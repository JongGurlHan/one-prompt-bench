#!/usr/bin/env python3
"""
PreToolUse(Bash) 훅 — 되돌리기 어려운 명령, 실제 모델 호출, 비밀값 출력을 차단한다.

Claude Code 규약: 도구 입력은 stdin JSON으로 들어오고, exit 2 + stderr 가 차단 신호다.
(exit 1 은 차단되지 않는 일반 오류로 처리된다.)

정규식 기반의 과속방지턱일 뿐 샌드박스가 아니다. settings.json 의 permissions.deny 와 함께 쓴다.
실제 모델 호출(생성·smoke)은 구독 한도와 요금을 쓰므로 사람이 `! <명령>`으로 직접 실행한다.
`!` 로 실행한 명령은 이 훅을 거치지 않는다. (docs/OPERATIONS.md)
"""

import json
import re
import sys

# 옵션은 같은 단순 명령 안에서만 본다 (; & | 줄바꿈에서 끊는다). 순서·묶음(-rf, -f -r)·긴 이름을 모두 잡는다.
SEG = r"[^;&|\n]*"
END = r"(?=[\s;&|)]|$)"  # 옵션 바로 뒤에 구분자가 붙어도(-f; -f| -f)) 옵션의 끝으로 본다
ARG = r"""(?:"[^"]*"|'[^']*'|\S+)"""  # 따옴표로 묶인 인자는 공백을 포함한다
GIT = rf"\bgit(?:\s+(?:-[Cc]\s+{ARG}|-[^\s=]+(?:={ARG})?))*\s+"  # -C path, -c k=v, --no-pager 같은 전역 옵션을 건너뛴다
RECURSIVE = rf"\s(?:-[a-zA-Z]*[rR][a-zA-Z]*|--recursive){END}"
FORCE = rf"\s(?:-[a-zA-Z]*f[a-zA-Z]*|--force[^\s;&|)]*){END}"

NO_HELP = rf"(?!{SEG}\s(?:--help|-h){END})"  # --help 로 옵션을 확인하는 것은 호출이 아니다
# 명령 자리(줄·구분자·서브셸 시작 뒤, VAR=값·sudo·npx 접두 허용). 커밋 메시지·heredoc 안의 같은 단어는 걸리지 않는다
CMD = r"(?:^|[;&|(\n`]|\$\()\s*(?:\w+=\S*\s+)*(?:(?:sudo|npx|exec|xargs)\s+)?"
LIVE_SCRIPTS = r"(?:gen|generate|smoke)"  # 실제 모델을 부르는 npm 스크립트 (docs/ARCHITECTURE.md 명령어)
# 파이프라인 진입점(pipeline/src/main.ts, 빌드된 main.js). 진입점 파일 이름을 바꾸면 이 패턴과 테스트도 바꾼다
ENTRY = r"\bmain\.[cm]?[jt]s(?=[\s;&|)]|$)"
ENV_FILE = r"(?:^|[\s/'\"=])\.env(?:\.(?!example\b|sample\b|template\b)[\w.-]+)?(?=[\s;&|)'\"]|$)"
READERS = r"\b(?:cat|head|tail|less|more|bat|type|grep|egrep|rg|sed|awk|strings|xxd|od|nl|source)\b"

DANGER = "위험한 명령({label})이 감지되었습니다. 다른 방법을 사용하세요."
LIVE = ("실제 모델 호출({label})은 구독 한도·요금을 씁니다. 사람이 지시한 경우에도 직접 실행하게 안내하세요: "
        "! <명령>  (docs/OPERATIONS.md)")
SECRET = "비밀값을 출력하는 명령({label})입니다. 키 값은 읽거나 출력하지 마세요."

PATTERNS = [
    (rf"\brm\b(?={SEG}{RECURSIVE})(?={SEG}{FORCE})", "rm -rf", DANGER),
    (rf"{GIT}push\b(?={SEG}(?:{FORCE}|\s\+\S))", "git push --force", DANGER),  # +refspec 도 강제 push 다
    (rf"{GIT}reset\b(?={SEG}\s--hard\b)", "git reset --hard", DANGER),
    (rf"{GIT}clean\b(?={SEG}{FORCE})", "git clean -f", DANGER),
    (rf"(?i)\b(?:rd|rmdir)\b(?={SEG}\s/s\b)", "rd /s", DANGER),
    (r"(?i)\bdrop\s+(table|database|schema)\b", "DROP TABLE/DATABASE", DANGER),
    # run 뒤의 옵션(-w pipeline 등)을 건너뛴 첫 인자가 스크립트 이름이다. `npm test -- smoke` 같은 인자는 걸리지 않는다
    (rf"{CMD}npm\b{SEG}\s(?:run|run-script)(?:\s+-\S+(?:\s+[^-\s;&|]\S*)?)*\s+{LIVE_SCRIPTS}{END}",
     "npm run gen/smoke", LIVE),
    # npm 스크립트를 거치지 않고 진입점을 직접 실행해도 안에서 claude -p·codex exec·Gemini API를 부른다 (훅은 자식 프로세스를 못 본다)
    (rf"{CMD}(?:tsx|node|ts-node|npm|pnpm|yarn)\b{SEG}{ENTRY}{SEG}\s{LIVE_SCRIPTS}{END}{NO_HELP}",
     "파이프라인 진입점 gen/smoke", LIVE),
    (rf"{CMD}codex\b(?={SEG}\sexec\b){NO_HELP}", "codex exec", LIVE),
    (rf"{CMD}claude\b(?={SEG}\s(?:-p|--print){END}){NO_HELP}", "claude -p", LIVE),
    (rf"{CMD}(?:curl|wget|http|https)\b{SEG}generativelanguage\.googleapis\.com", "Gemini API", LIVE),
    (rf"{CMD}{READERS}(?={SEG}{ENV_FILE})", ".env 읽기", SECRET),
    (rf"{CMD}(?:echo|printf|printenv)\b(?={SEG}\b\w*_API_KEY\b)", "API 키 출력", SECRET),
]


def main():
    try:
        payload = json.loads(sys.stdin.read())
    except ValueError:
        return 0
    if payload.get("tool_name") != "Bash":
        return 0
    command = (payload.get("tool_input") or {}).get("command", "")
    for pattern, label, template in PATTERNS:
        if re.search(pattern, command):
            msg = f"BLOCKED: {template.format(label=label)}\n"
            sys.stderr.buffer.write(msg.encode("utf-8"))  # Windows 기본 코덱(cp949)이면 메시지가 깨진다
            sys.stderr.flush()
            return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
