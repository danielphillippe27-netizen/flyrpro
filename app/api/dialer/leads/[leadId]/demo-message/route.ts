import { NextRequest, NextResponse } from 'next/server';
import { ensureSalespersonReferralCode, normalizeSalespersonReferralCodeInput } from '@/app/lib/billing/salespeople';
import { createTrackedDemoLink } from '@/lib/dialer/demo-link-tracking';
import { getDialerRequestContext } from '@/lib/dialer/server';
import { generateDemoLinkForLead } from '@/lib/demo/generateDemoLinkForLead';
import type { DiallerLead } from '@/types/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type DemoMessagePayload = {
  workspaceId?: string;
  email?: string | null;
  template?: 'default' | 'brokerage';
};

const FALLBACK_PUBLIC_ORIGIN = 'https://wolfgrid.app';
const DEMO_VIDEO_PATH = '/demo-1';
const LISTING_DEMO_VIDEO_PATH = '/demo-2';

function cleanText(value: string | null | undefined): string {
  return (value ?? '').trim();
}

function normalizePublicOrigin(value: string | null | undefined): string | null {
  const cleaned = value?.trim().replace(/\/+$/, '');
  if (!cleaned) return null;
  try {
    const parsed = new URL(cleaned.startsWith('http') ? cleaned : `https://${cleaned}`);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (parsed.hostname.toLowerCase() === 'wolfgrid.app') {
      parsed.hostname = 'wolfgrid.app';
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

function buildSharedDemoUrl(
  origin: string,
  referralCode: string | null,
  demoPath = DEMO_VIDEO_PATH,
  campaign = 'power-dialer-demo'
): string {
  if (!referralCode) return new URL(demoPath, origin).toString();

  const url = new URL(`/s/${encodeURIComponent(referralCode)}`, origin);
  url.searchParams.set('source', 'salesperson');
  url.searchParams.set('campaign', campaign);
  url.searchParams.set('redirect', demoPath);
  return url.toString();
}

function isBrokerageLead(lead: DiallerLead): boolean {
  const haystack = `${lead.name ?? ''} ${lead.company ?? ''}`.toLowerCase();
  return ['brokerage', 'realty', 'real estate office', 'realtor office', 'broker'].some((signal) =>
    haystack.includes(signal)
  );
}

function buildTextMessage(lead: DiallerLead, repName: string, demoUrl: string): string {
  const firstName = getFirstName(lead.name) || 'there';
  return [
    `Hey ${firstName}, it's ${repName} with WolfGrid.`,
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
    `Here is the quick 90-second WolfGrid demo I mentioned: ${demoUrl}`,
    '',
    'It shows how teams can automatically track field activity, manage leads, and keep agents accountable from one place.',
    '',
    'Reply here with any questions and I will get back to you.',
    '',
    'Thanks,',
    repName,
  ].join('\n');
}

function buildBrokerageEmailBody(
  lead: DiallerLead,
  repName: string,
  teamDemoUrl: string,
  listingDemoUrl: string,
  signupUrl: string
): string {
  const firstName = getFirstName(lead.name) || 'there';
  return [
    `Hey ${firstName},`,
    '',
    'It was great connecting with you.',
    '',
    'I wanted to send over two quick WolfGrid demos that might be useful for your brokerage:',
    '',
    `Demo 1 - Teams: ${teamDemoUrl}`,
    `Demo 2 - Individual Agent Listing: ${listingDemoUrl}`,
    '',
    `Agents can also start with one included campaign here: ${signupUrl}`,
    '',
    'I would be honoured if you shared this with any agents you think would benefit from it.',
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
    .from('sales_leads')
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
  const demoResult = await (async (): Promise<{
    demoUrl: string;
    trackedLink: Awaited<ReturnType<typeof createTrackedDemoLink>> | null;
  }> => {
    try {
      const generated = await generateDemoLinkForLead({
        admin: context.admin,
        leadId,
        user: context.requestUser,
      });
      const destination = new URL(generated.url);
      const trackedLink = await createTrackedDemoLink({
        admin: context.admin,
        origin,
        salesperson,
        workspaceId: context.workspaceId,
        lead: diallerLead,
        referralCode,
        source: 'salesperson',
        campaign: 'power-dialer-demo',
        destinationPath: destination.pathname,
      });
      return { demoUrl: trackedLink?.url ?? generated.url, trackedLink };
    } catch (generateError) {
      console.warn('[dialer/demo-message] demo engine link generation failed; falling back to tracked demo link', generateError);
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
      return { demoUrl: trackedLink?.url ?? buildSharedDemoUrl(origin, referralCode), trackedLink };
    }
  })();
  const { demoUrl, trackedLink } = demoResult;
  const listingDemoUrl = buildSharedDemoUrl(
    origin,
    referralCode,
    LISTING_DEMO_VIDEO_PATH,
    'individual-agent-listing'
  );
  const signupUrl = new URL('/onboarding', origin);
  signupUrl.searchParams.set('source', 'dialer');
  signupUrl.searchParams.set('campaign', 'brokerage-demo');
  if (referralCode) signupUrl.searchParams.set('referralCode', referralCode);
  const repName = getRepFirstName(salesperson?.full_name || context.requestUser.email);
  const template = payload.template === 'brokerage' || isBrokerageLead(diallerLead)
    ? 'brokerage'
    : 'default';

  return NextResponse.json({
    demoUrl,
    listingDemoUrl,
    demoLinkToken: trackedLink?.token ?? null,
    textBody: buildTextMessage(diallerLead, repName, demoUrl),
    emailSubject: template === 'brokerage'
      ? 'Two quick WolfGrid demos for your agents'
      : 'Quick WolfGrid demo',
    emailBody: template === 'brokerage'
      ? buildBrokerageEmailBody(diallerLead, repName, demoUrl, listingDemoUrl, signupUrl.toString())
      : buildEmailBody(diallerLead, repName, demoUrl),
    tracked: Boolean(trackedLink),
  });
}
