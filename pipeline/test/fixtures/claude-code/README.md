# Claude Code 어댑터 fixture

`claude -p --output-format json`이 stdout에 쓰는 JSON 객체 하나를 그대로 담는다.

**실제 출력은 `stdout-usage-limit.json`과 `stdout-smoke-ok.json` 두 개다.** 나머지는 합성이다.

- `stdout-usage-limit.json`: 2026-10-12 하네스(`scripts/execute.py`)가 띄운 Claude Code 2.1.296 세션이 Pro 세션 한도에 걸렸을 때의 stdout을 고치지 않고 복사했다. exit code 1, stderr는 비어 있었다. 하네스 세션은 도구를 쓰는 여러 턴 세션이라 `usage`·`num_turns`가 생성 호출(`--tools ""`, 한 턴)과 다르다. 필드 모양을 보는 용도다.
- `stdout-smoke-ok.json`: 2026-10-13 `npm run smoke -- claude-haiku-5-5`(Claude Code 2.1.296, 이 어댑터의 실제 호출 사양, 출력 상한 8,000)가 남긴 `results-smoke/claude-haiku-5-5-20261013-111045/raw-stdout.txt`를 바이트 그대로 복사했다. exit code 0, stderr는 비어 있었다.

| 파일 | 내용 |
|---|---|
| `stdout-usage-limit.json` | **실제**. `is_error: true`, `subtype: "success"`, `api_error_status: 429`, `api_error: "usage_limit_reached"`, `result: "You've hit your session limit · resets 8pm (Asia/Seoul)"`, `terminal_reason: "api_error"` |
| `stdout-smoke-ok.json` | **실제**. JSON 한 줄 + 끝 줄바꿈. `is_error: false`, `stop_reason: "end_turn"`, `terminal_reason: "completed"`, `result`는 ```` ```html ```` 블록 하나. `usage`: input 2 · cache_creation 653 · cache_read 0 · output 85 · thinking_tokens 0. `modelUsage` 키는 `claude-haiku-5-5` 하나 |
| `stdout-ok.json` | 합성. 정상 한 턴: `is_error: false`, `stop_reason: "end_turn"`, ```` ```html ```` 블록이 든 `result`, `usage`에 캐시 입력·`output_tokens_details.thinking_tokens`, `modelUsage` 키 하나 |
| `stdout-max-tokens.json` | 합성. `is_error: false`, `stop_reason: "max_tokens"`, 잘린 `result`. ⚠ 실제로 출력 상한에서 이렇게 끝나는지(에러로 끝나는지)는 모른다 |
| `stdout-refusal.json` | 합성. `is_error: false`, `stop_reason: "refusal"`. ⚠ 실제 거부 표시는 모른다 |
| `stdout-overloaded-529.json` | 합성. `is_error: true`, `api_error_status: 529`, `result`는 "API Error: 529 …" 모양. `api_error` 값은 몰라서 넣지 않았다 |
| `stdout-auth-401.json` | 합성. `is_error: true`, `api_error_status: 401`. `api_error` 없음 |
| `stdout-error-no-status.json` | 합성. `is_error: true`인데 `api_error_status: null`·`api_error` 없음, `result`에 한도 문구만 있다(문구로 한도를 알아보는 경로) |
| `stdout-not-json.txt` | 합성. JSON이 아닌 stdout |
| `auth-status-claude-ai.json` | 합성. `claude auth status --json`의 claude.ai 구독 로그인. 필드 이름은 ARCHITECTURE "로그인 점검"을 따랐고 email·orgId·orgName은 가짜 값(`user@example.com`) |
| `auth-status-other-method.json` | 합성. 로그인돼 있지만 `authMethod`가 claude.ai가 아니다. 값 `example-other-method`는 지어낸 것이다(API 키 로그인의 실제 값은 ⚠) |
| `auth-status-logged-out.json` | 합성. `{"loggedIn": false}`만. 로그아웃 때 다른 필드가 오는지는 모른다 |

합성 fixture는 위 실제 출력과 `docs/ARCHITECTURE.md` "도구별 호출 사양 → Claude Code CLI"의 필드 설명에 맞춰 같은 이름·모양으로 만들었다. 실제 출력인 척하지 않도록 session_id·uuid는 0으로 채웠고, 정상·잘림·거부의 `result` 본문에는 "합성 fixture"라고 적었다. 에러 fixture의 `result` 문구는 분류 경로를 보려고 만든 것이라 실제 문구와 다를 수 있다.

잘림(max_tokens)·거부·529·401 같은 출력을 실제로 만나면 smoke의 `raw-stdout.txt`는 그대로 복사해 fixture로 더하고(생성(gen)은 원본 stdout을 남기지 않으니 meta.json의 에러 message를 참고한다), ARCHITECTURE의 ⚠ 항목을 확정한다.
