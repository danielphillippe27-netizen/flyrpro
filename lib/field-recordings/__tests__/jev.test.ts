import assert from 'node:assert/strict';
import { analyzeWithJev, conversationQuestions, parseJevAnalysis } from '../jev';
import { objections, type TranscriptSegment } from '../contracts';

async function main() {
  const segments: TranscriptSegment[] = [{ id: 'synthetic-resident', startMs: 0, endMs: 1000, text: 'Please call me next week.', speaker: 'resident' }];
  const context = { timezone: 'America/Toronto', recordedAt: '2026-10-06T14:00:00Z' };
  const answers = {
    outcome: { type: 'choice', choice: 'follow_up_requested', confidence: 0.9, probabilities: { follow_up_requested: 0.9, unclear: 0.1 } },
    follow_up: { type: 'noul', noul: 0.9 }, appointment: { type: 'noul', noul: 0 }, do_not_contact: { type: 'noul', noul: 0 },
    ...Object.fromEntries(objections.map(key => [`objection_${key}`, { type: 'noul', noul: 0 }])),
  };
  const reply = { model: 'jev-1.13.0', answers, usage: { input_tokens: 100, output_tokens: 20 } };
  const result = parseJevAnalysis(reply, segments);
  assert.equal(result.provider, 'typesafe.ai'); assert.equal(result.model, reply.model);
  assert.equal(result.usage.input_tokens, 100);
  assert.equal(result.requiresReview, true); assert.deepEqual(result.evidenceSegmentIds, ['synthetic-resident']);
  for (const malformed of [{ ...reply, provider: 'jev-ai.org' }, { ...reply, model: '' },
    { ...reply, answers: { ...answers, follow_up: { type: 'noul', noul: 2 } } },
    { ...reply, usage: { ...reply.usage, input_tokens: -1 } }, { ...reply, usage: { ...reply.usage, output_tokens: 1.5 } }]) {
    assert.throws(() => parseJevAnalysis(malformed, segments));
  }
  const oldFetch = globalThis.fetch;
  const savedEnv = { key: process.env.JEV_API_KEY, oldKey: process.env.TYPESAFE_API_KEY, model: process.env.JEV_MODEL };
  let requests = 0;
  try {
    process.env.TYPESAFE_API_KEY = 'synthetic-typesafe-key'; delete process.env.JEV_MODEL;
    globalThis.fetch = async (url, options) => {
      requests++; assert.equal(url, 'https://api.typesafe.ai/v1/systemone');
      assert.equal(options?.method, 'POST'); assert.equal(options?.redirect, 'error'); assert.equal(options?.cache, 'no-store');
      assert.equal((options?.headers as Record<string, string>).Authorization, 'Bearer synthetic-typesafe-key');
      const body = JSON.parse(options!.body as string);
      assert.equal(body.model, 'jev-latest'); assert.deepEqual(body.state, { ...context, segments });
      assert.deepEqual(body.questions, conversationQuestions()); assert.ok(Object.keys(body.questions).length <= 20);
      return Response.json(reply);
    };
    assert.equal((await analyzeWithJev(segments, context)).provider, 'typesafe.ai');
    process.env.JEV_MODEL = 'jev-1.13'; await assert.rejects(analyzeWithJev(segments, context)); assert.equal(requests, 1);
    delete process.env.JEV_MODEL; delete process.env.TYPESAFE_API_KEY; process.env.JEV_API_KEY = 'wrong-provider-key';
    await assert.rejects(analyzeWithJev(segments, context)); assert.equal(requests, 1); // Never send the third-party account key to TypeSafe.
    process.env.TYPESAFE_API_KEY = 'synthetic-typesafe-key';
    for (const status of [401, 402, 409, 429, 503]) {
      globalThis.fetch = async () => new Response('PRIVATE provider body must remain hidden', { status });
      await assert.rejects(analyzeWithJev(segments, context), error => error instanceof Error && error.message === `Jev request failed (${status})`);
    }
    globalThis.fetch = async () => { throw new TypeError('Redirect rejected'); };
    await assert.rejects(analyzeWithJev(segments, context));
    console.log('TypeSafe endpoint/key/model isolation, typed token usage/decisions and sanitized failures passed');
  } finally {
    globalThis.fetch = oldFetch;
    for (const [name, value] of Object.entries({ JEV_API_KEY: savedEnv.key, TYPESAFE_API_KEY: savedEnv.oldKey, JEV_MODEL: savedEnv.model })) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
