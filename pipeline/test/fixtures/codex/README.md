# Codex CLI 어댑터 fixture

`codex exec --json`이 stdout에 쓰는 이벤트 JSON 줄(JSONL)과, `codex login status`가 stderr에 쓰는 한 줄(`login-status-*.txt`)을 담는다.

**모두 합성이다 — Codex 0.157.1 공개 소스 기준(`openai/codex` 태그 `rust-v0.157.1`의 `codex-rs/exec/src/exec_events.rs`).** 실제 `codex`를 띄워 받은 출력은 아직 없다. Codex smoke(`npm run smoke -- <OpenAI 모델 slug>`) 뒤 `results-smoke/<slug>-<시각>/raw-stdout.txt`를 고치지 않고 그대로 복사해 더하고, 이 README에 **실제**라고 적는다.

| 파일 | 내용 |
|---|---|
| `stdout-ok.jsonl` | 합성. 정상: `thread.started` → `turn.started` → `reasoning` item → `agent_message` item(```` ```html ```` 블록) → `turn.completed`. `usage`: input 5,200(캐시 읽기 3,072·캐시 쓰기 512 포함) · output 9,800(추론 4,100 포함) |
| `stdout-command-failed.jsonl` | 합성. 정상인데 모델이 명령 실행을 시도했다: `command_execution` item이 `item.started`(`in_progress`) → `item.completed`(`failed`, exit_code 1) 뒤 `agent_message` → `turn.completed`. ⚠ 실제로 모델이 명령·파일 쓰기를 시도하는지는 모른다 |
| `stdout-usage-limit.jsonl` | 합성. `error` + `turn.failed`, 문구 `You’ve hit your usage limit.`(굽은 따옴표, ARCHITECTURE 기준) 뒤는 지어낸 것이다 |
| `stdout-auth-401.jsonl` | 합성. `error` + `turn.failed`, `unexpected status 401 Unauthorized: …` |
| `stdout-server-503.jsonl` | 합성. `error` + `turn.failed`, `unexpected status 503 Service Unavailable: …` |
| `stdout-stream-disconnected.jsonl` | 합성. `error` + `turn.failed`, `stream disconnected before completion: …` |
| `stdout-incomplete.jsonl` | 합성. 출력 잘림: `error` + `turn.failed`, `stream disconnected before completion: Incomplete response returned, reason: max_output_tokens` |
| `stdout-not-json.txt` | 합성. `thread.started` 한 줄 뒤 JSON이 아닌 줄 |
| `login-status-chatgpt.txt` | 합성. `codex login status`의 **stderr**: `Logged in using ChatGPT` (exit 0, 2026-10-13 이 PC 출력과 같은 문구 — ARCHITECTURE "로그인 점검") |
| `login-status-api-key.txt` | 합성. stderr `Logged in using an API key - <가린 키>` (exit 0). 가린 키 `sk-fake0***FAKE9`는 지어낸 값이다(소스의 "앞 8자 + `***` + 끝 5자" 모양). preflight 출력에 나오면 안 되는 값으로 쓴다 |
| `login-status-not-logged-in.txt` | 합성. stderr `Not logged in` (exit 1, 소스 기준) |

- 이벤트 `type`·필드 이름(`thread_id`, `item.id`·`item.type`·`text`, `usage`의 `input_tokens`·`cached_input_tokens`·`cache_write_input_tokens`·`output_tokens`·`reasoning_output_tokens`, `turn.failed`의 `error.message`, `error`의 `message`)은 ARCHITECTURE "Codex CLI"의 출력 절을 따랐다. `command_execution`의 `command`·`aggregated_output`·`exit_code`·`status`는 같은 소스 파일 기준이고 어댑터는 읽지 않는다.
- 실제 출력인 척하지 않도록 `thread_id`는 0으로 채웠고, 본문·에러 문구에 "합성 fixture"라고 적었다(잘림 문구는 분류 경로를 보려고 ARCHITECTURE 문구 그대로 두었다). 토큰 수는 예시다.
- 실패 fixture의 exit code(테스트는 1로 둔다)와 stderr는 소스로만 본 가정이다. 에러 문구는 분류 경로를 보려고 만든 것이라 실제와 다를 수 있다.
- 본문은 stdout이 아니라 `-o`로 받은 `last-message.txt`에서 읽는다. 테스트의 가짜 실행 함수(`pipeline/test/codex-fakes.ts`)는 fixture에 `turn.completed`가 있으면 마지막 `agent_message`의 `text`를 `-o` 경로에 써서 Codex를 흉내 낸다(실패 fixture는 쓰지 않는다).

에러(한도 초과·401·503·스트림 끊김·잘림)를 실제로 만나면 smoke의 `raw-stdout.txt`는 그대로 복사해 fixture로 더하고(생성(gen)은 원본 stdout을 남기지 않으니 meta.json의 에러 message를 참고한다), ARCHITECTURE의 ⚠ 항목을 확정한다.
