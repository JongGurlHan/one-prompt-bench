# 작업 인계 (PROGRESS)

> 새 대화형 세션은 이 파일부터 읽는다. 마지막 갱신: 2026-10-13 (phase 5 merge 세션)
> 무인 step 세션(execute.py)은 이 파일을 읽을 필요 없다 — 필요한 맥락은 step 파일과 하네스가 준다.

## 지금 하는 일

aquagarden-bench를 참고한 LLM 벤치마크 사이트(One Prompt Bench) MVP. **phase 5(`05-judge-and-tabs`: 판정 도우미, 비교표·프롬프트·소개 탭, 휴대폰 화면, README)가 끝나 main에 merge됐다(`2bcbdee`, 아직 push 전).** 8개 모델 생성·검증은 끝나 공개 사이트(https://jonggurlhan.github.io/one-prompt-bench/)에 올라가 있다. 남은 일은 8개 판정(사람) → push다. 설계는 전부 `docs/`에 있다(CLAUDE.md "문서" 절).

## 진행 상태

- [x] phase 1~4 완료·main merge, 8개 모델(Gemini 1·Claude 3·GPT 4) 생성·검증 커밋, push·배포(2026-10-13, 마지막 run 38372942894)
- [x] phase 5 계획(2026-10-13, ADR-030: 도구가 덧붙이는 내용은 비교표 각주 §로 공개) → 실행(step 4개 모두 첫 시도 완료, 정가 환산 $18.5·295턴. step 1은 첫 시도가 사용 한도로 중단돼 wip 커밋을 이어받음)
- [x] phase 5 확인(이 PC): lint·typecheck·test(core 100 / pipeline 394+건너뜀 3 / site 108)·build·check:results(8개) 통과. 첫 `npm test`에서 복사 버튼 브라우저 테스트가 흔들려(느린 환경에서 가짜 시계가 실제 시간으로 흘러 2초 타이머가 먼저 끝남) 시계를 `pauseAt`으로 멈추고 쓰기 완료를 기다리게 고침(`bc8a709`)
- [x] phase 5 handoff → `docs/ARCHITECTURE.md`(판정 도우미 실제 동작, 디렉토리 구조, 사이트 DOM 계약·복사 테스트 시계), `docs/UI_GUIDE.md`(§·각주 세 줄·생성 조건 6행·휴대폰 수치), `docs/OPERATIONS.md`(판정). 이 PROGRESS 갱신과 함께 `docs:` 커밋(브랜치 위)
- [x] main에서 `git merge --no-ff feat-05-judge-and-tabs`(사용자, 2026-10-13, `2bcbdee`). 병합 뒤 `check:results` 통과, `results/` 변경 없음
- [ ] 8개 모델 판정(`npm run judge -- <slug>`, 사용자) → 커밋 → push(배포)
- [ ] 리눅스 CI 확인: phase 5가 더한 브라우저 테스트(복사·휴대폰 375px)가 CI에서 처음 돈다. push 뒤 Actions 결과를 본다

## 다음 세션이 바로 할 일

1. origin/main은 `17bf737`이고 main은 phase 5 merge·문서 커밋만큼 앞서 있다. 판정 전에 push하면 판정 없는 상태로 배포되니, 판정 뒤에 push하도록 안내한다(판정 전 상태도 배포 게이트는 통과한다).
2. 판정 전에 `npm run dev`로 각 모델을 50초 이상 지켜보게 안내한다(OPERATIONS "판정"). 판정 때 Gemini 3.8 Flash는 ✗ 예정(화면 검음, 에러 2105). 결과물이 있는 모델만 판정한다(8개 모두 ok). 판정 값은 사용자가 정한다 — 대신 정하지 마라.
3. 판정 커밋·push 뒤 Actions run을 확인하고, 사이트에서 4개 탭·휴대폰 화면을 눈으로 본다. 이상이 없으면 MVP 성공 기준(PRD)을 점검한다: 8개 모두 기록 있음, 판정 끝, 공개 URL에서 탭 4개 동작.

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
- 모델이 만든 결과물은 그대로 둔다(ADR 철학 2). Gemini 3.8 Flash는 THREE.Color에 없는 `addScaledColor`를 매 프레임 불러 화면이 검다. 비교표·결과 탭의 "에러 수"로 드러난다(ADR-026).
- 일괄 생성에서 무한 루프로 검증이 끝나지 않는 결과가 나오면 그때 처리 방법을 정한다(OPERATIONS "나중에 정할 것").
- Mono 자리의 한글은 Plex Sans KR 글자로 그려지지만 단어 사이 공백은 Mono 고정폭이라 조금 넓다(UI_GUIDE대로 둠).
- 훅은 Claude 세션의 Bash 명령만 검사한다. 사람이 `!`로 실행한 명령과 execute.py가 띄우는 `claude -p`는 막지 않는다(의도된 동작). `npm run validate`·`judge`는 results/를 바꾸므로 사람이 지시할 때만 쓴다.
- 루트의 빈 `migra/` 폴더는 사용자가 만든 것으로 보이며 git에 잡히지 않는다. 용도를 모르면 사용자에게 묻는다.
