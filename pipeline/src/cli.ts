import { parseArgs } from 'node:util';

/**
 * argv → 실행할 명령 (순수 함수).
 * help·usage_error는 main.ts가 Nest 컨텍스트 없이 바로 처리한다.
 */
export type Command =
  | { kind: 'help' }
  | { kind: 'usage_error'; message: string }
  | { kind: 'gen'; slugs: string[]; all: boolean; force: boolean }
  | { kind: 'smoke'; slug: string }
  | { kind: 'validate'; slugs: string[]; all: boolean }
  | ({ kind: 'judge'; slug: string; yes: boolean } & Partial<Record<JudgeValueFlag, string>>);

/** judge만 쓰는 값 플래그. 값은 받은 그대로 넘기고 검사는 judge 명령이 한다 */
const JUDGE_VALUE_FLAGS = ['scene', 'cycle', 'look', 'label', 'note'] as const;
type JudgeValueFlag = (typeof JUDGE_VALUE_FLAGS)[number];

export const USAGE = `사용법: main.ts <명령> [옵션]

명령:
  gen <slug…> | --all [--force]   모델 생성 + 검증 → results/<slug>/ (실제 모델 호출 — 사람만 실행)
                                  이미 기록이 있는 모델은 건너뛰고, api_failed·중단된 폴더만 다시 만든다
  smoke <slug>                    짧은 요청 1회 → results-smoke/<slug>-<시각>/ (실제 모델 호출 — 사람만 실행)
                                  재시도 없음, 출력 상한 8000, 도구 원본 출력(raw-*)도 저장. git 변경 검사는 하지 않는다
  validate <slug…> | --all        Playwright 재검증 → results/<slug>/meta.json의 validation과 스크린샷 4장만 바꾼다
                                  (모델 호출 없음, 결과물의 three.js CDN 접속). 결과물·판정은 그대로
  judge <slug> [플래그…]          사람이 한 판정 → results/<slug>/judgment.json (모델 호출 없음, 결과물이 있는 ok만)
                                  플래그로 주지 않은 요구사항(과 메모)만 터미널에서 묻는다. 요구사항 4개를 모두
                                  플래그로 주면 묻지 않는다(--note가 없으면 메모 없음). 기존 판정은 y/N 확인 뒤 덮어쓴다

옵션:
  --all       (gen) models.json의 모든 모델 (출시일 최신순)
              (validate) outcome이 ok인 모델 전부, 나머지는 건너뜀
  --force     (gen) 결과 폴더를 비우고 다시 생성. 판정(judgment.json)도 함께 지워진다 — 실행 전에 y/N 확인
  --scene · --cycle · --look · --label <pass|partial|fail>
              (judge) 요구사항 scene · seasonCycle · seasonLook · seasonLabel의 판정
  --note <메모>
              (judge) 한 줄 메모 (선택, 1~200자, 사이트에 그대로 공개)
  --yes       (judge) 기존 판정을 확인 없이 덮어쓴다
  -h, --help  사용법 출력`;

export function parseCommand(argv: string[]): Command {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        help: { type: 'boolean', short: 'h' },
        all: { type: 'boolean' },
        force: { type: 'boolean' },
        scene: { type: 'string' },
        cycle: { type: 'string' },
        look: { type: 'string' },
        label: { type: 'string' },
        note: { type: 'string' },
        yes: { type: 'boolean' },
      },
      allowPositionals: true,
      strict: true,
    });
  } catch (err) {
    return { kind: 'usage_error', message: err instanceof Error ? err.message : String(err) };
  }

  // 명령 뒤에 --help가 붙어도 명령을 실행하지 않고 사용법만 보여 준다
  if (parsed.values.help) return { kind: 'help' };

  const [name, ...rest] = parsed.positionals;
  if (name === undefined) return { kind: 'usage_error', message: '명령이 없습니다.' };

  const judgeFlags = [...JUDGE_VALUE_FLAGS, 'yes' as const].filter((f) => parsed.values[f] !== undefined);
  if (name !== 'judge' && judgeFlags.length > 0) {
    return { kind: 'usage_error', message: `${name}: --${judgeFlags[0]}는 judge 명령에서만 쓸 수 있습니다.` };
  }

  if (name === 'gen') {
    const slugs = [...new Set(rest)];
    const all = parsed.values.all ?? false;
    if (all && slugs.length > 0) return { kind: 'usage_error', message: 'gen: slug와 --all을 함께 쓸 수 없습니다.' };
    if (!all && slugs.length === 0) return { kind: 'usage_error', message: 'gen: 모델 slug나 --all이 필요합니다.' };
    return { kind: 'gen', slugs, all, force: parsed.values.force ?? false };
  }
  if (name === 'smoke') {
    if (parsed.values.all || parsed.values.force) {
      return { kind: 'usage_error', message: 'smoke: --all·--force는 쓸 수 없습니다. 모델 slug 1개만 주세요.' };
    }
    const [slug, ...extra] = rest;
    if (slug === undefined || extra.length > 0) {
      return { kind: 'usage_error', message: `smoke: 모델 slug가 정확히 1개 필요합니다 (받은 수: ${rest.length}).` };
    }
    return { kind: 'smoke', slug };
  }
  if (name === 'validate') {
    if (parsed.values.force) return { kind: 'usage_error', message: 'validate: --force는 쓸 수 없습니다.' };
    const slugs = [...new Set(rest)];
    const all = parsed.values.all ?? false;
    if (all && slugs.length > 0) {
      return { kind: 'usage_error', message: 'validate: slug와 --all을 함께 쓸 수 없습니다.' };
    }
    if (!all && slugs.length === 0) {
      return { kind: 'usage_error', message: 'validate: 모델 slug나 --all이 필요합니다.' };
    }
    return { kind: 'validate', slugs, all };
  }
  if (name === 'judge') {
    if (parsed.values.all || parsed.values.force) {
      return { kind: 'usage_error', message: 'judge: --all·--force는 쓸 수 없습니다. 모델 slug 1개만 주세요.' };
    }
    const [slug, ...extra] = rest;
    if (slug === undefined || extra.length > 0) {
      return { kind: 'usage_error', message: `judge: 모델 slug가 정확히 1개 필요합니다 (받은 수: ${rest.length}).` };
    }
    const values: Partial<Record<JudgeValueFlag, string>> = {};
    for (const f of JUDGE_VALUE_FLAGS) {
      const v = parsed.values[f];
      if (v !== undefined) values[f] = v;
    }
    return { kind: 'judge', slug, ...values, yes: parsed.values.yes ?? false };
  }
  return { kind: 'usage_error', message: `알 수 없는 명령: ${name}` };
}
