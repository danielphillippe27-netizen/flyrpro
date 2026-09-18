import { NextRequest,NextResponse } from 'next/server';
import { randomBytes,createHash } from 'node:crypto';
import { z } from 'zod';
import { cardScope,publicCard,CardError } from '@/lib/cards/server';
import { cardContentSchema,actionTypes,isPreview,cardMessage,vcard } from '@/lib/cards/contracts';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const uuid=z.uuid();
const json=(value:unknown,status=200)=>NextResponse.json(value,{status,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
async function handle(req:NextRequest,{params}:{params:Promise<{path:string[]}>}) {
 try {
 const {path}=await params; const raw=req.method==='GET'?'{}':await req.text(); if(raw.length>16384) throw new CardError('Request too large',413); let body; try {body=JSON.parse(raw);} catch {throw new CardError('Invalid JSON');} if(!body||typeof body!=='object'||Array.isArray(body)) throw new CardError('Invalid request');
 if(path[0]==='public') {
  const token=path[1]; const {client,share,content}=await publicCard(token);
  if(req.method==='GET'&&path[2]==='contact') return new NextResponse(vcard(content),{headers:{'Content-Type':'text/vcard;charset=utf-8','Content-Disposition':'attachment; filename="contact.vcf"','Cache-Control':'no-store'}});
  if(req.method!=='POST') throw new CardError('Not found',404);
  const ip=req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const bucket=createHash('sha256').update(`${token}:${ip}:${path[2]}`).digest('hex');
  const {data:allowed,error:limitError}=await client.rpc('card_take_rate_limit',{p_bucket:bucket,p_limit:path[2]==='events'?60:8});
  if(limitError||!allowed) throw new CardError('Please try again shortly',429);
  if(isPreview(req.headers.get('user-agent')||'')) return json({ignored:true});
  if(path[2]==='events') {
   const e=z.object({visitId:uuid,eventId:uuid,type:z.enum(['qualified_open',...actionTypes]),detail:z.string().max(100).optional(),visibleMs:z.number().min(0).optional()}).parse(body);
   if(e.type==='qualified_open'&&(e.visibleMs??0)<2000) throw new CardError('View not qualified');
   if(e.type!=='qualified_open') { const {error}=await client.rpc('card_record_event',{p_share:share.id,p_visit:e.visitId,p_key:'open',p_type:'qualified_open'}); if(error) throw error; }
   const {error}=await client.rpc('card_record_event',{p_share:share.id,p_visit:e.visitId,p_key:e.type==='qualified_open'?'open':e.eventId,p_type:e.type,p_detail:e.detail??null}); if(error) throw error;
   return json({ok:true});
  }
  if(path[2]==='referral-link') {
   const key=uuid.parse(body.idempotencyKey);
   // Always attach to the root; do not propagate a household identity to a referral.
   let root=share; while(root.parent_share_id){ const {data:p,error}=await client.from('card_shares').select('*').eq('id',root.parent_share_id).single();if(error) throw error;root=p; }
   const {data:existing}=await client.from('card_shares').select('token,parent_share_id').eq('rep_id',share.rep_id).eq('workspace_id',share.workspace_id).eq('idempotency_key',key).maybeSingle();
   if(existing && existing.parent_share_id!==root.id) throw new CardError('Request conflict',409);
   let child=existing;
   if(!child){const {data,error}=await client.from('card_shares').insert({token:randomBytes(24).toString('hex'),profile_id:share.profile_id,workspace_id:share.workspace_id,rep_id:share.rep_id,parent_share_id:root.id,idempotency_key:key}).select('token,parent_share_id').single();if(error) throw error;child=data;}
   const {error:activityError}=await client.from('card_events').upsert({share_id:root.id,visit_id:key,event_key:'referral_link',event_type:'referral_link_created'},{onConflict:'share_id,visit_id,event_key',ignoreDuplicates:true});if(activityError) throw activityError;
   return json({url:`${origin()}/c/${child!.token}`});
  }
  if(path[2]==='referrals') {
   const r=z.object({submissionId:uuid,name:z.string().trim().min(1).max(100),phone:z.string().trim().max(40).regex(/^[+\d ()-]*$/).default(''),email:z.union([z.email(),z.literal('')]).default(''),note:z.string().max(2000).default(''),referrerName:z.string().max(100).default(''),permission:z.literal(true)}).refine(r=>r.phone.replace(/\D/g,'').length>=7||!!r.email,'Phone or email required').parse(body);
   const {error}=await client.rpc('card_submit_referral',{p_share:share.id,p_submission:r.submissionId,p_name:r.name,p_phone:r.phone,p_email:r.email.toLowerCase(),p_note:r.note,p_referrer:r.referrerName});if(error) throw error;
   return json({ok:true});
  }
  throw new CardError('Not found',404);
 }
 const workspaceId=uuid.parse(req.nextUrl.searchParams.get('workspaceId')||body.workspaceId);
 const {client,user}=await cardScope(req,workspaceId);
 if(path[0]==='profile') {
  if(req.method==='GET'){ const {data,error}=await client.from('card_profiles').select('id,content,published').eq('workspace_id',workspaceId).eq('rep_id',user.id).maybeSingle();if(error) throw error;
   if(data)return json({profile:data});
   const {data:p}=await client.from('user_profiles').select('first_name,last_name,brokerage_name,avatar_url').eq('user_id',user.id).maybeSingle();
   const {data:contactProfile}=await client.from('profiles').select('phone_number').eq('id',user.id).maybeSingle();
   return json({profile:{id:crypto.randomUUID(),published:false,content:{name:[p?.first_name,p?.last_name].filter(Boolean).join(' '),title:'',company:p?.brokerage_name??'',bio:'',phone:contactProfile?.phone_number??'',email:user.email??'',photo:p?.avatar_url??'',reviewUrl:'',socials:[]}}}); }
  if(req.method==='POST'){const content=cardContentSchema.parse(body.content);const published=z.boolean().parse(body.published);const {data,error}=await client.from('card_profiles').upsert({workspace_id:workspaceId,rep_id:user.id,content,published,updated_at:new Date().toISOString()},{onConflict:'workspace_id,rep_id'}).select('id,content,published').single();if(error) throw error;return json({profile:data});}
 }
 if(path[0]==='engagement'&&req.method==='GET') {
  const campaignId=uuid.parse(req.nextUrl.searchParams.get('campaignId'));
  const {data,error}=await client.from('card_property_engagement').select('address_id,building_id,qualified_views,last_engaged_at').eq('workspace_id',workspaceId).eq('campaign_id',campaignId);if(error) throw error;return json({engagement:data});
 }
 if(path[0]==='shares'&&path.length===1&&req.method==='POST') {
  const contactId=uuid.parse(body.contactId),key=uuid.parse(body.idempotencyKey);
  const {data:contact}=await client.from('contacts').select('*').eq('id',contactId).eq('user_id',user.id).eq('workspace_id',workspaceId).maybeSingle();if(!contact) throw new CardError('Save and sync this lead before sending',409);
  if(!contact.phone || contact.phone.replace(/\D/g,'').length<7) throw new CardError('Add a valid phone number to this lead first',409);
  const {data:profile}=await client.from('card_profiles').select('*').eq('workspace_id',workspaceId).eq('rep_id',user.id).eq('published',true).maybeSingle();if(!profile) throw new CardError('Publish your business card first',409);
  if(contact.address_id && contact.campaign_address_id && contact.address_id!==contact.campaign_address_id) throw new CardError('This lead has conflicting property links. Correct its property before sending.',409);
  const linkedAddressId=contact.address_id || contact.campaign_address_id;
  const addressId=body.addressId?uuid.parse(body.addressId):linkedAddressId;
  let campaignId:string|null=null,buildingId:string|null=null;
  if(addressId){
   const {data:address}=await client.from('campaign_addresses').select('id,campaign_id,gers_id').eq('id',addressId).maybeSingle();
   if(!address) throw new CardError('Property unavailable',409);
   const {data:campaign}=await client.from('campaigns').select('workspace_id').eq('id',address.campaign_id).eq('workspace_id',workspaceId).maybeSingle();
   if(!campaign || (contact.campaign_id&&contact.campaign_id!==address.campaign_id) || (linkedAddressId&&linkedAddressId!==addressId)) throw new CardError('Property does not match this lead',409);
   campaignId=address.campaign_id;buildingId=address.gers_id;
   if(!linkedAddressId){const {error}=await client.from('contacts').update({address_id:addressId,campaign_id:campaignId}).eq('id',contactId).eq('user_id',user.id).eq('workspace_id',workspaceId);if(error) throw error;}
  }
  let {data:share}=await client.from('card_shares').select('*').eq('workspace_id',workspaceId).eq('rep_id',user.id).eq('idempotency_key',key).maybeSingle();
  if(share&&(share.contact_id!==contactId||share.address_id!==(addressId??null)||share.revoked_at)) throw new CardError('Request conflict',409);
  if(!share){ const {data,error}=await client.from('card_shares').insert({token:randomBytes(24).toString('hex'),profile_id:profile.id,workspace_id:workspaceId,rep_id:user.id,contact_id:contactId,address_id:addressId??null,campaign_id:campaignId,building_id:buildingId,idempotency_key:key}).select('*').single();if(error){ if(error.code==='23505'){const {data:retry}=await client.from('card_shares').select('*').eq('workspace_id',workspaceId).eq('rep_id',user.id).eq('idempotency_key',key).single();if(retry?.revoked_at||retry?.contact_id!==contactId||retry?.address_id!==(addressId??null)) throw new CardError('Request conflict',409);share=retry;}else throw error;}else share=data; }
  const url=`${origin()}/c/${share.token}`;
  return json({id:share.id,url,message:cardMessage(contact.full_name??'',profile.content.phone??'',url),phone:contact.phone??''});
 }
 if(path[0]==='activity'&&req.method==='GET') {
  const contactId=req.nextUrl.searchParams.get('contactId');
  const id=uuid.parse(contactId||req.nextUrl.searchParams.get('addressId'));
  const {data:shares,error}=await client.from('card_shares').select('id,created_at,revoked_at,card_events(id,event_type,detail,created_at),card_referrals(id,contact_id,referrer_name,note,created_at)').eq(contactId?'contact_id':'address_id',id).eq('workspace_id',workspaceId).eq('rep_id',user.id);if(error) throw error;
  return json({shares:shares??[]});
 }
 if(path[0]==='shares'&&path[1]&&req.method==='POST') {
  const id=uuid.parse(path[1]);const {data:share}=await client.from('card_shares').select('id').eq('id',id).eq('workspace_id',workspaceId).eq('rep_id',user.id).maybeSingle();if(!share) throw new CardError('Share unavailable',404);
  if(path[2]==='revoke'){const {error}=await client.from('card_shares').update({revoked_at:new Date().toISOString()}).eq('id',id);if(error) throw error;return json({ok:true});}
  if(path[2]==='composer'){const type=z.enum(['composer_opened','composer_cancelled','composer_sent','composer_failed']).parse(body.type);const eventId=uuid.parse(body.eventId);const {error}=await client.from('card_events').upsert({share_id:id,visit_id:eventId,event_key:type,event_type:type},{onConflict:'share_id,visit_id,event_key',ignoreDuplicates:true});if(error) throw error;return json({ok:true});}
 }
 throw new CardError('Not found',404);
 } catch(error){if(error instanceof z.ZodError)return json({error:error.issues[0]?.message??'Invalid input'},400);if(error instanceof CardError)return json({error:error.message},error.status);console.error('[cards]',error);return json({error:'Business card request failed. Please retry.'},500);}
}
function origin(){return (process.env.NEXT_PUBLIC_APP_URL||'https://wolfgrid.app').replace(/\/$/,'');}
export const GET=handle;
export const POST=handle;
