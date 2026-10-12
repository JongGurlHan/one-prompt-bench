# 프로젝트: One Prompt Bench

같은 프롬프트("사계절이 바뀌는 3D 나무")를 여러 LLM에 한 번씩 보내 받은 단일 HTML 결과물을 나란히 실행·비교하는 정적 사이트 MVP. 원칙: **추가 결제 0원**, 기록의 정직성(사람이 결과물을 고치지 않음), 얇게 끝까지.

## 문서 (설계의 단일 출처)
- `docs/PRD.md` 요구사항·MVP 제외·개발 순서 / `docs/ARCHITECTURE.md` 구조·파이프라인·사이트·배포·테스트 / `docs/ADR.md` 결정과 이유
- `docs/DATA.md` 데이터 형식·스키마 변경 예정·표시 규칙·check:results / `docs/UI_GUIDE.md` 토큰·화면 / `docs/COPY.md` 확정 문구
- `docs/OPERATIONS.md` 사람이 직접 하는 일(생성·판정·배포) / `docs/design/*.dc.html` 시안 원본(참고용)
- 대화형 세션을 시작하면 `PROGRESS.md`(작업 인계)를 먼저 읽는다. 무인 step 세션은 읽지 않아도 된다.
- 문서 내용은 두 등급이다. **확정**: 이 파일의 CRITICAL, `docs/ADR.md`의 결정, `docs/COPY.md` 문구, PRD의 범위(핵심 기능·MVP 제외) — 바꾸려면 구현 전에 사람에게 묻는다. **기준값**: UI_GUIDE의 수치, DATA의 포맷 세부, ARCHITECTURE의 구현 방법 — 구현 중 맞지 않으면 조정하고 handoff에 이유를 남긴다.
- 문서에 없는 것을 정해야 하면 대화형 세션은 사람에게 묻고, 무인 세션은 문서 의도에 맞게 정하고 handoff에 남긴다. `⚠` 표시는 실제 도구 출력으로 확인해야 하는 부분이다.

## 기술 스택
- npm workspaces 모노레포: `packages/core`(도메인 로직, zod 스키마), `pipeline/`(NestJS 스탠드얼론 CLI), `site/`(Astro 정적), `results/`(결과물 데이터)
- TypeScript strict, ESM(NodeNext), Node ≥ 22. 테스트는 `node:test` + `tsx`
- 생성 도구: Claude Code CLI · Codex CLI(구독 로그인) · Gemini API 무료 티어. 검증: Playwright(스크린샷 JPEG)
- 사이트 스타일: Astro scoped CSS + CSS 변수. React·Tailwind 없음

## 아키텍처 규칙
- CRITICAL: 실제 모델 호출(`npm run gen`·`npm run smoke`·파이프라인 진입점의 gen·smoke 직접 실행·`claude -p`·`codex exec`·Gemini API)을 직접 실행하지 마라. 사람이 지시해도 `! <명령>`으로 사람이 직접 실행하게 안내한다. 이유: 구독 한도·요금을 쓴다. (훅이 막는다)
- CRITICAL: 테스트는 가짜 어댑터·CLI 출력 fixture·로컬 HTML만 쓴다. 실제 CLI·API·네트워크를 부르는 테스트를 만들지 마라. 파일을 쓰는 테스트는 OS 임시 디렉토리에서 한다.
- CRITICAL: `results/` 아래 파일을 손으로 만들거나 고치지 마라(테스트 픽스처 포함). 결과물은 파이프라인만 쓰고, `check:results`가 sha256으로 검사한다.
- CRITICAL: 모델이 만든 HTML은 `<iframe sandbox="allow-scripts">` 안에서만 실행한다. `allow-same-origin`을 넣지 말고, 결과물 파일을 직접 링크하지 마라(새 창은 `/view/<slug>/` 래퍼).
- CRITICAL: 저장 데이터의 모양과 불변식은 `packages/core/src/schema.ts` 한 곳에서 정의한다. 표시 규칙(상태 라벨·포맷)은 `packages/core/src/display.ts` 한 곳에서 정의한다. 다른 곳에 같은 규칙을 다시 쓰지 마라.
- CRITICAL: 비밀값(`.env`, API 키)을 읽거나 출력하거나 커밋하지 마라. 생성 도구의 자식 프로세스 환경에서는 `ANTHROPIC_API_KEY`·`OPENAI_API_KEY`를 지운다. Claude Code `--bare`는 쓰지 마라(API 키 과금).
- 의존 방향: `pipeline → core`, `site → core`. core는 다른 워크스페이스를 import하지 않는다.
- NestJS 생성자 주입은 `@Inject(TOKEN)`을 명시한다(tsx는 emitDecoratorMetadata 미지원).
- 사이트 문구는 `docs/COPY.md` 그대로 쓰고, 모델 수는 `{N}`으로 채운다. 숫자를 하드코딩하지 마라.

## 개발 프로세스
- CRITICAL: 새 기능 구현 시 반드시 테스트를 먼저 작성하고, 테스트가 통과하는 구현을 작성할 것 (TDD)
- 커밋 메시지는 conventional commits 형식을 따를 것 (feat:, fix:, docs:, refactor:, test:, chore:, data:)
- 개발은 하네스로 한다: PRD "개발 순서" 표의 한 줄 = phase 하나(`phases/NN-<slug>`, 날짜와 묶지 않음), 계획은 `/harness`, 실행은 `python scripts/execute.py <phase>`.
- phase가 끝나면 `/devlog <phase>`로 개발 일지 초안을 만든다. 세션을 넘길 때는 `/handoff`로 `PROGRESS.md`를 갱신한다.

## 명령어
```
npm run lint            # ESLint
npm run typecheck       # tsc + astro check
npm test                # 전 워크스페이스 테스트 (가짜만)
npm run build           # 사이트 빌드 → site/dist
npm run dev             # 사이트 개발 서버
npm run check:results   # results/ 전수 검사 (배포 게이트)
npm run validate -- <slug…>|--all   # Playwright 재검증 (results/ 갱신 — 사람이 지시할 때만)
npm run judge -- <slug>             # 판정 기록 (사람용, 대화형)
npm run gen -- …  /  npm run smoke -- …   # 실제 모델 호출 — 사람만
python -m pytest scripts            # 하네스 테스트
```
(첫 phase의 step 0 전에는 package.json이 없어 npm 명령이 동작하지 않는다.)
