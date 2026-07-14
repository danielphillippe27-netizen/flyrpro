/**
 * Run with: npx tsx lib/__tests__/telnyxSms.test.ts
 */

import assert from 'node:assert/strict';
import { sendTelnyxSms } from '../dialer/telnyx';

type FetchCall = {
  url: string;
  body: Record<string, unknown>;
};

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function main() {
  process.env.TELNYX_API_KEY = 'test-key';
  process.env.TELNYX_ALPHANUMERIC_SENDER_ID = 'WolfGrid';
  process.env.TELNYX_MESSAGING_PROFILE_ID = 'profile-123';

  await test('retries with numeric sender when Telnyx rejects alphanumeric sender', async () => {
    const calls: FetchCall[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: input.toString(),
        body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
      });

      if (calls.length === 1) {
        return jsonResponse(
          {
            errors: [
              {
                code: '40306',
                detail: 'Alphanumeric sender ID WolfGrid is not registered for the destination number +61413911007',
              },
            ],
          },
          422
        );
      }

      return jsonResponse({
        data: {
          id: 'msg-123',
          status: 'queued',
        },
      });
    }) as typeof fetch;

    const result = await sendTelnyxSms({
      from: '+12896752788',
      to: '+61413911007',
      body: 'Hey Matthew',
      webhookUrl: 'https://wolfgrid.app/api/telnyx/messaging/status',
    });

    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, 'https://api.telnyx.com/v2/messages');
    assert.equal(calls[0].body.from, 'WolfGrid');
    assert.equal(calls[0].body.messaging_profile_id, 'profile-123');
    assert.equal(calls[1].body.from, '+12896752788');
    assert.equal(result.id, 'msg-123');
    assert.equal(result.raw.flyr_sender && typeof result.raw.flyr_sender === 'object', true);
    assert.deepEqual(result.raw.flyr_sender, {
      requested_from: 'WolfGrid',
      final_from: '+12896752788',
      alphanumeric_sender_attempted: true,
      alphanumeric_sender_fallback: true,
    });
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    globalThis.fetch = originalFetch;
    process.env = originalEnv;
  });
