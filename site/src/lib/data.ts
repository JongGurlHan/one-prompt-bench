import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { displayModel, loadResults, type ModelDisplay, type ResultEntry } from '@opb/core';

/* ────────────────────────────────────────────────────────────
 * 사이트 데이터 (빌드 때만 읽는다, ADR-002)
 * 데이터 루트는 OPB_DATA_ROOT(테스트의 임시 디렉토리), 없거나 비면 레포 루트다.
 * 표시 값은 core displayModel만 쓴다 — 라벨·포맷을 여기서 다시 만들지 않는다.
 * ──────────────────────────────────────────────────────────── */

export const DATA_ROOT = path.resolve(process.env.OPB_DATA_ROOT || __OPB_REPO_ROOT__);

export interface SiteModel {
  entry: ResultEntry;
  display: ModelDisplay;
}

export interface SiteData {
  /** sortByRelease 순서 (출시일 최신순) */
  models: SiteModel[];
}

let cached: Promise<SiteData> | undefined;

/**
 * 빌드에서는 한 번만 읽고 모든 페이지·사본이 같은 결과를 쓴다.
 * 개발 서버는 요청마다 다시 읽어서 results/가 바뀌면 새로고침으로 보인다.
 * 스키마를 통과하지 못한 파일이 있으면 loadResults가 경로를 담아 던져서 빌드가 실패한다.
 */
export function loadSiteData(): Promise<SiteData> {
  if (import.meta.env.DEV) return readSiteData();
  return (cached ??= readSiteData());
}

async function readSiteData(): Promise<SiteData> {
  const entries = await loadResults(DATA_ROOT);
  console.info(`[opb] data: ${entries.length} models from ${DATA_ROOT}`);
  return { models: entries.map((entry) => ({ entry, display: displayModel(entry) })) };
}

/* ───────── 결과물 사본 (dist/r/<slug>/) ───────── */

/** dist/r/<slug>/에 바이트 그대로 내는 파일. 스크린샷·meta.json·judgment.json은 내지 않는다 */
export const RAW_FILES = {
  'index.html': {
    contentType: 'text/html; charset=utf-8',
    exists: ({ entry }: SiteModel) => entry.record?.output != null,
  },
  'response.txt': {
    contentType: 'text/plain; charset=utf-8',
    exists: ({ entry }: SiteModel) => entry.record?.responseTextPath != null,
  },
} as const;
export type RawFileName = keyof typeof RAW_FILES;

/** 그 파일이 있는 모델의 slug (getStaticPaths용) */
export async function rawFileSlugs(name: RawFileName): Promise<string[]> {
  const { models } = await loadSiteData();
  return models.filter(RAW_FILES[name].exists).map((m) => m.display.slug);
}

/** results/<slug>/<name>을 읽어 그대로 돌려준다 */
export async function rawFileResponse(slug: string | undefined, name: RawFileName): Promise<Response> {
  const { models } = await loadSiteData();
  const model = models.find((m) => m.display.slug === slug);
  if (!model || !RAW_FILES[name].exists(model)) return new Response(null, { status: 404 });
  const bytes = await readFile(path.join(DATA_ROOT, 'results', model.display.slug, name));
  return new Response(bytes, { headers: { 'Content-Type': RAW_FILES[name].contentType } });
}
