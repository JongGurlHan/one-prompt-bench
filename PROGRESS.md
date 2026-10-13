# 작업 인계 (PROGRESS)

> 새 대화형 세션은 이 파일부터 읽는다. 마지막 갱신: 2026-10-13 (phase 3 확인·첫 배포·Claude smoke·phase 4 계획 세션)
> 무인 step 세션(execute.py)은 이 파일을 읽을 필요 없다 — 필요한 맥락은 step 파일과 하네스가 준다.

## 지금 하는 일

aquagarden-bench를 참고한 LLM 벤치마크 사이트(One Prompt Bench) MVP. **phase 3(`03-deploy-claude-adapter`: 배포 워크플로 + Claude Code 어댑터)까지 끝나 main에 merge되고 첫 배포까지 됐다(https://jonggurlhan.github.io/one-prompt-bench/).** Claude smoke도 끝났다(fixture·⚠ 반영). **phase 4(`04-codex-adapter`) 계획을 만들어 실행을 기다리는 중이다.** 설계는 전부 `docs/`에 있다(CLAUDE.md "문서" 절).

## 진행 상태

- [x] 하네스 정비·기획 보완(docs 7종, 훅, execute.py 한도 감지) — 2026-10-12
- [x] phase 1 `01-pipeline-core` 완료·main merge(`edebe5a`), Gemini smoke → fixture
- [x] phase 2 `02-validator-results-tab` 완료·main merge(`d35d3f2`)
- [x] 사람 작업: Gemini 3.8 Flash 생성(2026-10-13) → `data:` 커밋(`eac58e0`)
- [x] phase 3 실행(step 0~2 모두 첫 시도에 완료, 정가 환산 $11.92·175턴, 세션 한도로 한 번 blocked 뒤 재개) → 확인(이 PC에서 lint·typecheck·test·build·check:results 통과) → main `--no-ff` merge(`680ff0e`)
- [x] phase 3 handoff → docs 반영·커밋(`60ade99`)
- [x] 첫 배포(2026-10-13): Pages Source = GitHub Actions, main push → run 38334877323 성공(리눅스에서만 도는 테스트 포함 전부 통과). 결과를 ARCHITECTURE "검증기"·"배포", OPERATIONS "배포"에 적었다.
- [x] Claude smoke(2026-10-13, claude-haiku-5-5): outcome ok → `raw-stdout.txt`를 fixture `stdout-smoke-ok.json`으로(테스트 추가), ARCHITECTURE "Claude Code CLI"에 "smoke로 확인한 것"과 남은 ⚠ 정리. 첫 배포 결과와 함께 한 번에 커밋·push하기로 했다(사용자).
- [x] phase 4 계획(2026-10-13): Codex 0.157.1 공개 소스(태그 `rust-v0.157.1`)로 이벤트 형식·설정 키·에러 문구·로그인 출력을 확인해 ARCHITECTURE "Codex CLI"를 다시 쓰고(사용량 이중 계산 바로잡음), 사용자 결정으로 ADR-027(덧붙는 블록 일부 끄기)을 더했다. `phases/04-codex-adapter/` step 0 `codex-adapter`, step 1 `codex-preflight-smoke`
- [ ] phase 4 실행 → 확인·merge → 사람 작업(Codex smoke, 8개 일괄 생성과 검증)
- [ ] phase 5

## 다음 세션이 바로 할 일

1. phase 4가 아직 안 돌았으면 사용자가 `python scripts/execute.py 04-codex-adapter`를 실행한다(`git status`가 깨끗해야 한다, `phases/`는 예외).
2. phase 4가 끝났으면 `/harness` F 절차: summary·handoff와 `npm test` 확인 → 사용자가 main에 `--no-ff` merge → handoff 결정을 docs로.
3. 사람 작업 안내: `! npm run smoke -- gpt-6-1-sol`(또는 다른 OpenAI 모델) → `raw-stdout.txt`(JSONL)를 `pipeline/test/fixtures/codex/`로 옮기고 ARCHITECTURE "Codex CLI"의 ⚠ 확정 → 8개 일괄 생성(`npm run gen -- --all`)과 검증. Claude 모델 생성에서는 reasoningTokens로 `--effort high` 적용을 본다.

## 사용자 결정·답변

- 문서에 옮기지 않은 결정은 없다. 2026-10-13에 `ANTHROPIC_AUTH_TOKEN`·`ANTHROPIC_BASE_URL`을 자식 환경에서 지우는 일을 "아직 하지 않는다"로 미뤘다(OPERATIONS "나중에 정할 것"에 기록).

## 주의할 점

- git: origin/main = `60ade99`(2026-10-13 push). main에 push하면 배포 워크플로가 돈다. 원격 `feat-02-validator-results-tab`은 `209e652`까지만 올라가 있다.
- gh 계정: 이 PC의 `gh`에 JongGurlHan·LeoMetascale 두 계정이 있고, 사용자가 **활성 계정을 JongGurlHan으로 두라고 했다**(2026-10-13, LeoMetascale로 되돌리지 않는다). 2026-10-13에 JongGurlHan 토큰에 `workflow` 권한을 더했다. 그때 활성 계정이 LeoMetascale인 상태에서는 push가 여전히 workflow 권한 없음으로 거부됐고, JongGurlHan을 활성으로 두자 통과했다(비활성 계정 쪽에는 갱신 전 토큰이 남아 있던 것으로 보인다).
- 이 PC 환경(2026-10-12 확인): Claude Code 2.1.296, codex-cli 0.157.1, Node 24.14, npm 11.9, Python 3.12, Windows + Git Bash. 환경변수에 ANTHROPIC/OPENAI/GEMINI 키 없음. `~/.codex/config.toml` 있음(생성 때 `--ignore-user-config`로 무시). `.env`에 GEMINI_API_KEY 있음(값은 읽지 않는다).
- Claude Code 안에서 `!`로 실행한 명령은 `CLAUDECODE`·`CLAUDE_EFFORT`·`CLAUDE_CODE_SESSION_ID` 등을 물려받는다. `cliEnv`가 자식 `claude -p`의 환경에서 지운다(phase 3 구현). 첫 Claude smoke에서 중첩 세션 거부 같은 문제가 나오면 이 부분을 먼저 본다.
- Claude smoke·생성과 Claude Code 개발이 같은 Pro 한도를 쓴다. phase 3도 step 2 도중 세션 한도에 걸렸다. smoke는 한도가 남아 있을 때 한다.
- `npm test`가 실제 Chromium을 띄운다(네트워크는 테스트가 전부 가로챈다). Chromium이 없으면 `npx playwright install chromium`.
- check:results는 결과 폴더 안에 meta.json이 가리키지 않는 파일(judgment.json 제외)이나 하위 폴더가 있어도 실패한다. 생성 뒤 `results/`에 다른 파일을 두지 않는다.
- 첫 실제 결과(`results/gemini-3-8-flash/`): 모델 코드가 THREE.Color에 없는 `addScaledColor`를 매 프레임 불러(index.html 555행) 화면이 검고 계절 패널이 "봄"에 멈춘다(에러 2105). 모델 결과이므로 그대로 둔다(ADR 철학 2). 판정 때 ✗. 결과 탭에는 이제 "에러 수"가 보인다(ADR-026).
- Mono 자리의 한글은 Plex Sans KR 글자로 그려지지만 단어 사이 공백은 Mono 고정폭이라 조금 넓다(UI_GUIDE대로 둠).
- 훅은 Claude 세션의 Bash 명령만 검사한다. 사람이 `!`로 실행한 명령과 execute.py가 띄우는 `claude -p`는 막지 않는다(의도된 동작). `npm run validate`는 results/를 바꾸므로 사람이 지시할 때만 쓴다.
- 루트의 빈 `migra/` 폴더는 사용자가 만든 것으로 보이며 git에 잡히지 않는다. 용도를 모르면 사용자에게 묻는다.
