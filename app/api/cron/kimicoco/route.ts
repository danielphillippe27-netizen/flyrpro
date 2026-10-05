import { NextRequest, NextResponse } from 'next/server';
import { dispatchKimiCoco } from '@/lib/integrations/kimicoco';
export const runtime='nodejs'; export const dynamic='force-dynamic'; export const maxDuration=60;
export async function GET(request:NextRequest) {
 if(!process.env.CRON_SECRET || request.headers.get('authorization')!==`Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({error:'Unauthorized'},{status:401});
 try {return NextResponse.json(await dispatchKimiCoco());} catch {return NextResponse.json({error:'KimiCoco queue unavailable'},{status:503});}
}
