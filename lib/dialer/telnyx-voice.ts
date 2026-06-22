import { NextRequest } from 'next/server';
import { getTelnyxInboundForwardTo } from '@/lib/dialer/env';
import { normalizePhoneNumber } from '@/lib/dialer/phone';
import {
  buildPublicTelnyxWebhookUrl,
  dialTelnyxCall,
  type TelnyxDialResult,
} from '@/lib/dialer/telnyx';

type TelnyxCallLaunchParams = {
  request: NextRequest;
  callId: string;
  callRequestId: string;
  fromNumber: string | null | undefined;
  toNumber: string | null | undefined;
  statusPayload?: Record<string, unknown> | null;
};

export type TelnyxCallLaunchResult = {
  agentDial: TelnyxDialResult;
  forwardTo: string;
  webhookUrl: string;
  statusPayload: Record<string, unknown>;
};

function getConfiguredForwardTo(): string | null {
  return normalizePhoneNumber(getTelnyxInboundForwardTo()).e164;
}

export function getTelnyxForwardToNumber(): string | null {
  return getConfiguredForwardTo();
}

export async function launchTelnyxBridgeCall(params: TelnyxCallLaunchParams): Promise<TelnyxCallLaunchResult> {
  const from = normalizePhoneNumber(params.fromNumber).e164;
  const leadTo = normalizePhoneNumber(params.toNumber).e164;
  const forwardTo = getConfiguredForwardTo();

  if (!from) {
    throw new Error('Telnyx caller ID is missing or invalid.');
  }
  if (!leadTo) {
    throw new Error('Lead phone number is missing or invalid.');
  }
  if (!forwardTo) {
    throw new Error('TELNYX_INBOUND_FORWARD_TO must be set to bridge backend calls.');
  }

  const webhookUrl = buildPublicTelnyxWebhookUrl(params.request, '/api/telnyx/voice/status').toString();
  const agentDial = await dialTelnyxCall({
    from,
    to: forwardTo,
    webhookUrl,
    clientState: {
      callRequestId: params.callRequestId,
      role: 'agent',
      direction: 'outbound',
      from,
      to: leadTo,
      forwardTo,
    },
    commandId: `${params.callRequestId}:agent`,
  });

  const statusPayload = {
    ...(params.statusPayload ?? {}),
    telnyx: {
      mode: 'backend_bridge',
      callId: params.callId,
      callRequestId: params.callRequestId,
      from,
      leadTo,
      forwardTo,
      webhookUrl,
      agentCallControlId: agentDial.callControlId,
      agentCallLegId: agentDial.callLegId,
      agentCallSessionId: agentDial.callSessionId,
      launchedAt: new Date().toISOString(),
    },
  };

  return {
    agentDial,
    forwardTo,
    webhookUrl,
    statusPayload,
  };
}
