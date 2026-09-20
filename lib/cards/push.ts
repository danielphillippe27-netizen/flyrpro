import { db, publicCard } from '@/lib/cards/server';
import { sendApnsNotification } from '@/lib/notifications/apns';

type CardPushJob = {
 id: string;
 share_id: string;
 event_type: string;
 detail: string;
 delivered_token_ids?: string[] | null;
};

type IosPushToken = {
 id: string;
 token: string;
 environment: string;
};

export function cardPushTitle(type: string, detail: string) {
 const social = ['Instagram','Facebook','LinkedIn','TikTok','YouTube','X','Website'].includes(detail) ? detail : 'Social link';
 const titles: Record<string,string> = {
  qualified_open:'Business card opened', call_clicked:'Call button clicked', text_clicked:'Text button clicked',
  email_clicked:'Email button clicked', contact_downloaded:'Save Contact clicked', social_clicked:`${social} clicked`,
  website_clicked:'Website clicked', review_clicked:'Review link clicked', referral_started:'Referral form opened',
 };
 return titles[type] ?? 'Business card activity';
}
export async function dispatchCardPush(shareId?: string) {
 const client = db();
 const {data:jobs,error} = await client.rpc('claim_card_push',{p_share:shareId ?? null});
 if(error) throw error;
 const pushJobs = (jobs ?? []) as CardPushJob[];
 await Promise.all(pushJobs.map(async job => {
  const delivered = new Set<string>(job.delivered_token_ids ?? []);
  try {
   const {data:raw,error:shareError}=await client.from('card_shares').select('token').eq('id',job.share_id).maybeSingle();
   if(shareError) throw shareError;
   if(!raw) throw new Error('Card unavailable');
   const {share}=await publicCard(raw.token);
   const {data:tokens,error:tokenError}=await client.from('user_push_tokens').select('id,token,environment').eq('user_id',share.rep_id).eq('platform','ios').eq('enabled',true);
   if(tokenError) throw tokenError;
   if(!tokens?.length) throw new Error('No active iOS push tokens');
   const {data:contact}=share.contact_id ? await client.from('contacts').select('full_name,address').eq('id',share.contact_id).eq('user_id',share.rep_id).eq('workspace_id',share.workspace_id).maybeSingle() : {data:null};
   const label = [contact?.full_name, share.address_id ? contact?.address : null].filter(Boolean).join(' · ').slice(0,180) || 'Your shared business card';
   const payload = {
    aps:{alert:{title:cardPushTitle(job.event_type,job.detail),body:label},sound:'default','thread-id':`card:${share.id}`},
    type:'business_card_activity',notification_id:job.id,share_id:share.id,user_id:share.rep_id,
    workspace_id:share.workspace_id,contact_id:share.contact_id,address_id:share.address_id,
    campaign_id:share.campaign_id,activity_label:label,
   };
   const failures: string[]=[];
   const iosTokens = tokens as IosPushToken[];
   await Promise.all(iosTokens.filter(token=>!delivered.has(token.id)).map(async token=>{
    try {
     await sendApnsNotification({token:token.token,environment:token.environment,payload});
     delivered.add(token.id);
    } catch(error) {
     const reason=error instanceof Error?error.message:String(error);
     if(/BadDeviceToken|Unregistered|DeviceTokenNotForTopic/.test(reason)) {
      await client.from('user_push_tokens').update({enabled:false}).eq('id',token.id);
     }
     failures.push(reason.slice(0,200));
    }
   }));
   if(failures.length) throw new Error(failures.join('; '));
   const {error:updateError}=await client.from('card_push_queue').update({sent_at:new Date().toISOString(),delivered_token_ids:[...delivered],last_error:null}).eq('id',job.id);
   if(updateError) throw updateError;
  } catch(error) {
   const message=error instanceof Error?error.message:String(error);
   const unavailable=message==='Card unavailable';
   await client.from('card_push_queue').update({delivered_token_ids:[...delivered],last_error:message.slice(0,500),...(unavailable?{sent_at:new Date().toISOString()}:{})}).eq('id',job.id);
  }
 }));
 return {processed:pushJobs.length};
}
