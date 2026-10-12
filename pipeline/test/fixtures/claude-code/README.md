# Claude Code 어댑터 fixture

`claude -p --output-format json`이 stdout에 쓰는 JSON 객체 하나를 그대로 담는다.

**`stdout-usage-limit.json`만 실제 출력이다.** 2026-10-12 하네스(`scripts/execute.py`)가 띄운 Claude Code 2.1.296 세션이 Pro 세션 한도에 걸렸을 때의 stdout을 고치지 않고 복사했다. exit code 1, stderr는 비어 있었다. 하네스 세션은 도구를 쓰는 여러 턴 세션이라 `usage`·`num_turns`가 생성 호출(`--tools ""`, 한 턴)과 다르다. 필드 모양을 보는 용도다.

| 파일 | 내용 |
|---|---|
| `stdout-usage-limit.json` | **실제**. `is_error: true`, `subtype: "success"`, `api_error_status: 429`, `api_error: "usage_limit_reached"`, `result: "You've hit your session limit · resets 8pm (Asia/Seoul)"`, `terminal_reason: "api_error"` |

나머지 fixture(정상·출력 상한·거부·서버 오류·로그인 상태 등)는 phase 3 step이 위 실제 출력과 `docs/ARCHITECTURE.md` "도구별 호출 사양 → Claude Code CLI"의 필드 설명에 맞춰 합성한다. 합성한 파일은 이 표에 "합성"으로 적는다.

Claude smoke(`npm run smoke -- <claude 모델>`)를 하면 `results-smoke/<slug>-<시각>/raw-stdout.txt`를 그대로 복사해 실제 정상 출력 fixture로 더하고, ARCHITECTURE의 ⚠ 항목을 확정한다.
