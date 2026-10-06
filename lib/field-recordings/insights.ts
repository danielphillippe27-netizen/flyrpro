import { z } from 'zod';
import { objections, outcomes } from './contracts';
const probability = z.number().min(0).max(1);
const storedAnalysis = z.object({
  model: z.string().min(1), requiresReview: z.literal(true),
  outcome: z.object({ type: z.literal('choice'), choice: z.enum(outcomes), confidence: probability }),
  intent: z.object({ follow_up: probability, appointment: probability, do_not_contact: probability }),
  objections: z.record(z.enum(objections), probability), evidenceSegmentIds: z.array(z.string()).min(1),
});
export const outcomeLabels: Record<typeof outcomes[number], string> = {
  conversation: 'Conversation without an agreed next step', declined_offer: 'Offer declined',
  follow_up_requested: 'Follow-up requested', information_requested: 'Information requested',
  appointment_agreed: 'Appointment agreed', qualified_opportunity: 'Relevant need and interest',
  do_not_contact: 'No further contact requested', unclear: 'Unclear outcome',
};
type OutcomeBucket = 'positive' | 'declined' | 'neutral' | 'no_contact' | 'uncertain';
const positive = new Set<string>(['follow_up_requested','information_requested','appointment_agreed','qualified_opportunity']);
export function conversationInsights(value: unknown) {
  const parsed = storedAnalysis.safeParse(value);
  if (!parsed.success) return null;
  const analysis = parsed.data;
  const noContact = analysis.intent.do_not_contact >= .8 || (analysis.outcome.choice === 'do_not_contact' && analysis.outcome.confidence >= .8);
  const conflict = noContact && (analysis.intent.follow_up >= .8 || analysis.intent.appointment >= .8 || positive.has(analysis.outcome.choice));
  const bucket: OutcomeBucket = conflict || analysis.outcome.confidence < .8 || analysis.outcome.choice === 'unclear' ? 'uncertain'
    : noContact ? 'no_contact' : positive.has(analysis.outcome.choice) ? 'positive' : analysis.outcome.choice === 'declined_offer' ? 'declined' : 'neutral';
  return { ...analysis, bucket, conflict,
    followUpCandidate: !noContact && bucket !== 'uncertain' && (analysis.intent.follow_up >= .8 || analysis.outcome.choice === 'follow_up_requested'),
    suggestedObjections: objections.filter(key => analysis.objections[key] >= .8).map(key => ({ key, score: analysis.objections[key] })),
  };
}
export function campaignInsights(conversations: { id: string; review_state: string; analysis: unknown }[]) {
  const counts = { positive: 0, declined: 0, neutral: 0, no_contact: 0, uncertain: 0, unanalyzed: 0, excluded: 0 };
  const objectionCounts: Record<string, number> = {};
  const followUpIds: string[] = [];
  for (const conversation of conversations) {
    if (conversation.review_state === 'rejected') { counts.excluded++; continue; }
    const insights = conversationInsights(conversation.analysis);
    if (!insights) { counts.unanalyzed++; continue; }
    counts[insights.bucket]++;
    if (insights.followUpCandidate) followUpIds.push(conversation.id);
    for (const objection of insights.suggestedObjections) objectionCounts[objection.key] = (objectionCounts[objection.key] ?? 0) + 1;
  }
  return { counts, objectionCounts, followUpIds };
}
