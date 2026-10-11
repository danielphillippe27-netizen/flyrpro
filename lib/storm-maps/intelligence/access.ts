import { NextRequest, NextResponse } from 'next/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { resolveWorkspaceMembershipForUser, type MinimalSupabaseClient } from '@/app/api/_utils/workspace';
import { createAdminClient } from '@/lib/supabase/server';
import { isWorkspaceStormMapsActive } from '../addon';
export async function stormContext(request: NextRequest) {
  const user=await resolveUserFromRequest(request);
  if(!user)return {response:NextResponse.json({error:'Unauthorized'},{status:401})};
  const admin=createAdminClient();
  const member=await resolveWorkspaceMembershipForUser(admin as unknown as MinimalSupabaseClient,user.id,request.nextUrl.searchParams.get('workspaceId'));
  if(!member.workspaceId)return {response:NextResponse.json({error:'Workspace access required'},{status:403})};
  if(!await isWorkspaceStormMapsActive(admin,member.workspaceId))return {response:NextResponse.json({error:'Enable the Storm add-on for this workspace'},{status:403})};
  return {admin,user,workspaceId:member.workspaceId,role:member.role};
}
export function stormError(error: unknown) {
  return NextResponse.json({error:error instanceof Error?error.message:'Storm data unavailable'},{status:503,headers:{'Cache-Control':'no-store'}});
}

export async function consumeArchiveRequest(context: {admin: ReturnType<typeof createAdminClient>;workspaceId:string}) {
  const {data,error}=await context.admin.rpc('consume_storm_archive_request',{p_workspace_id:context.workspaceId});
  if(error)throw new Error('Archive request accounting is unavailable. Retry after Storm Intelligence is configured.');
  if(data!==true)throw new Error('This workspace has reached its daily archive lookup limit. Saved storms and live maps remain available.');
}
