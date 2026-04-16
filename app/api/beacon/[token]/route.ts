import { NextResponse } from 'next/server';
import { getPublicBeaconByToken } from '@/lib/beacon/public';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type Params = {
  params: Promise<{ token: string }>;
};

export async function GET(_: Request, { params }: Params) {
  const { token } = await params;
  const payload = await getPublicBeaconByToken(token);

  return NextResponse.json(payload, {
    headers: {
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}
