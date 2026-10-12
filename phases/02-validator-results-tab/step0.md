# Step 0: results-core

## 목표

core가 `results/`를 읽어 검사하고, 사이트에 보여 줄 값을 계산한다.

- `npm run check:results`가 `docs/DATA.md` "check:results"의 규칙 9개를 검사한다. 어긴 것을 모두 `경로: 이유`로 출력하고 exit 1이다. 결과가 하나도 없으면(`results/` 없음 포함) 통과한다. 규칙마다 실패 사례를 테스트가 증명한다.
- `display.ts`가 `docs/DATA.md` "표시 규칙"의 모든 행(상태 라벨, 결과물이 없을 때의 이유, 값 포맷)을 순수 함수로 계산하고, 표의 경계값을 테스트가 증명한다.
- 다음 step(검증기·사이트 테스트)이 쓸 가짜 데이터 루트 빌더를 `@opb/core/testing`에서 가져다 쓸 수 있다.

## 관련 파일

- `docs/DATA.md` 전체. 특히 "파일 배치", "check:results"(사이트 빌드의 데이터 검사 포함), "표시 규칙"
- `docs/COPY.md` "공통"(상태 라벨·생성 도구 이름·에러 종류 표시·판정 기호), "결과 탭" → "결과물이 없을 때"
- `docs/ADR.md` ADR-009, ADR-011, ADR-012, ADR-016, ADR-021
- `packages/core/src/schema.ts`(GenerationRecordSchema·JudgmentSchema·ModelRegistrySchema·GENERATOR_BY_PROVIDER), `request-rules.ts`(judgeRequests·classifyRequest), `sort.ts`(sortByRelease), `prompt.ts`(CURRENT_PROMPT), `index.ts`(barrel), `package.json`(exports)
- `packages/core/scripts/check-samples.ts`: 샘플 대조와 이슈 문자열 매칭 방식
- `pipeline/test/batch-fakes.ts`의 `makeRepo`·`seedResult`: 가짜 레포를 만드는 기존 방식. 참고만 하고 import하지 마라.

## 작업

테스트를 먼저 작성한다. 판단은 순수 함수로 두고 파일 I/O는 얇게 감싼다.

1. `packages/core/src/results.ts`를 만들고 barrel에 추가한다. 시그니처는 예시이고 재량이다.
   ```ts
   export interface ResultEntry {
     model: ModelEntry;
     record: GenerationRecord | null; // meta.json 없음 → null
     judgment: Judgment | null;
   }
   /** models.json + results/<slug>/{meta,judgment}.json을 읽어 조인한다. sortByRelease 순서.
    *  스키마를 통과하지 못한 파일이 있으면 그 경로를 담아 throw한다. 다른 규칙은 검사하지 않는다(사이트 빌드용, DATA.md "사이트 빌드의 데이터 검사") */
   export async function loadResults(dataRoot: string): Promise<ResultEntry[]>;

   export interface CheckIssue { path: string; message: string } // path: dataRoot 기준 POSIX 경로
   /** DATA.md "check:results" 규칙 1~9 전부. 이슈가 없으면 빈 배열 */
   export async function checkResults(dataRoot: string): Promise<CheckIssue[]>;
   ```
   - `checkResults`는 첫 이슈에서 멈추지 않고 이슈를 모두 모은다.
   - sha256은 `index.html` 바이트 그대로 계산한다(줄바꿈 변환 없음).
   - 문서에 없는 경우(예: results/ 아래 심볼릭 링크)는 엄격한 쪽(이슈)으로 정하고 handoff에 남긴다.
2. `packages/core/scripts/check-results.ts`와 루트 `package.json` 스크립트 `"check:results"`를 만든다.
   - 데이터 루트는 기본이 레포 루트(파일 위치에서 계산)이고, 환경변수 `OPB_DATA_ROOT`가 있으면 그것을 쓴다.
   - 이슈가 있으면 `경로: 이유`를 한 줄씩 출력하고 exit 1이다. 없으면 검사한 결과 폴더 수와 함께 OK를 출력하고 exit 0이다.
3. `packages/core/src/display.ts`를 만들고 barrel에 추가한다. DATA.md "표시 규칙"의 표 세 개를 빠짐없이 구현한다. 시그니처는 예시이고 재량이다.
   ```ts
   export type StatusLabel = '정상' | '지시 미준수' | '위반' | '잘림' | 'HTML 없음' | '거부' | '한도 초과' | '생성 실패' | '생성 전' | '검증 전';
   export type BadgeTone = 'green' | 'yellow' | 'red' | 'purple' | 'blue' | 'gray'; // DATA "상태 라벨"의 배지 계열
   export const STATUS_LEGEND: readonly StatusLabel[]; // COPY "공통" 상태 라벨 순서 (범례용)
   export function statusOf(record: GenerationRecord | null): { label: StatusLabel; tone: BadgeTone };
   /** 결과물이 있으면 null. 이유 문구와 응답 원문 카드를 보일지 */
   export function missingOutputReason(record: GenerationRecord | null): { text: string; showResponseText: boolean } | null;
   export const PROVIDER_LABEL: Readonly<Record<Provider, string>>;       // Anthropic · OpenAI · Google
   export const GENERATOR_LABEL: Readonly<Record<GeneratorTool, string>>; // Claude Code · Codex CLI · Gemini API
   export function displayModel(entry: ResultEntry): ModelDisplay;       // 사이트가 쓰는 표시 값 전부
   export function fillCount(text: string, n: number): string;           // '{N}' 치환
   ```
   - 라벨·이유·에러 종류·판정 기호 문구는 `docs/COPY.md`에서 한 글자도 바꾸지 않고 옮긴다.
   - "생성 실패" 이유에는 마지막 시도의 에러 종류 표시(COPY "공통")를 덧붙인다. 덧붙이는 형식은 재량이고 handoff에 남긴다.
   - 조건 검사와 three.js 버전은 `judgeRequests`·`classifyRequest` 결과로 계산한다. URL 정규식을 새로 쓰지 마라.
   - 걸린 시간은 마지막 시도의 `latencyMs`다(ADR-021). 초 단위 반올림 규칙은 재량이고, 테스트와 handoff에 남긴다.
   - `ModelDisplay`는 phase 5의 비교표도 쓸 수 있게 DATA 표의 모든 항목을 담는다(파일 크기·three.js 버전·에러 수·추론 토큰·재시도·†‡ 표시 여부, 판정 4개와 메모, 회사·생성 도구·출시일).
4. 결과물 iframe의 sandbox 값을 core 상수 하나로 둔다: `export const RESULT_IFRAME_SANDBOX = 'allow-scripts'`. 파일 위치는 재량이고 barrel에서 export한다. 다음 step의 검증기와 사이트가 이 상수를 쓴다.
5. 가짜 데이터 루트 빌더를 `@opb/core/testing` 서브패스로 내보낸다. `packages/core/package.json`의 exports에 추가하고, 파일은 src 밖(예: `test/support/`)에 둔다.
   - OS 임시 디렉토리(`mkdtemp`)에 models.json, prompts/(레포의 `prompts/season-tree-v1*.md`를 읽어 복사), results/<slug>/를 만든다.
   - 상태별로 스키마를 통과하는 기록을 만들 수 있어야 한다:
     - ok: 검증 있음·없음, 외부 요청 목록 지정
     - no_html, truncated, refused
     - api_failed: usage_limit과 그 밖의 kind
     - 판정 있음
   - index.html 바이트로 sha256·bytes를 계산해 meta.json에 넣고, 스크린샷 파일도 만든다. 내용은 JPEG 시그니처 바이트면 충분하다.
   - 쓰기 전에 스키마로 검사한다(잘못된 픽스처가 조용히 생기지 않게). 일부러 깨진 데이터는 테스트가 빌더로 만든 뒤 직접 고쳐 쓴다.
   - core 테스트가 이 빌더를 쓴다. step 1(pipeline)과 step 2·3(site) 테스트도 쓸 것이다.
6. 테스트(`packages/core/test/`):
   - checkResults: 규칙 1~9 각각의 실패 사례, 모두 통과하는 정상 데이터(모든 상태 포함), `results/` 없음과 빈 `results/`의 통과, 이슈가 여러 개일 때 모두 보고되는지.
   - check-results 스크립트: `OPB_DATA_ROOT`를 임시 데이터로 두고 spawn해서 exit code와 출력을 확인한다.
   - loadResults: 정렬 순서, meta.json이 없는 모델의 record가 null인지, 스키마 위반이면 경로가 담긴 에러를 던지는지, sha256 불일치처럼 check 전용 규칙은 통과시키는지.
   - display:
     - 상태 라벨 표의 모든 행(위에서부터 처음 맞는 것)과 배지 계열
     - 이유 문구와 원문 표시 여부
     - 포맷 경계값: 0 바이트·1024 바이트, `<$0.01`·`$0.00`, 59초·60초 근처, api_failed이고 사용량 0이면 —, reasoning null이면 —
     - three.js 버전: 여러 버전은 쉼표, 미고정만 있으면 "미고정", 없으면 —
     - 판정 없음 → 판정 전, 결과물 없음 → —
     - fillCount

## 금지사항

- 레포의 `results/`를 만들거나 쓰지 마라. 테스트 데이터는 OS 임시 디렉토리에만 만든다. 이유: CLAUDE.md CRITICAL.
- 표시 문구를 바꾸거나 새로 지어내지 마라. COPY.md에 없는 문구가 필요하면 handoff에 남긴다. 이유: COPY.md는 확정 문구다.
- 상태 라벨·포맷 규칙을 core 밖(pipeline·site)에 다시 쓰지 마라. 이유: CLAUDE.md CRITICAL(display.ts 한 곳).
- `schema.ts`의 저장 모양(필드·불변식)을 바꾸지 마라. 이유: DATA.md "스키마 변경 예정"에 없는 변경이다. 필요해 보이면 바꾸지 말고 handoff에 남긴다.
- core에서 pipeline·site를 import하지 마라. 이유: 의존 방향(CLAUDE.md).
- check:results 규칙을 DATA.md보다 느슨하게 만들지 마라(경고만 하고 통과시키는 것 등). 이유: 배포 게이트다(ADR-012, ADR-017).
