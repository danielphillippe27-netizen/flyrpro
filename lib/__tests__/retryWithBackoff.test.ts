// Run with: npx tsx lib/__tests__/retryWithBackoff.test.ts
import assert from 'node:assert/strict';
import { retryWithBackoff } from '@/lib/utils/retryWithBackoff';

async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

async function main() {
  await test('succeeds on first attempt', async () => {
    let attempts = 0;
    const result = await retryWithBackoff(
      async () => {
        attempts += 1;
        return 'ok';
      },
      { baseDelayMs: 0 }
    );

    assert.equal(result, 'ok');
    assert.equal(attempts, 1);
  });

  await test('fails once then succeeds', async () => {
    let attempts = 0;
    const result = await retryWithBackoff(
      async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error('fetch failed');
        }
        return 'ok';
      },
      { baseDelayMs: 0 }
    );

    assert.equal(result, 'ok');
    assert.equal(attempts, 2);
  });

  await test('fails all attempts and throws last error', async () => {
    let attempts = 0;
    const lastError = new Error('fetch failed final');

    try {
      await retryWithBackoff(
        async () => {
          attempts += 1;
          if (attempts === 3) {
            throw lastError;
          }
          throw new Error('fetch failed');
        },
        { baseDelayMs: 0 }
      );
      assert.fail('Expected retryWithBackoff to throw');
    } catch (error) {
      assert.equal(error, lastError);
    }
    assert.equal(attempts, 3);
  });

  await test('respects maxAttempts option', async () => {
    let attempts = 0;

    await assert.rejects(
      retryWithBackoff(
        async () => {
          attempts += 1;
          throw new Error('fetch failed');
        },
        { maxAttempts: 2, baseDelayMs: 0 }
      )
    );
    assert.equal(attempts, 2);
  });

  await test('does not retry when shouldRetry returns false', async () => {
    let attempts = 0;

    await assert.rejects(
      retryWithBackoff(
        async () => {
          attempts += 1;
          throw new Error('fetch failed');
        },
        {
          baseDelayMs: 0,
          shouldRetry: () => false,
        }
      )
    );
    assert.equal(attempts, 1);
  });

  await test('default shouldRetry retries on connection errors', async () => {
    let attempts = 0;
    const result = await retryWithBackoff(
      async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error('ECONNRESET');
        }
        return 'ok';
      },
      { baseDelayMs: 0 }
    );

    assert.equal(result, 'ok');
    assert.equal(attempts, 2);
  });

  await test('default shouldRetry does not retry on 4xx-equivalent errors', async () => {
    let attempts = 0;
    const notFound = new Response('not found', { status: 404 });

    try {
      await retryWithBackoff(
        async () => {
          attempts += 1;
          throw notFound;
        },
        { baseDelayMs: 0 }
      );
      assert.fail('Expected retryWithBackoff to throw');
    } catch (error) {
      assert.equal(error, notFound);
    }
    assert.equal(attempts, 1);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
