# Step 1: core-cli-schema

## 목표

core의 스키마·어댑터 인터페이스·Runner가 CLI/SDK 생성 방식에 맞게 바뀐다.

- meta.json에 `runtime.generator { tool, version, invocation }`가 기록된다.
- `params.maxOutputTokens`가 null(도구 기본값)을 허용한다.
- 스크린샷 경로 규칙이 `.jpg`다.
- 프롬프트 파일(`prompts/<id>-<version>.md`·`.system.md`)을 읽어 `PromptSpec`을 만드는 로더가 있다.

모두 core 테스트와 `check-samples`로 증명한다.

## 관련 파일

- `docs/DATA.md` "meta.json", **"스키마 변경 예정"(표 5행 전부)**, "정규화 규칙", "불변식", "models.json"(provider ↔ 생성 도구 표)
- `docs/ARCHITECTURE.md` "생성 파이프라인" → "책임 분리", "기존 코드에서 바꿀 것", "프롬프트 읽기"
- `docs/ADR.md` ADR-005(시스템 프롬프트), ADR-007(출력 상한 65,536, Codex는 null)
- `packages/core/src/schema.ts`, `adapter.ts`, `runner.ts`, `test/runner.test.ts`, `examples/meta.sample.json`, `scripts/check-samples.ts`
- `prompts/season-tree-v1.md`, `prompts/season-tree-v1.system.md`

## 작업

테스트를 먼저 고치거나 추가한 뒤 구현한다.

1. `schema.ts`(데이터 모양의 단일 출처):
   - `GeneratorToolSchema = z.enum(['claude-code', 'codex-cli', 'gemini-api'])`와 provider → 도구 대응 상수(예: `GENERATOR_BY_PROVIDER: Record<Provider, GeneratorTool>`). 표시 이름(Claude Code·Anthropic 등)은 phase 2의 `display.ts` 몫이니 여기 두지 마라.
   - `runtime`: `sdkPackage`·`sdkVersion`을 없애고 `generator: { tool: GeneratorTool, version: string(min 1), invocation: string(min 1) }`. `gitCommit`·`nodeVersion`은 유지.
   - `params.maxOutputTokens`: 양의 정수 | `null`.
   - `validation.screenshots[].path`: `.jpg$` 정규식. 주석·에러 메시지도 JPEG로 고친다.
   - `schemaVersion`은 1을 유지한다.
2. `adapter.ts`:
   - `GenerationRequest.maxOutputTokens: number | null`. null이면 어댑터는 상한 옵션을 보내지 않는다(도구 기본값).
   - `ProviderAdapter.sdk`를 없애고 다음을 추가한다:
     ```ts
     readonly generator: { tool: GeneratorTool; version: string };
     readonly supportsMaxOutputTokens: boolean;          // Codex CLI는 false
     describeInvocation(req: GenerationRequest): string; // meta.json runtime.generator.invocation
     ```
     invocation 규칙: user 프롬프트와 비밀값은 넣지 않고, 시스템 프롬프트 내용은 자리표시(예: `<system prompt>`)로 둔다. CLI는 명령줄, SDK는 설정 JSON. 어댑터마다 구현한다.
   - 출력 상한 상수 `DEFAULT_MAX_OUTPUT_TOKENS = 65_536`을 core 한 곳에 두고, "어댑터가 상한을 지원하면 65,536, 아니면 null"을 정하는 함수(예: `maxOutputTokensFor(adapter, limit = DEFAULT_MAX_OUTPUT_TOKENS)`)도 core에 둔다. batch와 smoke(상한 8,000)가 이 함수를 쓴다.
   - 주석의 "SDK 호출 1회"를 "도구 호출 1회(CLI 프로세스 또는 SDK 요청)"로 고친다.
3. `runner.ts`:
   - `RunInput.maxOutputTokens: number | null`.
   - meta.json `runtime.generator = { ...adapter.generator, invocation: adapter.describeInvocation(req) }`. `params.maxOutputTokens`에는 받은 값(null 포함)을 그대로 쓴다.
   - 그 밖의 동작(재시도·타임아웃·백오프·저장·비용·출력 폴더 비어 있음 검사)은 바꾸지 마라.
4. 프롬프트 로더(새 파일, 예: `packages/core/src/prompt.ts`):
   ```ts
   export const CURRENT_PROMPT = { id: 'season-tree', version: 'v1' } as const;
   export async function loadPrompt(repoRoot: string, id: string, version: string): Promise<PromptSpec>;
   // user = prompts/<id>-<version>.md, system = prompts/<id>-<version>.system.md
   ```
   - 파일 내용을 **그대로** 쓴다(끝 줄바꿈 포함, trim 금지).
   - CRLF가 있으면 고치지 말고 에러로 거부한다(`.gitattributes`가 LF를 보장하므로 CRLF는 설정이 깨졌다는 신호다). UTF-8 BOM 처리(거부 또는 제거)는 재량이며, 고른 방식을 handoff에 남긴다.
   - `PromptSpec`은 runner.ts에 있다. 이 파일로 옮기거나 `system`을 `string`으로 좁히는 것은 재량이다(좁히면 runner 테스트 픽스처도 함께 고친다).
   - 테스트: OS 임시 디렉토리(`mkdtemp`)에 프롬프트 파일을 만들어 (a) 내용이 바이트 그대로 돌아온다(끝 줄바꿈 포함), (b) 파일이 없으면 경로가 담긴 에러, (c) CRLF면 거부. 그리고 실제 레포의 `prompts/season-tree-v1.*`가 로더를 통과하는지 **읽기만** 하는 테스트 하나.
5. `examples/meta.sample.json`: `runtime`을 새 모양으로 바꾸고(예: `generator: { tool: 'claude-code', version: '2.1.296', invocation: 'claude -p --model … --system-prompt <system prompt> …' }`), 스크린샷 경로 4개를 `.jpg`로 바꾼다. `check-samples.ts`가 계속 통과해야 한다.
6. `test/runner.test.ts`: 가짜 어댑터를 새 인터페이스로 바꾸고 테스트를 추가한다. (a) meta.json `runtime.generator`에 어댑터의 tool·version과 `describeInvocation` 결과가 기록된다. (b) `maxOutputTokens: null`이 `GenerationRequest`와 `params.maxOutputTokens`에 null로 전달·기록된다. (c) `maxOutputTokensFor`가 지원 여부에 따라 65,536/null을 돌려준다. 기존 9개 케이스는 의미를 그대로 유지한다.
7. `@opb/core`의 공개 진입점에서 pipeline이 쓸 것을 내보낸다: 스키마·타입, `GENERATOR_BY_PROVIDER`, `runGeneration`·`RunnerDeps`·`RunInput`, 어댑터 타입·`RETRYABLE_FAILURES`·`DEFAULT_RUN_POLICY`·`DEFAULT_MAX_OUTPUT_TOKENS`·`maxOutputTokensFor`, `loadPrompt`·`CURRENT_PROMPT`·`PromptSpec`, `extractHtml`, `judgeRequests`, `sortByRelease`. 바뀐 이름이 있으면 handoff에 남긴다.

## 금지사항

- `results/` 아래 파일을 만들거나 고치지 마라. 이유: CLAUDE.md CRITICAL(결과물은 파이프라인만 쓴다).
- `schemaVersion`을 올리지 마라. 이유: 실제 데이터가 아직 없어 이전 버전 호환이 필요 없다(DATA.md).
- 이전 설계의 Anthropic SDK 어댑터를 만들지 마라. 이유: 제거된 설계다(ARCHITECTURE "기존 코드에서 바꿀 것").
- 스키마·불변식·provider→도구 대응을 pipeline 쪽에 다시 정의하지 마라. 이유: `schema.ts` 단일 출처(CLAUDE.md CRITICAL).
- 프롬프트 내용을 trim·줄바꿈 정규화하지 마라. 이유: 원문을 한 글자도 바꾸지 않고 보내며, 보낸 내용을 sha256으로 기록한다.
