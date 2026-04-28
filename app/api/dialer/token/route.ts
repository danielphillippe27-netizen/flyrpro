import { NextRequest, NextResponse } from 'next/server';
import { buildDialerIdentity, createTwilioVoiceToken, getDialerRequestContext } from '@/lib/dialer/server';
import { getTwilioDialerEnvIssues } from '@/lib/dialer/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const workspaceId = request.nextUrl.searchParams.get('workspaceId');
  const tabId = request.nextUrl.searchParams.get('tabId') ?? 'web';

  try {
    const context = await getDialerRequestContext(request, workspaceId);
    if (context instanceof NextResponse) {
      return context;
    }

    const identity = buildDialerIdentity(context.workspaceId, context.requestUser.id, tabId);
    const { token, expiresAt } = createTwilioVoiceToken(identity);

    return NextResponse.json({
      token,
      identity,
      expiresAt,
      fromNumber: context.settings.defaultFromNumber,
      smsFromNumber: context.settings.defaultSmsFromNumber,
      allowSmsFollowup: context.settings.allowSmsFollowup,
      dialerAddonStatus: context.settings.dialerAddonStatus,
      usesSharedDefaultNumber: context.settings.usesSharedDefaultNumber,
    });
  } catch (error) {
    console.error('[dialer/token] failed to create Twilio token', error);
    const envIssues = getTwilioDialerEnvIssues();
    return NextResponse.json(
      {
        error:
          envIssues.length > 0
            ? `Twilio is not configured. Missing or invalid: ${envIssues.join(', ')}`
            : error instanceof Error
              ? error.message
              : 'Twilio is not configured for this environment',
      },
      { status: 500 }
    );
  }
}
