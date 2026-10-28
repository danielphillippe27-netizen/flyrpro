import { NextRequest } from 'next/server';
import { stormContext } from '@/lib/storm-maps/intelligence/access';
import { countBoundaryAddresses } from '@/lib/territory/count-boundary-addresses';
export const runtime = 'nodejs';
export const maxDuration = 180;
export async function POST(request: NextRequest) {
  const context = await stormContext(request);
  if ('response' in context) return context.response;
  return countBoundaryAddresses(request, context.workspaceId);
}
