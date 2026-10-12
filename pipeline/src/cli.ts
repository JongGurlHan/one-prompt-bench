import { parseArgs } from 'node:util';

/**
 * argv → 실행할 명령 (순수 함수). smoke는 step 4가 이 유니온에 추가한다.
 * help·usage_error는 main.ts가 Nest 컨텍스트 없이 바로 처리한다.
 */
export type Command =
  | { kind: 'help' }
  | { kind: 'usage_error'; message: string }
  | { kind: 'gen'; slugs: string[]; all: boolean; force: boolean };

export const USAGE = `사용법: main.ts <명령> [옵션]

명령:
  gen <slug…> | --all [--force]   모델 생성 + 검증 → results/<slug>/ (실제 모델 호출 — 사람만 실행)
                                  이미 기록이 있는 모델은 건너뛰고, api_failed·중단된 폴더만 다시 만든다

옵션:
  --all       models.json의 모든 모델 (출시일 최신순)
  --force     결과 폴더를 비우고 다시 생성. 판정(judgment.json)도 함께 지워진다 — 실행 전에 y/N 확인
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

  if (name === 'gen') {
    const slugs = [...new Set(rest)];
    const all = parsed.values.all ?? false;
    if (all && slugs.length > 0) return { kind: 'usage_error', message: 'gen: slug와 --all을 함께 쓸 수 없습니다.' };
    if (!all && slugs.length === 0) return { kind: 'usage_error', message: 'gen: 모델 slug나 --all이 필요합니다.' };
    return { kind: 'gen', slugs, all, force: parsed.values.force ?? false };
  }
  return { kind: 'usage_error', message: `알 수 없는 명령: ${name}` };
}
