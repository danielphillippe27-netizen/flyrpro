import { getDialerCanadaFromNumber, getDialerUsFromNumber } from '@/lib/dialer/env';
import { normalizePhoneNumber } from '@/lib/dialer/phone';

const CANADA_CALLER_ID_COUNTRIES = new Set(['CA', 'AU', 'NZ', 'ZA']);

export function resolveOutboundCallerId(params: {
  toNumber: string | null | undefined;
  defaultFromNumber: string;
}): string {
  const destination = normalizePhoneNumber(params.toNumber);

  if (destination.countryCode && CANADA_CALLER_ID_COUNTRIES.has(destination.countryCode)) {
    return getDialerCanadaFromNumber() || params.defaultFromNumber;
  }

  if (destination.countryCode === 'US') {
    return getDialerUsFromNumber() || params.defaultFromNumber;
  }

  return params.defaultFromNumber;
}
