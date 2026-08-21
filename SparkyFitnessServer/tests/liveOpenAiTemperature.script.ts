/**
 * Manual, credential-gated probe. NOT a Vitest suite (`*.script.ts` is excluded
 * from discovery) — it makes real, billable calls to the OpenAI API.
 *
 *   OPENAI_PROBE_KEY=sk-... pnpm exec tsx tests/liveOpenAiTemperature.script.ts
 *
 * It exercises what a mocked suite cannot: that the static list matches the
 * models the live API actually rejects, and that the reactive backstop's
 * detector matches the provider's real 400 body rather than a reconstruction
 * of it.
 */
import { dispatchAiRequest } from '../ai/providerDispatch.js';

const KEY = process.env.OPENAI_PROBE_KEY;
if (!KEY) {
  throw new Error(
    'OPENAI_PROBE_KEY is unset. This probe makes real, billable OpenAI calls; set it deliberately.'
  );
}

const SCHEMA = {
  type: 'object',
  properties: { answer: { type: 'string' } },
  required: ['answer'],
  additionalProperties: false,
};

async function run(model: string, temperature: number | undefined) {
  const result = await dispatchAiRequest({
    provider: { service_type: 'openai', api_key: KEY, model_name: model },
    prompt: 'Reply with {"answer":"ok"}.',
    jsonSchema: SCHEMA,
    schemaName: 'probe',
    temperature,
  });
  const detail = result.ok ? JSON.stringify(result.json) : result.detail;
  console.log(
    `${result.ok ? 'PASS' : 'FAIL'}  ${model} temperature=${temperature}  ${detail.slice(0, 120)}`
  );
  return result.ok;
}

// 1. A model on the static list: temperature must never leave the process.
await run('gpt-5.6-sol', 0);
// 2. A model that honors it: the value must survive and the call must work.
await run('gpt-5.4-mini', 0);
// 3. A model that honors it under an older name shape.
await run('gpt-4o-mini', 0);
// 4. The reactive path against a real 400 with no static-list help:
//    `gpt-5-search-api` is not a reasoning-model name, is deliberately absent
//    from MODELS_REJECTING_TEMPERATURE, and rejects temperature anyway. The
//    dispatcher must 400, strip, retry and succeed. Run it twice: the second
//    call must make a single request, proving the rejection was learned.
await run('gpt-5-search-api', 0);
await run('gpt-5-search-api', 0);
