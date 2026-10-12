# 작업 인계 (PROGRESS)

> 새 대화형 세션은 이 파일부터 읽는다. 마지막 갱신: 2026-10-13 (phase 3 계획 세션)
> 무인 step 세션(execute.py)은 이 파일을 읽을 필요 없다 — 필요한 맥락은 step 파일과 하네스가 준다.

## 지금 하는 일

aquagarden-bench를 참고한 LLM 벤치마크 사이트(One Prompt Bench) MVP. phase 2까지 끝나 main에 merge됐고, 첫 실제 생성(Gemini 3.8 Flash)을 커밋했다(`eac58e0`). **phase 3(`03-deploy-claude-adapter`: 배포 워크플로 + Claude Code 어댑터) 계획을 만들어 실행을 기다리는 중이다.** 설계는 전부 `docs/`에 있다(CLAUDE.md "문서" 절).

## 진행 상태

- [x] 하네스 정비·기획 보완(docs 7종, 훅, execute.py 한도 감지) — 2026-10-12
- [x] phase 1 `01-pipeline-core` 완료·main merge(`edebe5a`), Gemini smoke → fixture
- [x] phase 2 `02-validator-results-tab` 완료 → 확인 → main merge(`d35d3f2`) → handoff를 docs로, COPY 문구 2개·Mono 한글 글꼴 수정
- [x] 사람 작업: Gemini 3.8 Flash 생성(2026-10-13) → check:results 통과 → `data:` 커밋(`eac58e0`), 레포 데이터로 build한 결과 탭 확인
- [x] phase 3 계획: `phases/03-deploy-claude-adapter/` step 0~2(public-deploy · cli-process · claude-code-adapter). 결정은 ADR-026과 ARCHITECTURE(Claude Code 절·배포 절)·COPY·UI_GUIDE·DATA·OPERATIONS에 반영, 실제 한도 초과 출력 fixture(`pipeline/test/fixtures/claude-code/`) 추가
- [ ] phase 3 실행 → 확인·merge → 사람 작업(Pages 설정, push로 첫 배포, Claude smoke)
- [ ] phase 4~5 (PRD.md "개발 순서")

## 다음 세션이 바로 할 일

1. phase 3가 아직 안 돌았으면 사용자가 `python scripts/execute.py 03-deploy-claude-adapter`를 실행한다(`git status`가 깨끗해야 한다, `phases/`는 예외).
2. phase 3가 끝났으면 `/harness` F 절차: summary·handoff와 `npm test` 확인 → 사용자가 main에 `--no-ff` merge → handoff 결정을 docs로.
3. 사람 작업 안내:
   - GitHub 레포 Settings → Pages → Source를 "GitHub Actions"로(2026-10-13 기준 Pages 미설정, 레포는 이미 공개).
   - `git push origin main` → Actions 로그 확인. 리눅스에서 처음 도는 것: 검증기 WebGL 픽스처 테스트, CLI 모듈의 POSIX 프로세스 종료. 실패하면 배포되지 않는다.
   - `! npm run smoke -- claude-haiku-5-5` → `results-smoke/`의 `raw-stdout.txt`를 `pipeline/test/fixtures/claude-code/`로 옮기고 ARCHITECTURE "Claude Code CLI"의 ⚠ 확정(입력 토큰 규모, modelUsage 모델 수, max_tokens·refusal 표시, API 키 로그인의 authMethod).
   - 그다음 phase 4 계획.

## 사용자 결정·답변

- 문서에 옮기지 않은 결정은 없다. 2026-10-13 phase 3 계획 때 고른 것(결과 탭 에러 수 행, 무한 루프는 실제로 나오면 처리)은 ADR-026·OPERATIONS "나중에 정할 것"에 있다.

## 주의할 점

- git: main이 origin/main보다 앞서 있다(push 안 함). phase 3 뒤 첫 배포 때 올린다. 원격 `feat-02-validator-results-tab`은 `209e652`까지만 올라가 있다.
- 이 PC 환경(2026-10-12 확인): Claude Code 2.1.296, codex-cli 0.157.1, Node 24.14, npm 11.9, Python 3.12, Windows + Git Bash. 환경변수에 ANTHROPIC/OPENAI/GEMINI 키 없음. `~/.codex/config.toml` 있음(생성 때 `--ignore-user-config`로 무시). `.env`에 GEMINI_API_KEY 있음(값은 읽지 않는다).
- Claude Code 안에서 `!`로 실행한 명령은 `CLAUDECODE`·`CLAUDE_EFFORT`·`CLAUDE_CODE_SESSION_ID` 등을 물려받는다(2026-10-13 확인). phase 3 CLI 모듈(`cliEnv`)이 자식 `claude -p`의 환경에서 지우도록 계획했다. 첫 Claude smoke에서 중첩 세션 거부 같은 문제가 나오면 이 부분을 먼저 본다.
- `npm test`가 실제 Chromium을 띄운다(네트워크는 테스트가 전부 가로챈다, 전체 약 35초). Chromium이 없으면 `npx playwright install chromium`.
- check:results는 결과 폴더 안에 meta.json이 가리키지 않는 파일(judgment.json 제외)이나 하위 폴더가 있어도 실패한다. 생성 뒤 `results/`에 다른 파일을 두지 않는다.
- 하네스 한도 감지(`209e652`)는 phase 2 step 3에서 실제로 동작했다(세션 한도 → blocked, 재시도 안 함). phase 2는 정가 환산 $19.69, 258턴 — Pro 세션 한도가 phase 도중에 걸릴 수 있고, Claude smoke·생성도 같은 한도를 쓴다.
- 첫 실제 결과(`results/gemini-3-8-flash/`): 모델 코드가 THREE.Color에 없는 `addScaledColor`를 매 프레임 불러(index.html 555행) 화면이 검고 계절 패널이 "봄"에 멈춘다(에러 2105, 스크린샷 4장 동일). 모델 결과이므로 그대로 둔다(ADR 철학 2). 판정 때 ✗. meta.json 110KB.
- Mono 자리의 한글은 Plex Sans KR 글자로 그려지지만 단어 사이 공백은 Mono 고정폭이라 조금 넓다(UI_GUIDE대로 둠).
- 훅은 Claude 세션의 Bash 명령만 검사한다. 사람이 `!`로 실행한 명령과 execute.py가 띄우는 `claude -p`는 막지 않는다(의도된 동작). `npm run validate`는 results/를 바꾸므로 사람이 지시할 때만 쓴다.
- 루트의 빈 `migra/` 폴더는 사용자가 만든 것으로 보이며 git에 잡히지 않는다. 용도를 모르면 사용자에게 묻는다.
