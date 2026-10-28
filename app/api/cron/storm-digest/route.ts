import { timingSafeEqual } from 'node:crypto';
import { NextRequest,NextResponse } from 'next/server';
import twilio from 'twilio';
import { createAdminClient } from '@/lib/supabase/server';
import { loadReportEvents,xweatherData } from '@/lib/storm-maps/intelligence/provider';
import type { CycloneResponse } from '@/lib/storm-maps/intelligence/normalize';
import { buildStormDigest,torontoDigestClock } from '@/lib/storm-maps/intelligence/digest';
import { australianHailDigest } from '@/lib/storm-maps/intelligence/australian-hail-history';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=180;
export async function GET(request:NextRequest){
 const secret=process.env.CRON_SECRET?.trim();
 if(!secret)return NextResponse.json({error:'Storm scheduler is not configured.'},{status:503});
 const expected=Buffer.from(`Bearer ${secret}`),actual=Buffer.from(request.headers.get('authorization')??'');
 if(actual.length!==expected.length||!timingSafeEqual(actual,expected))return NextResponse.json({error:'Unauthorized'},{status:401});
 const now=new Date(),clock=torontoDigestClock(now),admin=createAdminClient();
 const {data:subscriptions,error}=await admin.from('storm_digest_subscriptions').select('id,phone,local_hour').eq('enabled',true);
 if(error)return NextResponse.json({error:'Digest subscriptions unavailable.'},{status:503});
 const force=request.nextUrl.searchParams.get('force')==='1',preview=request.nextUrl.searchParams.get('preview')==='1';
 const due=(subscriptions??[]).filter(s=>force||s.local_hour===clock.hour);
 if(!due.length)return NextResponse.json({status:'not_due',localDate:clock.date});
 const from=process.env.TWILIO_DEFAULT_SMS_FROM_NUMBER?.trim()||process.env.TWILIO_DEFAULT_FROM_NUMBER?.trim(),sid=process.env.TWILIO_ACCOUNT_SID?.trim(),token=process.env.TWILIO_AUTH_TOKEN?.trim();
 if(!from||!sid||!token)return NextResponse.json({error:'Storm SMS sender is not configured.'},{status:503});
 const start=new Date(+now-86400000);
 const [hail,cyclones,australia]=await Promise.allSettled([loadReportEvents([-180,18,-50,85],start.toISOString(),now.toISOString(),'hail'),xweatherData<CycloneResponse>('tropicalcyclones',{limit:'100',fields:'id,profile,position,track.dateTimeISO'}),australianHailDigest(start,now)]);
 const summary=buildStormDigest(hail.status==='fulfilled'?hail.value:null,cyclones.status==='fulfilled'?cyclones.value:null,start,now,australia.status==='fulfilled'?australia.value:null);
 if(preview)return NextResponse.json({status:'preview',summary});
 const client=twilio(sid,token),results:Array<{subscriptionId:string;status:string;messageId?:string}>=[];
 for(const subscription of due){
  // Claim before sending. A retry must never duplicate an ambiguously accepted SMS.
  const {data:run,error:claimError}=await admin.from('storm_digest_runs').insert({subscription_id:subscription.id,local_date:clock.date,summary}).select('id').single();
  if(claimError){results.push({subscriptionId:subscription.id,status:claimError.code==='23505'?'already_attempted':'claim_failed'});continue;}
  try{
   const message=await client.messages.create({from,to:subscription.phone,body:summary.text});
   const {error:recordError}=await admin.from('storm_digest_runs').update({status:'accepted',provider_message_id:message.sid,completed_at:new Date().toISOString()}).eq('id',run.id);
   results.push({subscriptionId:subscription.id,status:recordError?'accepted_record_pending':'accepted',messageId:message.sid});
  }catch{
   await admin.from('storm_digest_runs').update({status:'failed',completed_at:new Date().toISOString()}).eq('id',run.id);
   results.push({subscriptionId:subscription.id,status:'failed'});
  }
 }
 const failed=results.some(r=>['failed','claim_failed','accepted_record_pending'].includes(r.status));
 return NextResponse.json({status:failed?'attention_required':'ok',localDate:clock.date,results},{status:failed?503:200});
}
