import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';

/* ────────────────────────────────────────────────────────────
 * 설정 = 레포 루트 + .env 값.
 * .env는 dotenv.parse로 읽어 이 객체에만 둔다. process.env에는 넣지 않는다:
 * 나중에 띄울 Claude·Codex 자식 프로세스로 키가 넘어가지 않게 하려는 것이다 (ARCHITECTURE "Gemini API").
 * 값(키)은 로그·에러 메시지에 넣지 않는다.
 * ──────────────────────────────────────────────────────────── */

export interface AppConfig {
  /** 절대 경로. models.json·prompts/·results/가 있는 곳 */
  readonly repoRoot: string;
  /** <repoRoot>/.env를 dotenv.parse로 읽은 값. 파일이 없으면 빈 객체 */
  readonly dotenv: Readonly<Record<string, string>>;
}

export const GEMINI_API_KEY = 'GEMINI_API_KEY';

/** 이 파일 위치(pipeline/src/config/)에서 계산한 레포 루트 */
export function defaultRepoRoot(): string {
  return fileURLToPath(new URL('../../../', import.meta.url)).replace(/[\\/]+$/, '');
}

export async function loadConfig(repoRoot: string): Promise<AppConfig> {
  const file = path.join(repoRoot, '.env');
  let src: string;
  try {
    src = await readFile(file, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { repoRoot, dotenv: {} };
    throw new Error(`.env를 읽을 수 없습니다: ${file} (${code ?? 'unknown'})`, { cause: err });
  }
  return { repoRoot, dotenv: Object.freeze(parse(src)) };
}

/** 사람에게 보여 줄 문자열에서 .env 값을 가린다. 짧은 값(8자 미만)은 키가 아니라고 보고 두어 문장이 깨지지 않게 한다 */
export function redactSecrets(text: string, config: AppConfig): string {
  let out = text;
  for (const value of Object.values(config.dotenv)) {
    if (value.length >= 8) out = out.split(value).join('***');
  }
  return out;
}
