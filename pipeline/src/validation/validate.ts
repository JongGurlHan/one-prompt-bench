import type { ModelEntry } from '@opb/core';
import { displayWidth, selectTargets } from '../generation/batch.js';
import { loadModels } from '../generation/models.js';
import type { Output } from '../tokens.js';
import { readValidationTarget, type ValidationTarget } from './validate-result.js';
import { describeValidation, type Validator } from './validator.js';

/* ────────────────────────────────────────────────────────────
 * `npm run validate -- <slug…> | --all`: 이미 생성한 결과를 다시 검증한다 (ARCHITECTURE "검증기").
 *  - --all: models.json(출시일 최신순)에서 outcome이 ok인 모델 전부. 나머지는 건너뜀(이유)
 *  - slug 직접 지정: 모르는 slug가 있으면 아무것도 하지 않고 exit 1. ok가 아니면 실패로 보고하고 다음 모델을 계속
 *  - meta.json이 깨진 모델은 --all이어도 실패로 보고한다 (outcome을 알 수 없다 — 사람이 확인할 것)
 *  - 한 모델의 검증이 throw해도 다음 모델을 계속한다. 모델을 부르지 않으므로 preflight는 없다
 * ──────────────────────────────────────────────────────────── */

export interface ValidateCommandOptions {
  slugs: readonly string[];
  all: boolean;
}

export interface ValidateDeps {
  repoRoot: string;
  validator: Validator;
  out: Output;
}

interface ValidateRow {
  slug: string;
  action: 'validated' | 'skipped' | 'failed';
  /** 검증 요약 또는 건너뜀·실패 이유 */
  detail: string;
}

const ACTION_LABEL: Record<ValidateRow['action'], string> = { validated: '검증', skipped: '건너뜀', failed: '실패' };

/** exit code: 모르는 slug·models.json 오류·실패한 모델이 있으면 1 */
export async function runValidate(opts: ValidateCommandOptions, deps: ValidateDeps): Promise<number> {
  const { out } = deps;

  let registry: ModelEntry[];
  try {
    registry = await loadModels(deps.repoRoot);
  } catch (err) {
    out.error(errorMessage(err));
    return 1;
  }
  const selected = selectTargets(registry, opts);
  if (!selected.ok) {
    out.error(`${selected.message} — 아무것도 검증하지 않았습니다.`);
    return 1;
  }

  // 1. 대상 판정 (파일은 바꾸지 않는다)
  const plans: { slug: string; target: ValidationTarget }[] = [];
  for (const model of selected.models) {
    let target: ValidationTarget;
    try {
      target = await readValidationTarget(deps.repoRoot, model.slug);
    } catch (err) {
      target = { kind: 'broken', reason: `meta.json을 읽을 수 없습니다 (${errorMessage(err)})` };
    }
    plans.push({ slug: model.slug, target });
  }
  const toValidate = plans.filter((p) => p.target.kind === 'ok').map((p) => p.slug);
  out.log(`검증 대상 ${toValidate.length}개${toValidate.length > 0 ? `: ${toValidate.join(', ')}` : ''}`);

  // 2. 순차 검증: 한 모델이 실패해도 다음 모델을 계속한다
  const rows: ValidateRow[] = [];
  let n = 0;
  for (const { slug, target } of plans) {
    if (target.kind === 'broken' || (target.kind === 'not_ok' && !opts.all)) {
      out.error(`${slug}: 실패 — ${target.reason}`);
      rows.push({ slug, action: 'failed', detail: target.reason });
      continue;
    }
    if (target.kind === 'not_ok') {
      rows.push({ slug, action: 'skipped', detail: target.reason });
      continue;
    }
    out.log('');
    out.log(`[${++n}/${toValidate.length}] ${slug}`);
    try {
      const validation = await deps.validator.validate(slug);
      rows.push({ slug, action: 'validated', detail: describeValidation(validation) });
    } catch (err) {
      const message = `검증 실패: ${errorMessage(err)}`;
      out.error(`  ${message}`);
      rows.push({ slug, action: 'failed', detail: message });
    }
  }

  out.log('');
  out.log(formatValidateSummary(rows));
  return rows.some((r) => r.action === 'failed') ? 1 : 0;
}

/** slug · 처리 · 결과(검증 요약 또는 이유) + 개수 */
export function formatValidateSummary(rows: readonly ValidateRow[]): string {
  const table = [['slug', '처리', '결과'], ...rows.map((r) => [r.slug, ACTION_LABEL[r.action], r.detail])];
  const widths = [0, 1].map((col) => Math.max(...table.map((row) => displayWidth(row[col]!))));
  const lines = table.map(([slug, action, detail]) =>
    [slug!, action!].map((cell, col) => cell + ' '.repeat(widths[col]! - displayWidth(cell) + 2)).join('') + detail,
  );
  const count = (action: ValidateRow['action']) => rows.filter((r) => r.action === action).length;
  return [
    '요약',
    ...lines,
    '',
    `검증 ${count('validated')} · 건너뜀 ${count('skipped')} · 실패 ${count('failed')}`,
  ].join('\n');
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
