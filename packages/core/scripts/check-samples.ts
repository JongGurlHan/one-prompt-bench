import { readFileSync } from 'node:fs';
import { GenerationRecordSchema, JudgmentSchema, ModelRegistrySchema } from '../src/schema.js';

const readJson = (p: string): unknown => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));

const registry = ModelRegistrySchema.parse(readJson('../examples/models.sample.json'));
const raw = readJson('../examples/meta.sample.json') as Record<string, unknown>;
const record = GenerationRecordSchema.parse(raw);

// 레지스트리 조인 + 비용 재계산 (meta.json에 가격을 중복 저장하지 않으므로 여기서 대조)
const model = registry.find((m) => m.slug === record.modelSlug);
if (!model) throw new Error(`unknown slug ${record.modelSlug}`);
const expected =
  (record.usageTotal.inputTokens * model.pricing.inputPer1M +
    record.usageTotal.outputTokens * model.pricing.outputPer1M) /
  1_000_000;
if (model.pricing.asOf === record.cost.pricingAsOf && Math.abs(expected - record.cost.totalUsd) > 1e-6) {
  throw new Error(`cost mismatch: expected ${expected}, got ${record.cost.totalUsd}`);
}
console.log(`OK  sample: ${model.displayName}, ${record.attempts.length} attempts, $${record.cost.totalUsd}`);

// 판정 파일: 같은 모델·같은 프롬프트·같은 결과물을 보고 쓴 것인지
const judgment = JudgmentSchema.parse(readJson('../examples/judgment.sample.json'));
if (judgment.modelSlug !== record.modelSlug) throw new Error('judgment modelSlug mismatch');
if (judgment.prompt.id !== record.prompt.id || judgment.prompt.version !== record.prompt.version) {
  throw new Error('judgment prompt mismatch');
}
if (judgment.outputSha256 !== record.output?.sha256) throw new Error('judgment is for a different output');
console.log(`OK  judgment: ${Object.values(judgment.requirements).join(', ')}`);

// 불변식이 실제로 잡히는지 깨뜨려서 확인
const broken: [string, (r: any) => void, string][] = [
  ['usageTotal mismatch', (r) => (r.usageTotal.inputTokens = 1), 'sum of attempts'],
  ['ok without output', (r) => (r.output = null), 'ok requires output'],
  ['api_failed with response', (r) => (r.outcome = 'api_failed'), 'last attempt to be an error'],
  ['attempt numbering gap', (r) => (r.attempts[1].n = 3), 'attempt n must be 2'],
  ['reasoning > output', (r) => (r.usageTotal.reasoningTokens = 99_999), 'subset of outputTokens'],
  ['cost sum mismatch', (r) => (r.cost.totalUsd = 1), 'inputUsd + outputUsd'],
];
let failed = 0;
for (const [name, mutate, expect] of broken) {
  const copy = structuredClone(raw);
  mutate(copy);
  const res = GenerationRecordSchema.safeParse(copy);
  const hit = !res.success && res.error.issues.some((i) => i.message.includes(expect));
  if (!hit) failed++;
  console.log(`${hit ? 'OK  rejects' : 'FAIL'} ${name}`);
}
process.exit(failed ? 1 : 0);
