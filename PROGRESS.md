# 작업 인계 (PROGRESS)

> 새 대화형 세션은 이 파일부터 읽는다. 마지막 갱신: 2026-10-14 (ADR-032 1단계 완료·phase 6 계획 세션)
> 무인 step 세션(execute.py)은 이 파일을 읽을 필요 없다 — 필요한 맥락은 step 파일과 하네스가 준다.

## 지금 하는 일

aquagarden-bench를 참고한 LLM 벤치마크 사이트(One Prompt Bench) MVP. phase 5까지 main에 merge됐다(**아직 push 전**, origin/main `17bf737`). 판정 전 확인에서 GPT-6 Sol(배경만)·Gemini 3.8 Flash(검은 화면)가 나무를 그리지 못했고, 사용자가 원칙을 **ADR-032**로 정했다: 공개 결과물은 나무가 그려지는 것이 전제 → 같은 프롬프트로 다시 생성(총 3회) → 브라우저 에러를 알려 주고 모델이 고치게 함(2회, 수정 요청문 `prompts/season-tree-v1.repair.md`) → 그래도 안 되면 수록 제외. 모든 과정은 결과 탭 안내 박스·비교표 "생성 횟수"로 공개(ADR-031은 ADR-032로 대체). 설계는 전부 `docs/`에 있다(CLAUDE.md "문서" 절).

## 진행 상태

- [x] phase 1~5 완료·main merge, 8개 모델 생성·검증 커밋(마지막 배포 run 38372942894)
- [x] ADR-031(2026-10-13) → ADR-032(2026-10-14) 결정과 문서 반영(ADR·PRD·DATA·COPY·UI_GUIDE·OPERATIONS·ARCHITECTURE, 수정 요청문 `prompts/season-tree-v1.repair.md`, `9cee1f5`)
- [x] ADR-032 1단계(다시 생성) 완료 — 8개 모두 나무가 그려진다(2026-10-14, `7a16e18`): GPT-6 Sol 3회째(앞선 `f0e6988`·`a766e4f`는 첫 프레임 `elapsed` 음수로 멈춤), Gemini 3.8 Flash 2회째(앞선 `eac58e0`은 `addScaledColor`로 검은 화면, 그 사이 `--force` 한 번은 503으로 응답 없음 → 횟수에 안 넣음). 두 결과물 모두 에러 0, 새로 열기 4번씩 멈춤 없음
- [x] 사용자 결정(2026-10-14): 수정 요청(`gen --repair`)은 실제로 필요해질 때 만든다(ADR-032·PRD·ARCHITECTURE·DATA·OPERATIONS에 기록). 수록 제외도 같음
- [x] phase 6 계획: `phases/06-regeneration-disclosure`(step 0 `discarded-record` — 스키마·check:results·display·`models.json` 기록 3개·`--force` 버리기 전 커밋 검사 / step 1 `regeneration-disclosure` — 결과 탭 안내 박스·비교표 "생성 횟수" 열·각주 ¶·바뀐 문구)
- [ ] phase 6 실행(`python scripts/execute.py 06-regeneration-disclosure`, 사용자) → 확인 → main `--no-ff` merge
- [ ] 8개 판정(`npm run judge -- <slug>`) → 커밋 → push(배포) → 리눅스 CI(phase 5·6 브라우저 테스트가 처음 돈다) 확인

## 다음 세션이 바로 할 일

1. phase 6이 끝났으면 `feat-06-regeneration-disclosure`를 확인한다(step summary·handoff, 이 PC에서 lint·typecheck·test·build·check:results). 사이트에서 GPT-6 Sol(3회)·Gemini(2회)·Sonnet(2회, "기록은 남아 있지 않아요")의 안내 박스와 비교표 열을 본다. handoff의 문서 반영 거리를 `docs/`로 옮기고(특히 DATA "스키마 변경 예정"에서 반영된 `discarded`를 본문으로) merge를 안내한다.
2. merge 뒤 8개 판정을 안내한다(OPERATIONS "판정"). 판정 값은 사용자가 정한다. 그다음 push.
3. push는 phase 6 merge와 판정 뒤에 한다. 그 전에 push하면 다시 생성한 결과물이 아무 표시 없이 공개된다.

## 사용자 결정·답변

- 문서에 옮기지 않은 결정은 없다. 2026-10-13에 `ANTHROPIC_AUTH_TOKEN`·`ANTHROPIC_BASE_URL`을 자식 환경에서 지우는 일을 "아직 하지 않는다"로 미뤘다(OPERATIONS "나중에 정할 것").

## 주의할 점

- git: origin/main = `17bf737`(배포됨). main에 push하면 배포 워크플로가 돈다. 원격 `feat-02-validator-results-tab`은 `209e652`까지만 올라가 있다. 로컬에 `feat-01`~`feat-05` 브랜치가 남아 있다. Windows를 흉내 내는 테스트에서 파일을 만들 때는 대소문자까지 실제 이름대로 만든다(리눅스 CI는 구분한다).
- `git merge --no-ff`를 브랜치 이름 없이 main에서 실행하면 upstream이 없어 실패한다(2026-10-13 사용자가 한 번 그랬다, 아무 일도 안 일어남).
- gh 계정: 이 PC의 `gh`에 JongGurlHan·LeoMetascale 두 계정이 있고, 사용자가 **활성 계정을 JongGurlHan으로 두라고 했다**(LeoMetascale로 되돌리지 않는다). JongGurlHan 토큰에는 `workflow` 권한이 있다. LeoMetascale이 활성이면 push가 workflow 권한 없음으로 거부된다.
- 이 PC 환경(2026-10-12 확인): Claude Code 2.1.296, codex-cli 0.162.1, Node 24.14, npm 11.9, Python 3.12, Windows + Git Bash. 환경변수에 ANTHROPIC/OPENAI/GEMINI 키 없음. `.env`에 GEMINI_API_KEY 있음(값은 읽지 않는다). 터미널 출력이 cp949라 Python으로 한글을 출력할 때는 `PYTHONIOENCODING=utf-8`이 필요하다.
- Claude 모델 생성·smoke와 Claude Code 개발이 같은 Pro 한도를 쓴다. 한도에 걸리면 execute.py가 step을 `blocked`로 멈추거나(phase 5 step 1에서 한 번) 시도가 중단된다 — 같은 명령을 다시 실행하면 wip 커밋을 이어받는다.
- `npm test`가 실제 Chromium을 띄운다(네트워크는 테스트가 전부 가로챈다). Chromium이 없으면 `npx playwright install chromium`. Windows Chromium은 클립보드에 쓸 때 LF를 CRLF로 바꾼다(복사 테스트가 OS 줄바꿈으로 비교).
- check:results는 결과 폴더 안에 meta.json이 가리키지 않는 파일(judgment.json 제외)이나 하위 폴더가 있어도 실패한다. 생성·판정 뒤 `results/`에 다른 파일을 두지 않는다. judgment.json은 결과물 sha256에 묶여 있어서 `--force`로 다시 만들면 지워진다.
- 사람·세션이 결과물 코드를 고치는 일은 여전히 금지다(철학 2·CRITICAL). 나무를 못 그린 결과물은 ADR-032대로 **다시 생성하거나 모델이 고치게** 할 뿐이다(사용자가 2026-10-14 "원인부터 고치자"고 물었을 때, 원인이 모델 코드 안에 있어 결과물 수정·프롬프트 힌트·실행 환경 보정은 모두 벤치마크를 바꾼다고 설명했고 사용자가 동의했다). 품질 문제(나무가 어색함 등)는 재생성 대상이 아니라 그대로 판정한다. GPT-6 Sol의 첫 결과물 버그는 타이밍에 달린 것처럼 보이지만 headless Chromium으로 12번 새로 열어 12번 모두 멈췄다.
- 일괄 생성에서 무한 루프로 검증이 끝나지 않는 결과가 나오면 그때 처리 방법을 정한다(OPERATIONS "나중에 정할 것").
- Mono 자리의 한글은 Plex Sans KR 글자로 그려지지만 단어 사이 공백은 Mono 고정폭이라 조금 넓다(UI_GUIDE대로 둠).
- 훅은 Claude 세션의 Bash 명령만 검사한다. 사람이 `!`로 실행한 명령과 execute.py가 띄우는 `claude -p`는 막지 않는다(의도된 동작). `npm run validate`·`judge`는 results/를 바꾸므로 사람이 지시할 때만 쓴다.
- 루트의 빈 `migra/` 폴더는 사용자가 만든 것으로 보이며 git에 잡히지 않는다. 용도를 모르면 사용자에게 묻는다.
