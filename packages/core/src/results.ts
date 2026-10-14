import { createHash } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { ZodType } from 'zod';
import {
  GENERATOR_BY_PROVIDER,
  GenerationRecordSchema,
  JudgmentSchema,
  MAX_GENERATIONS,
  ModelRegistrySchema,
  type GenerationRecord,
  type Judgment,
  type ModelEntry,
} from './schema.js';
import { sortByRelease } from './sort.js';

/* ────────────────────────────────────────────────────────────
 * 데이터 루트(레포 루트 또는 테스트용 임시 디렉토리)의 models.json · results/ 읽기와 검사
 *  - loadResults  : 사이트 빌드용. 스키마만 검사한다 (DATA.md "사이트 빌드의 데이터 검사")
 *  - checkResults : 배포 게이트. DATA.md "check:results" 규칙 1~9 전부 + 버린 결과물 기록(ADR-032)
 *                   + 문서에 없는 경우는 엄격하게
 * 경로는 모두 데이터 루트 기준 POSIX 문자열이다 (meta.json의 경로 표기와 같다).
 * ──────────────────────────────────────────────────────────── */

export interface ResultEntry {
  model: ModelEntry;
  /** meta.json 없음 → null (생성 전) */
  record: GenerationRecord | null;
  judgment: Judgment | null;
}

export interface CheckIssue {
  /** 데이터 루트 기준 POSIX 경로 */
  path: string;
  message: string;
}

/** loadResults가 스키마를 통과하지 못한 파일을 만났을 때. 문제가 된 파일을 모두 담는다 */
export class ResultsDataError extends Error {
  constructor(readonly issues: readonly CheckIssue[]) {
    super(`invalid data files:\n${issues.map((i) => `  ${i.path}: ${i.message}`).join('\n')}`);
    this.name = 'ResultsDataError';
  }
}

const MODELS = 'models.json';
const RESULTS = 'results';
const META = 'meta.json';
const JUDGMENT = 'judgment.json';
/** meta.json이 가리키는 결과물·원문의 파일 이름 (사이트와 검증기가 이 이름으로 찾는다) */
const OUTPUT_FILE = 'index.html';
const RESPONSE_FILE = 'response.txt';

/**
 * models.json + results/<slug>/{meta,judgment}.json을 읽어 조인한다. sortByRelease 순서.
 * 스키마를 통과하지 못한 파일이 있으면 그 경로를 모두 담아 ResultsDataError를 던진다.
 * 파일 존재·sha256·판정 대조 같은 나머지 규칙은 검사하지 않는다 (check:results가 막는다).
 */
export async function loadResults(dataRoot: string): Promise<ResultEntry[]> {
  const issues: CheckIssue[] = [];
  const models = await readJson(dataRoot, MODELS, ModelRegistrySchema, issues);
  if (models.kind !== 'ok') {
    if (models.kind === 'missing') issues.push({ path: MODELS, message: 'missing' });
    throw new ResultsDataError(issues);
  }

  const entries: ResultEntry[] = [];
  for (const model of sortByRelease(models.value)) {
    const dir = `${RESULTS}/${model.slug}`;
    const meta = await readJson(dataRoot, `${dir}/${META}`, GenerationRecordSchema, issues);
    const judgment = await readJson(dataRoot, `${dir}/${JUDGMENT}`, JudgmentSchema, issues);
    entries.push({
      model,
      record: meta.kind === 'ok' ? meta.value : null,
      judgment: judgment.kind === 'ok' ? judgment.value : null,
    });
  }
  if (issues.length > 0) throw new ResultsDataError(issues);
  return entries;
}

/**
 * DATA.md "check:results" 규칙 1~9와 버린 결과물 기록의 불변식(phase 6)을 검사해 어긴 것을 모두 돌려준다.
 * 이슈가 없으면 빈 배열. results/가 없으면 결과가 없는 것이므로 models.json만 검사한다.
 */
export async function checkResults(dataRoot: string): Promise<CheckIssue[]> {
  const issues: CheckIssue[] = [];
  const add = (p: string, message: string) => void issues.push({ path: p, message });

  // 1. models.json이 스키마를 통과한다
  const models = await readJson(dataRoot, MODELS, ModelRegistrySchema, issues);
  if (models.kind === 'missing') add(MODELS, 'missing');
  // 모델 목록을 모르면 폴더 이름(2)·생성 도구(8)·버린 결과물 대조는 건너뛴다 (이미 1에서 실패)
  const registry = models.kind === 'ok' ? new Map(models.value.map((m) => [m.slug, m])) : null;
  if (models.kind === 'ok') await checkDiscarded(dataRoot, models.value, issues);

  // 2. results/ 아래 항목은 모두 폴더이고, 이름이 models.json의 slug다
  let resultsDir;
  try {
    resultsDir = await lstat(abs(dataRoot, RESULTS));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return issues; // 결과가 하나도 없음
    throw err;
  }
  if (!resultsDir.isDirectory()) {
    add(RESULTS, resultsDir.isSymbolicLink() ? 'symbolic link (must be a real folder)' : 'not a folder');
    return issues;
  }
  for (const entry of sortByName(await readdir(abs(dataRoot, RESULTS), { withFileTypes: true }))) {
    const rel = `${RESULTS}/${entry.name}`;
    // 심볼릭 링크는 가리키는 곳이 폴더여도 이슈 (문서에 없는 경우 → 엄격하게)
    if (entry.isSymbolicLink()) add(rel, 'symbolic link (must be a real folder)');
    else if (!entry.isDirectory()) add(rel, 'not a folder');
    else {
      const model = registry?.get(entry.name) ?? null;
      if (registry && !model) add(rel, 'not a slug in models.json');
      await checkFolder(dataRoot, entry.name, model, issues); // 모르는 폴더도 안을 검사해 모두 보고한다
    }
  }
  return issues;
}

/** 수정 요청 항목을 거절할 때의 이유 (gen --repair와 GenerationRecordSchema.repair는 필요해질 때 만든다). display도 쓴다 */
export const REPAIR_NOT_IMPLEMENTED = '수정 요청(--repair)은 아직 구현되지 않았다(ADR-032)';

/**
 * models.json의 버린 결과물 기록 (DATA "스키마 변경 예정"의 불변식 중 phase 6 범위, ADR-032).
 * 지금 공개 결과물은 항상 생성본이다(수정 요청 항목은 거절). 그래서 "생성본 항목이 앞" 순서 규칙은 저절로 지켜지고,
 * 수정본 규칙(횟수·순서·meta.json repair 대조)은 --repair와 함께 더한다. 커밋이 실제로 있는지는 보지 않는다(CI는 얕은 clone).
 */
async function checkDiscarded(dataRoot: string, models: readonly ModelEntry[], issues: CheckIssue[]) {
  const add = (p: string, message: string) => void issues.push({ path: p, message });
  for (const model of models) {
    const discarded = model.discarded;
    if (!discarded) continue;
    const key = `${model.slug}.discarded`;

    // 수정 요청 관련 항목(수정본이거나 다음에 수정 요청을 한 항목)
    discarded.forEach((d, i) => {
      if (d.made === 'repair' || d.next === 'repair') add(MODELS, `${key}.${i}: ${REPAIR_NOT_IMPLEMENTED}`);
    });

    // 생성본 횟수: 버린 생성본 + 공개 결과물(생성본) ≤ MAX_GENERATIONS
    const generations = discarded.filter((d) => d.made === 'generation').length + 1;
    if (generations > MAX_GENERATIONS) {
      add(
        MODELS,
        `${key}: ${generations - 1} discarded generations + the published result = ${generations} generations (max ${MAX_GENERATIONS})`,
      );
    }

    // 버린 결과물이 있으면 공개 결과물(meta.json)이 있어야 한다
    const metaRel = `${RESULTS}/${model.slug}/${META}`;
    if (!(await isRegularFile(abs(dataRoot, metaRel)))) {
      add(metaRel, `missing (models.json ${key} records discarded results, so the published result must exist)`);
    }
  }
}

/** 규칙 3~9: results/<slug>/ 하나 */
async function checkFolder(dataRoot: string, slug: string, model: ModelEntry | null, issues: CheckIssue[]) {
  const add = (p: string, message: string) => void issues.push({ path: p, message });
  const dir = `${RESULTS}/${slug}`;
  const entries = sortByName(await readdir(abs(dataRoot, dir), { withFileTypes: true }));
  const byName = new Map(entries.map((e) => [e.name, e]));
  const isFile = (name: string) => byName.get(name)?.isFile() === true;

  // 폴더 안은 일반 파일만 (하위 폴더·심볼릭 링크는 이슈, 문서에 없는 경우 → 엄격하게)
  for (const e of entries) {
    if (!e.isFile()) add(`${dir}/${e.name}`, e.isSymbolicLink() ? 'symbolic link (must be a regular file)' : 'not a regular file');
  }

  // 3. meta.json이 있고 스키마를 통과하며 modelSlug가 폴더 이름과 같다
  const metaRel = `${dir}/${META}`;
  let record: GenerationRecord | null = null;
  if (!byName.has(META)) add(metaRel, 'missing (interrupted generation?)');
  else if (isFile(META)) {
    const meta = await readJson(dataRoot, metaRel, GenerationRecordSchema, issues);
    if (meta.kind === 'ok') record = meta.value;
  }
  if (record && record.modelSlug !== slug) add(metaRel, `modelSlug "${record.modelSlug}" does not match the folder name`);

  const referenced = new Set([META, JUDGMENT]);
  if (record) {
    // 8. 생성 도구가 provider의 생성 도구와 같다
    if (model) {
      const expected = GENERATOR_BY_PROVIDER[model.provider];
      if (record.runtime.generator.tool !== expected) {
        add(
          metaRel,
          `runtime.generator.tool "${record.runtime.generator.tool}" does not match models.json provider ${model.provider} (${expected})`,
        );
      }
    }

    // 6. ok면 검증 기록이 있다
    if (record.outcome === 'ok' && record.validation === null) {
      add(metaRel, `outcome is ok but validation is null (run npm run validate -- ${slug})`);
    }

    // 버린 결과물이 있는 모델의 공개 기록은 표본이어야 한다 — 응답이 오지 않은 기록(api_failed)은 표본이 아니다
    // (ADR-032, 2026-10-14 사용자 결정: 안내 박스·생성 횟수가 실행 카드와 어긋난 채 공개되지 않게)
    if (model?.discarded && record.outcome === 'api_failed') {
      add(
        metaRel,
        `outcome is api_failed but models.json ${model.slug}.discarded records discarded results — run npm run gen -- ${slug} again until a response arrives`,
      );
    }

    // 9. 가리키는 경로는 results/<slug>/ 안이다 → 4. 그 파일이 실제로 있다
    const refs: { field: string; path: string; fixedName?: string }[] = [];
    if (record.responseTextPath !== null) {
      refs.push({ field: 'responseTextPath', path: record.responseTextPath, fixedName: RESPONSE_FILE });
    }
    if (record.output) refs.push({ field: 'output.path', path: record.output.path, fixedName: OUTPUT_FILE });
    record.validation?.screenshots.forEach((s, i) => refs.push({ field: `validation.screenshots.${i}.path`, path: s.path }));

    for (const ref of refs) {
      const name = fileNameIn(dir, ref.path);
      if (name === null) {
        add(metaRel, `${ref.field} "${ref.path}" is not a file directly in ${dir}/`);
        continue; // 폴더 밖의 파일은 읽지 않는다
      }
      if (ref.fixedName && name !== ref.fixedName) add(metaRel, `${ref.field} must be ${dir}/${ref.fixedName}`);
      referenced.add(name);
      if (!byName.has(name)) add(ref.path, `missing (meta.json ${ref.field})`);
    }

    // 5. 결과물의 sha256(바이트 그대로)이 meta.json과 같다
    const outputName = record.output ? fileNameIn(dir, record.output.path) : null;
    if (record.output && outputName !== null && isFile(outputName)) {
      const bytes = await readFile(abs(dataRoot, record.output.path));
      const actual = sha256(bytes);
      if (actual !== record.output.sha256) {
        add(record.output.path, `sha256 ${actual} does not match meta.json output.sha256 ${record.output.sha256} (edited by hand?)`);
      }
      if (bytes.byteLength !== record.output.bytes) {
        add(record.output.path, `size ${bytes.byteLength} bytes does not match meta.json output.bytes ${record.output.bytes}`);
      }
    }
  }

  // 7. judgment.json은 스키마를 통과하고 meta.json의 모델·프롬프트·결과물을 보고 쓴 것이다 (ADR-012)
  const judgmentRel = `${dir}/${JUDGMENT}`;
  if (isFile(JUDGMENT)) {
    const read = await readJson(dataRoot, judgmentRel, JudgmentSchema, issues);
    if (read.kind === 'ok') {
      const j = read.value;
      if (!record) {
        if (j.modelSlug !== slug) add(judgmentRel, `modelSlug "${j.modelSlug}" does not match the folder name`);
      } else {
        if (j.modelSlug !== record.modelSlug) {
          add(judgmentRel, `modelSlug "${j.modelSlug}" does not match meta.json modelSlug "${record.modelSlug}"`);
        }
        if (j.prompt.id !== record.prompt.id || j.prompt.version !== record.prompt.version) {
          add(
            judgmentRel,
            `prompt ${j.prompt.id}/${j.prompt.version} does not match meta.json prompt ${record.prompt.id}/${record.prompt.version}`,
          );
        }
        if (!record.output) {
          add(judgmentRel, `meta.json has no output (outcome ${record.outcome}); only results with an output are judged`);
        } else if (j.outputSha256 !== record.output.sha256) {
          add(
            judgmentRel,
            `outputSha256 ${j.outputSha256} does not match meta.json output.sha256 ${record.output.sha256} (re-judge with npm run judge -- ${slug})`,
          );
        }
      }
    }
  }

  // meta.json이 가리키지 않는 파일은 이슈 (손으로 넣은 파일, 문서에 없는 경우 → 엄격하게).
  // meta.json을 읽지 못했으면 무엇이 맞는 파일인지 모르므로 건너뛴다 (이미 3에서 실패)
  if (record) {
    for (const e of entries) {
      if (e.isFile() && !referenced.has(e.name)) add(`${dir}/${e.name}`, 'unexpected file (not referenced by meta.json)');
    }
  }
}

/* ───────── helpers ───────── */

type Read<T> = { kind: 'ok'; value: T } | { kind: 'missing' } | { kind: 'invalid' };

/** 데이터 루트 기준 rel의 JSON을 읽어 스키마로 검사한다. 없으면 missing(이슈는 부르는 쪽이 정함), 문제는 issues에 넣는다 */
async function readJson<T>(dataRoot: string, rel: string, schema: ZodType<T>, issues: CheckIssue[]): Promise<Read<T>> {
  let text: string;
  try {
    text = await readFile(abs(dataRoot, rel), 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return { kind: 'missing' };
    issues.push({ path: rel, message: `cannot read (${code ?? String(err)})` });
    return { kind: 'invalid' };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    issues.push({ path: rel, message: `not valid JSON (${(err as Error).message})` });
    return { kind: 'invalid' };
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    for (const i of parsed.error.issues) {
      issues.push({ path: rel, message: `schema: ${i.path.length > 0 ? `${i.path.join('.')}: ` : ''}${i.message}` });
    }
    return { kind: 'invalid' };
  }
  return { kind: 'ok', value: parsed.data };
}

/** p가 dir 바로 아래 파일을 가리키는 정규화된 POSIX 상대 경로면 그 파일 이름, 아니면 null */
function fileNameIn(dir: string, p: string): string | null {
  if (p.includes('\\') || path.posix.normalize(p) !== p || !p.startsWith(`${dir}/`)) return null;
  const name = p.slice(dir.length + 1);
  return name === '' || name === '.' || name === '..' || name.includes('/') ? null : name;
}

const abs = (dataRoot: string, rel: string) => path.join(dataRoot, ...rel.split('/'));
const sortByName = (entries: Dirent[]) => entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');

/** 일반 파일이 있으면 true (없음·폴더·심볼릭 링크는 false) */
async function isRegularFile(file: string): Promise<boolean> {
  try {
    return (await lstat(file)).isFile();
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return false;
    throw err;
  }
}
