# 작업 인계 (PROGRESS)

> 새 대화형 세션은 이 파일부터 읽는다. 마지막 갱신: 2026-10-13 (phase 4 확인·merge 세션)
> 무인 step 세션(execute.py)은 이 파일을 읽을 필요 없다 — 필요한 맥락은 step 파일과 하네스가 준다.

## 지금 하는 일

aquagarden-bench를 참고한 LLM 벤치마크 사이트(One Prompt Bench) MVP. **phase 4(`04-codex-adapter`: Codex CLI 어댑터)까지 끝나 main에 merge됐다(`f0c0f59`).** 세 도구(Gemini·Claude Code·Codex) 어댑터로 **8개 모델 생성이 모두 끝나 커밋됐다**(2026-10-13, Codex CLI 0.162.1 업데이트·웹 검색 끔(ADR-028)·Claude Code 이어 쓰기 처리(ADR-029)를 거침). push해 공개 사이트에 배포됐다. 다음은 phase 5 계획이다. 설계는 전부 `docs/`에 있다(CLAUDE.md "문서" 절). 공개 사이트: https://jonggurlhan.github.io/one-prompt-bench/

## 진행 상태

- [x] phase 1~3 완료·main merge, 첫 배포(2026-10-13), Gemini·Claude smoke → fixture, Gemini 3.8 Flash 생성(`eac58e0`)
- [x] phase 4 계획(2026-10-13, ADR-027, ARCHITECTURE "Codex CLI"를 0.157.1 소스로 다시 씀)
- [x] phase 4 실행(step 0 `codex-adapter`·step 1 `codex-preflight-smoke` 모두 첫 시도에 완료, 정가 환산 $6.94·90턴, 한도 걸림 없음) → 확인(이 PC에서 lint·typecheck·test(core 86 / pipeline 347+건너뜀 3 / site 53)·build·check:results 통과) → main `--no-ff` merge(`f0c0f59`)
- [x] phase 4 handoff → `docs/ARCHITECTURE.md`(Codex 구현 줄, 공용 기록기 `adapters/cli-recorder.ts`, `runSync` 이동, 에러 문구 고르는 순서, 로그인 판정 규칙, ⚠ 두 개 추가). 이 PROGRESS 갱신과 함께 `docs:` 커밋
- [x] Codex smoke 1차(2026-10-13, gpt-6.1-sol, Codex 0.157.1): preflight 통과, **서버가 모델 거부(400)** — 0.157.1이 gpt-6.1-sol보다 먼저 나와 모델 목록에 없다. 실제 출력을 fixture `stdout-model-not-supported.jsonl`로 옮기고, 웹소켓 에러 JSON(`"status":400`)을 분류하도록 고쳤다(처음엔 unknown). ARCHITECTURE "Codex CLI"에 "smoke로 확인한 것"·0.162.1 소스 비교, OPERATIONS 표 갱신(`fix`·`docs` 커밋)
- [x] Codex CLI 0.157.1 → 0.162.1 업데이트(2026-10-13, 사용자) → smoke 2차 성공: 입력 9,418(캐시 7,296)·출력 21·추론 0, 8.1초, 도구 사용 없음. 실제 출력을 fixture `stdout-smoke-ok.jsonl`로 옮기고 테스트를 더했다. ARCHITECTURE "Codex CLI"를 0.162.1 기준으로 고쳤다(기본 지시문 교체를 0.162.1 소스로 확인).
- [x] 사용자 결정(2026-10-13): Codex 웹 검색 도구를 끈다 → ADR-028, 인자에 `-c web_search="disabled"`(테스트 먼저), 커밋
- [x] Codex smoke 3차(2026-10-13, 웹 검색 끈 뒤): 설정 거부 없음, 입력 6,962(캐시 0)·출력 21·추론 0, 13.5초. ARCHITECTURE·OPERATIONS에 기록(fixture는 모양이 같아 안 옮김)
- [x] 일괄 생성(2026-10-13, 7개): check:results 통과. GPT 4개·Claude Haiku·Opus는 ok. **Claude Sonnet은 Claude Code가 출력 상한 뒤 스스로 이어 써서(출력 87,265) `no_html`로 잘못 기록됨** → 사용자 결정 ADR-029: 이어 쓰기는 잘림으로 기록하도록 어댑터 수정(테스트 먼저), Sonnet은 `--force` 1회 재생성. 6개는 `data:` 커밋
- [x] Claude Sonnet 5.5 재생성(2026-10-13, `--force`, 고친 어댑터 `f0e6988`): ok, 입력 1,053·출력 65,060(추론 48,767)·456초, 검증 에러 0 → `data:` 커밋. 8개 결과가 모두 커밋됐다
- [x] push(2026-10-13): 첫 run 38372457223은 `codex-bin` 테스트 하나가 리눅스에서만 실패(Windows 흉내 테스트가 소문자 `codex.cmd`를 만들어 대소문자 구분 FS에서 못 찾음) → 테스트 수정 `17bf737` → run 38372942894 성공(build 1분 10초, deploy 9초). 공개 사이트에 8개 모델이 보이고 `/view/<slug>/`가 열린다
- [x] phase 5 계획(2026-10-13, `phases/05-judge-and-tabs`, step 4개: judge-cli · compare-tab · prompt-intro-tabs · mobile-readme). 결정 ADR-030(도구가 덧붙이는 내용은 비교표 각주 §로 공개, COPY·DATA 반영), † 표시는 값이 —여도 그대로
- [ ] phase 5 실행 → 확인 → main `--no-ff` merge → 8개 판정(`npm run judge`)

## 다음 세션이 바로 할 일

1. `python scripts/execute.py 05-judge-and-tabs`로 phase 5를 실행한다(사람이 터미널에서). 끝나면 `feat-05-judge-and-tabs`를 확인하고 `--no-ff`로 merge한 뒤, handoff를 `docs/`에 옮기고 8개를 판정한다. 판정 때 Gemini는 ✗(화면 검음, 에러 2105). Codex·Claude의 남은 ⚠는 ARCHITECTURE에 있다.

## 사용자 결정·답변

- 문서에 옮기지 않은 결정은 없다. 2026-10-13에 `ANTHROPIC_AUTH_TOKEN`·`ANTHROPIC_BASE_URL`을 자식 환경에서 지우는 일을 "아직 하지 않는다"로 미뤘다(OPERATIONS "나중에 정할 것"에 기록).

## 주의할 점

- git: origin/main = `17bf737`(2026-10-13 push, 배포됨). main에 push하면 배포 워크플로가 돈다. Windows를 흉내 내는 테스트에서 파일을 만들 때는 대소문자까지 실제 이름대로 만든다(리눅스 CI는 구분한다). main에 push하면 배포 워크플로가 돈다 — phase 4가 더한 `codex-bin` POSIX 테스트가 CI에서 처음 돈다. 원격 `feat-02-validator-results-tab`은 `209e652`까지만 올라가 있다.
- gh 계정: 이 PC의 `gh`에 JongGurlHan·LeoMetascale 두 계정이 있고, 사용자가 **활성 계정을 JongGurlHan으로 두라고 했다**(2026-10-13, LeoMetascale로 되돌리지 않는다). JongGurlHan 토큰에는 `workflow` 권한이 있다. LeoMetascale이 활성이면 push가 workflow 권한 없음으로 거부된다.
- 이 PC 환경(2026-10-12 확인): Claude Code 2.1.296, codex-cli 0.162.1(2026-10-13 업데이트), Node 24.14, npm 11.9, Python 3.12, Windows + Git Bash. 환경변수에 ANTHROPIC/OPENAI/GEMINI 키 없음. `~/.codex/config.toml` 있음(생성 때 `--ignore-user-config`로 무시). `.env`에 GEMINI_API_KEY 있음(값은 읽지 않는다).
- Claude Code 안에서 `!`로 실행한 명령은 `CLAUDECODE`·`CLAUDE_EFFORT`·`CLAUDE_CODE_SESSION_ID` 등을 물려받는다. `cliEnv`가 자식 CLI의 환경에서 지운다(Claude smoke에서 동작 확인).
- Claude smoke·생성과 Claude Code 개발이 같은 Pro 한도를 쓴다. 일괄 생성은 개발 세션을 쉬는 동안 하는 게 낫다.
- `npm test`가 실제 Chromium을 띄운다(네트워크는 테스트가 전부 가로챈다). Chromium이 없으면 `npx playwright install chromium`.
- check:results는 결과 폴더 안에 meta.json이 가리키지 않는 파일(judgment.json 제외)이나 하위 폴더가 있어도 실패한다. 생성 뒤 `results/`에 다른 파일을 두지 않는다.
- 첫 실제 결과(`results/gemini-3-8-flash/`): 모델 코드가 THREE.Color에 없는 `addScaledColor`를 매 프레임 불러(index.html 555행) 화면이 검고 계절 패널이 "봄"에 멈춘다(에러 2105). 모델 결과이므로 그대로 둔다(ADR 철학 2). 판정 때 ✗. 결과 탭에는 "에러 수"가 보인다(ADR-026).
- 일괄 생성에서 무한 루프로 검증이 끝나지 않는 결과가 나오면 그때 처리 방법을 정한다(OPERATIONS "나중에 정할 것").
- Mono 자리의 한글은 Plex Sans KR 글자로 그려지지만 단어 사이 공백은 Mono 고정폭이라 조금 넓다(UI_GUIDE대로 둠).
- 훅은 Claude 세션의 Bash 명령만 검사한다. 사람이 `!`로 실행한 명령과 execute.py가 띄우는 `claude -p`는 막지 않는다(의도된 동작). `npm run validate`는 results/를 바꾸므로 사람이 지시할 때만 쓴다.
- 루트의 빈 `migra/` 폴더는 사용자가 만든 것으로 보이며 git에 잡히지 않는다. 용도를 모르면 사용자에게 묻는다.
