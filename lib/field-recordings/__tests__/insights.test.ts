import assert from 'node:assert/strict';
import { campaignInsights, conversationInsights } from '../insights';
import { objections } from '../contracts';
const analysis = (choice: string, confidence = .9) => ({ model: 'jev-test', requiresReview: true,
  outcome: { type: 'choice', choice, confidence }, intent: { follow_up: .1, appointment: .1, do_not_contact: .1 },
  objections: Object.fromEntries(objections.map(key => [key, key === 'timing' ? .9 : .1])), evidenceSegmentIds: ['source'],
});
const follow = { ...analysis('follow_up_requested'), intent: { follow_up: .95, appointment: .1, do_not_contact: .1 } };
assert.equal(conversationInsights(follow)?.bucket, 'positive');
assert.equal(conversationInsights(follow)?.followUpCandidate, true);
assert.deepEqual(conversationInsights(follow)?.suggestedObjections, [{ key: 'timing', score: .9 }]);
assert.equal(conversationInsights(analysis('appointment_agreed'))?.bucket, 'positive');
assert.equal(conversationInsights(analysis('information_requested'))?.bucket, 'positive');
assert.equal(conversationInsights(analysis('qualified_opportunity'))?.bucket, 'positive');
assert.equal(conversationInsights(analysis('conversation'))?.bucket, 'neutral');
assert.equal(conversationInsights(analysis('declined_offer'))?.bucket, 'declined');
assert.equal(conversationInsights(analysis('do_not_contact'))?.bucket, 'no_contact');
assert.equal(conversationInsights(analysis('declined_offer', .79))?.bucket, 'uncertain');
assert.equal(conversationInsights(analysis('unclear', 1))?.bucket, 'uncertain');
const conflicting = { ...follow, intent: { ...follow.intent, do_not_contact: .95 } };
assert.equal(conversationInsights(conflicting)?.conflict, true);
assert.equal(conversationInsights(conflicting)?.bucket, 'uncertain');
assert.equal(conversationInsights(conflicting)?.followUpCandidate, false);
assert.equal(conversationInsights(null), null);
assert.equal(conversationInsights({ ...follow, outcome: { ...follow.outcome, confidence: 2 } }), null);
assert.equal(conversationInsights({ ...follow, requiresReview: false }), null);
assert.equal(conversationInsights({ ...follow, evidenceSegmentIds: [] }), null);
const totals = campaignInsights([
  { id: 'follow', review_state: 'pending', analysis: follow },
  { id: 'declined', review_state: 'approved', analysis: analysis('declined_offer') },
  { id: 'rejected', review_state: 'rejected', analysis: follow },
  { id: 'unknown', review_state: 'pending', analysis: null },
  { id: 'conflicting', review_state: 'pending', analysis: conflicting },
]);
assert.deepEqual(totals.counts, { positive: 1, declined: 1, neutral: 0, no_contact: 0, uncertain: 1, unanalyzed: 1, excluded: 1 });
assert.deepEqual(totals.followUpIds, ['follow']);
assert.equal(totals.objectionCounts.timing, 3);
console.log('Jev insight validation, proposed outcome buckets, uncertainty, no-contact conflicts, follow-up signals and rejected-conversation exclusion passed');
