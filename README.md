# One Prompt Bench

같은 프롬프트 하나("사계절이 바뀌는 3D 나무")를 여러 LLM에 한 번씩 보내고, 각 모델이 돌려준 단일 HTML 결과물을 브라우저에서 하나씩 실행해 나란히 비교하는 정적 사이트다. 모델마다 한 번만 생성하고 사람은 결과물을 고치지 않으며, 생성에 든 토큰·시간·에러와 요구사항 판정을 함께 기록한다. 모델을 점수로 줄 세우지 않는다 — 순위가 아니라 기록이다.

공개 사이트: https://jonggurlhan.github.io/one-prompt-bench/

## 프롬프트와 모델

- 프롬프트: 브라우저만으로 실행되는, 사계절이 바뀌는 3D 나무 애니메이션을 하나의 HTML 파일로 만들어 달라는 요청이다(장면·계절 순환·계절 모습·계절 이름 표시 네 가지 요구사항). 모든 모델에 한 글자도 바꾸지 않고 보낸다.
- 프롬프트 파일은 `prompts/`에 있다.

  | 파일 | 내용 |
  |---|---|
  | `prompts/season-tree-v1.md` | 프롬프트 원문 (user 메시지) |
  | `prompts/season-tree-v1.system.md` | 모든 생성 도구에 같은 최소 시스템 프롬프트 |
  | `prompts/season-tree-v1.judging.md` | 요구사항 판정 기준표 (사람용, 사이트의 프롬프트 탭에도 표시) |

- 수록 모델은 `models.json`(사람이 관리하는 레지스트리)을 본다. 수록 기준은 2026-09-01 이후 출시된 OpenAI·Anthropic·Google 모델이고, 새 모델도 같은 조건으로 추가한다.
- 생성 도구: Anthropic 모델은 Claude Code CLI, OpenAI 모델은 Codex CLI(둘 다 구독 로그인), Google 모델은 Gemini API 무료 티어.

## 사이트

탭 네 개(소개 · 결과 · 비교표 · 프롬프트)로 된 정적 사이트이고 첫 화면은 결과 탭이다.

- **결과**: 모델 목록(출시일 최신순, 휴대폰에서는 드롭다운)에서 고른 결과물 하나만 실행한다. 요구사항 판정·메모, 생성 기록(토큰·비용·걸린 시간·에러 수)을 함께 보여 주고, 결과물이 없으면 이유와 응답 원문을 보여 준다.
- **비교표**: 수록 모델 / 생성 기록 / 요구사항과 검증, 표 세 개와 각주. 도구마다 다른 조건은 각주로 공개한다.
- **프롬프트**: 원문과 복사 버튼, 생성 조건, 판정 기준표.
- **소개**: 프로젝트 소개, 수록 기준과 대상에서 뺀 모델.

모델이 만든 HTML은 신뢰하지 않는다. `<iframe sandbox="allow-scripts">`(`allow-same-origin` 없음) 안에서만 실행하고, "새 창에서 열기"도 결과물 파일이 아니라 같은 샌드박스를 쓰는 래퍼 페이지(`/view/<slug>/`)로 연다.

## 기술 스택

- npm workspaces 모노레포, TypeScript strict(ESM, NodeNext), Node.js 22.12 이상
- `packages/core/` — 프레임워크 없는 도메인 로직. 데이터 모양과 불변식은 zod 스키마(`packages/core/src/schema.ts`), 상태 라벨·숫자 포맷 같은 표시 규칙은 `packages/core/src/display.ts` 한 곳에서 정의한다.
- `pipeline/` — NestJS 스탠드얼론 CLI. 생성(도구별 어댑터, 기술적 실패만 재시도), Playwright 검증(열림·에러·외부 요청·스크린샷), 판정 도우미.
- `site/` — Astro 정적 사이트. 스타일은 scoped CSS + CSS 변수, 클라이언트 동작은 순수 TypeScript(React·Tailwind 없음).
- 테스트: `node:test` + `tsx`, 브라우저 테스트는 Playwright(Chromium).
- 배포: GitHub Actions → GitHub Pages.

## 디렉토리 구조

```
.
├── models.json              모델 레지스트리 (사람이 관리, 스키마는 core)
├── prompts/                 프롬프트 원문 · 시스템 프롬프트 · 판정 기준표
├── results/<slug>/          생성 결과 (파이프라인만 쓴다, 사람이 고치지 않는다)
├── packages/core/           @opb/core — 스키마, 표시 규칙, results 읽기·검사, 실행 규칙
├── pipeline/                @opb/pipeline — 생성 · 검증 · 판정 CLI (NestJS)
├── site/                    @opb/site — Astro 정적 사이트
├── docs/                    설계 문서 (design/은 시안 원본)
├── phases/  scripts/        개발 하네스 (phase 계획·상태, Python 실행기와 테스트)
└── .github/workflows/       배포 워크플로 (deploy.yml)
```

의존 방향은 `pipeline → core`, `site → core`이고, core는 다른 워크스페이스를 import하지 않는다. 사이트는 빌드할 때만 `models.json`·`results/`·`prompts/`를 읽는다.

## 로컬 실행

```bash
npm install
npx playwright install chromium   # 브라우저 테스트·검증기가 쓰는 Chromium

npm run dev     # 사이트 개발 서버
npm test        # 전 워크스페이스 테스트 (가짜 어댑터·CLI 출력 fixture·로컬 HTML만, 모델 호출 없음)
npm run build   # 정적 사이트 빌드 → site/dist/
```

그 밖의 검사 명령:

| 명령 | 하는 일 |
|---|---|
| `npm run lint` | ESLint, 전 워크스페이스 |
| `npm run typecheck` | tsc(core·pipeline) + astro check(site) |
| `npm run check:results` | `results/` 전수 검사 (배포 게이트) |

위 명령은 모두 모델을 부르지 않는다. 테스트가 파일을 쓸 때는 OS 임시 디렉토리를 쓰고, 레포의 `results/`는 읽거나 쓰지 않는다.

## 설계 문서

| 문서 | 내용 |
|---|---|
| [docs/PRD.md](docs/PRD.md) | 요구사항, MVP 제외 사항, 개발 순서 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 모노레포 구조, 생성 파이프라인, 검증기, 사이트, 배포, 테스트 전략 |
| [docs/ADR.md](docs/ADR.md) | 결정과 이유 (철학: 추가 결제 0원, 기록의 정직성, 얇게 끝까지) |
| [docs/DATA.md](docs/DATA.md) | 데이터 형식, 상태 라벨·표시 규칙, `check:results` 검사 항목 |
| [docs/UI_GUIDE.md](docs/UI_GUIDE.md) | 디자인 토큰, 공통 레이아웃, 탭별 화면 |
| [docs/COPY.md](docs/COPY.md) | 사이트 문구 (확정) |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | 사람이 직접 하는 일 — 생성 · 재검증 · 판정 · 배포 · 새 모델 추가 |

## 운영

생성 · 재검증 · 판정 · 배포는 사람이 [docs/OPERATIONS.md](docs/OPERATIONS.md)의 순서대로 직접 한다.

- 실제 모델을 부르는 명령(`npm run gen`, `npm run smoke`)은 구독 한도와 요금을 쓴다. 사람이 터미널에서만 실행하고, 자동화·CI·AI 에이전트 세션에서는 돌리지 않는다. 배포 워크플로에도 넣지 않는다.
- `results/`를 바꾸는 명령(`npm run validate`로 재검증, `npm run judge`로 판정 기록)도 사람이 필요할 때만 실행한다.
- 키가 필요한 것은 Gemini API 하나다. `.env.example`을 `.env`로 복사해 `GEMINI_API_KEY`를 넣는다(`.env`는 git에 올리지 않는다). Claude Code와 Codex CLI는 API 키가 아니라 구독 로그인으로 생성한다.
- 배포: main에 push하면 GitHub Actions가 lint · typecheck · test · check:results를 모두 통과한 경우에만 GitHub Pages에 배포한다. 워크플로는 비밀값을 쓰지 않는다.

## 원칙

### 비용: 추가 결제 0원

이미 쓰고 있는 구독(Claude, ChatGPT)과 Gemini API 무료 티어만으로 생성한다. 다른 모든 결정보다 앞선다.

- 생성 전 점검(preflight)이 구독 로그인 상태를 확인하고, CLI 자식 프로세스 환경에서는 `ANTHROPIC_API_KEY`·`OPENAI_API_KEY`를 지운다. API 키로 과금되는 실행 방식은 쓰지 않는다.
- 한도에 걸린 모델은 "한도 초과"로 기록하고 건너뛴다. 유료로 이어서 생성하지 않는다.
- 비교표의 비용은 API 정가로 환산한 참고값이다. 실제로 청구된 금액은 없다.

### 기록의 정직성

- 모델마다 같은 프롬프트·같은 시스템 프롬프트로 1회 생성한다. 기술적 실패만 재시도하고, 응답이 온 경우(HTML 없음·거부·잘림)는 그대로 그 모델의 결과로 기록한다.
- 사람은 결과물을 고치지 않는다. `results/`는 파이프라인만 쓰고, meta.json에 결과물의 sha256과 생성에 쓴 코드의 커밋 해시를 남긴다.
- 판정은 사람이 판정 기준표대로 하고, 판정 기록은 결과물 sha256에 묶인다.
- 도구마다 다른 조건(출력 상한, 추론 강도 단계, 도구가 덧붙이는 입력)은 숨기지 않고 비교표 각주로 공개한다.
- `npm run check:results`가 `results/` 전체를 검사한다(스키마, 결과물 sha256과 meta.json 대조로 손으로 고친 파일 잡기, 판정과 결과물의 연결 등). 배포 게이트라서 하나라도 어긋나면 배포되지 않는다.

## 개발 방식

- 새 기능은 테스트를 먼저 쓴다(TDD). 테스트는 가짜 어댑터·CLI 출력 fixture·로컬 HTML만 쓰고 실제 CLI·API·네트워크를 부르지 않는다.
- 커밋 메시지는 conventional commits(`feat:`, `fix:`, `docs:`, `test:`, `chore:`, `data:` 등)를 따른다.
- 개발은 하네스로 한다. PRD "개발 순서" 표의 한 줄이 phase 하나(`phases/`)이고, Python 실행기(`scripts/execute.py`)가 step 단위로 무인 세션을 돌린다. 하네스 테스트는 `python -m pytest scripts`.
