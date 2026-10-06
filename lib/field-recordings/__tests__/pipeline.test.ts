import assert from 'node:assert/strict';
import { normalizePlaudTranscript, splitConversations, doorIntervals } from '../transcript';
import { validateWriting } from '../writing';
import { validatePlaudStorageUrl } from '../plaud';
import { captureEventSchema } from '../contracts';

const segments = normalizePlaudTranscript({ results: [
  { start: 1.25, end: 3.5, text: 'Please call me next week.', speaker_id: 'Speaker 1' },
  { start: 4, end: 5, text: 'Which day works?', speaker_id: 'Speaker 2' },
  { start: 30, end: 32, text: 'A different conversation.', speaker_id: 'Speaker 3' },
] }, 'chunk', 1000);
assert.equal(segments[0].startMs, 2250);
assert.equal(segments[0].endMs, 4500);
assert.equal(segments[0].speaker, 'Speaker 1');
assert.throws(() => normalizePlaudTranscript({ results: [{ start: 9, end: 1, text: 'Broken' }] }, 'chunk', 0));
const events = [
  { id: '4804d67b-e16f-4505-b3e0-b0f6323d63ae', sequence: 0, kind: 'door_started', targetId: 'd6a9a4a5-8a09-4dff-930f-d87a32fd1470', occurredAt: '2026-10-06T14:00:00Z', consent: 'granted' },
  { id: 'adb1e942-aae4-43d8-887d-df10336c1f23', sequence: 1, kind: 'door_finished', targetId: 'd6a9a4a5-8a09-4dff-930f-d87a32fd1470', occurredAt: '2026-10-06T14:00:10Z' },
].map(event => captureEventSchema.parse(event));
const doors = doorIntervals(events, '2026-10-06T14:00:00Z');
assert.equal(doors.length, 1);
const conversations = splitConversations(segments, doors);
assert.equal(conversations.length, 2);
assert.equal(conversations[0].targetId, events[0].targetId);
assert.equal(conversations[0].consent, 'granted');
assert.equal(conversations[1].targetId, null);
assert.equal(conversations[1].consent, 'unknown');
assert.equal(doorIntervals(events.slice(0, 1), '2026-10-06T14:00:00Z').length, 0);
assert.equal(splitConversations(segments, [{ ...doors[0], consent: 'declined' }])[0].consent, 'unknown');
const overlappingDoor = { ...doors[0], targetId: 'de867b54-a10d-4f96-a75f-027f96cba594', startMs: 3000, endMs: 7000 };
for (const consent of ['declined', 'unknown', 'granted'] as const) {
  const ambiguous = splitConversations(segments.slice(0, 2), [doors[0], { ...overlappingDoor, consent }]);
  assert.ok(ambiguous.every(conversation => conversation.targetId === null && conversation.consent === 'unknown'));
}
assert.equal(splitConversations(segments.slice(0, 2), [doors[0], { ...overlappingDoor, startMs: 10000, endMs: 12000 }])[0].targetId, events[0].targetId);
const writing = { summary: 'Requested follow-up.', note: 'Resident requested a call next week.', evidence: [{ segmentId: segments[0].id, quote: 'Please call me next week.' }], actions: [{ kind: 'call', title: 'Confirm follow-up day', dueAt: null, evidence: [{ segmentId: segments[0].id, quote: 'Please call me next week.' }] }] };
assert.equal(validateWriting(writing, segments).actions[0].dueAt, null);
assert.throws(() => validateWriting({ ...writing, evidence: [{ segmentId: 'missing', quote: 'Invented' }] }, segments));
assert.throws(() => validateWriting({ ...writing, evidence: [] }, segments));
assert.throws(() => validateWriting({ ...writing, actions: [{ ...writing.actions[0], dueAt: 'sometime soon' }] }, segments));
assert.throws(() => validatePlaudStorageUrl('http://plaud-bucket.s3.amazonaws.com/audio'));
assert.throws(() => validatePlaudStorageUrl('https://evil.example/audio'));
assert.throws(() => validatePlaudStorageUrl('https://user:password@plaud-bucket.s3.amazonaws.com/audio'));
assert.ok(validatePlaudStorageUrl('https://plaud-bucket.s3.amazonaws.com/audio'));
console.log('Transcript offsets, door consent, segmentation, evidence and provider URL tests passed');
