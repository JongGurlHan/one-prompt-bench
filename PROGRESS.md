# 작업 인계 (PROGRESS)

> 새 대화형 세션은 이 파일부터 읽는다. 마지막 갱신: 2026-10-12 (phase 2 계획 세션)
> 무인 step 세션(execute.py)은 이 파일을 읽을 필요 없다 — 필요한 맥락은 step 파일과 하네스가 준다.

## 지금 하는 일

aquagarden-bench를 참고한 LLM 벤치마크 사이트(One Prompt Bench) MVP. phase 1(파이프라인·Gemini 어댑터)이 끝났고, **phase 2(`02-validator-results-tab`: 검증기·check:results·결과 탭) 계획을 만들어 실행을 기다리는 중**이다. 설계는 전부 `docs/`에 있다(CLAUDE.md "문서" 절).

## 진행 상태

- [x] 하네스 정비·기획 보완(docs 7종, 훅, execute.py 한도 감지) — 2026-10-12
- [x] phase 1 `01-pipeline-core` 완료·main merge(`edebe5a`), handoff 내용 docs 반영
- [x] 사람 작업: Gemini smoke(`results-smoke/gemini-3-8-flash-20261012-164309/`) → fixture `stream-smoke-ok.jsonl`, ARCHITECTURE의 Gemini ⚠ 항목 정리
- [x] phase 2 계획: `phases/02-validator-results-tab/` step 0~3(results-core · playwright-validator · site-setup · results-tab), 결정은 ADR-024·025와 DATA·ARCHITECTURE·UI_GUIDE·COPY에 반영
- [ ] phase 2 실행 → 확인·merge → 사람 작업(Gemini 1개 생성, 결과 탭 로컬 확인)
- [ ] phase 3~5 (PRD.md "개발 순서")

## 다음 세션이 바로 할 일

1. phase 2가 아직 안 돌았으면 사용자가 `python scripts/execute.py 02-validator-results-tab`를 실행한다(`git status`가 깨끗해야 한다). step 1이 `npx playwright install chromium`으로 브라우저를 받는다.
2. phase 2가 끝났으면 `/harness` F 절차: `phases/02-validator-results-tab/index.json`의 summary·handoff와 `npm test`를 사용자와 확인 → 사용자가 main에 `--no-ff` merge → handoff의 결정·⚠ 결과(특히 headless WebGL launch 플래그, Astro·TS 6 호환, `@opb/core/testing` 경로, 생성 실패 이유 형식)를 docs에 옮긴다.
3. 사람 작업 안내: `! npm run gen -- gemini-3-8-flash`(첫 실제 생성, 자동 검증 약 40초, three.js CDN 필요) → 스크린샷 4장 확인 → `npm run check:results` → `results/` 커밋(`data: gemini-3-8-flash 생성`) → `npm run dev`로 결과 탭 확인. 그다음 phase 3 계획.

## 사용자 결정·답변

- 문서에 옮기지 않은 결정은 없다. 2026-10-12 phase 2 계획 때 고른 것(헤더는 있는 탭만, 첫 선택은 결과물 있는 첫 모델)은 ADR-024·025에 있다.

## 주의할 점

- 이 PC 환경(2026-10-12 확인): Claude Code 2.1.296, codex-cli 0.157.1, Node 24.14, npm 11.9, Python 3.12, Windows + Git Bash. 환경변수에 ANTHROPIC/OPENAI/GEMINI 키 없음. `~/.codex/config.toml` 있음(생성 때 `--ignore-user-config`로 무시). `.env`에 GEMINI_API_KEY 있음(smoke 성공으로 확인, 값은 읽지 않는다).
- OPERATIONS.md "추가 결제 차단 체크리스트"를 사용자가 확인했다는 기록이 없다. 첫 실제 생성 전에 한 번 물어본다.
- 첫 실제 생성은 phase 2 뒤에 한다(ADR-022). phase 2 실행 중에 `results/`를 만들면 check:results AC가 실데이터 때문에 흔들린다.
- phase 2부터 `npm test`가 실제 Chromium을 띄운다(네트워크는 테스트가 전부 가로챈다). Chromium이 없으면 `npx playwright install chromium`.
- Claude Code의 `--system-prompt-file`은 help에 별도 항목이 없어 확인되지 않았다 → phase 3 어댑터는 `--system-prompt "<내용>"`을 쓴다(ARCHITECTURE.md).
- 훅은 Claude 세션의 Bash 명령만 검사한다. 사람이 `!`로 실행한 명령과 execute.py가 띄우는 `claude -p`는 막지 않는다(의도된 동작). `npm run validate`는 훅이 막지 않지만 results/를 바꾸므로 사람이 지시할 때만 쓴다.
- 루트의 빈 `migra/` 폴더는 사용자가 만든 것으로 보이며 git에 잡히지 않는다. 용도를 모르면 사용자에게 묻는다.
