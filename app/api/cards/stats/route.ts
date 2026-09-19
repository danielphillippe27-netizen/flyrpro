import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { cardScope, CardError } from '@/lib/cards/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const workspaceId = z.uuid().parse(request.nextUrl.searchParams.get('workspaceId'));
    const scope = z.enum(['self', 'team']).parse(request.nextUrl.searchParams.get('scope') ?? 'self');
    const { client, user } = await cardScope(request, workspaceId);
    if (scope === 'team') {
      const { data: member, error } = await client.from('workspace_members').select('role')
        .eq('workspace_id', workspaceId).eq('user_id', user.id).maybeSingle();
      if (error || !member || !['owner', 'admin'].includes(member.role)) throw new CardError('Team stats unavailable', 403);
    }
    // One qualified open per share/visit, including a visit proved by a button action.
    // Exact server count avoids the default row limit and includes repeat visits.
    let query = client.from('card_events').select('id,card_shares!inner(id)', { count: 'exact', head: true })
      .eq('event_type', 'qualified_open').eq('card_shares.workspace_id', workspaceId);
    if (scope === 'self') query = query.eq('card_shares.rep_id', user.id);
    const { count, error } = await query;
    if (error || count === null) throw new Error('Unable to count card opens');
    return NextResponse.json({ opened: count }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const status = error instanceof CardError ? error.status : error instanceof z.ZodError ? 400 : 500;
    return NextResponse.json({ error: status === 500 ? 'Unable to load business-card stats' : error instanceof Error ? error.message : 'Invalid request' }, { status });
  }
}
