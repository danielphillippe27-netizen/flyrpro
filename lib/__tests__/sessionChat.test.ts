import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SessionChatError,
  decodeCursor,
  encodeCursor,
  validateText,
  validateVoice,
} from '../../app/api/live-sessions/chat/_lib/session-chat';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;

async function test(name: string, body: () => unknown | Promise<unknown>) {
  try {
    await body();
    console.log(`PASS  ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL  ${name}`);
    console.error(error);
  }
}

function expectChatError(body: () => unknown, status: number) {
  assert.throws(body, (error) => error instanceof SessionChatError && error.status === status);
}

async function main() {
await test('text is trimmed and limited to 1,000 characters', () => {
  assert.equal(validateText('  team update  '), 'team update');
  assert.equal(validateText('x'.repeat(1_000)).length, 1_000);
  expectChatError(() => validateText('   '), 400);
  expectChatError(() => validateText('x'.repeat(1_001)), 400);
});

await test('voice notes enforce MIME type, size, and duration', () => {
  const valid = new File([new Uint8Array(128)], 'note.m4a', { type: 'audio/mp4' });
  assert.equal(validateVoice(valid, '1000'), 1_000);
  assert.equal(validateVoice(valid, '120000'), 120_000);
  expectChatError(() => validateVoice(valid, 999), 400);
  expectChatError(() => validateVoice(valid, 120_001), 400);
  expectChatError(
    () => validateVoice(new File([new Uint8Array(1)], 'note.wav', { type: 'audio/wav' }), 1_000),
    415
  );
  const oversized = { size: 4 * 1024 * 1024 + 1, type: 'audio/aac' } as File;
  expectChatError(() => validateVoice(oversized, 1_000), 400);
});

await test('message cursors preserve timestamp and UUID tie-breaker', () => {
  const row = {
    id: '21d319db-b19e-44fc-95dd-03d68808b5be',
    created_at: '2026-09-08T17:00:00.000Z',
  };
  assert.deepEqual(decodeCursor(encodeCursor(row)), {
    id: row.id,
    createdAt: row.created_at,
  });
  expectChatError(() => decodeCursor('not-a-cursor'), 400);
});

await test('migration protects room access and private voice storage', async () => {
  const sql = await fs.readFile(
    path.join(root, 'supabase/migrations/20260908120000_session_chat.sql'),
    'utf8'
  );
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/i);
  assert.match(sql, /can_view_session_chat/i);
  assert.match(sql, /can_send_session_chat/i);
  assert.match(sql, /'session-chat-voice',[\s\S]*?'session-chat-voice',[\s\S]*?false/i);
  assert.match(sql, /4194304/);
  assert.doesNotMatch(sql, /sender_user_id uuid[^\n]*REFERENCES auth\.users/i);
});

if (failures) process.exitCode = 1;
}

void main();
