import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import {
  getTelnyxApiKey,
  getTelnyxConnectionId,
  getTelnyxMessagingProfileId,
  getTelnyxPublicKey,
  getTelnyxTelephonyCredentialId,
  getTelnyxWebhookBaseUrl,
} from '@/lib/dialer/env';

const TELNYX_API_BASE_URL = 'https://api.telnyx.com/v2';
const ED25519_SPKI_DER_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

type TelnyxApiEnvelope<T> = {
  data?: T;
  errors?: Array<{ title?: string; detail?: string; code?: string }>;
};

export type TelnyxSmsResult = {
  id: string;
  status: string;
  raw: Record<string, unknown>;
};

export type TelnyxProvisionedNumber = {
  phoneNumber: string;
  providerPhoneNumberId: string | null;
  orderId: string | null;
  raw: Record<string, unknown>;
  locality: string | null;
  region: string | null;
};

export type TelnyxWebhookValidationResult = {
  isValid: boolean;
  response?: NextResponse;
  body: Record<string, unknown>;
  rawBody: string;
};

export type TelnyxVoiceClientState = {
  callRequestId?: string;
  role?: 'agent' | 'lead' | 'inbound';
  direction?: 'outbound' | 'inbound';
  to?: string | null;
  from?: string | null;
  forwardTo?: string | null;
};

export type TelnyxDialResult = {
  callControlId: string | null;
  callLegId: string | null;
  callSessionId: string | null;
  raw: Record<string, unknown>;
};

function normalizeBaseUrl(value: string | null | undefined): string | null {
  const cleaned = value?.trim().replace(/\/$/, '');
  if (!cleaned) return null;
  const url = cleaned.startsWith('http') ? cleaned : `https://${cleaned}`;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return null;
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') return null;
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

function getTelnyxErrorMessage(payload: unknown, fallback: string): string {
  const envelope = payload as TelnyxApiEnvelope<unknown>;
  const error = envelope.errors?.[0];
  return error?.detail?.trim() || error?.title?.trim() || fallback;
}

async function telnyxFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${TELNYX_API_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${getTelnyxApiKey()}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const payload = (await response.json().catch(() => ({}))) as TelnyxApiEnvelope<T>;
  if (!response.ok) {
    throw new Error(getTelnyxErrorMessage(payload, `Telnyx request failed with ${response.status}`));
  }
  return payload.data as T;
}

async function telnyxFetchRaw(path: string, init?: RequestInit): Promise<string> {
  const response = await fetch(`${TELNYX_API_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${getTelnyxApiKey()}`,
      Accept: 'application/json, text/plain',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const text = await response.text();
  if (!response.ok) {
    let payload: unknown = null;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
    throw new Error(getTelnyxErrorMessage(payload, text || `Telnyx request failed with ${response.status}`));
  }
  return text;
}

export function encodeTelnyxClientState(state: TelnyxVoiceClientState): string {
  return Buffer.from(JSON.stringify(state)).toString('base64');
}

export function decodeTelnyxClientState(value: unknown): TelnyxVoiceClientState {
  if (typeof value !== 'string' || !value.trim()) return {};

  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64').toString('utf8')) as unknown;
    return parsed && typeof parsed === 'object' ? parsed as TelnyxVoiceClientState : {};
  } catch {
    return {};
  }
}

export function buildPublicTelnyxWebhookUrl(request: NextRequest, path: string): URL {
  const baseUrl =
    normalizeBaseUrl(getTelnyxWebhookBaseUrl()) ||
    normalizeBaseUrl(process.env.NEXT_PUBLIC_APP_URL) ||
    normalizeBaseUrl(process.env.APP_BASE_URL) ||
    normalizeBaseUrl(process.env.VERCEL_URL) ||
    normalizeBaseUrl(request.nextUrl.origin) ||
    'https://flyrpro.app';

  return new URL(path, baseUrl);
}

function createEd25519PublicKey(publicKey: string): crypto.KeyObject {
  const trimmed = publicKey.trim();
  const body = trimmed
    .replace(/-----BEGIN PUBLIC KEY-----/g, '')
    .replace(/-----END PUBLIC KEY-----/g, '')
    .replace(/\s/g, '');
  const raw = Buffer.from(body, 'base64');
  const der = raw.length === 32 ? Buffer.concat([ED25519_SPKI_DER_PREFIX, raw]) : raw;
  return crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
}

export async function validateTelnyxWebhookRequest(request: NextRequest): Promise<TelnyxWebhookValidationResult> {
  const rawBody = await request.text();
  const body = (rawBody ? JSON.parse(rawBody) : {}) as Record<string, unknown>;
  const publicKey = getTelnyxPublicKey();

  if (!publicKey) {
    return {
      isValid: false,
      response: NextResponse.json({ error: 'Missing Telnyx public key' }, { status: 401 }),
      body,
      rawBody,
    };
  }

  const signature = request.headers.get('telnyx-signature-ed25519');
  const timestamp = request.headers.get('telnyx-timestamp');
  if (!signature || !timestamp) {
    return {
      isValid: false,
      response: NextResponse.json({ error: 'Missing Telnyx signature' }, { status: 401 }),
      body,
      rawBody,
    };
  }

  const signedPayload = Buffer.from(`${timestamp}|${rawBody}`);
  const isValid = crypto.verify(
    null,
    signedPayload,
    createEd25519PublicKey(publicKey),
    Buffer.from(signature, 'base64')
  );

  return {
    isValid,
    response: isValid ? undefined : NextResponse.json({ error: 'Invalid Telnyx signature' }, { status: 401 }),
    body,
    rawBody,
  };
}

export async function sendTelnyxSms(params: {
  from: string;
  to: string;
  body: string;
  webhookUrl: string;
}): Promise<TelnyxSmsResult> {
  const data = await telnyxFetch<Record<string, unknown>>('/messages', {
    method: 'POST',
    body: JSON.stringify({
      from: params.from,
      to: params.to,
      text: params.body,
      webhook_url: params.webhookUrl,
      use_profile_webhooks: false,
      ...(getTelnyxMessagingProfileId() ? { messaging_profile_id: getTelnyxMessagingProfileId() } : {}),
    }),
  });

  return {
    id: String(data.id ?? data.message_id ?? ''),
    status: String(data.status ?? 'queued'),
    raw: data,
  };
}

export async function createTelnyxVoiceToken(): Promise<{
  token: string;
  expiresAt: string;
  telephonyCredentialId: string;
}>;
export async function createTelnyxVoiceToken(options?: {
  telephonyCredentialId?: string | null;
}): Promise<{
  token: string;
  expiresAt: string;
  telephonyCredentialId: string;
}> {
  const credentialId = options?.telephonyCredentialId || getTelnyxTelephonyCredentialId();
  if (!credentialId) {
    throw new Error('TELNYX_TELEPHONY_CREDENTIAL_ID is required to create Telnyx WebRTC tokens.');
  }

  const rawTokenResponse = await telnyxFetchRaw(`/telephony_credentials/${credentialId}/token`, {
    method: 'POST',
  });
  let token = rawTokenResponse.trim();
  let expiresAt: string | null = null;
  try {
    const data = JSON.parse(rawTokenResponse) as Record<string, unknown>;
    const nested = data.data && typeof data.data === 'object' ? data.data as Record<string, unknown> : {};
    token = String(data.token ?? data.jwt ?? data.login_token ?? nested.token ?? nested.jwt ?? nested.login_token ?? '').trim();
    expiresAt = typeof data.expires_at === 'string'
      ? data.expires_at
      : typeof nested.expires_at === 'string'
        ? nested.expires_at
        : null;
  } catch {
    // Telnyx returns the JWT as plain text for this endpoint.
  }
  if (!token) {
    throw new Error('Telnyx did not return a WebRTC token.');
  }

  expiresAt = expiresAt ?? new Date(Date.now() + 60 * 55 * 1000).toISOString();

  return { token, expiresAt, telephonyCredentialId: credentialId };
}

function parseTelnyxDialResult(data: Record<string, unknown>): TelnyxDialResult {
  return {
    callControlId: typeof data.call_control_id === 'string' ? data.call_control_id : null,
    callLegId: typeof data.call_leg_id === 'string' ? data.call_leg_id : null,
    callSessionId: typeof data.call_session_id === 'string' ? data.call_session_id : null,
    raw: data,
  };
}

export async function dialTelnyxCall(params: {
  from: string;
  to: string;
  connectionId?: string | null;
  webhookUrl?: string | null;
  clientState?: TelnyxVoiceClientState;
  commandId?: string;
  linkTo?: string | null;
  bridgeIntent?: boolean;
  bridgeOnAnswer?: boolean;
  record?: 'record-from-answer';
}): Promise<TelnyxDialResult> {
  const data = await telnyxFetch<Record<string, unknown>>('/calls', {
    method: 'POST',
    body: JSON.stringify({
      connection_id: params.connectionId || getTelnyxConnectionId(),
      from: params.from,
      to: params.to,
      ...(params.webhookUrl ? { webhook_url: params.webhookUrl, webhook_url_method: 'POST' } : {}),
      ...(params.clientState ? { client_state: encodeTelnyxClientState(params.clientState) } : {}),
      ...(params.commandId ? { command_id: params.commandId } : {}),
      ...(params.linkTo ? { link_to: params.linkTo } : {}),
      ...(params.bridgeIntent ? { bridge_intent: true } : {}),
      ...(params.bridgeOnAnswer ? { bridge_on_answer: true } : {}),
      ...(params.record ? { record: params.record, record_channels: 'dual', record_format: 'mp3' } : {}),
    }),
  });

  return parseTelnyxDialResult(data);
}

export async function answerTelnyxCall(callControlId: string, params?: {
  clientState?: TelnyxVoiceClientState;
  commandId?: string;
  record?: 'record-from-answer';
}): Promise<Record<string, unknown>> {
  return telnyxFetch<Record<string, unknown>>(`/calls/${encodeURIComponent(callControlId)}/actions/answer`, {
    method: 'POST',
    body: JSON.stringify({
      ...(params?.clientState ? { client_state: encodeTelnyxClientState(params.clientState) } : {}),
      ...(params?.commandId ? { command_id: params.commandId } : {}),
      ...(params?.record ? { record: params.record, record_channels: 'dual', record_format: 'mp3' } : {}),
    }),
  });
}

export async function transferTelnyxCall(callControlId: string, params: {
  to: string;
  from?: string | null;
  clientState?: TelnyxVoiceClientState;
  commandId?: string;
  timeoutSecs?: number;
}): Promise<Record<string, unknown>> {
  return telnyxFetch<Record<string, unknown>>(`/calls/${encodeURIComponent(callControlId)}/actions/transfer`, {
    method: 'POST',
    body: JSON.stringify({
      to: params.to,
      ...(params.from ? { from: params.from } : {}),
      ...(params.clientState ? { client_state: encodeTelnyxClientState(params.clientState) } : {}),
      ...(params.commandId ? { command_id: params.commandId } : {}),
      ...(params.timeoutSecs ? { timeout_secs: params.timeoutSecs } : {}),
    }),
  });
}

export async function hangupTelnyxCall(callControlId: string, params?: {
  commandId?: string;
}): Promise<Record<string, unknown>> {
  return telnyxFetch<Record<string, unknown>>(`/calls/${encodeURIComponent(callControlId)}/actions/hangup`, {
    method: 'POST',
    body: JSON.stringify({
      ...(params?.commandId ? { command_id: params.commandId } : {}),
    }),
  });
}

export async function provisionTelnyxPhoneNumber(params: {
  countryCode: string;
  areaCode?: number;
}): Promise<TelnyxProvisionedNumber> {
  const search = new URLSearchParams();
  search.set('filter[country_code]', params.countryCode);
  search.set('filter[phone_number_type]', 'local');
  search.append('filter[features][]', 'sms');
  search.append('filter[features][]', 'voice');
  search.set('limit', '1');
  if (params.areaCode && ['US', 'CA'].includes(params.countryCode)) {
    search.set('filter[national_destination_code]', String(params.areaCode));
  }

  const numbers = await telnyxFetch<Array<Record<string, unknown>>>(`/available_phone_numbers?${search.toString()}`);
  const candidate = numbers[0];
  const phoneNumber = String(candidate?.phone_number ?? '');
  if (!phoneNumber) {
    throw new Error('No available Telnyx local numbers matched that search.');
  }

  const order = await telnyxFetch<Record<string, unknown>>('/number_orders', {
    method: 'POST',
    body: JSON.stringify({
      phone_numbers: [{ phone_number: phoneNumber }],
      ...(getTelnyxConnectionId() ? { connection_id: getTelnyxConnectionId() } : {}),
      ...(getTelnyxMessagingProfileId() ? { messaging_profile_id: getTelnyxMessagingProfileId() } : {}),
    }),
  });

  return {
    phoneNumber,
    providerPhoneNumberId: String(candidate.id ?? '') || null,
    orderId: String(order.id ?? '') || null,
    raw: { candidate, order },
    locality: typeof candidate.locality === 'string' ? candidate.locality : null,
    region: typeof candidate.region === 'string' ? candidate.region : null,
  };
}
