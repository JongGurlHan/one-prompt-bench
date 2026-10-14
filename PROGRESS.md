# 작업 인계 (PROGRESS)

> 새 대화형 세션은 이 파일부터 읽는다. 마지막 갱신: 2026-10-14 (phase 6 확인 세션)
> 무인 step 세션(execute.py)은 이 파일을 읽을 필요 없다 — 필요한 맥락은 step 파일과 하네스가 준다.

## 지금 하는 일

aquagarden-bench를 참고한 LLM 벤치마크 사이트(One Prompt Bench) MVP. phase 6(재생성 공개, ADR-032)까지 구현·확인했고 **main merge 대기**다. main은 phase 5까지 merge됐지만 **아직 push 전**이다(origin/main `17bf737`). 남은 것은 merge → 8개 판정 → push(배포) → 리눅스 CI 확인이다. 설계는 전부 `docs/`에 있다(CLAUDE.md "문서" 절).

## 진행 상태

- [x] phase 1~5 완료·main merge, 8개 모델 생성·검증 커밋(마지막 배포 run 38372942894)
- [x] ADR-032(나무가 그려지는 결과물만 공개: 다시 생성 총 3회 → 수정 요청 2회 → 수록 제외) 결정·문서화, 1단계(다시 생성) 완료 — 8개 모두 나무가 그려진다(`7a16e18`). 수정 요청(`gen --repair`)·수록 제외는 필요해질 때 만든다
- [x] phase 6 `06-regeneration-disclosure` 실행(2 step, $8.17) → 확인(2026-10-14): lint·typecheck·test·build·check:results 통과, 개발 서버에서 안내 박스(Sol 3번째·Flash 2번째·Sonnet 2번째 "기록은 남아 있지 않아요", 다른 모델은 숨김 — 버튼·375px 선택기 모두)·비교표 "생성 횟수" 열·각주 ¶·바뀐 문구 확인
- [x] 확인 중 사용자 결정 반영(feat 브랜치 `6f646f0`): 응답 없는 공개 기록(api_failed)은 생성 횟수 —, 버린 기록이 있는 모델이 api_failed면 check:results 실패. handoff를 문서로 옮김(`041b47a` — DATA "버린 결과물"·check:results 규칙 10, ARCHITECTURE 커밋 검사·DOM 계약, UI_GUIDE, OPERATIONS, ADR-032)
- [ ] main merge(사용자): `git checkout main` 뒤 `git merge --no-ff feat-06-regeneration-disclosure`
- [ ] 8개 판정(`npm run judge -- <slug>`) → 커밋 → push(배포) → 리눅스 CI(phase 5·6 브라우저 테스트가 처음 돈다) 확인 → PRD 성공 기준 점검

## 다음 세션이 바로 할 일

1. main에 phase 6이 merge됐는지 본다(`git log --oneline main -3`). 안 됐으면 위 명령을 안내한다(브랜치 이름 필수, squash 금지).
2. 8개 판정을 안내한다(OPERATIONS "판정"). slug: claude-haiku-5-5, claude-opus-5-5, claude-sonnet-5-5, gemini-3-8-flash, gpt-6-1-sol, gpt-6-astra, gpt-6-luna, gpt-6-sol. 판정 값은 사용자가 정한다(대신 정하지 않는다). judgment.json을 커밋한 뒤 push한다.
3. push 뒤 배포 워크플로(리눅스)를 본다. 실패하면 브라우저 테스트(phase 5·6에서 처음 리눅스로 돈다)와 `ubuntu-latest` 변경(2026-10-19부터 Ubuntu 26 — playwright `--with-deps`)부터 확인한다.

## 사용자 결정·답변

- 문서에 옮기지 않은 결정은 없다. 2026-10-13에 `ANTHROPIC_AUTH_TOKEN`·`ANTHROPIC_BASE_URL`을 자식 환경에서 지우는 일을 "아직 하지 않는다"로 미뤘다(OPERATIONS "나중에 정할 것").

## 주의할 점

- git: origin/main = `17bf737`(배포됨). main에 push하면 배포 워크플로가 돈다. **push는 phase 6 merge와 판정 뒤에** 한다 — 그 전에 push하면 다시 생성한 결과물이 아무 표시 없이 공개된다. 원격 `feat-02-validator-results-tab`은 `209e652`까지만 올라가 있다. 로컬에 `feat-01`~`feat-06` 브랜치가 남아 있다. Windows를 흉내 내는 테스트에서 파일을 만들 때는 대소문자까지 실제 이름대로 만든다(리눅스 CI는 구분한다).
- `git merge --no-ff`를 브랜치 이름 없이 main에서 실행하면 upstream이 없어 실패한다(2026-10-13 사용자가 한 번 그랬다, 아무 일도 안 일어남).
- gh 계정: 이 PC의 `gh`에 JongGurlHan·LeoMetascale 두 계정이 있고, 사용자가 **활성 계정을 JongGurlHan으로 두라고 했다**(LeoMetascale로 되돌리지 않는다). JongGurlHan 토큰에는 `workflow` 권한이 있다. LeoMetascale이 활성이면 push가 workflow 권한 없음으로 거부된다.
- 이 PC 환경(2026-10-12 확인): Claude Code 2.1.296, codex-cli 0.162.1, Node 24.14, npm 11.9, Python 3.12, Windows + Git Bash. 환경변수에 ANTHROPIC/OPENAI/GEMINI 키 없음. `.env`에 GEMINI_API_KEY 있음(값은 읽지 않는다). 터미널 출력이 cp949라 Python으로 한글을 출력할 때는 `PYTHONIOENCODING=utf-8`이 필요하다.
- Claude 모델 생성·smoke와 Claude Code 개발이 같은 Pro 한도를 쓴다. 한도에 걸리면 execute.py가 step을 `blocked`로 멈추거나(phase 5 step 1에서 한 번) 시도가 중단된다 — 같은 명령을 다시 실행하면 wip 커밋을 이어받는다.
- `npm test`가 실제 Chromium을 띄운다(네트워크는 테스트가 전부 가로챈다). Chromium이 없으면 `npx playwright install chromium`. Windows Chromium은 클립보드에 쓸 때 LF를 CRLF로 바꾼다(복사 테스트가 OS 줄바꿈으로 비교). Windows에서는 pipeline의 POSIX 전용 테스트 3개가 건너뛰어진다(정상).
- check:results는 결과 폴더 안에 meta.json이 가리키지 않는 파일(judgment.json 제외)이나 하위 폴더가 있어도 실패한다. 생성·판정 뒤 `results/`에 다른 파일을 두지 않는다. judgment.json은 결과물 sha256에 묶여 있어서 `--force`로 다시 만들면 지워진다.
- 사람·세션이 결과물 코드를 고치는 일은 여전히 금지다(철학 2·CRITICAL). 나무를 못 그린 결과물은 ADR-032대로 **다시 생성하거나 모델이 고치게** 할 뿐이다(원인이 모델 코드 안에 있어 결과물 수정·프롬프트 힌트·실행 환경 보정은 모두 벤치마크를 바꾼다 — 2026-10-14 사용자 동의). 품질 문제(나무가 어색함 등)는 재생성 대상이 아니라 그대로 판정한다.
- Claude Haiku 5.5 결과물은 첫 프레임에 `Cannot read properties of undefined (reading 'skyC')` 페이지 에러를 낸다(검증 기록에 2개). GPT-6 Sol 첫 결과물과 같은 원인(첫 rAF `now`가 `performance.now()`보다 일러 시간이 음수)이지만 `requestAnimationFrame`을 먼저 걸어 루프가 멈추지 않고 나무가 그려진다 — 재생성 대상이 아니고, 에러 수는 비교표·결과 탭에 이미 보인다(판정 때 참고).
- 일괄 생성에서 무한 루프로 검증이 끝나지 않는 결과가 나오면 그때 처리 방법을 정한다(OPERATIONS "나중에 정할 것").
- Mono 자리의 한글은 Plex Sans KR 글자로 그려지지만 단어 사이 공백은 Mono 고정폭이라 조금 넓다(UI_GUIDE대로 둠).
- 훅은 Claude 세션의 Bash 명령만 검사한다. 사람이 `!`로 실행한 명령과 execute.py가 띄우는 `claude -p`는 막지 않는다(의도된 동작). `npm run validate`·`judge`는 results/를 바꾸므로 사람이 지시할 때만 쓴다.
- 루트의 빈 `migra/` 폴더는 사용자가 만든 것으로 보이며 git에 잡히지 않는다. 용도를 모르면 사용자에게 묻는다.
