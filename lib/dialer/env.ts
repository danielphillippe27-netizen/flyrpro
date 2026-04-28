const REQUIRED_TWILIO_DIALER_ENV_NAMES = [
  'TWILIO_ACCOUNT_SID',
  'TWILIO_API_KEY_SID',
  'TWILIO_API_KEY_SECRET',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_TWIML_APP_SID',
  'TWILIO_DEFAULT_FROM_NUMBER',
] as const;

type DialerEnvName =
  | (typeof REQUIRED_TWILIO_DIALER_ENV_NAMES)[number]
  | 'TWILIO_DEFAULT_SMS_FROM_NUMBER'
  | 'TWILIO_INBOUND_FORWARD_TO'
  | 'TWILIO_INBOUND_FALLBACK_MESSAGE'
  | 'TWILIO_VOICEMAIL_DROP_AUDIO_URL'
  | 'TWILIO_VOICEMAIL_DROP_MESSAGE';

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
    case 'TWILIO_DEFAULT_FROM_NUMBER':
    case 'TWILIO_DEFAULT_SMS_FROM_NUMBER':
    case 'TWILIO_INBOUND_FORWARD_TO':
      return /^\+[1-9]\d{1,14}$/.test(value) ? null : 'invalid';
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

export function getTwilioVoicemailDropAudioUrl(): string | null {
  return optionalEnv('TWILIO_VOICEMAIL_DROP_AUDIO_URL');
}

export function getTwilioVoicemailDropMessage(): string {
  return (
    optionalEnv('TWILIO_VOICEMAIL_DROP_MESSAGE') ||
    'Hi, this is FLYR. Sorry we missed you. Please give us a call back when you have a moment. Thank you.'
  );
}
