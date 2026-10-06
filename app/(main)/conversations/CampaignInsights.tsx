'use client';
import { campaignInsights } from '@/lib/field-recordings/insights';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ConversationTarget } from '@/lib/field-recordings/targets';
export default function CampaignInsights({ conversations, targets }: {
  conversations: { id: string; review_state: string; analysis: unknown; target_id: string | null; target_confirmed: boolean; summary: string | null }[];
  targets: ConversationTarget[];
}) {
  const insights = campaignInsights(conversations);
  return <Card><CardHeader><CardTitle>Suggested conversation outcomes</CardTitle></CardHeader><CardContent className="space-y-3">
    <div className="grid grid-cols-2 gap-3 text-sm"><p>{insights.counts.positive} positive next-step signals</p><p>{insights.counts.declined} offers declined</p><p>{insights.counts.neutral} conversations without a next step</p><p>{insights.counts.no_contact} no-contact signals</p><p>{insights.counts.uncertain} uncertain outcomes</p><p>{insights.counts.unanalyzed} awaiting usable analysis</p></div>
    <p className="text-xs text-muted-foreground">AI suggestions requiring review. Scores below 0.80 or conflicting signals are uncertain; rejected conversations are excluded. Positive signals include requested information, follow-ups, appointments and relevant interest.</p>
    {Object.keys(insights.objectionCounts).length > 0 && <p className="text-sm">Suggested objections: {Object.entries(insights.objectionCounts).sort((a,b) => b[1]-a[1]).map(([key,count]) => `${key.replaceAll('_',' ')}: ${count}`).join(' · ')}</p>}
    {insights.followUpIds.length > 0 && <div><p className="text-sm font-medium">Conversations to review for follow-up</p><ul className="mt-2 space-y-2">{insights.followUpIds.map(id => {
      const conversation = conversations.find(value => value.id === id)!;
      const label = targets.find(target => target.id === conversation.target_id)?.label ?? 'Unassigned conversation';
      return <li key={id}><a className="text-sm underline" href={`#conversation-${id}`}>{label}{!conversation.target_confirmed ? ' · Door needs confirmation' : ''}</a>{conversation.summary && <p className="text-xs text-muted-foreground">{conversation.summary}</p>}</li>;
    })}</ul></div>}
  </CardContent></Card>;
}
