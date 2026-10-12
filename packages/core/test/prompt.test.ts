import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CURRENT_PROMPT, loadPrompt } from '../src/prompt.js';

/** 임시 레포에 prompts/<id>-<version>.md·.system.md를 바이트 그대로 쓴다 (undefined면 만들지 않음) */
async function fakeRepo(files: { user?: string | Buffer; system?: string | Buffer }) {
  const repoRoot = await mkdtemp(path.join(tmpdir(), 'bench-prompt-'));
  await mkdir(path.join(repoRoot, 'prompts'));
  const userPath = path.join(repoRoot, 'prompts', 'season-tree-v1.md');
  const systemPath = path.join(repoRoot, 'prompts', 'season-tree-v1.system.md');
  if (files.user !== undefined) await writeFile(userPath, files.user);
  if (files.system !== undefined) await writeFile(systemPath, files.system);
  return { repoRoot, userPath, systemPath };
}

const rejectsWith =
  (...parts: string[]) =>
  (err: unknown) => {
    assert.ok(err instanceof Error);
    for (const p of parts) assert.ok(err.message.includes(p), `"${err.message}" should include "${p}"`);
    return true;
  };

test('내용을 바이트 그대로 돌려준다 (앞뒤 공백·끝 줄바꿈 포함, trim 없음)', async () => {
  const user = '  사계절이 바뀌는 3D 나무를 만들어주세요.\n\n- 봄 → 여름\n\n';
  const system = '사용자의 요청에 답하세요.\n';
  const { repoRoot } = await fakeRepo({ user, system });

  const spec = await loadPrompt(repoRoot, 'season-tree', 'v1');
  assert.deepEqual(spec, { id: 'season-tree', version: 'v1', system, user });
  assert.ok(Buffer.from(spec.user, 'utf8').equals(Buffer.from(user, 'utf8')));
});

test('파일이 없으면 그 경로가 담긴 에러', async () => {
  const noUser = await fakeRepo({ system: 'x\n' });
  await assert.rejects(loadPrompt(noUser.repoRoot, 'season-tree', 'v1'), rejectsWith(noUser.userPath));

  const noSystem = await fakeRepo({ user: 'x\n' });
  await assert.rejects(loadPrompt(noSystem.repoRoot, 'season-tree', 'v1'), rejectsWith(noSystem.systemPath));
});

test('CRLF는 고치지 않고 거부 (.gitattributes의 LF 고정이 깨졌다는 신호)', async () => {
  const crlfUser = await fakeRepo({ user: '첫 줄\r\n둘째 줄\r\n', system: 'x\n' });
  await assert.rejects(loadPrompt(crlfUser.repoRoot, 'season-tree', 'v1'), rejectsWith(crlfUser.userPath, 'CRLF'));

  const crlfSystem = await fakeRepo({ user: 'x\n', system: '사용자의 요청에 답하세요.\r\n' });
  await assert.rejects(loadPrompt(crlfSystem.repoRoot, 'season-tree', 'v1'), rejectsWith(crlfSystem.systemPath, 'CRLF'));
});

test('UTF-8 BOM·UTF-8이 아닌 파일은 거부 (조용히 고치면 보낸 내용이 파일과 달라진다)', async () => {
  const bom = await fakeRepo({ user: '﻿사계절 나무\n', system: 'x\n' });
  await assert.rejects(loadPrompt(bom.repoRoot, 'season-tree', 'v1'), rejectsWith(bom.userPath, 'BOM'));

  // 메모장의 'Unicode'(UTF-16 LE) 저장
  const utf16 = await fakeRepo({ user: 'x\n', system: Buffer.from('﻿hi\n', 'utf16le') });
  await assert.rejects(loadPrompt(utf16.repoRoot, 'season-tree', 'v1'), rejectsWith(utf16.systemPath, 'UTF-8'));
});

test('레포의 현재 프롬프트가 로더를 통과한다 (읽기만)', async () => {
  const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
  const spec = await loadPrompt(repoRoot, CURRENT_PROMPT.id, CURRENT_PROMPT.version);
  assert.deepEqual(CURRENT_PROMPT, { id: 'season-tree', version: 'v1' });
  assert.equal(spec.id, 'season-tree');
  assert.equal(spec.version, 'v1');
  for (const [name, text] of [
    ['season-tree-v1.md', spec.user],
    ['season-tree-v1.system.md', spec.system],
  ] as const) {
    assert.ok(text.trim().length > 0, `${name} is empty`);
    const raw = await readFile(path.join(repoRoot, 'prompts', name));
    assert.ok(Buffer.from(text, 'utf8').equals(raw), `${name} must round-trip byte for byte`);
  }
});
