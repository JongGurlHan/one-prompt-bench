# Step 4: smoke-command

## 목표

`npm run smoke -- <slug>`가 동작하는 코드가 완성된다. preflight(git 검사 제외)를 거쳐 짧은 프롬프트로 1회 호출하고, `results-smoke/<slug>-<timestamp>/`에 meta.json·응답 원문·**도구 원본 출력**을 저장한다. 가짜 클라이언트로 테스트가 증명한다. 이 step에서 실제로 `smoke`를 실행하지 않는다.

## 관련 파일

- `docs/ARCHITECTURE.md` "도구별 호출 사양" → **smoke**, Gemini API
- `docs/OPERATIONS.md` "smoke로 확인할 것" — 사람이 이 출력으로 무엇을 확인하는지
- step 2·3 산출물: Gemini 어댑터·`GeminiClient`, 어댑터 레지스트리(클라이언트 래퍼를 받는 생성 함수), preflight(git 검사 옵션), `cli.ts`

## 작업

테스트를 먼저 작성한다.

1. smoke 프롬프트(코드 상수, `PromptSpec`):
   - `id: 'smoke'`, `version: 'v1'`.
   - `system`은 실제 `prompts/season-tree-v1.system.md` 내용(core 로더로 읽음). 시스템 지시문 교체가 적용되는지 smoke로 확인하기 위해서다.
   - `user`는 짧은 요청. 예: "'Hello'라고 쓰인 아주 짧은 HTML 페이지 하나를 ```html 코드 블록 하나에 담아주세요."
   - 출력 상한은 `maxOutputTokensFor(adapter, 8_000)`이다(상한을 지원하지 않는 도구는 null).
2. 실행: core `runGeneration`을 재시도 없는 정책(`maxAttempts: 1`, 타임아웃은 5분 정도로 재량)으로 부른다. `outDirRel`은 `results-smoke/<slug>-<YYYYMMDD-HHmmss>`. preflight는 step 3 것을 git 검사만 끄고 쓴다. 대상은 slug 정확히 1개다.
3. 원본 출력 저장. core 어댑터 인터페이스는 바꾸지 않고, 어댑터에 주입하는 의존성을 기록용 래퍼로 감싼다:
   - Gemini: `GeminiClient`를 감싸 스트림 청크를 받은 순서대로 모아 `raw-stream.jsonl`(한 줄에 청크 하나)로 저장한다. 요청이나 스트림이 throw하면 에러의 이름·메시지·status·상세 본문을 `raw-error.json`으로 저장한다(API 키가 섞이면 가린다).
   - 래퍼 방식은 phase 3·4의 CLI 어댑터가 프로세스 실행 함수를 감싸 stdout·stderr를 같은 폴더에 쓸 수 있는 모양으로 둔다(레지스트리 항목의 생성 함수가 래퍼를 받는다).
   - Runner는 폴더가 비어 있어야 시작하므로, 원본 파일은 `runGeneration`이 끝난 뒤에 쓴다.
4. 끝나면 저장 폴더 경로, outcome, 사용량(입력·출력·추론), 걸린 시간을 출력한다. 입력 토큰이 2,000을 넘으면 "도구 기본 지시문·메모리가 섞였을 수 있음" 경고를 낸다(OPERATIONS.md 공통 확인 항목).
5. `cli.ts`에 `smoke <slug>` 명령, 루트 `package.json`에 `"smoke"` 스크립트(`gen`과 같은 방식)를 둔다. `results-smoke/`는 이미 gitignore돼 있다.
6. 테스트: OS 임시 디렉토리 레포와 가짜 `GeminiClient`로 다음을 검증한다.
   - (a) 폴더 이름 형식, meta.json이 core 스키마를 통과, `params.maxOutputTokens` 8000, prompt id `smoke`.
   - (b) `raw-stream.jsonl`에 청크가 순서대로 한 줄씩 있다.
   - (c) 클라이언트가 throw하면 `raw-error.json`과 `api_failed` meta.json이 남고, 시도는 1회뿐이다(429여도 재시도 없음).
   - (d) git 변경이 있어도 smoke는 진행하고, API 키 변수가 환경에 있으면 중단한다.
   - (e) 입력 토큰 경고 문구.
   - (f) `parseCommand`의 smoke 인자(slug 정확히 1개, 0개·2개면 사용법 오류).

## 금지사항

- `npm run smoke`나 `tsx pipeline/src/main.ts smoke`를 실행하지 마라. 이유: 실제 모델 호출이다(CLAUDE.md CRITICAL, 훅이 막는다).
- 테스트에서 레포의 `results-smoke/`·`results/`에 쓰지 마라. 이유: 파일을 쓰는 테스트는 OS 임시 디렉토리에서 한다(CLAUDE.md CRITICAL).
- 원본 출력을 얻으려고 core `ProviderAdapter`·`ProviderResponse`에 필드를 추가하지 마라. 이유: meta.json 기록과 무관한 디버깅 출력이 도메인 인터페이스에 섞인다(ARCHITECTURE "smoke").
- smoke 결과를 `results/`에 쓰지 마라. 이유: results/는 배포 대상이고, check:results가 models.json에 없는 폴더 이름을 실패로 본다.
