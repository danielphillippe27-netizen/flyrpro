'use client';
import { conversationInsights, outcomeLabels } from '@/lib/field-recordings/insights';
export default function ConversationInsights({ analysis, segments }: { analysis: unknown; segments: { id: string; text: string }[] }) {
  const insights = conversationInsights(analysis);
  if (!insights) return <p className="text-sm text-muted-foreground">Jev analysis is unavailable or still processing.</p>;
  const evidence = segments.filter(segment => insights.evidenceSegmentIds.includes(segment.id));
  return <div className="space-y-2 rounded-md bg-muted p-3">
    <p className="text-sm font-medium">Jev suggestion: {outcomeLabels[insights.outcome.choice]}</p>
    <p className="text-xs text-muted-foreground">Model score: {insights.outcome.confidence.toFixed(2)} · {insights.model} · Review required</p>
    {insights.conflict && <p className="text-sm">Contact-preference and follow-up signals conflict. Resolve this before creating a follow-up.</p>}
    {insights.suggestedObjections.length > 0 && <p className="text-sm">Suggested objections: {insights.suggestedObjections.map(value => `${value.key.replaceAll('_', ' ')} (${value.score.toFixed(2)})`).join(', ')}</p>}
    <details><summary className="cursor-pointer text-sm">Transcript supplied to Jev</summary><div className="mt-2 space-y-1">{evidence.map(segment => <p key={segment.id} className="text-sm">{segment.text}</p>)}</div></details>
    <p className="text-xs text-muted-foreground">Check the resident’s statements against the transcript. A positive signal does not establish a sale or completed follow-up.</p>
  </div>;
}
