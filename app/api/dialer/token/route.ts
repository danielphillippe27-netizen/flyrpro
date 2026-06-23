import { NextRequest, NextResponse } from 'next/server';
import { buildDialerIdentity, createDialerVoiceToken, getDialerRequestContext } from '@/lib/dialer/server';
import { getActiveDialerEnvIssues, getDialerTelecomProvider } from '@/lib/dialer/env';
import { getTelnyxWebRtcClientDestination } from '@/lib/dialer/telnyx-voice';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const workspaceId = request.nextUrl.searchParams.get('workspaceId');
  const tabId = request.nextUrl.searchParams.get('tabId') ?? 'web';
  const platform = request.nextUrl.searchParams.get('platform');
  const isIosVoiceClient = platform === 'ios';

  try {
    const context = await getDialerRequestContext(request, workspaceId);
    if (context instanceof NextResponse) {
      return context;
    }

    const activeProvider = getDialerTelecomProvider();
    if (isIosVoiceClient && activeProvider !== 'twilio' && activeProvider !== 'telnyx') {
      return NextResponse.json(
        {
          error: 'Native iOS calling requires a supported voice SDK provider.',
          provider: activeProvider,
        },
        { status: 400 }
      );
    }

    const identity = buildDialerIdentity(
      context.workspaceId,
      context.requestUser.id,
      isIosVoiceClient ? 'ios' : tabId
    );
    const allowIncoming = activeProvider === 'telnyx' || isIosVoiceClient;
    const {
      provider,
      token,
      expiresAt,
      pushCredentialSid,
      telnyxTelephonyCredentialId,
      telnyxPushCredentialId,
      telnyxSipUsername,
      telnyxSipPassword,
    } = await createDialerVoiceToken(identity, {
      allowIncoming,
      includeIosPushCredential: isIosVoiceClient,
    });
    const telnyxWebRtcInboundConfigured =
      provider === 'telnyx' ? Boolean(await getTelnyxWebRtcClientDestination()) : false;

    return NextResponse.json({
      provider,
      token,
      identity,
      expiresAt,
      incomingAllowed: provider === 'telnyx' ? telnyxWebRtcInboundConfigured || isIosVoiceClient : isIosVoiceClient,
      voipPushConfigured: provider === 'twilio'
        ? Boolean(pushCredentialSid)
        : Boolean(telnyxPushCredentialId),
      telnyxTelephonyCredentialId: telnyxTelephonyCredentialId ?? null,
      telnyxPushCredentialId: telnyxPushCredentialId ?? null,
      telnyxSipUsername: isIosVoiceClient ? telnyxSipUsername ?? null : null,
      telnyxSipPassword: isIosVoiceClient ? telnyxSipPassword ?? null : null,
      requiresTelnyxVoiceSdk: provider === 'telnyx',
      sdkTarget: provider === 'telnyx'
        ? isIosVoiceClient
          ? 'telnyx-ios'
          : 'telnyx-webrtc-js'
        : isIosVoiceClient
          ? 'twilio-ios'
          : 'twilio-voice-js',
      fromNumber: context.settings.defaultFromNumber,
      smsFromNumber: context.settings.defaultSmsFromNumber,
      allowSmsFollowup: context.settings.allowSmsFollowup,
      dialerAddonStatus: context.settings.dialerAddonStatus,
      usesSharedDefaultNumber: context.settings.usesSharedDefaultNumber,
    });
  } catch (error) {
    console.error('[dialer/token] failed to create dialer token', error);
    const envIssues = getActiveDialerEnvIssues();
    const provider = getDialerTelecomProvider();
    return NextResponse.json(
      {
        error:
          envIssues.length > 0
            ? `${provider === 'telnyx' ? 'Telnyx' : 'Twilio'} is not configured. Missing or invalid: ${envIssues.join(', ')}`
            : error instanceof Error
              ? error.message
              : `${provider === 'telnyx' ? 'Telnyx' : 'Twilio'} is not configured for this environment`,
      },
      { status: 500 }
    );
  }
}
