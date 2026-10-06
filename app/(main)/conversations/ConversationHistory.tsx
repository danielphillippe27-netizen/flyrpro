'use client';
import type { ReviewConversation } from './ConversationReview';
import type { TranscriptSegment } from '@/lib/field-recordings/contracts';
type Entry = ReviewConversation & { segments: TranscriptSegment[] };
export default function ConversationHistory({ history }: { history: Entry[] }) {
  if (!history.length) return null;
  return <details className="space-y-3 rounded border p-3"><summary className="cursor-pointer font-medium">Original conversation history ({history.length})</summary>
    <p className="text-sm text-muted-foreground">These originals were replaced by split or merge results. Their notes, proposals and transcripts are preserved for reference. Review and apply the active conversations above.</p>
    {history.map(item => <article key={item.id} className="space-y-2 rounded border p-3"><p className="text-sm text-muted-foreground">Original · version {item.version}</p>
      {item.summary && <p className="font-medium">{item.summary}</p>}{item.note && <p className="whitespace-pre-wrap text-sm">{item.note}</p>}
      {(item.action_proposals || []).map((action, index) => <div key={index} className="text-sm"><p>{action.kind.replaceAll('_', ' ')}: {action.title}</p>{action.evidence.map((source, sourceIndex) => <blockquote key={sourceIndex} className="pl-3 text-muted-foreground">{source.quote}</blockquote>)}</div>)}
      <details><summary className="cursor-pointer text-sm">Original transcript</summary>{item.segments.map(segment => <p key={segment.id} className="mt-2 text-sm">{Math.floor(segment.startMs / 1000)}s · {segment.text}</p>)}</details>
    </article>)}
  </details>;
}
