import { createAdminClient } from '@/lib/supabase/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import type { NextRequest } from 'next/server';
import { cardContentSchema } from './contracts';
export class CardError extends Error { constructor(message:string,public status=400){super(message);} }
export const db=()=>createAdminClient();
export async function cardScope(req:NextRequest,workspaceId:string) {
 const user=await resolveUserFromRequest(req); if(!user) throw new CardError('Sign in to continue',401);
 const client=db();
 const {data:member,error}=await client.from('workspace_members').select('workspace_id').eq('workspace_id',workspaceId).eq('user_id',user.id).maybeSingle();
 if(error||!member) throw new CardError('Workspace unavailable',403);
 const {data:feature}=await client.from('card_workspace_features').select('enabled').eq('workspace_id',workspaceId).maybeSingle();
 if(!feature?.enabled) throw new CardError('Business cards are not enabled for this workspace',403);
 return {client,user,workspaceId};
}
export async function publicCard(token:string) {
 if(!/^[a-f0-9]{48}$/.test(token)) throw new CardError('Card unavailable',404);
 const client=db();
 const {data:share}=await client.from('card_shares').select('*').eq('token',token).is('revoked_at',null).maybeSingle();
 if(!share) throw new CardError('Card unavailable',404);
 const {data:member}=await client.from('workspace_members').select('user_id').eq('workspace_id',share.workspace_id).eq('user_id',share.rep_id).maybeSingle(); if(!member) throw new CardError('Card unavailable',404);
 // Revoking the original share also revokes all referral descendants.
 let parent=share.parent_share_id; let depth=0;
 while(parent){ if(++depth>16) throw new CardError('Card unavailable',404); const {data:p}=await client.from('card_shares').select('parent_share_id,revoked_at').eq('id',parent).maybeSingle(); if(!p||p.revoked_at) throw new CardError('Card unavailable',404); parent=p.parent_share_id; }
 const {data:profile}=await client.from('card_profiles').select('content,published').eq('id',share.profile_id).maybeSingle();
 const {data:feature}=await client.from('card_workspace_features').select('enabled').eq('workspace_id',share.workspace_id).maybeSingle();
 if(!profile?.published||!feature?.enabled) throw new CardError('Card unavailable',404);
 return {client,share,content:cardContentSchema.parse(profile.content)};
}
