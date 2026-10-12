import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ModelRegistrySchema, type ModelEntry } from '@opb/core';

/** <repoRoot>/models.json을 읽어 core 스키마로 검사한다. slug는 여기를 통과한 값만 쓴다 (결과 폴더 이름) */
export async function loadModels(repoRoot: string): Promise<ModelEntry[]> {
  const file = path.join(repoRoot, 'models.json');
  let json: unknown;
  try {
    json = JSON.parse(await readFile(file, 'utf8'));
  } catch (err) {
    throw new Error(`models.json을 읽을 수 없습니다: ${file} (${err instanceof Error ? err.message : String(err)})`, {
      cause: err,
    });
  }
  const parsed = ModelRegistrySchema.safeParse(json);
  if (!parsed.success) throw new Error(`models.json이 스키마를 통과하지 못합니다: ${formatIssues(parsed.error)}`);
  return parsed.data;
}

/** zod 이슈를 '경로: 메시지' 몇 개로 줄인다 (사람이 읽는 한 줄) */
export function formatIssues(
  error: { issues: readonly { path: readonly PropertyKey[]; message: string }[] },
  max = 3,
): string {
  const shown = error.issues
    .slice(0, max)
    .map((i) => `${i.path.length > 0 ? i.path.map(String).join('.') : '(root)'}: ${i.message}`)
    .join('; ');
  const more = error.issues.length - max;
  return more > 0 ? `${shown} 외 ${more}개` : shown;
}
