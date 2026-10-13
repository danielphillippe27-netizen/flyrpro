import {timingSafeEqual} from 'node:crypto';
import {NextRequest,NextResponse} from 'next/server';
import {collectWatchedHail} from '@/lib/storm-maps/intelligence/hail-watch-collector';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=300;
export async function GET(request:NextRequest){
 const secret=process.env.CRON_SECRET?.trim();if(!secret)return NextResponse.json({error:'Hail watch scheduler is not configured.'},{status:503});
 const actual=Buffer.from(request.headers.get('authorization')??''),expected=Buffer.from(`Bearer ${secret}`);if(actual.length!==expected.length||!timingSafeEqual(actual,expected))return NextResponse.json({error:'Unauthorized'},{status:401});
 try{return NextResponse.json(await collectWatchedHail());}catch{return NextResponse.json({error:'Hail watch collection failed.'},{status:503});}
}
