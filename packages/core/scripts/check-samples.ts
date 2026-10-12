import { readFileSync } from 'node:fs';
import { GENERATOR_BY_PROVIDER, GenerationRecordSchema, JudgmentSchema, ModelRegistrySchema } from '../src/schema.js';

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
// 생성 도구는 provider로 정해진다 (models.json에 provider, meta.json에 실제로 쓴 도구)
if (record.runtime.generator.tool !== GENERATOR_BY_PROVIDER[model.provider]) {
  throw new Error(`generator mismatch: ${model.provider} → ${record.runtime.generator.tool}`);
}
console.log(
  `OK  sample: ${model.displayName}, ${record.runtime.generator.tool} ${record.runtime.generator.version}, ` +
    `${record.attempts.length} attempts, $${record.cost.totalUsd}`,
);

// 판정 파일: 같은 모델·같은 프롬프트·같은 결과물을 보고 쓴 것인지
const judgment = JudgmentSchema.parse(readJson('../examples/judgment.sample.json'));
if (judgment.modelSlug !== record.modelSlug) throw new Error('judgment modelSlug mismatch');
if (judgment.prompt.id !== record.prompt.id || judgment.prompt.version !== record.prompt.version) {
  throw new Error('judgment prompt mismatch');
}
if (judgment.outputSha256 !== record.output?.sha256) throw new Error('judgment is for a different output');
console.log(`OK  judgment: ${Object.values(judgment.requirements).join(', ')}`);

// 불변식이 실제로 잡히는지 깨뜨려서 확인 (expect는 '경로: 메시지'의 일부)
const broken: [string, (r: any) => void, string][] = [
  ['usageTotal mismatch', (r) => (r.usageTotal.inputTokens = 1), 'sum of attempts'],
  ['ok without output', (r) => (r.output = null), 'ok requires output'],
  ['api_failed with response', (r) => (r.outcome = 'api_failed'), 'last attempt to be an error'],
  ['attempt numbering gap', (r) => (r.attempts[1].n = 3), 'attempt n must be 2'],
  ['reasoning > output', (r) => (r.usageTotal.reasoningTokens = 99_999), 'subset of outputTokens'],
  ['cost sum mismatch', (r) => (r.cost.totalUsd = 1), 'inputUsd + outputUsd'],
  ['WebP screenshot', (r) => (r.validation.screenshots[0].path = 'results/example-model-a/spring.webp'), 'JPEG'],
  ['unknown generator tool', (r) => (r.runtime.generator.tool = 'anthropic-sdk'), 'runtime.generator.tool:'],
  ['empty invocation', (r) => (r.runtime.generator.invocation = ''), 'runtime.generator.invocation:'],
  [
    'old SDK runtime',
    (r) => (r.runtime = { gitCommit: 'a1b2c3d', sdkPackage: '@anthropic-ai/sdk', sdkVersion: '0.0.0', nodeVersion: '22.0.0' }),
    'runtime.generator:',
  ],
  ['maxOutputTokens 0', (r) => (r.params.maxOutputTokens = 0), 'params.maxOutputTokens:'],
];
let failed = 0;
for (const [name, mutate, expect] of broken) {
  const copy = structuredClone(raw);
  mutate(copy);
  const res = GenerationRecordSchema.safeParse(copy);
  const hit = !res.success && res.error.issues.some((i) => `${i.path.join('.')}: ${i.message}`.includes(expect));
  if (!hit) failed++;
  console.log(`${hit ? 'OK  rejects' : 'FAIL'} ${name}`);
}

// 바뀐 모양이 실제로 허용되는지
const allowed: [string, (r: any) => void][] = [
  ['maxOutputTokens null (Codex CLI: tool default)', (r) => (r.params.maxOutputTokens = null)],
];
for (const [name, mutate] of allowed) {
  const copy = structuredClone(raw);
  mutate(copy);
  const ok = GenerationRecordSchema.safeParse(copy).success;
  if (!ok) failed++;
  console.log(`${ok ? 'OK  accepts' : 'FAIL'} ${name}`);
}
process.exit(failed ? 1 : 0);
