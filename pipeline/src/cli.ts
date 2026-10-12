import { parseArgs } from 'node:util';

/**
 * argv → 실행할 명령 (순수 함수). gen·smoke는 step 3·4가 이 유니온에 추가한다.
 * help·usage_error는 main.ts가 Nest 컨텍스트 없이 바로 처리한다.
 */
export type Command = { kind: 'help' } | { kind: 'usage_error'; message: string };

export const USAGE = `사용법: main.ts <명령> [옵션]

명령:
  (없음)

옵션:
  -h, --help  사용법 출력`;

export function parseCommand(argv: string[]): Command {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: { help: { type: 'boolean', short: 'h' } },
      allowPositionals: true,
      strict: true,
    });
  } catch (err) {
    return { kind: 'usage_error', message: err instanceof Error ? err.message : String(err) };
  }

  // 명령 뒤에 --help가 붙어도 명령을 실행하지 않고 사용법만 보여 준다
  if (parsed.values.help) return { kind: 'help' };

  const [name] = parsed.positionals;
  if (name === undefined) return { kind: 'usage_error', message: '명령이 없습니다.' };
  return { kind: 'usage_error', message: `알 수 없는 명령: ${name}` };
}
