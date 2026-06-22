const REQUIRED_TWILIO_DIALER_ENV_NAMES = [
  'TWILIO_ACCOUNT_SID',
  'TWILIO_API_KEY_SID',
  'TWILIO_API_KEY_SECRET',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_TWIML_APP_SID',
  'TWILIO_DEFAULT_FROM_NUMBER',
] as const;

const REQUIRED_TELNYX_DIALER_ENV_NAMES = [
  'TELNYX_API_KEY',
  'TELNYX_DEFAULT_FROM_NUMBER',
  'TELNYX_CONNECTION_ID',
  'TELNYX_TELEPHONY_CREDENTIAL_ID',
] as const;

export type DialerTelecomProvider = 'twilio' | 'telnyx';

type DialerEnvName =
  | (typeof REQUIRED_TWILIO_DIALER_ENV_NAMES)[number]
  | (typeof REQUIRED_TELNYX_DIALER_ENV_NAMES)[number]
  | 'DIALER_TELECOM_PROVIDER'
  | 'DIALER_PROVIDER'
  | 'TWILIO_DEFAULT_SMS_FROM_NUMBER'
  | 'TWILIO_INBOUND_FORWARD_TO'
  | 'TWILIO_INBOUND_FALLBACK_MESSAGE'
  | 'TWILIO_IOS_PUSH_CREDENTIAL_SID'
  | 'TWILIO_VOICEMAIL_DROP_AUDIO_URL'
  | 'TWILIO_VOICEMAIL_DROP_MESSAGE'
  | 'TELNYX_PUBLIC_KEY'
  | 'TELNYX_DEFAULT_SMS_FROM_NUMBER'
  | 'TELNYX_INBOUND_FORWARD_TO'
  | 'TELNYX_INBOUND_FALLBACK_MESSAGE'
  | 'TELNYX_MESSAGING_PROFILE_ID'
  | 'TELNYX_CONNECTION_ID'
  | 'TELNYX_OUTBOUND_VOICE_PROFILE_ID'
  | 'TELNYX_TELEPHONY_CREDENTIAL_ID'
  | 'TELNYX_IOS_TELEPHONY_CREDENTIAL_ID'
  | 'TELNYX_IOS_PUSH_CREDENTIAL_ID'
  | 'TELNYX_SIP_USERNAME'
  | 'TELNYX_SIP_PASSWORD'
  | 'TELNYX_WEBHOOK_BASE_URL'
  | 'TELNYX_VOICEMAIL_DROP_MESSAGE'
  | 'DIALER_CANADA_FROM_NUMBER'
  | 'DIALER_US_FROM_NUMBER';

function normalizeEnvValue(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  let normalized = value.trim();
  while (
    normalized.length >= 2 &&
    ((normalized.startsWith('"') && normalized.endsWith('"')) ||
      (normalized.startsWith("'") && normalized.endsWith("'")))
  ) {
    normalized = normalized.slice(1, -1).trim();
  }

  if (!normalized) {
    return null;
  }

  const lowered = normalized.toLowerCase();
  if (lowered === 'null' || lowered === 'undefined') {
    return null;
  }

  return normalized;
}

function getEnvIssue(name: DialerEnvName): 'missing' | 'invalid' | null {
  const value = normalizeEnvValue(process.env[name]);

  if (!value) {
    return 'missing';
  }

  switch (name) {
    case 'TWILIO_ACCOUNT_SID':
      return /^AC[0-9a-fA-F]{32}$/.test(value) ? null : 'invalid';
    case 'TWILIO_API_KEY_SID':
      return /^SK[0-9a-fA-F]{32}$/.test(value) ? null : 'invalid';
    case 'TWILIO_TWIML_APP_SID':
      return /^AP[0-9a-fA-F]{32}$/.test(value) ? null : 'invalid';
    case 'TWILIO_IOS_PUSH_CREDENTIAL_SID':
      return /^CR[0-9a-fA-F]{32}$/.test(value) ? null : 'invalid';
    case 'TWILIO_DEFAULT_FROM_NUMBER':
    case 'TWILIO_DEFAULT_SMS_FROM_NUMBER':
    case 'TWILIO_INBOUND_FORWARD_TO':
    case 'TELNYX_DEFAULT_FROM_NUMBER':
    case 'TELNYX_DEFAULT_SMS_FROM_NUMBER':
    case 'TELNYX_INBOUND_FORWARD_TO':
    case 'DIALER_CANADA_FROM_NUMBER':
    case 'DIALER_US_FROM_NUMBER':
      return /^\+[1-9]\d{1,14}$/.test(value) ? null : 'invalid';
    case 'DIALER_TELECOM_PROVIDER':
    case 'DIALER_PROVIDER':
      return value === 'twilio' || value === 'telnyx' ? null : 'invalid';
    default:
      return null;
  }
}

function requireEnv(name: DialerEnvName): string {
  const value = normalizeEnvValue(process.env[name]);
  const issue = getEnvIssue(name);

  if (!value || issue === 'missing') {
    throw new Error(`${name} is required to use the web dialer.`);
  }

  if (issue === 'invalid') {
    throw new Error(`${name} is invalid for the web dialer.`);
  }

  return value;
}

function optionalEnv(name: DialerEnvName): string | null {
  const value = normalizeEnvValue(process.env[name]);
  return getEnvIssue(name) ? null : value;
}

export function getTwilioDialerEnvIssues(): string[] {
  return REQUIRED_TWILIO_DIALER_ENV_NAMES.flatMap((name) => {
    const issue = getEnvIssue(name);
    return issue ? [`${name} (${issue})`] : [];
  });
}

export function getDialerTelecomProvider(): DialerTelecomProvider {
  return (optionalEnv('DIALER_TELECOM_PROVIDER') ||
    optionalEnv('DIALER_PROVIDER') ||
    'telnyx') as DialerTelecomProvider;
}

export function getActiveDialerEnvIssues(): string[] {
  return getDialerTelecomProvider() === 'telnyx'
    ? getTelnyxDialerEnvIssues()
    : getTwilioDialerEnvIssues();
}

export function getTelnyxDialerEnvIssues(): string[] {
  return REQUIRED_TELNYX_DIALER_ENV_NAMES.flatMap((name) => {
    const issue = getEnvIssue(name);
    return issue ? [`${name} (${issue})`] : [];
  });
}

export function getTwilioAccountSid(): string {
  return requireEnv('TWILIO_ACCOUNT_SID');
}

export function getTwilioApiKeySid(): string {
  return requireEnv('TWILIO_API_KEY_SID');
}

export function getTwilioApiKeySecret(): string {
  return requireEnv('TWILIO_API_KEY_SECRET');
}

export function getTwilioAuthToken(): string {
  return requireEnv('TWILIO_AUTH_TOKEN');
}

export function getTwilioTwiMLAppSid(): string {
  return requireEnv('TWILIO_TWIML_APP_SID');
}

export function getTwilioDefaultFromNumber(): string {
  return requireEnv('TWILIO_DEFAULT_FROM_NUMBER');
}

export function getTwilioDefaultSmsFromNumber(): string | null {
  return optionalEnv('TWILIO_DEFAULT_SMS_FROM_NUMBER');
}

export function getTwilioInboundForwardTo(): string | null {
  return optionalEnv('TWILIO_INBOUND_FORWARD_TO');
}

export function getTwilioInboundFallbackMessage(): string {
  return (
    optionalEnv('TWILIO_INBOUND_FALLBACK_MESSAGE') ||
    'Thanks for calling FLYR. We are unavailable right now, so please leave a voicemail or try again shortly.'
  );
}

export function getTwilioIosPushCredentialSid(): string | null {
  return optionalEnv('TWILIO_IOS_PUSH_CREDENTIAL_SID');
}

export function getTwilioVoicemailDropAudioUrl(): string | null {
  return optionalEnv('TWILIO_VOICEMAIL_DROP_AUDIO_URL');
}

export function getTwilioVoicemailDropMessage(): string {
  return (
    optionalEnv('TWILIO_VOICEMAIL_DROP_MESSAGE') ||
    'Hi, this is FLYR. Sorry we missed you. Please give us a call back when you have a moment. Thank you.'
  );
}

export function getTelnyxApiKey(): string {
  return requireEnv('TELNYX_API_KEY');
}

export function getTelnyxPublicKey(): string | null {
  return optionalEnv('TELNYX_PUBLIC_KEY');
}

export function getTelnyxDefaultFromNumber(): string {
  return requireEnv('TELNYX_DEFAULT_FROM_NUMBER');
}

export function getTelnyxDefaultSmsFromNumber(): string | null {
  return optionalEnv('TELNYX_DEFAULT_SMS_FROM_NUMBER');
}

export function getTelnyxInboundForwardTo(): string | null {
  return optionalEnv('TELNYX_INBOUND_FORWARD_TO');
}

export function getTelnyxInboundFallbackMessage(): string {
  return (
    optionalEnv('TELNYX_INBOUND_FALLBACK_MESSAGE') ||
    'Thanks for calling FLYR. We are unavailable right now, so please leave a voicemail or try again shortly.'
  );
}

export function getTelnyxMessagingProfileId(): string | null {
  return optionalEnv('TELNYX_MESSAGING_PROFILE_ID');
}

export function getTelnyxConnectionId(): string | null {
  return optionalEnv('TELNYX_CONNECTION_ID');
}

export function getTelnyxOutboundVoiceProfileId(): string | null {
  return optionalEnv('TELNYX_OUTBOUND_VOICE_PROFILE_ID');
}

export function getTelnyxTelephonyCredentialId(): string | null {
  return optionalEnv('TELNYX_TELEPHONY_CREDENTIAL_ID');
}

export function getTelnyxIosTelephonyCredentialId(): string | null {
  return optionalEnv('TELNYX_IOS_TELEPHONY_CREDENTIAL_ID') || getTelnyxTelephonyCredentialId();
}

export function getTelnyxIosPushCredentialId(): string | null {
  return optionalEnv('TELNYX_IOS_PUSH_CREDENTIAL_ID');
}

export function getTelnyxSipUsername(): string | null {
  return optionalEnv('TELNYX_SIP_USERNAME');
}

export function getTelnyxSipPassword(): string | null {
  return optionalEnv('TELNYX_SIP_PASSWORD');
}

export function getTelnyxWebhookBaseUrl(): string | null {
  return optionalEnv('TELNYX_WEBHOOK_BASE_URL');
}

export function getTelnyxVoicemailDropMessage(): string {
  return (
    optionalEnv('TELNYX_VOICEMAIL_DROP_MESSAGE') ||
    'Hi, this is FLYR. Sorry we missed you. Please give us a call back when you have a moment. Thank you.'
  );
}

export function getDialerCanadaFromNumber(): string | null {
  return optionalEnv('DIALER_CANADA_FROM_NUMBER');
}

export function getDialerUsFromNumber(): string | null {
  return optionalEnv('DIALER_US_FROM_NUMBER');
}
