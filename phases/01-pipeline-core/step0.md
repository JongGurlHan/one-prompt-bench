# Step 0: workspace-setup

## 목표

npm workspaces 모노레포가 연결되어 루트에서 `npm run lint`·`npm run typecheck`·`npm test`가 동작한다.

- 기존 `packages/core` 테스트 17개(runner 9·request-rules 5·sort 3)와 `packages/core/scripts/check-samples.ts`가 **core 소스 동작을 바꾸지 않고** `npm test`에서 통과한다.
- `pipeline/` 워크스페이스에 NestJS 스탠드얼론 뼈대가 있고, `@Inject(TOKEN)` 생성자 주입이 tsx 실행에서 실제로 동작함을 테스트가 증명한다.

## 관련 파일

- `docs/ARCHITECTURE.md` "디렉토리 구조", "명령어", "테스트 전략", "NestJS 사용 규칙", "버전 참고", "프롬프트 읽기"
- `docs/ADR.md` ADR-003, ADR-014, ADR-015
- `packages/core/` 전체(src·test·examples·scripts). 아직 `package.json`이 없다. `test/sort.test.ts`는 레포 루트 `models.json`을 상대 경로로 읽는다.
- `.claude/hooks/block_dangerous.py`의 `ENTRY`·`LIVE_SCRIPTS` 패턴 — 진입점 파일 이름이 `main.ts`여야 훅이 `main.ts gen|smoke` 직접 실행을 막는다.

## 작업

1. 루트 `package.json`: `"private": true`, `"type": "module"`, `"engines": { "node": ">=22" }`, `"workspaces": ["packages/core", "pipeline"]`. `site`는 phase 2에서 추가한다(없는 경로를 넣지 마라). 스크립트:
   - `lint`: 루트에서 ESLint 한 번(flat config `eslint.config.js` + typescript-eslint). 대상은 `packages/`·`pipeline/`의 TS. `scripts/`(Python), `docs/`, `node_modules`, `dist`는 제외. type-aware 규칙은 필수가 아니다.
   - `typecheck`: `npm run typecheck --workspaces --if-present` (각 워크스페이스가 `tsc --noEmit`. phase 2의 site는 자기 스크립트로 astro check를 붙인다).
   - `test`: `npm test --workspaces --if-present`.
   - `gen`·`smoke` 스크립트는 만들지 마라(step 3·4 범위).
2. `tsconfig.base.json`: `strict`, `module`·`moduleResolution` = `NodeNext`, `target` ES2023 이상, `noEmit`. 그 밖의 옵션은 재량이되 기존 core 코드가 그대로 통과해야 한다. 각 워크스페이스의 `tsconfig.json`이 extends 한다.
3. `packages/core/package.json`: 이름 `@opb/core`, `"type": "module"`, 의존성 `zod`.
   - 빌드 없이 TS 소스를 직접 내보낸다(`exports`가 `src/` 아래 `.ts`를 가리키는 방식). pipeline에서 `import … from '@opb/core'`(또는 정한 서브패스)가 **tsx 실행과 `tsc --noEmit`(NodeNext) 양쪽에서** 해석되는지 pipeline 테스트·typecheck로 확인한다. 진입 파일(예: `src/index.ts`)을 새로 만드는 것은 괜찮다.
   - `test`: `tsx --test`로 `test/*.test.ts`를 실행한 뒤 `tsx scripts/check-samples.ts`. `typecheck`: `tsc --noEmit`(src·test·scripts 포함).
4. `pipeline/` 워크스페이스: 이름 `@opb/pipeline`, `"type": "module"`, 의존성 `@opb/core`(workspace), `@nestjs/common`, `@nestjs/core`, `reflect-metadata`, Nest가 요구하는 peer(rxjs 등).
   - `tsconfig.json`: `experimentalDecorators: true`. `emitDecoratorMetadata`에 의존하지 마라(tsx/esbuild 미지원).
   - `src/cli.ts`: `node:util`의 `parseArgs`로 argv를 해석하는 순수 함수 `parseCommand(argv: string[]): Command`(판별 유니온). 이 step에서는 명령이 없으므로 빈 인자·알 수 없는 명령 → 사용법 오류. gen·smoke는 step 3·4가 추가한다.
   - `src/main.ts`: 진입점. 맨 위 `import 'reflect-metadata'`. `parseCommand` 결과로 `NestFactory.createApplicationContext(AppModule)`를 띄워 명령을 실행하는 얇은 층. 사용법 오류면 사용법을 출력하고 exit code 1. HTTP 서버는 띄우지 않는다.
   - `src/tokens.ts`: DI 토큰(Symbol 또는 문자열 상수)을 한 곳에 모은다.
   - `src/app.module.ts`: `AppModule`. DI를 증명할 실제로 쓸모 있는 provider 하나 이상. 예: `CLOCK` 토큰 → core Runner의 `RunnerDeps`(`now`/`sleep`)와 같은 모양, 그것을 `@Inject(CLOCK)`로 받는 서비스.
   - `test`: `tsx --test`로 `pipeline/test/**/*.test.ts`. `typecheck`: `tsc --noEmit`.
   - 테스트(먼저 작성): (a) `parseCommand`가 빈 인자·알 수 없는 명령을 사용법 오류로 돌려준다. (b) `createApplicationContext(AppModule)`로 띄운 컨텍스트에서 `@Inject(TOKEN)`로 주입받은 의존성이 undefined가 아니고 동작한다. 테스트 끝에 `app.close()`. (c) pipeline 코드가 `@opb/core`의 값(예: `RETRYABLE_FAILURES` 또는 `sortByRelease`)을 import해 쓸 수 있다.
5. 버전: `docs/ARCHITECTURE.md` "버전 참고"(typescript ^7.0.2, tsx ^4.23.15, zod ^4.6.5, @types/node ^26.6.4). NestJS·ESLint·typescript-eslint는 설치 시점 최신 안정판.
   - **TypeScript 7이 typescript-eslint나 `experimentalDecorators`와 맞지 않으면 6.x로 내리고, 그 사실과 이유(실제 에러 메시지 요약)를 handoff에 남겨라.** 사람이 phase 뒤에 ADR에 옮긴다.
6. `.gitattributes`(새 파일, 루트):
   ```
   prompts/** text eol=lf
   results/** -text
   ```
   이유: 개발 PC는 `core.autocrlf=true`다. 프롬프트는 파일 내용 그대로 모델에 보내고 sha256을 기록하므로 체크아웃마다 줄바꿈이 바뀌면 안 된다. 결과물은 sha256으로 검사하므로 git이 바이트를 바꾸면 안 된다(ARCHITECTURE "프롬프트 읽기", DATA "파일 배치").
7. `npm install`로 의존성을 설치하고 `package-lock.json`을 만든다(커밋 대상). `.gitignore`는 이미 `node_modules/`·`dist/`를 무시한다.

## 금지사항

- `packages/core/src`의 동작(스키마·러너·추출·정렬·조건 검사)을 바꾸지 마라. 이유: 스키마 변경은 step 1의 범위이고, 이 step의 증명 대상은 "기존 테스트가 그대로 통과"다. lint 때문에 걸리면 규칙 조정을 먼저 고려하고, 코드를 고친다면 동작이 같은 범위에서만 고친다.
- 진입점 파일 이름을 `main.ts`가 아닌 것으로 만들지 마라. 이유: 훅이 `main.ts gen|smoke` 직접 실행을 이 이름으로 막는다.
- vitest·jest 같은 다른 테스트 러너를 들이지 마라. 이유: ADR-015, `node:test` + `tsx`로 통일.
- `site/` 워크스페이스나 `results/` 폴더를 만들지 마라. 이유: phase 2 범위, results/는 파이프라인만 쓴다.
- 빌드 산출물(`dist/`)을 거쳐 core를 쓰게 만들지 마라. 이유: 빌드 단계를 늘리지 않는다(tsx로 직접 실행).
