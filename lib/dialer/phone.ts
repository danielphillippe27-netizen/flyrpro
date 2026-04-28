import { parsePhoneNumberFromString } from 'libphonenumber-js/min';

export type PhoneNormalizationResult = {
  raw: string | null;
  e164: string | null;
  national: string | null;
  isValid: boolean;
  error: string | null;
};

export function normalizePhoneNumber(input: string | null | undefined, defaultCountry: 'US' | 'CA' = 'US'): PhoneNormalizationResult {
  const raw = typeof input === 'string' ? input.trim() : '';
  if (!raw) {
    return {
      raw: null,
      e164: null,
      national: null,
      isValid: false,
      error: 'Phone number is missing',
    };
  }

  try {
    const parsed = parsePhoneNumberFromString(raw, defaultCountry);
    if (!parsed || !parsed.isValid()) {
      return {
        raw,
        e164: null,
        national: null,
        isValid: false,
        error: 'Phone number is invalid',
      };
    }

    return {
      raw,
      e164: parsed.number,
      national: parsed.formatNational(),
      isValid: true,
      error: null,
    };
  } catch {
    return {
      raw,
      e164: null,
      national: null,
      isValid: false,
      error: 'Phone number could not be parsed',
    };
  }
}

export function formatPhoneDisplay(input: string | null | undefined): string {
  const normalized = normalizePhoneNumber(input);
  return normalized.national ?? input?.trim() ?? 'No phone';
}
