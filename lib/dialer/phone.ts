import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/core';
import metadata from 'libphonenumber-js/metadata.min.json';

export type SupportedPhoneMarket = 'US' | 'CA' | 'ZA' | 'AU' | 'NZ';

export const SUPPORTED_PHONE_MARKETS: SupportedPhoneMarket[] = ['US', 'CA', 'ZA', 'AU', 'NZ'];

export const PHONE_MARKET_LABELS: Record<SupportedPhoneMarket, string> = {
  US: 'United States',
  CA: 'Canada',
  ZA: 'South Africa',
  AU: 'Australia',
  NZ: 'New Zealand',
};

export type PhoneNormalizationResult = {
  raw: string | null;
  e164: string | null;
  national: string | null;
  countryCode: string | null;
  areaCode: string | null;
  areaLabel: string | null;
  isValid: boolean;
  error: string | null;
};

function emptyResult(raw: string | null, error: string): PhoneNormalizationResult {
  return {
    raw,
    e164: null,
    national: null,
    countryCode: null,
    areaCode: null,
    areaLabel: null,
    isValid: false,
    error,
  };
}

export function normalizePhoneMarket(value: string | null | undefined): SupportedPhoneMarket {
  const upper = (value ?? '').trim().toUpperCase();
  return SUPPORTED_PHONE_MARKETS.includes(upper as SupportedPhoneMarket) ? upper as SupportedPhoneMarket : 'US';
}

export function phoneMarketFromCountryCode(value: string | null | undefined): SupportedPhoneMarket {
  return normalizePhoneMarket(value);
}

function nationalDigitsForArea(countryCode: string | null, nationalNumber: string): string {
  if (countryCode === 'US' || countryCode === 'CA') return nationalNumber;
  if (countryCode === 'ZA') return nationalNumber.length >= 2 ? `0${nationalNumber}` : nationalNumber;
  if (countryCode === 'AU' || countryCode === 'NZ') return nationalNumber.length >= 1 ? `0${nationalNumber}` : nationalNumber;
  return nationalNumber;
}

export function getPhoneAreaCode(countryCode: string | null | undefined, nationalNumber: string | null | undefined): string | null {
  const country = (countryCode ?? '').trim().toUpperCase();
  const digits = nationalDigitsForArea(country, (nationalNumber ?? '').replace(/\D/g, ''));

  if ((country === 'US' || country === 'CA') && digits.length >= 3) return digits.slice(0, 3);
  if (country === 'ZA' && digits.length >= 3) return digits.slice(0, 3);
  if ((country === 'AU' || country === 'NZ') && digits.length >= 2) return digits.slice(0, 2);

  return null;
}

export function getPhoneAreaLabel(countryCode: string | null | undefined, areaCode: string | null | undefined): string | null {
  const country = (countryCode ?? '').trim().toUpperCase() as SupportedPhoneMarket;
  const area = (areaCode ?? '').trim();
  if (!area) return null;
  const countryLabel = PHONE_MARKET_LABELS[country] ?? country;
  return countryLabel ? `${countryLabel} ${area}` : area;
}

export function normalizePhoneNumber(input: string | null | undefined, defaultCountry: SupportedPhoneMarket = 'US'): PhoneNormalizationResult {
  const raw = typeof input === 'string' ? input.trim() : '';
  if (!raw) {
    return emptyResult(null, 'Phone number is missing');
  }

  try {
    const parsed = parsePhoneNumberFromString(raw, normalizePhoneMarket(defaultCountry) as CountryCode, metadata);
    if (!parsed || !parsed.isValid()) {
      return emptyResult(raw, 'Phone number is invalid');
    }

    const countryCode = parsed.country ?? null;
    const areaCode = getPhoneAreaCode(countryCode, parsed.nationalNumber);
    return {
      raw,
      e164: parsed.number,
      national: parsed.formatNational(),
      countryCode,
      areaCode,
      areaLabel: getPhoneAreaLabel(countryCode, areaCode),
      isValid: true,
      error: null,
    };
  } catch {
    return emptyResult(raw, 'Phone number could not be parsed');
  }
}

export function formatPhoneDisplay(input: string | null | undefined): string {
  const normalized = normalizePhoneNumber(input);
  return normalized.national ?? input?.trim() ?? 'No phone';
}
