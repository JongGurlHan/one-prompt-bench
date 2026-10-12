import { createInterface } from 'node:readline/promises';

/** 사람에게 y/N을 묻는다. 승인이면 true. batch의 --force가 쓴다 (건너뛰는 플래그는 없다) */
export type Confirm = (message: string) => Promise<boolean>;

/** y·yes만 승인. 그 밖(빈 입력 포함)은 모두 거절 — 기본값은 N */
export function isYes(answer: string): boolean {
  return /^y(?:es)?$/i.test(answer.trim());
}

/** node:readline/promises로 묻는다. 입력이 끝나거나(EOF) Ctrl+C면 거절로 본다 */
export function createTerminalConfirm(
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
): Confirm {
  return async (message) => {
    const rl = createInterface({ input, output });
    const ac = new AbortController();
    rl.once('close', () => ac.abort());
    rl.once('SIGINT', () => rl.close());
    try {
      return isYes(await rl.question(`${message} [y/N] `, { signal: ac.signal }));
    } catch {
      return false;
    } finally {
      rl.close();
    }
  };
}
