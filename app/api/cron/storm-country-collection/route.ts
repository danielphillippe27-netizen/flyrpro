import {timingSafeEqual} from 'node:crypto';
import {NextRequest,NextResponse} from 'next/server';
import {collectCountryArchive} from '@/lib/storm-maps/intelligence/country-collector';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;
export async function GET(request:NextRequest){
 const secret=process.env.CRON_SECRET?.trim();if(!secret)return NextResponse.json({error:'Country collector is not configured.'},{status:503});
 const actual=Buffer.from(request.headers.get('authorization')??''),expected=Buffer.from(`Bearer ${secret}`);if(actual.length!==expected.length||!timingSafeEqual(actual,expected))return NextResponse.json({error:'Unauthorized'},{status:401});
 try{return NextResponse.json(await collectCountryArchive(new Date(),request.nextUrl.searchParams.get('history')==='1'));}catch{return NextResponse.json({error:'Country collection failed. Check the collection ledger.'},{status:503});}
}
