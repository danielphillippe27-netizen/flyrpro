import { NextRequest } from 'next/server';
import { z } from 'zod';
import { relationshipCommand } from '@/lib/coco/relationships';
import { crmRequest, requireCrmWorkspace, readCrmBody, privateJson, errorResponse, CrmRequestError } from '@/lib/mac-companion/server';
export const dynamic = 'force-dynamic';
async function handle(request: NextRequest, mutation: boolean) {
  try {
    const { api } = await crmRequest(request, 'mac', mutation);
    const input = mutation ? relationshipCommand.parse(await readCrmBody(request, 100000)) : z.object({ workspaceId: z.string().uuid(), contactId: z.string().uuid() }).parse(Object.fromEntries(request.nextUrl.searchParams));
    await requireCrmWorkspace(api, input.workspaceId);
    const { workspaceId, ...payload } = input;
    const result = await api.rpc('coco_relationship_command', { ws: workspaceId, command: 'action' in input ? input.action : 'read', payload });
    if (result.error) {
      if (result.error.code === '42501') throw new CrmRequestError('Contact unavailable in this workspace.', 403);
      if (result.error.code === '40001') throw new CrmRequestError('Details changed elsewhere. Reload before saving.', 409);
      throw new CrmRequestError('Could not save or load relationship details. Check that the database update is installed.', 503);
    }
    return privateJson(result.data);
  } catch (error) {
    if (error instanceof z.ZodError) return errorResponse(new CrmRequestError('Check the fields, recipients and date.'));
    return errorResponse(error);
  }
}
export const GET = (request: NextRequest) => handle(request, false);
export const POST = (request: NextRequest) => handle(request, true);
