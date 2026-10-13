# Step 0: judge-cli

## 목표

`npm run judge -- <slug>`가 동작한다. 사람이 요구사항 4개(pass/partial/fail)와 메모를 입력하면 `results/<slug>/judgment.json`이 만들어지고, 판정 기준표(`prompts/season-tree-v1.judging.md`)를 읽는 core 함수가 생긴다(step 2의 프롬프트 탭도 같은 함수를 쓴다).

- 대화형(터미널에서 한 항목씩 묻기)과 플래그(`--scene --cycle --look --label --note --yes`) 두 방식이 같은 코드를 지난다. 테스트는 플래그와 가짜 입력으로만 한다.
- sha256·판정 시각·프롬프트 id/version은 자동으로 채우고, 저장 전에 `JudgmentSchema`로 검사한다.
- 결과물이 없는 모델(outcome이 `ok`가 아님)·meta.json 없음·모르는 slug는 거절한다.
- 기존 판정이 있으면 내용을 보여 주고 덮어쓸지 y/N으로 확인한다(`--yes`면 확인 없이 덮어쓴다).

## 관련 파일

- `docs/ARCHITECTURE.md` "판정 도우미", "NestJS 사용 규칙", "테스트 전략"
- `docs/DATA.md` "judgment.json", "check:results"의 규칙 7, `docs/ADR.md` ADR-012·ADR-013·ADR-015
- `docs/OPERATIONS.md` "판정"
- `packages/core/src/schema.ts`(`JudgmentSchema`·`MarkSchema`·`GenerationRecordSchema`), `packages/core/src/display.ts`(`REQUIREMENT_LABEL`·`MARK_LABEL`), `packages/core/src/prompt.ts`(파일 읽기 규칙: CRLF·BOM 거부)
- `prompts/season-tree-v1.judging.md` (표 구조를 확인한다)
- 본보기: `pipeline/src/validation/validate.ts`·`validate.service.ts`(명령 함수 + 얇은 Nest 서비스), `pipeline/src/system/confirm.ts`(`Confirm`·`createTerminalConfirm`), `pipeline/src/cli.ts`·`main.ts`(명령 등록), `pipeline/src/tokens.ts`, `pipeline/test/validate-command.test.ts`·`cli.test.ts`·`app.module.test.ts`
- 테스트 데이터: `@opb/core/testing`(`makeDataRoot`·`writeResult`·`fakeModel`)

## 작업

테스트를 먼저 작성한다. 시그니처는 예시이고 재량이다. 바꾸면 handoff에 남긴다.

1. **core: 판정 기준표 읽기** (`packages/core/src/judging.ts`, `index.ts`에서 내보냄)
   ```ts
   export interface JudgingRow { key: RequirementKey; label: string; pass: string; partial: string; fail: string }
   export interface JudgingCriteria { intro: string[]; rows: JudgingRow[] }  // intro = 표 위의 문단들(줄 단위 그대로)
   export function parseJudgingCriteria(markdown: string): JudgingCriteria
   export async function loadJudgingCriteria(repoRoot: string, id: string, version: string): Promise<JudgingCriteria>
   ```
   - 표의 행 이름 칸 `장면 (\`scene\`)`에서 키(`scene`·`seasonCycle`·`seasonLook`·`seasonLabel`)를 읽고, 표시 이름은 core `REQUIREMENT_LABEL`을 쓴다(여기서 새 이름을 만들지 않는다). 칸 안의 백틱은 글자 그대로 둔다.
   - 4개 키가 모두 한 번씩 있어야 한다. 표가 없거나 키가 빠지거나 겹치면 파일 경로가 든 에러로 던진다.
   - 파일 읽기 규칙(UTF-8, BOM·CRLF 거부)은 `loadPrompt`와 같다. 중복하지 말고 `prompt.ts`의 읽기 함수를 내보내서 쓰는 쪽을 먼저 검토한다.
   - 파일 끝 문단("판정은 `results/<모델>/judgment.json`에 기록한다…")은 intro가 아니라 표 아래 내용이다. `intro`는 표 위의 비어 있지 않은 줄들이다.
2. **pipeline: 판정 명령** (`pipeline/src/judging/`)
   - 순수한 부분: `buildJudgment({ record, answers, now }) → Judgment`. `outputSha256`은 `record.output.sha256`, `prompt`는 `record.prompt`의 id·version, `judgedAt`은 한국 시간(+09:00 오프셋) ISO 문자열이다(`JudgmentSchema`의 `Timestamp`가 받는 형식을 확인한다). 결과가 스키마를 통과해야 한다.
   - 명령: `runJudge(opts, deps)` — `opts`는 `{ slug, scene?, cycle?, look?, label?, note?, yes? }`. 플래그로 받지 못한 값만 대화형으로 묻는다(묻기 전에 결과물 경로와 스크린샷 4장 경로, 판정 기준표 요약(`loadJudgingCriteria`)을 보여 준다). exit code를 돌려준다: 저장했으면 0, 사용자가 덮어쓰기를 거절했거나 입력이 취소됐거나 아래 거절 사유가 있으면 1.
   - 거절 사유(모두 아무것도 쓰지 않고 exit 1, 이유를 한국어로 출력): 모르는 slug, meta.json 없음, outcome이 `ok`가 아님, `output`이 null, 메모가 비었거나 200자 초과, 플래그 값이 `pass`/`partial`/`fail`이 아님.
   - 입력 받기: `Confirm`처럼 주입할 수 있는 `Ask`(질문 → 한 줄 답) 함수 타입을 `system/`에 두고 `createTerminalAsk()`(readline, EOF·Ctrl+C면 취소 → exit 1)로 구현한다. 요구사항 값은 `pass`/`partial`/`fail` 또는 `p`/`a`/`f`처럼 짧은 입력도 받되, 잘못된 입력은 다시 묻는다(최대 3회, 그 뒤 취소). 입력 방식의 세부는 재량이다.
   - 저장: `results/<slug>/judgment.json`, 2칸 들여쓰기 + 끝 줄바꿈(Runner·검증기가 meta.json을 쓰는 형식과 같게). 저장 직전에 `JudgmentSchema.parse`. 기존 `judgment.json`이 있으면 읽어서(깨져 있어도 멈추지 말고 "깨진 판정"으로 알리고 덮어쓸지 묻는다) 값을 보여 준 뒤 확인한다.
   - `JudgeService`(Nest, `@Inject(TOKEN)` 명시) + `tokens.ts`에 토큰 추가 + `app.module.ts` 등록. `cli.ts`의 `Command`에 `judge`를 더하고 `USAGE`에 설명을 쓴다. `main.ts`의 `execute` switch에 연결한다(`never` 검사가 깨지지 않게).
   - 루트 `package.json`에 `"judge": "tsx --tsconfig pipeline/tsconfig.json pipeline/src/main.ts judge"`.
3. **테스트** (모두 OS 임시 디렉토리의 가짜 데이터, 가짜 `Ask`)
   - core: `parseJudgingCriteria`가 실제 `prompts/season-tree-v1.judging.md`를 읽어 행 4개(키·순서·문구)를 돌려준다(이 파일은 읽기만 한다). 표 없음·키 빠짐·키 중복·CRLF는 던진다.
   - `buildJudgment`: 필드가 meta.json에서 오고 스키마를 통과한다. `judgedAt`이 +09:00 오프셋.
   - 명령: 플래그만으로 저장 → 파일 내용·형식. 일부만 플래그면 나머지를 묻는다(가짜 Ask의 질문 목록을 확인). 기존 판정 덮어쓰기: 거절하면 파일이 그대로, `--yes`면 덮어씀. 거절 사유 6가지 각각 파일이 생기지 않는다. 저장된 데이터가 core `checkResults`(규칙 7)를 통과한다.
   - `cli.test.ts`에 `judge` 파싱(slug 1개 필요, 플래그 값)을 더하고, `app.module.test.ts`에 서비스 등록을 더한다.
4. 끝나면 ARCHITECTURE "판정 도우미"와 구현이 다른 점이 생겼으면 handoff에 남긴다. 사람이 쓸 실행 예시(대화형과 플래그)를 handoff에 한 줄로 적는다.

## 금지사항

- `npm run judge`를 실제 `results/`에 대해 실행하지 마라. 테스트에서도 레포의 `results/`에 쓰지 마라(읽기는 `prompts/` 파일에 한해서만). 이유: CLAUDE.md CRITICAL — `results/`는 파이프라인과 사람만 쓴다.
- 판정 값·메모를 지어내지 마라(기본값 `pass` 같은 것도 두지 마라). 이유: 판정은 사람이 하는 일이고, 기본값이 있으면 입력 없이 넘기는 실수가 기록으로 남는다.
- `schema.ts`의 `JudgmentSchema`를 바꾸지 마라. 이유: 이 phase에 예정된 스키마 변경이 없다(필요해 보이면 멈추고 handoff에 남긴다).
- 요구사항 이름·판정 기호 문구를 새로 만들지 마라. 이유: `display.ts`의 `REQUIREMENT_LABEL`·`MARK_LABEL`이 단일 출처다(CLAUDE.md CRITICAL).
- 실제 모델 호출(`gen`·`smoke`·`claude -p`·`codex exec`·Gemini API)을 실행하지 마라. 이유: CLAUDE.md CRITICAL.
- `docs/`를 고치지 마라. 이유: 확정 문서는 사람 확인 뒤에 옮긴다. 달라진 점은 handoff에 남긴다.
