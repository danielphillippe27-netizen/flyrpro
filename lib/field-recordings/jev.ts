import { z } from 'zod';
import { objections, outcomes, type TranscriptSegment } from './contracts';

const probability = z.number().min(0).max(1);
const choice = z.object({ type: z.literal('choice'), choice: z.enum(outcomes), confidence: probability, probabilities: z.record(z.string(), probability) });
const noul = z.object({ type: z.literal('noul'), noul: probability });
const responseSchema = z.object({ model: z.string(), answers: z.record(z.string(), z.unknown()), usage: z.object({ input_tokens: z.number().nonnegative(), output_tokens: z.number().nonnegative() }) });

const descriptions: Record<typeof outcomes[number], string> = {
  conversation: 'Conversation occurred without an explicit next step.',
  declined_offer: 'Resident declined the offer, without requesting no further contact.',
  follow_up_requested: 'Resident explicitly requested or agreed to later contact, without a booked appointment.',
  information_requested: 'Resident explicitly requested information.',
  appointment_agreed: 'Resident and rep explicitly agreed to an appointment.',
  qualified_opportunity: 'Resident explicitly stated a relevant need and interest, without an agreed next step.',
  do_not_contact: 'Resident explicitly requested no further contact. Mere disinterest is insufficient.',
  unclear: 'Insufficient, contradictory, or uncertain evidence; speaker identity is unclear.',
};

export function conversationQuestions() {
  const questions: Record<string, unknown> = {
    outcome: { type: 'choice', instructions: 'Classify the resident’s explicit statements in this conversation. Do not treat rep suggestions or private dictation as resident intent. Use unclear when identity or evidence is uncertain.', criteria: descriptions },
    follow_up: { type: 'noul', instructions: 'Did the resident explicitly request or accept later contact? A hypothetical suggestion or rep-only plan does not qualify.' },
    appointment: { type: 'noul', instructions: 'Did the resident explicitly agree to an appointment, rather than merely mention availability?' },
    do_not_contact: { type: 'noul', instructions: 'Did the resident explicitly ask for no further contact? Not interested alone is not such a request.' },
  };
  for (const objection of objections) questions[`objection_${objection}`] = {
    type: 'noul', instructions: `Did the resident express an objection about ${objection.replaceAll('_', ' ')}? Evaluate only resident statements, not rep hypotheticals.`,
  };
  return questions;
}

export function parseJevAnalysis(value: unknown, evidence: TranscriptSegment[]) {
  const result = responseSchema.parse(value);
  const outcome = choice.parse(result.answers.outcome);
  const intent = Object.fromEntries(['follow_up', 'appointment', 'do_not_contact'].map(key => [key, noul.parse(result.answers[key]).noul]));
  const objectionProbabilities = Object.fromEntries(objections.map(key => [key, noul.parse(result.answers[`objection_${key}`]).noul]));
  return { model: result.model, rubricVersion: 'field-conversations-v1', outcome, intent, objections: objectionProbabilities, evidenceSegmentIds: evidence.map(s => s.id), usage: result.usage, requiresReview: true };
}

export async function analyzeWithJev(segments: TranscriptSegment[], context: { timezone: string; recordedAt: string }) {
  const key = process.env.TYPESAFE_API_KEY;
  if (!key) throw new Error('Jev is not configured');
  if (!segments.length || segments.reduce((n, s) => n + s.text.length, 0) > 60000) throw new Error('Conversation exceeds analysis limits');
  const response = await fetch('https://api.typesafe.ai/v1/systemone', {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: process.env.JEV_MODEL || 'jev-1.13.0', state: { ...context, segments }, questions: conversationQuestions() }),
    signal: AbortSignal.timeout(30000), redirect: 'error', cache: 'no-store',
  });
  // Provider bodies can contain personal content; never include them in errors or logs.
  if (!response.ok) throw new Error(`Jev request failed (${response.status})`);
  return parseJevAnalysis(await response.json(), segments);
}
