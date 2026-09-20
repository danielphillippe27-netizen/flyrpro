import { NextRequest, NextResponse } from 'next/server';
import { dispatchCardPush } from '@/lib/cards/push';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
export async function GET(request:NextRequest) {
 if(!process.env.CRON_SECRET || request.headers.get('authorization')!==`Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({error:'Unauthorized'},{status:401});
 return NextResponse.json(await dispatchCardPush());
}
