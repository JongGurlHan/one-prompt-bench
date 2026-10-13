# 운영 가이드 — 사람이 직접 하는 일 (생성·판정·배포·하네스)

Claude 세션(대화형·무인 모두)은 실제 모델 호출을 하지 않는다. 이 문서의 `npm run gen`·`npm run smoke`는 사람이 터미널에서 실행한다. Claude Code 안에서는 `! npm run gen -- ...`처럼 `!`를 붙여 직접 실행한다.

## 최초 준비 (1회)

1. Node.js 22 이상(개발 PC 24.14), `npm install`
2. `.env.example`을 `.env`로 복사하고 `GEMINI_API_KEY`를 넣는다(Google AI Studio 무료 발급). `.env`는 git에 올라가지 않는다.
3. 생성 전에 커밋이 한 번은 있어야 한다. meta.json이 "어떤 코드로 만들었는지"를 커밋 해시로 기록한다.
4. 검증기용 브라우저: `npx playwright install chromium`

## 추가 결제 차단 체크리스트 (처음 생성하기 전에 반드시)

구독 한도에 걸렸을 때 도구가 유료로 이어서 쓰지 않게 막는다. `npm run gen`의 preflight가 일부를 자동으로 확인하지만, 계정 설정은 사람만 확인할 수 있다.

- [ ] Claude: usage credits(추가 사용량) 사용이 꺼져 있다
- [ ] Claude Code: Console(API) 계정이 아니라 Claude 구독 계정으로 로그인했다 (`claude auth status`의 인증 방식이 claude.ai)
- [ ] Codex CLI: "Sign in with ChatGPT"로 로그인했다 (API 키 로그인 아님, `codex login status`)
- [ ] ChatGPT: Codex용 크레딧을 사두지 않았고, 자동 충전이 꺼져 있다
- [ ] 컴퓨터 전체 환경변수에 `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`가 없다 (2026-10-12 확인: 없음)

## smoke로 확인할 것 (⚠ 도구별 첫 생성 전에)

`npm run smoke -- <slug>`는 짧은 요청 한 번으로 도구·인증·출력 파싱을 확인한다. 한도를 조금 쓴다. 결과는 `results-smoke/<slug>-<시각>/`에 남는다(커밋 안 됨). meta.json·response.txt와 함께 도구 원본 출력(`raw-*` 파일, Gemini는 `raw-stream.jsonl`·`raw-error.json`)이 저장되니, 확인한 뒤 Claude에게 "이 출력을 어댑터 테스트 fixture로 옮기고 ⚠ 항목을 확정해 줘"라고 시킨다. 실패(`api_failed`)하면 종료 코드가 1이다.

| 도구 | 확인할 것 |
|---|---|
| 공통 | 입력 토큰이 수백 개 수준인가 (수천 개 이상이면 도구 기본 지시문·메모리·CLAUDE.md가 섞인 것 → 격리 옵션을 고친다) |
| Claude Code | `--system-prompt`로 기본 지시문이 교체되는가, `--effort high`가 적용되는가, 잘림·거부를 어느 필드로 알 수 있는가, 추론 토큰을 따로 주는가, `modelUsage`에 모델이 하나인가(나머지는 ARCHITECTURE "Claude Code CLI"의 ⚠). `raw-stdout.txt`는 `pipeline/test/fixtures/claude-code/`로 그대로 옮긴다. 2026-10-13 claude-haiku-5-5로 확인함(ARCHITECTURE "smoke로 확인한 것") |
| Codex CLI | 입력 토큰 규모(ADR-027로 끈 블록 밖에 무엇이 남는가), Hello 요청에도 추론 토큰이 나오는가(`model_reasoning_effort`), 모델이 명령 실행·파일 쓰기를 시도하는가, stderr 내용(나머지는 ARCHITECTURE "Codex CLI"의 ⚠). `raw-stdout.txt`(JSONL)는 `pipeline/test/fixtures/codex/`로 그대로 옮긴다. `codex login status` 형식과 설정 키는 2026-10-13 소스로 확인함 |
| Gemini API | thinking level·`maxOutputTokens`·`systemInstruction` 필드 이름(설치한 SDK 버전), 사용량 필드 이름, 무료 티어 429와 일일 할당량 소진의 구분 |

확인 결과는 `docs/ARCHITECTURE.md` "도구별 호출 사양"의 ⚠ 표시를 지우고 사실로 고쳐 적는다.

## 생성

```bash
npm run gen -- gemini-3-8-flash          # 한 모델
npm run gen -- --all                     # 전체 (이미 결과가 있는 모델은 건너뜀, 실패한 것만 다시)
npm run gen -- claude-opus-5-5 --force   # 다시 만들기 (폴더를 비움 → 예전 판정도 지워짐)
```

- 생성은 **main 브랜치에서, 코드 변경을 모두 커밋한 상태로** 한다. phase 브랜치는 squash하지 말고 merge(`git merge --no-ff`)한다. squash하면 meta.json에 기록된 커밋 해시가 main 기록에서 사라진다.
- outcome이 ok면 검증이 바로 이어진다(모델당 약 40초, three.js CDN 접속 필요).
- 한도: Claude 모델 생성과 Claude Code 개발이 같은 Pro 한도를 쓴다. Claude 모델 3개는 한도가 리셋된 직후에 몰아서 생성한다. Codex의 GPT-6 Astra는 5시간당 메시지 약 5~45개다.
- 한도에 걸린 모델은 "한도 초과"로 기록되고 건너뛴다. 한도가 풀린 뒤 `npm run gen -- --all`을 다시 실행하면 그 모델만 돈다.
- 끝나면 `results/`를 커밋한다(`git add results && git commit -m "data: <모델> 생성"`). 커밋하지 않으면 하네스가 시작하지 않는다(작업 트리 검사).

## 재검증

```bash
npm run validate -- --all        # 전체
npm run validate -- gpt-6-sol    # 한 모델
```
`meta.json`의 `validation`과 스크린샷만 바뀌고 결과물은 그대로다. 판정은 유지된다.

## 판정 (판정 도우미가 생긴 뒤, 이후 새 모델마다)

1. `npm run dev`로 로컬 사이트를 열고 결과 탭에서 그 모델을 50초 이상(한 바퀴 넘게) 지켜본다. 사이트와 같은 샌드박스 조건이다.
2. `results/<slug>/`의 스크린샷 4장(spring·summer·autumn·winter `.jpg`)을 본다. 보는 방법은 `prompts/season-tree-v1.judging.md` 머리말.
3. `prompts/season-tree-v1.judging.md` 기준으로 `npm run judge -- <slug>`를 실행해 요구사항 4개(pass/partial/fail)와 메모(1~200자, 사이트에 공개)를 입력한다. sha256·시각은 자동으로 채워진다.
4. 커밋하고 push하면 배포된다. `--force`로 결과물을 다시 만들면 판정도 함께 지워지므로 다시 판정한다.

결과물이 없는 모델(HTML 없음·잘림·거부·생성 실패·한도 초과)은 판정하지 않는다.

## 배포 (배포 워크플로가 생긴 phase 뒤에 최초 설정)

1. GitHub에 **공개** 레포를 만들고 push한다(무료 플랜의 Pages는 공개 레포만). `JongGurlHan/one-prompt-bench`는 이미 공개 레포다(2026-10-13 확인, git 기록에 실제 키 없음).
2. 레포 Settings → Pages → Source를 "GitHub Actions"로 한다.
3. main에 push하면 `.github/workflows/deploy.yml`이 검사(lint·typecheck·test·check:results)를 통과한 뒤에만 배포한다. Actions 탭의 "Run workflow"로 수동 실행할 수 있다. 2026-10-13 첫 배포 완료(Pages Source = GitHub Actions 설정됨).
   - workflow 파일을 바꾼 커밋을 push하려면 토큰에 `workflow` 권한이 있어야 한다. 이 PC의 github.com 인증은 `gh`(`gh auth git-credential`, 사용자 JongGurlHan)가 맡는다. 거부되면 `gh auth status`로 JongGurlHan 토큰의 권한을 본다.
4. 주소: `https://<사용자>.github.io/<레포 이름>/`

## 하네스로 개발하기

```bash
python scripts/execute.py <phase>                 # phase 실행 (예: 01-pipeline-core, feat-<phase> 브랜치)
python scripts/execute.py <phase> --reset-failed  # error/blocked 해결 후 재실행
python scripts/execute.py <phase> --resume        # 중단된 step 이어받기
```

- phase 계획은 Claude Code에서 `/harness`로 만든다. 상세 규칙은 `.claude/commands/harness.md`.
- 실행 전에 `phases/` 밖의 변경을 모두 커밋한다.
- **Claude 사용 한도에 걸리면** step이 `blocked`로 멈추고 한도 메시지가 표시된다. 한도가 풀린 뒤 `--reset-failed`로 다시 실행한다.
- phase가 끝나면 `feat-<phase>` 브랜치를 확인하고 main에 merge한다(`--no-ff`). 그다음 PRD.md "개발 순서" 표의 "사람이 할 일"을 한다.

## 새 모델 추가

1. 수록 기준(2026-09-01 이후 출시된 OpenAI·Anthropic·Google 모델)에 맞는지 확인한다.
2. `models.json`에 항목을 추가한다(slug, provider, modelId, displayName, releasedAt, pricing — 공식 가격 페이지와 확인 날짜).
3. 아래 "나중에 정할 것"에 걸리면(출력 상한이 65,536보다 작음, 새 회사, high 미지원) 먼저 규칙을 정해 ADR에 기록한다.
4. 커밋 → `npm run gen -- <slug>` → `results/` 커밋 → 판정 → push.

## 나중에 정할 것

- 새 모델 규칙: 최대 출력이 65,536보다 작을 때 / 새 회사 모델일 때 / 추론 강도 high를 지원하지 않을 때
- 다음 버전 검증 항목: 로딩 시간, 빈 화면 판정, FPS
- 검증 중 멈추는 결과물(무한 루프): 스크린샷이 시간 초과돼 validation이 null로 남고 check:results가 배포를 막는다. 실제로 나오면 기록 방법(스키마 포함)을 정한다(ADR-026).
- 같은 페이지 에러가 매 프레임 반복되면 `pageErrors`에 그대로 쌓인다(Gemini 3.8 Flash: 2105개, meta.json 110KB). 레포가 너무 커지면 저장 방식을 정한다. 지금은 그대로 둔다.
- 도구가 프롬프트 밖에 덧붙이는 내용(Claude Code 약 600토큰 — ARCHITECTURE "Claude Code CLI", Codex는 ADR-027로 일부를 끈 뒤 smoke로 확인)을 사이트에 공개할지와 문구: 2026-10-13 사용자가 phase 5(비교표·소개 탭) 계획 때 정하기로 했다. 정하면 COPY·ADR에 적는다.
- CLI 자식 환경에서 `ANTHROPIC_AUTH_TOKEN`·`ANTHROPIC_BASE_URL`(다른 과금 경로 변수)도 지울지: phase 3 확인 때(2026-10-13) 사용자가 "아직 지우지 않는다"로 미뤘다. 지금은 ADR-001의 두 API 키만 지운다. 이 PC 환경에는 두 변수가 없고, preflight가 `authMethod: claude.ai`·`apiProvider: firstParty`를 확인한다. 이 변수를 쓰게 되거나 preflight가 인증 방식으로 걸러 내지 못하는 경우가 나오면 다시 정한다(정하면 ADR-001과 `system/cli.ts`의 지우는 목록을 함께 고친다).
