import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { verifyAudio } from '../audio-verification';

async function main() {
  const originalFetch = globalThis.fetch;
  const audio = Buffer.alloc(417); audio.set([255, 251, 144, 0]);
  const checksum = createHash('sha256').update(audio).digest('hex');
  let requests = 0, cancelled = false;
  function install(bytes: Buffer, status = 200) {
    globalThis.fetch = async (_url, options) => {
      requests++;
      assert.equal(options?.redirect, 'error'); assert.equal(options?.cache, 'no-store');
      assert.ok(options?.signal);
      let offset = 0;
      return new Response(new ReadableStream({
        pull(controller) { if (offset < bytes.length) { controller.enqueue(bytes.subarray(offset, offset + 7)); offset += 7; } else controller.close(); },
        cancel() { cancelled = true; },
      }), { status });
    };
  }
  try {
    install(audio); assert.equal(await verifyAudio('https://example.test/audio', audio.length, checksum), 27);
    const before = requests;
    await assert.rejects(verifyAudio('https://example.test/audio', 0, checksum));
    await assert.rejects(verifyAudio('https://example.test/audio', audio.length, 'invalid'));
    assert.equal(requests, before);
    install(audio); await assert.rejects(verifyAudio('https://example.test/audio', audio.length - 10, checksum)); assert.ok(cancelled);
    install(audio); await assert.rejects(verifyAudio('https://example.test/audio', audio.length + 1, checksum));
    install(audio); await assert.rejects(verifyAudio('https://example.test/audio', audio.length, '0'.repeat(64)));
    install(audio.subarray(0, 410)); await assert.rejects(verifyAudio('https://example.test/audio', 410, createHash('sha256').update(audio.subarray(0, 410)).digest('hex')));
    install(audio, 500); await assert.rejects(verifyAudio('https://example.test/audio', audio.length, checksum));
    globalThis.fetch = async () => { throw new TypeError('Redirect rejected'); };
    await assert.rejects(verifyAudio('https://example.test/audio', audio.length, checksum));
    console.log('Streamed audio size/hash/duration validation, malformed media, cancellation and transport rejection passed');
  } finally { globalThis.fetch = originalFetch; }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
