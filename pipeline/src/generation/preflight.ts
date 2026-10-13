import { GENERATOR_BY_PROVIDER, type GeneratorTool, type ModelEntry } from '@opb/core';
import { registeredTools, type AdapterRegistry } from '../adapters/registry.js';
import { GEMINI_API_KEY, type AppConfig } from '../config/config.js';
import { FORBIDDEN_ENV_KEYS } from '../system/cli.js';
import type { GitClient } from '../system/git.js';

/* ────────────────────────────────────────────────────────────
 * preflight: 실제 호출 전 자동 점검 (추가 결제 차단 + 기록의 정직성).
 * 하나라도 실패하면 호출하는 쪽은 어떤 어댑터도 만들거나 호출하지 않고 종료한다 (ARCHITECTURE "Batch 규칙").
 * 판정은 evaluatePreflight(순수 함수), 사실 수집(git·도구별 점검)은 runPreflight.
 * 사유에는 변수 이름만 쓰고 값(키)은 쓰지 않는다.
 * ──────────────────────────────────────────────────────────── */

export interface PreflightCheck {
  ok: boolean;
  /** 무엇을 점검했는지 */
  name: string;
  /** 사람이 읽을 결과·사유 (여러 줄 가능, 비밀값 없음) */
  detail: string;
}

/** 커밋 안 된 변경이 없어야 하는 경로 — meta.json의 gitCommit이 실제 코드를 가리키게 */
export const GIT_CLEAN_PATHS: readonly string[] = ['packages', 'pipeline', 'prompts', 'models.json'];

export interface PreflightFacts {
  models: readonly ModelEntry[];
  /** 현재 프로세스 환경 (process.env) */
  env: Readonly<Record<string, string | undefined>>;
  registeredTools: ReadonlySet<GeneratorTool>;
  /** 설정(.env)의 GEMINI_API_KEY */
  geminiApiKey: string | undefined;
  /** git status --porcelain 결과. null = git 검사 끔(smoke) */
  git: { status: string } | { error: string } | null;
}

export function evaluatePreflight(facts: PreflightFacts): PreflightCheck[] {
  const checks: PreflightCheck[] = [];

  const present = FORBIDDEN_ENV_KEYS.filter((name) => facts.env[name] !== undefined);
  checks.push(
    present.length === 0
      ? { ok: true, name: 'API 키 환경변수', detail: `${FORBIDDEN_ENV_KEYS.join('·')} 없음` }
      : {
          ok: false,
          name: 'API 키 환경변수',
          detail: `${present.join('·')}가 환경에 있습니다. 구독 대신 API 키로 과금될 수 있으니 지우고 다시 실행하세요.`,
        },
  );

  const slugsByTool = new Map<GeneratorTool, string[]>();
  for (const m of facts.models) {
    const tool = GENERATOR_BY_PROVIDER[m.provider];
    slugsByTool.set(tool, [...(slugsByTool.get(tool) ?? []), m.slug]);
  }
  const missing = [...slugsByTool].filter(([tool]) => !facts.registeredTools.has(tool));
  if (missing.length === 0) {
    checks.push({ ok: true, name: '생성 도구', detail: [...slugsByTool.keys()].join(', ') || '대상 없음' });
  } else {
    for (const [tool, slugs] of missing) {
      checks.push({ ok: false, name: '생성 도구', detail: `아직 지원하지 않는 생성 도구: ${tool} (${slugs.join(', ')})` });
    }
  }

  if (slugsByTool.has('gemini-api')) {
    checks.push(
      facts.geminiApiKey?.trim()
        ? { ok: true, name: `.env ${GEMINI_API_KEY}`, detail: '있음' }
        : {
            ok: false,
            name: `.env ${GEMINI_API_KEY}`,
            detail: `.env에 ${GEMINI_API_KEY}가 없거나 비어 있습니다 (.env.example 참고).`,
          },
    );
  }

  if (facts.git !== null) {
    const name = `git 작업 트리 (${GIT_CLEAN_PATHS.join(' ')})`;
    if ('error' in facts.git) {
      checks.push({ ok: false, name, detail: `git status를 실행하지 못했습니다: ${facts.git.error}` });
    } else {
      const lines = facts.git.status.split('\n').filter((line) => line.trim() !== '');
      checks.push(
        lines.length === 0
          ? { ok: true, name, detail: '커밋 안 된 변경 없음' }
          : {
              ok: false,
              name,
              detail: ['커밋 안 된 변경이 있습니다. 커밋한 뒤 다시 실행하세요:', ...lines.map((l) => l.trimEnd())].join('\n'),
            },
      );
    }
  }

  return checks;
}

export interface PreflightDeps {
  env: Readonly<Record<string, string | undefined>>;
  config: AppConfig;
  adapters: AdapterRegistry;
  git: GitClient;
}

/** 사실을 모아 판정하고, 대상 모델의 등록된 도구마다 도구별 preflight()를 붙인다. 어댑터는 만들지 않는다 */
export async function runPreflight(
  models: readonly ModelEntry[],
  deps: PreflightDeps,
  options: { checkGit?: boolean } = {},
): Promise<PreflightCheck[]> {
  let git: PreflightFacts['git'] = null;
  if (options.checkGit ?? true) {
    try {
      git = { status: await deps.git.status(GIT_CLEAN_PATHS) };
    } catch (err) {
      git = { error: errorMessage(err) };
    }
  }

  const registered = registeredTools(deps.adapters);
  const checks = evaluatePreflight({
    models,
    env: deps.env,
    registeredTools: registered,
    geminiApiKey: deps.config.dotenv[GEMINI_API_KEY],
    git,
  });

  const targetTools = new Set(models.map((m) => GENERATOR_BY_PROVIDER[m.provider]));
  for (const tool of targetTools) {
    const entry = deps.adapters[tool];
    if (!entry?.preflight) continue;
    try {
      checks.push(...(await entry.preflight()));
    } catch (err) {
      checks.push({ ok: false, name: `${tool} 점검`, detail: errorMessage(err) });
    }
  }
  return checks;
}

export const preflightPassed = (checks: readonly PreflightCheck[]): boolean => checks.every((c) => c.ok);

const CONTINUATION = ' '.repeat(10);

export function formatPreflight(checks: readonly PreflightCheck[]): string {
  const lines = ['preflight'];
  for (const c of checks) {
    const [first = '', ...rest] = c.detail.split('\n');
    lines.push(`  [${c.ok ? '통과' : '실패'}] ${c.name}: ${first}`);
    for (const line of rest) lines.push(CONTINUATION + line);
  }
  return lines.join('\n');
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
