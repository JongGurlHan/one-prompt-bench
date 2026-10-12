# 작업 인계 (PROGRESS)

> 새 대화형 세션은 이 파일부터 읽는다. 마지막 갱신: 2026-10-12 (하네스 정비·기획 보완 세션 완료)
> 무인 step 세션(execute.py)은 이 파일을 읽을 필요 없다 — 필요한 맥락은 step 파일과 하네스가 준다.

## 지금 하는 일

aquagarden-bench를 참고한 LLM 벤치마크 사이트(One Prompt Bench) MVP. 준비 단계(하네스를 프로젝트에 맞게 정비, 기획 보완)가 끝났다. 다음은 **1일차 phase 계획**이다. 설계는 전부 `docs/`에 있다(CLAUDE.md "문서" 절).

## 진행 상태

- [x] 하네스 정비: CLAUDE.md, docs 7종(PRD·ARCHITECTURE·ADR·DATA·UI_GUIDE·COPY·OPERATIONS), `/harness`·`/review` 프로젝트화, `/devlog`·`/handoff` 신규
- [x] 훅: 실제 모델 호출(gen·smoke·`claude -p`·`codex exec`·Gemini API)·`.env`/API 키 출력 차단 (명령 자리에서만 매칭). settings.json에서 `.env` Read 거부
- [x] execute.py: Claude 구독 사용 한도 메시지 감지 → 재시도 없이 `blocked` (하네스 테스트 296개 통과)
- [x] 기존 코드 → `packages/core/`(src·test·examples·scripts), 데이터 → `models.json`·`prompts/`, 시안 → `docs/design/`. scratch에서 core 테스트 17개·check-samples 통과 확인 (package.json은 아직 없음 — 1일차 step 0에서 workspace 연결)
- [x] 기획 원본 폴더 삭제(사용자), 이번 변경 커밋·push (2026-10-12, origin/main)
- [ ] 1일차 phase 계획 (`/harness`) → 실행 → 사람 작업 (PRD.md 일정표)

## 다음 세션이 바로 할 일

1. `git status`가 깨끗한지 확인한다(하네스는 `phases/` 밖에 커밋 안 된 변경이 있으면 시작하지 않는다). 루트의 빈 `migra/` 폴더는 사용자가 만든 것으로 보이며 git에 잡히지 않는다 — 용도를 모르면 사용자에게 묻는다.
2. `/harness`로 `phases/day1-pipeline-core` 계획 초안을 만든다. 범위는 PRD.md 일정표의 1일차(모노레포·core 연결, NestJS 뼈대, DATA.md "스키마 변경 예정" 반영, Gemini 어댑터, batch·preflight·smoke 명령)다. step 0은 npm workspaces 연결이고, 이때 기존 core 테스트가 그대로 통과해야 한다.
3. 계획을 보여줄 때 phase 뒤에 사람이 할 일(추가 결제 차단 체크리스트, `.env`, Gemini smoke → 1개 생성)을 함께 안내한다.

## 사용자 결정·답변 (모두 ADR에 기록됨)

- 시스템 프롬프트: 세 도구 공통 최소 지시문 (ADR-005) — 문구 "사용자의 요청에 답하세요."는 Claude가 정함, 사용자가 바꿀 수 있음
- 하네스 무인 세션 모델: Opus 5.5 (ADR-020)
- 결과 탭 추가 기능: 다시 시작 버튼만 (ADR-019)
- 판정 기록: CLI 도우미 `npm run judge` (ADR-013). 사용자가 판정 절차를 자세히 설명받은 뒤 골랐다.

## 주의할 점

- 이 PC 환경(2026-10-12 확인): Claude Code 2.1.296, codex-cli 0.157.1, Node 24.14, npm 11.9, Python 3.12, Windows + Git Bash. 환경변수에 ANTHROPIC/OPENAI/GEMINI 키 없음. `~/.codex/config.toml` 있음(생성 때 `--ignore-user-config`로 무시). `~/.claude/CLAUDE.md` 없음.
- Claude Code의 `--system-prompt-file`은 help에 별도 항목이 없어 확인되지 않았다 → `--system-prompt "<내용>"`을 쓴다(ARCHITECTURE.md).
- 훅은 Claude 세션의 Bash 명령만 검사한다. 사람이 `!`로 실행한 명령과 execute.py가 띄우는 `claude -p`는 막지 않는다(의도된 동작).
- 기존 core 코드는 이전 SDK 설계 기준이다(`ProviderAdapter.sdk`, `maxOutputTokens` 필수, `system: null`). 바꿀 내용은 DATA.md "스키마 변경 예정"에 있다.
