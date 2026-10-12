# 작업 인계 (PROGRESS)

> 새 대화형 세션은 이 파일부터 읽는다. 마지막 갱신: 2026-10-13 (phase 2 확인·merge 세션)
> 무인 step 세션(execute.py)은 이 파일을 읽을 필요 없다 — 필요한 맥락은 step 파일과 하네스가 준다.

## 지금 하는 일

aquagarden-bench를 참고한 LLM 벤치마크 사이트(One Prompt Bench) MVP. phase 2(`02-validator-results-tab`: 검증기·check:results·결과 탭)가 끝나 main에 merge됐다(`d35d3f2`). **다음은 사람 작업(첫 실제 생성 = Gemini 1개, 결과 탭 로컬 확인)이고, 그다음 phase 3 계획이다.** 설계는 전부 `docs/`에 있다(CLAUDE.md "문서" 절).

## 진행 상태

- [x] 하네스 정비·기획 보완(docs 7종, 훅, execute.py 한도 감지) — 2026-10-12
- [x] phase 1 `01-pipeline-core` 완료·main merge(`edebe5a`), Gemini smoke → fixture
- [x] phase 2 `02-validator-results-tab` 완료(2026-10-13 01:19) → 확인(lint·typecheck·test 298개·build·check:results 통과, 가짜 데이터 스크린샷 확인) → main merge(`d35d3f2`)
- [x] phase 2 handoff를 docs에 옮김(ARCHITECTURE 디렉토리·검증기·사이트·배포·테스트·버전, DATA check:results 엄격 규칙·포맷), `.gitignore`의 안 쓰는 `site/public/r/` 삭제
- [x] 사용자 승인으로 COPY에 "주요 메뉴"·"응답 원문을 불러오지 못했어요." 추가, `--font-mono`에 Plex Sans KR 대체 글꼴(UI_GUIDE·테스트 포함)
- [x] OPERATIONS "추가 결제 차단 체크리스트" — 사용자가 확인했다고 답함(2026-10-13)
- [ ] 사람 작업: Gemini 1개 생성 → 결과 탭 로컬 확인
- [ ] phase 3~5 (PRD.md "개발 순서")

## 다음 세션이 바로 할 일

1. 사람 작업이 끝났는지 확인한다: `! npm run gen -- gemini-3-8-flash`(자동 검증 약 40초, three.js CDN 필요) → `results/gemini-3-8-flash/`의 스크린샷 4장 확인 → `npm run check:results` → `git add results && git commit -m "data: gemini-3-8-flash 생성"` → `npm run dev`로 결과 탭 확인. 실제 결과물에서 이상한 점(검증 실패, 화면 문제)이 있으면 phase 3 계획에 넣는다.
2. 그다음 `/harness`로 phase 3(배포 워크플로 + Claude Code 어댑터) 계획. 계획 때 함께 정할 것: 무한 루프 결과물의 검증 실패 처리(ARCHITECTURE "검증기" 알려진 한계), 리눅스 CI의 WebGL 확인(⚠), 워크플로의 `ASTRO_TELEMETRY_DISABLED=1`.

## 사용자 결정·답변

- 문서에 옮기지 않은 결정은 없다.

## 주의할 점

- git: main이 origin/main보다 앞서 있다(2026-10-13 기준 20커밋, push 안 함). phase 3의 사람 작업 "공개 레포·Pages 설정·push(첫 배포)" 때 올린다. 원격 `feat-02-validator-results-tab`은 `209e652`까지만 올라가 있다.
- 이 PC 환경(2026-10-12 확인): Claude Code 2.1.296, codex-cli 0.157.1, Node 24.14, npm 11.9, Python 3.12, Windows + Git Bash. 환경변수에 ANTHROPIC/OPENAI/GEMINI 키 없음. `~/.codex/config.toml` 있음(생성 때 `--ignore-user-config`로 무시). `.env`에 GEMINI_API_KEY 있음(smoke 성공으로 확인, 값은 읽지 않는다).
- Mono 자리의 한글은 이제 Plex Sans KR 글자로 그려지지만, 단어 사이 공백은 Mono의 고정폭 공백이라 조금 넓다(UI_GUIDE가 그 자리를 Mono로 정했으므로 그대로 둠).
- `npm test`가 실제 Chromium을 띄운다(네트워크는 테스트가 전부 가로챈다, 전체 약 35초). Chromium이 없으면 `npx playwright install chromium`.
- check:results는 결과 폴더 안에 meta.json이 가리키지 않는 파일(judgment.json 제외)이나 하위 폴더가 있어도 실패한다. 생성 뒤 `results/`에 다른 파일을 두지 않는다.
- 하네스 한도 감지(`209e652`)는 phase 2 step 3에서 실제로 동작했다(세션 한도 → blocked, 재시도 안 함). Pro 세션 한도가 phase 하나 도중에 걸릴 수 있다 — phase 2는 정가 환산 $19.69, 258턴.
- Claude Code의 `--system-prompt-file`은 help에 별도 항목이 없어 확인되지 않았다 → phase 3 어댑터는 `--system-prompt "<내용>"`을 쓴다(ARCHITECTURE.md).
- 훅은 Claude 세션의 Bash 명령만 검사한다. 사람이 `!`로 실행한 명령과 execute.py가 띄우는 `claude -p`는 막지 않는다(의도된 동작). `npm run validate`는 훅이 막지 않지만 results/를 바꾸므로 사람이 지시할 때만 쓴다.
- 루트의 빈 `migra/` 폴더는 사용자가 만든 것으로 보이며 git에 잡히지 않는다. 용도를 모르면 사용자에게 묻는다.
