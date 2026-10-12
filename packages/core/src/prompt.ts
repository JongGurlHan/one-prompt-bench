import { readFile } from 'node:fs/promises';
import path from 'node:path';

/** 모델에 보내는 프롬프트 한 벌. system·user는 파일 내용 그대로다 (meta.json prompt.sha256이 둘을 함께 해시) */
export interface PromptSpec {
  id: string;
  version: string;
  system: string; // 세 도구 공통 최소 지시문 (ADR-005)
  user: string;
}

/** 지금 생성에 쓰는 프롬프트. 바꾸면 결과 전체를 다시 만들어야 하므로 새 버전 파일을 추가한다 */
export const CURRENT_PROMPT = { id: 'season-tree', version: 'v1' } as const;

/**
 * prompts/<id>-<version>.md(user)와 .system.md(system)를 읽는다.
 * 한 글자도 고치지 않는다(trim·줄바꿈 정규화 없음). 고쳐야 읽히는 파일은 거부한다:
 * 조용히 고치면 실제로 보낸 내용과 레포의 파일이 달라진 사실이 숨는다.
 */
export async function loadPrompt(repoRoot: string, id: string, version: string): Promise<PromptSpec> {
  const base = path.join(repoRoot, 'prompts', `${id}-${version}`);
  const [user, system] = await Promise.all([readPromptFile(`${base}.md`), readPromptFile(`${base}.system.md`)]);
  return { id, version, system, user };
}

// fatal: 잘못된 바이트를 U+FFFD로 바꾸지 않고 throw. ignoreBOM: BOM을 지우지 않고 남겨서 아래에서 거부
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

async function readPromptFile(file: string): Promise<string> {
  let bytes: Buffer;
  try {
    bytes = await readFile(file);
  } catch (err) {
    throw new Error(`prompt file not readable: ${file} (${(err as NodeJS.ErrnoException).code ?? String(err)})`, {
      cause: err,
    });
  }

  let text: string;
  try {
    text = utf8.decode(bytes);
  } catch (err) {
    throw new Error(`prompt file is not valid UTF-8: ${file}`, { cause: err });
  }
  if (text.startsWith('﻿')) {
    throw new Error(`prompt file starts with a UTF-8 BOM: ${file} — save it as UTF-8 without BOM`);
  }
  if (text.includes('\r')) {
    // .gitattributes가 prompts/**를 LF로 고정한다. CR이 있으면 그 설정이 깨진 체크아웃이다
    throw new Error(`prompt file has CRLF (or CR) line endings: ${file} — check .gitattributes (prompts/** eol=lf)`);
  }
  return text;
}
