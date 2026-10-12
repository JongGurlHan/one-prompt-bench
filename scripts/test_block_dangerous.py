"""
.claude/hooks/block_dangerous.py 테스트.
Claude Code PreToolUse 규약대로 stdin JSON을 넣고 종료 코드를 확인한다 (2 = 차단).
"""

import json
import subprocess
import sys
from pathlib import Path

import pytest

HOOK = Path(__file__).resolve().parent.parent / ".claude" / "hooks" / "block_dangerous.py"


def run_hook(command: str, tool_name: str = "Bash") -> subprocess.CompletedProcess:
    payload = {"hook_event_name": "PreToolUse", "tool_name": tool_name, "tool_input": {"command": command}}
    return subprocess.run([sys.executable, str(HOOK)], input=json.dumps(payload),
                          capture_output=True, text=True, encoding="utf-8")


@pytest.mark.parametrize("cmd", [
    "rm -rf /",
    "rm -fr build",
    "rm -Rf node_modules",
    "rm -r -f dist",
    "rm --recursive --force dist",
    "cd src && rm -rf ..",
    # 옵션 순서·표기 변형 (회귀: -f 가 -r 보다 앞이거나 긴 옵션만 쓰면 통과했다)
    "rm -f -r dist",
    "rm --force --recursive dist",
    "rm -r --force dist",
    "sudo rm -rf /tmp/x",
    "find . -name cache -exec rm -rf {} +",
    "bash -c 'rm -rf dist'",
    "git push --force origin main",
    "git push -f",
    "git push origin main --force-with-lease",
    "git push -uf origin x",
    "git push -fu origin x",
    "git push origin +main",
    "git reset --hard HEAD~1",
    "git clean -fdx",
    "git clean -xdf",
    # git 전역 옵션 (회귀: git 바로 뒤에 하위 명령이 와야만 잡았다)
    "git -C . reset --hard HEAD",
    "git -c core.pager=cat push --force",
    "git --no-pager clean -fdx",
    # 옵션 바로 뒤의 구분자·따옴표로 묶인 인자 (회귀: 옵션 뒤에 공백이나 끝이 와야만 잡았다)
    "git push -f; echo done",
    "git push -f|cat",
    "(git push -f)",
    "rm -r dist -f; echo done",
    "rm -r dist -f&& echo done",
    'git -C "C:/My Project" reset --hard HEAD',
    "git -C 'my dir' clean -fd",
    # Windows (Bash 도구에서 cmd 를 거쳐 실행)
    "cmd //c rd /s /q build",
    "cmd /c rmdir /S /Q build",
    "psql -c 'DROP TABLE users'",
    "psql -c 'drop database prod'",
])
def test_blocks_dangerous(cmd):
    r = run_hook(cmd)
    assert r.returncode == 2, cmd
    assert "BLOCKED" in r.stderr


@pytest.mark.parametrize("cmd", [
    "rm file.txt",
    "rm -f file.txt",
    "rm -r empty_dir",
    "rm -r build; ls -f",  # -f 는 다른 명령의 옵션이다
    "git rm -r --cached foo",
    "git push origin feat-mvp",
    "git push --follow-tags origin feat-mvp",
    "git push origin feat+x",
    "git -C sub status",
    'git -C "C:/My Project" status',
    "git reset --soft HEAD~1",
    "git reset HEAD~1 && echo --hard",
    "git clean -n",
    "git clean -e cache -n",
    "npm run build && npm test",
    "echo 'format the drive'",
])
def test_allows_safe(cmd):
    assert run_hook(cmd).returncode == 0, cmd


@pytest.mark.parametrize("cmd", [
    # 실제 모델 호출 — 구독 한도·요금을 쓴다. 사람이 직접 실행한다 (docs/OPERATIONS.md)
    "npm run gen -- claude-opus-5-5",
    "npm run gen -- --all --force",
    "npm run generate",
    "npm run smoke -- gemini-3-8-flash",
    "npm -w pipeline run gen -- gpt-6-sol",
    "npm run --workspace pipeline smoke",
    "cd pipeline && npm run smoke",
    "codex exec -m gpt-6-sol --json -",
    "codex -c model_reasoning_effort=high exec 'hi'",
    "claude -p 'hello'",
    "echo hi | claude --print --model claude-haiku-5-5",
    "curl -s https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",
    "FOO=1 npm run gen -- gpt-6-sol",
    "ls && (codex exec -)",
    "echo $(claude -p hi)",
    # 파이프라인 진입점 직접 실행 — npm 스크립트를 거치지 않아도 안에서 실제 도구를 띄운다
    "npx tsx pipeline/src/main.ts gen gemini-3-8-flash",
    "npx tsx pipeline/src/main.ts smoke claude-haiku-5-5",
    "cd pipeline && npx tsx src/main.ts smoke gpt-6-sol",
    "tsx src/main.ts generate --all",
    "node pipeline/dist/main.js gen --all --force",
    "node --import tsx pipeline/src/main.ts smoke gemini-3-8-flash",
    "npm exec -w pipeline -- tsx src/main.ts gen gpt-6-sol",
    "npx tsx pipeline/src/main.ts --verbose smoke x",
])
def test_blocks_live_generation(cmd):
    r = run_hook(cmd)
    assert r.returncode == 2, cmd
    assert "BLOCKED" in r.stderr and "! " in r.stderr  # 사람이 직접 실행하는 방법을 안내한다


@pytest.mark.parametrize("cmd", [
    "cat .env",
    "cat ./.env",
    "head -5 pipeline/.env",
    "grep GEMINI .env",
    "cat .env.local",
    "echo $GEMINI_API_KEY",
    'echo "${GEMINI_API_KEY}"',
    "printenv GEMINI_API_KEY",
])
def test_blocks_secret_reads(cmd):
    r = run_hook(cmd)
    assert r.returncode == 2, cmd
    assert "BLOCKED" in r.stderr


@pytest.mark.parametrize("cmd", [
    "npm run gen:types",
    "npm run validate -- --all",
    "npm run judge -- claude-opus-5-5",
    "npm test -w pipeline",
    "npm run test -- --test-name-pattern smoke",
    "codex --version",
    "codex exec --help",
    "claude --version",
    "claude --help",
    "claude auth status",
    "cat .env.example",
    "cp .env.example .env",
    "ls -la .env",
    "grep -rn GEMINI_API_KEY pipeline/src",
    "git diff -- .gitignore",
    # 명령이 아니라 글 속에 나온 경우 (회귀: heredoc·커밋 메시지 안의 단어로 차단됐다)
    'git commit -m "docs: codex exec 사용법과 claude -p 금지 정리"',
    'echo "npm run gen 은 사람이 실행"',
    "python - <<'EOF'\ns = '- [x] hook: 실호출(gen/smoke/claude -p/codex exec/Gemini API) 차단'\nEOF",
    "grep -n 'generativelanguage.googleapis.com' docs/ARCHITECTURE.md",
    "git commit -m 'chore: .env 읽기를 cat 으로 하지 않게'",
    # 같은 진입점이라도 실제 모델을 부르지 않는 하위 명령·도움말·테스트
    "npx tsx pipeline/src/main.ts validate gpt-6-sol",
    "npx tsx pipeline/src/main.ts judge gpt-6-sol --scene pass",
    "npx tsx pipeline/src/main.ts gen --help",
    "npx tsx --test pipeline/test/generation/batch.test.ts",
    'git commit -m "feat: main.ts에 gen 명령 추가"',
    "grep -n 'main.ts smoke' docs/ARCHITECTURE.md",
])
def test_allows_project_safe(cmd):
    assert run_hook(cmd).returncode == 0, cmd


def test_ignores_non_bash_tool():
    assert run_hook("rm -rf /", tool_name="Write").returncode == 0


def test_invalid_json_does_not_crash():
    r = subprocess.run([sys.executable, str(HOOK)], input="not json", capture_output=True, text=True)
    assert r.returncode == 0
