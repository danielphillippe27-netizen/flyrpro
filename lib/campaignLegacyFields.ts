export const LEGACY_CAMPAIGN_TEXT_PREFIX = '__FLYR_CAMPAIGN_TEXT_V1__';

export type LegacyCampaignText = {
  notes?: string;
  scripts?: string;
  flyerUrl?: string;
};

export function parseLegacyCampaignText(value: string | null | undefined): LegacyCampaignText {
  if (!value) return {};
  if (!value.startsWith(LEGACY_CAMPAIGN_TEXT_PREFIX)) return { notes: value };

  try {
    const parsed = JSON.parse(value.slice(LEGACY_CAMPAIGN_TEXT_PREFIX.length)) as {
      notes?: unknown;
      scripts?: unknown;
      flyerUrl?: unknown;
    };
    return {
      notes: typeof parsed.notes === 'string' ? parsed.notes : undefined,
      scripts: typeof parsed.scripts === 'string' ? parsed.scripts : undefined,
      flyerUrl: typeof parsed.flyerUrl === 'string' ? parsed.flyerUrl : undefined,
    };
  } catch {
    return { notes: value };
  }
}

export function buildLegacyCampaignText(payload: LegacyCampaignText): string {
  const compactPayload = {
    notes: payload.notes?.length ? payload.notes : null,
    scripts: payload.scripts?.length ? payload.scripts : null,
    flyerUrl: payload.flyerUrl?.length ? payload.flyerUrl : null,
  };

  if (!compactPayload.notes && !compactPayload.scripts && !compactPayload.flyerUrl) {
    return '';
  }

  return `${LEGACY_CAMPAIGN_TEXT_PREFIX}${JSON.stringify(compactPayload)}`;
}

export function isMissingCampaignColumnErrorMessage(
  message: string,
  column: 'notes' | 'scripts' | 'flyer_url'
): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes(column.toLowerCase()) &&
    (normalized.includes('does not exist') ||
      normalized.includes('schema cache') ||
      normalized.includes('could not find the') ||
      normalized.includes('column'))
  );
}
