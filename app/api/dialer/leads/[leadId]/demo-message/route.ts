import { NextRequest, NextResponse } from 'next/server';
import { ensureSalespersonReferralCode, normalizeSalespersonReferralCodeInput } from '@/app/lib/billing/salespeople';
import { createTrackedDemoLink } from '@/lib/dialer/demo-link-tracking';
import { getDialerRequestContext } from '@/lib/dialer/server';
import type { DiallerLead } from '@/types/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type DemoMessagePayload = {
  workspaceId?: string;
  email?: string | null;
};

const FALLBACK_PUBLIC_ORIGIN = 'https://www.flyrpro.app';
const DEMO_VIDEO_PATH = '/demo-1';

function cleanText(value: string | null | undefined): string {
  return (value ?? '').trim();
}

function normalizePublicOrigin(value: string | null | undefined): string | null {
  const cleaned = value?.trim().replace(/\/+$/, '');
  if (!cleaned) return null;
  try {
    const parsed = new URL(cleaned.startsWith('http') ? cleaned : `https://${cleaned}`);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (parsed.hostname.toLowerCase() === 'flyrpro.app') {
      parsed.hostname = 'www.flyrpro.app';
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

function getPublicOrigin(request: NextRequest): string {
  return (
    normalizePublicOrigin(process.env.NEXT_PUBLIC_APP_URL) ||
    normalizePublicOrigin(process.env.APP_BASE_URL) ||
    normalizePublicOrigin(process.env.VERCEL_URL) ||
    normalizePublicOrigin(request.nextUrl.origin) ||
    FALLBACK_PUBLIC_ORIGIN
  );
}

function getFirstName(name: string | null | undefined): string {
  return cleanText(name).split(/\s+/)[0] || '';
}

function getRepFirstName(value: string | null | undefined): string {
  return getFirstName(value) || 'Daniel';
}

function buildSharedDemoUrl(origin: string, referralCode: string | null): string {
  if (!referralCode) return new URL(DEMO_VIDEO_PATH, origin).toString();

  const url = new URL(`/s/${encodeURIComponent(referralCode)}`, origin);
  url.searchParams.set('source', 'salesperson');
  url.searchParams.set('campaign', 'power-dialer-demo');
  url.searchParams.set('redirect', DEMO_VIDEO_PATH);
  return url.toString();
}

function buildTextMessage(lead: DiallerLead, repName: string, demoUrl: string): string {
  const firstName = getFirstName(lead.name) || 'there';
  return [
    `Hey ${firstName}, it's ${repName} with FLYR.`,
    '',
    `Here's the quick 90-second demo I mentioned: ${demoUrl}`,
    '',
    'Take a look when you get a chance. It shows how teams can track field activity, manage leads, and keep agents accountable.',
  ].join('\n');
}

function buildEmailBody(lead: DiallerLead, repName: string, demoUrl: string): string {
  const firstName = getFirstName(lead.name) || 'there';
  return [
    `Hey ${firstName},`,
    '',
    'It was great connecting with you.',
    '',
    `Here is the quick 90-second FLYR demo I mentioned: ${demoUrl}`,
    '',
    'It shows how teams can automatically track field activity, manage leads, and keep agents accountable from one place.',
    '',
    'Reply here with any questions and I will get back to you.',
    '',
    'Thanks,',
    repName,
  ].join('\n');
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ leadId: string }> },
) {
  const payload = (await request.json().catch(() => ({}))) as DemoMessagePayload;
  const { leadId } = await params;
  const context = await getDialerRequestContext(request, payload.workspaceId);
  if (context instanceof NextResponse) return context;

  const { data: lead, error: leadError } = await context.admin
    .from('dialler_leads')
    .select('*')
    .eq('id', leadId)
    .eq('workspace_id', context.workspaceId)
    .eq('user_id', context.requestUser.id)
    .maybeSingle();

  if (leadError) {
    console.error('[dialer/demo-message] failed to load lead', leadError);
    return NextResponse.json({ error: 'Failed to load lead.' }, { status: 500 });
  }

  if (!lead) {
    return NextResponse.json({ error: 'Lead not found.' }, { status: 404 });
  }

  const diallerLead = {
    ...(lead as DiallerLead),
    email: cleanText(payload.email) || (lead as DiallerLead).email,
  };
  const salesperson = context.salesperson;
  const existingReferralCode = normalizeSalespersonReferralCodeInput(salesperson?.referral_code ?? '');
  const referralCode = salesperson?.id
    ? existingReferralCode ||
      (await ensureSalespersonReferralCode(context.admin, {
        salespersonId: salesperson.id,
        fullName: salesperson.full_name || salesperson.email || context.requestUser.email || 'Salesperson',
        existingReferralCode: salesperson.referral_code,
      }).catch((error) => {
        console.warn('[dialer/demo-message] referral code generation failed', error);
        return null;
      }))
    : null;

  const origin = getPublicOrigin(request);
  const trackedLink = await createTrackedDemoLink({
    admin: context.admin,
    origin,
    salesperson,
    workspaceId: context.workspaceId,
    lead: diallerLead,
    referralCode,
    source: 'salesperson',
    campaign: 'power-dialer-demo',
    destinationPath: DEMO_VIDEO_PATH,
  });
  const demoUrl = trackedLink?.url ?? buildSharedDemoUrl(origin, referralCode);
  const repName = getRepFirstName(salesperson?.full_name || context.requestUser.email);

  return NextResponse.json({
    demoUrl,
    demoLinkToken: trackedLink?.token ?? null,
    textBody: buildTextMessage(diallerLead, repName, demoUrl),
    emailSubject: 'Quick FLYR demo',
    emailBody: buildEmailBody(diallerLead, repName, demoUrl),
    tracked: Boolean(trackedLink),
  });
}
