import { NextRequest } from 'next/server';
import twilio from 'twilio';
import {
  getDialerTelecomProvider,
  getTwilioAccountSid,
  getTwilioAuthToken,
  type DialerTelecomProvider,
} from '@/lib/dialer/env';
import { buildPublicTwilioWebhookUrl } from '@/lib/dialer/server';
import { buildPublicTelnyxWebhookUrl, provisionTelnyxPhoneNumber, sendTelnyxSms } from '@/lib/dialer/telnyx';

export type DialerSmsSendResult = {
  provider: DialerTelecomProvider;
  messageId: string;
  status: string;
  raw: Record<string, unknown>;
};

export type DialerProvisionedNumber = {
  provider: DialerTelecomProvider;
  phoneNumber: string;
  providerPhoneNumberId: string | null;
  providerNumberOrderId: string | null;
  twilioIncomingPhoneNumberSid: string | null;
  locality: string | null;
  region: string | null;
  metadata: Record<string, unknown>;
};

export async function sendDialerSms(
  request: NextRequest,
  params: {
    from: string;
    to: string;
    body: string;
  }
): Promise<DialerSmsSendResult> {
  if (getDialerTelecomProvider() === 'telnyx') {
    const message = await sendTelnyxSms({
      ...params,
      webhookUrl: buildPublicTelnyxWebhookUrl(request, '/api/telnyx/messaging/status').toString(),
    });
    return {
      provider: 'telnyx',
      messageId: message.id,
      status: message.status,
      raw: message.raw,
    };
  }

  const client = twilio(getTwilioAccountSid(), getTwilioAuthToken());
  const statusCallback = buildPublicTwilioWebhookUrl(request, '/api/twilio/messaging/status');
  const message = await client.messages.create({
    from: params.from,
    to: params.to,
    body: params.body,
    statusCallback: statusCallback.toString(),
  });

  return {
    provider: 'twilio',
    messageId: message.sid,
    status: message.status ?? 'queued',
    raw: {
      sid: message.sid,
      status: message.status ?? 'queued',
    },
  };
}

export async function provisionDialerPhoneNumber(params: {
  countryCode: string;
  areaCode?: number;
  friendlyName: string;
  voiceUrl: string;
  smsUrl: string;
  statusCallback: string;
}): Promise<DialerProvisionedNumber> {
  if (getDialerTelecomProvider() === 'telnyx') {
    const purchased = await provisionTelnyxPhoneNumber({
      countryCode: params.countryCode,
      areaCode: params.areaCode,
    });
    return {
      provider: 'telnyx',
      phoneNumber: purchased.phoneNumber,
      providerPhoneNumberId: purchased.providerPhoneNumberId,
      providerNumberOrderId: purchased.orderId,
      twilioIncomingPhoneNumberSid: null,
      locality: purchased.locality,
      region: purchased.region,
      metadata: purchased.raw,
    };
  }

  const client = twilio(getTwilioAccountSid(), getTwilioAuthToken());
  const search =
    params.areaCode && ['US', 'CA'].includes(params.countryCode)
      ? { areaCode: params.areaCode, limit: 1, smsEnabled: true, voiceEnabled: true }
      : { limit: 1, smsEnabled: true, voiceEnabled: true };
  const candidates = await client.availablePhoneNumbers(params.countryCode).local.list(search);
  const candidate = candidates[0];
  if (!candidate?.phoneNumber) {
    throw new Error('No available Twilio local numbers matched that search.');
  }

  const purchasedNumber = await client.incomingPhoneNumbers.create({
    phoneNumber: candidate.phoneNumber,
    friendlyName: params.friendlyName,
    voiceUrl: params.voiceUrl,
    voiceMethod: 'POST',
    smsUrl: params.smsUrl,
    smsMethod: 'POST',
    statusCallback: params.statusCallback,
    statusCallbackMethod: 'POST',
  });

  return {
    provider: 'twilio',
    phoneNumber: purchasedNumber.phoneNumber,
    providerPhoneNumberId: purchasedNumber.sid,
    providerNumberOrderId: null,
    twilioIncomingPhoneNumberSid: purchasedNumber.sid,
    locality: candidate.locality ?? null,
    region: candidate.region ?? null,
    metadata: {
      candidate,
      purchasedNumber: {
        sid: purchasedNumber.sid,
        phoneNumber: purchasedNumber.phoneNumber,
      },
    },
  };
}
