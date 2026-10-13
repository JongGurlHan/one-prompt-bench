import { createInterface } from 'node:readline/promises';

/** 사람에게 묻고 한 줄 답을 받는다. 입력이 취소되면(EOF·Ctrl+C) null. judge가 쓴다 */
export type Ask = (question: string) => Promise<string | null>;

/**
 * node:readline/promises로 묻는다. 질문은 그대로 출력하고(끝의 ": " 등은 부르는 쪽이 붙인다), 답은 손대지 않고 돌려준다.
 * 입력이 끝나거나(EOF) Ctrl+C면 null. createTerminalConfirm처럼 질문마다 인터페이스를 만들고 닫는다(터미널 입력용)
 */
export function createTerminalAsk(
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
): Ask {
  return async (question) => {
    const rl = createInterface({ input, output });
    const ac = new AbortController();
    rl.once('close', () => ac.abort());
    rl.once('SIGINT', () => rl.close());
    try {
      return await rl.question(question, { signal: ac.signal });
    } catch {
      return null;
    } finally {
      rl.close();
    }
  };
}
