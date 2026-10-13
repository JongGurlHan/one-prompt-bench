# 작업 인계 (PROGRESS)

> 새 대화형 세션은 이 파일부터 읽는다. 마지막 갱신: 2026-10-13 (phase 4 확인·merge 세션)
> 무인 step 세션(execute.py)은 이 파일을 읽을 필요 없다 — 필요한 맥락은 step 파일과 하네스가 준다.

## 지금 하는 일

aquagarden-bench를 참고한 LLM 벤치마크 사이트(One Prompt Bench) MVP. **phase 4(`04-codex-adapter`: Codex CLI 어댑터)까지 끝나 main에 merge됐다(`f0c0f59`).** 이제 세 도구(Gemini·Claude Code·Codex) 어댑터가 모두 있다. 다음은 사람 작업 — Codex smoke, 8개 일괄 생성과 검증 — 그리고 phase 5 계획이다. 설계는 전부 `docs/`에 있다(CLAUDE.md "문서" 절). 공개 사이트: https://jonggurlhan.github.io/one-prompt-bench/

## 진행 상태

- [x] phase 1~3 완료·main merge, 첫 배포(2026-10-13), Gemini·Claude smoke → fixture, Gemini 3.8 Flash 생성(`eac58e0`)
- [x] phase 4 계획(2026-10-13, ADR-027, ARCHITECTURE "Codex CLI"를 0.157.1 소스로 다시 씀)
- [x] phase 4 실행(step 0 `codex-adapter`·step 1 `codex-preflight-smoke` 모두 첫 시도에 완료, 정가 환산 $6.94·90턴, 한도 걸림 없음) → 확인(이 PC에서 lint·typecheck·test(core 86 / pipeline 347+건너뜀 3 / site 53)·build·check:results 통과) → main `--no-ff` merge(`f0c0f59`)
- [x] phase 4 handoff → `docs/ARCHITECTURE.md`(Codex 구현 줄, 공용 기록기 `adapters/cli-recorder.ts`, `runSync` 이동, 에러 문구 고르는 순서, 로그인 판정 규칙, ⚠ 두 개 추가). 이 PROGRESS 갱신과 함께 `docs:` 커밋
- [ ] 사람 작업: Codex smoke → 8개 일괄 생성과 검증
- [ ] phase 5 `05-…`(PRD "개발 순서" 5번: 판정 도우미, 비교표·프롬프트·소개 탭, 휴대폰 화면, README) → 8개 판정

## 다음 세션이 바로 할 일

1. Codex smoke: 사용자가 `! npm run smoke -- gpt-6-1-sol`을 실행한다. 끝나면 `results-smoke/gpt-6-1-sol-<시각>/raw-stdout.txt`(JSONL)를 고치지 않고 `pipeline/test/fixtures/codex/`로 복사해 테스트를 더하고, README 표에 **실제**로 적는다. ARCHITECTURE "Codex CLI"의 ⚠를 확정한다: 입력 토큰 규모, Hello에도 `reasoning_output_tokens`가 나오는가, `output_tokens`가 추론을 포함하는가, 모델이 명령 실행·파일 쓰기를 시도하는가, stderr 내용(사용자 폴더 경로가 찍히는가 — 에러 때 meta.json message로 공개된다), `codex login status`가 stderr 첫 줄에 결과를 쓰는가(앞에 경고 줄이 오면 preflight가 지금은 실패로 멈춘다).
2. 일괄 생성: 사용자가 `! npm run gen -- --all`(Gemini는 이미 있어 건너뛰고 7개). Claude 3개는 Pro 한도, Codex 4개는 ChatGPT 한도를 쓴다 — 한도에 걸린 모델은 `api_failed`로 남고 다시 실행하면 그 모델만 돈다. 끝나면 `npm run check:results` → `data:` 커밋. Claude 생성의 reasoningTokens로 `--effort high` 적용을 확인한다(ARCHITECTURE "Claude Code CLI" ⚠). 그다음 phase 5를 `/harness`로 계획한다.

## 사용자 결정·답변

- 문서에 옮기지 않은 결정은 없다. 2026-10-13에 `ANTHROPIC_AUTH_TOKEN`·`ANTHROPIC_BASE_URL`을 자식 환경에서 지우는 일을 "아직 하지 않는다"로 미뤘다(OPERATIONS "나중에 정할 것"에 기록).

## 주의할 점

- git: origin/main = `6f73b94`. main은 그보다 10커밋 앞서 있다(phase 4 계획·실행·merge·문서). main에 push하면 배포 워크플로가 돈다 — phase 4가 더한 `codex-bin` POSIX 테스트가 CI에서 처음 돈다. 원격 `feat-02-validator-results-tab`은 `209e652`까지만 올라가 있다.
- gh 계정: 이 PC의 `gh`에 JongGurlHan·LeoMetascale 두 계정이 있고, 사용자가 **활성 계정을 JongGurlHan으로 두라고 했다**(2026-10-13, LeoMetascale로 되돌리지 않는다). JongGurlHan 토큰에는 `workflow` 권한이 있다. LeoMetascale이 활성이면 push가 workflow 권한 없음으로 거부된다.
- 이 PC 환경(2026-10-12 확인): Claude Code 2.1.296, codex-cli 0.157.1, Node 24.14, npm 11.9, Python 3.12, Windows + Git Bash. 환경변수에 ANTHROPIC/OPENAI/GEMINI 키 없음. `~/.codex/config.toml` 있음(생성 때 `--ignore-user-config`로 무시). `.env`에 GEMINI_API_KEY 있음(값은 읽지 않는다).
- Claude Code 안에서 `!`로 실행한 명령은 `CLAUDECODE`·`CLAUDE_EFFORT`·`CLAUDE_CODE_SESSION_ID` 등을 물려받는다. `cliEnv`가 자식 CLI의 환경에서 지운다(Claude smoke에서 동작 확인).
- Claude smoke·생성과 Claude Code 개발이 같은 Pro 한도를 쓴다. 일괄 생성은 개발 세션을 쉬는 동안 하는 게 낫다.
- `npm test`가 실제 Chromium을 띄운다(네트워크는 테스트가 전부 가로챈다). Chromium이 없으면 `npx playwright install chromium`.
- check:results는 결과 폴더 안에 meta.json이 가리키지 않는 파일(judgment.json 제외)이나 하위 폴더가 있어도 실패한다. 생성 뒤 `results/`에 다른 파일을 두지 않는다.
- 첫 실제 결과(`results/gemini-3-8-flash/`): 모델 코드가 THREE.Color에 없는 `addScaledColor`를 매 프레임 불러(index.html 555행) 화면이 검고 계절 패널이 "봄"에 멈춘다(에러 2105). 모델 결과이므로 그대로 둔다(ADR 철학 2). 판정 때 ✗. 결과 탭에는 "에러 수"가 보인다(ADR-026).
- 일괄 생성에서 무한 루프로 검증이 끝나지 않는 결과가 나오면 그때 처리 방법을 정한다(OPERATIONS "나중에 정할 것").
- Mono 자리의 한글은 Plex Sans KR 글자로 그려지지만 단어 사이 공백은 Mono 고정폭이라 조금 넓다(UI_GUIDE대로 둠).
- 훅은 Claude 세션의 Bash 명령만 검사한다. 사람이 `!`로 실행한 명령과 execute.py가 띄우는 `claude -p`는 막지 않는다(의도된 동작). `npm run validate`는 results/를 바꾸므로 사람이 지시할 때만 쓴다.
- 루트의 빈 `migra/` 폴더는 사용자가 만든 것으로 보이며 git에 잡히지 않는다. 용도를 모르면 사용자에게 묻는다.
