export interface AddressCardEngagement {
  address_id: string;
  shares: number;
  opens: number;
  clicks: number;
  downloads: number;
}

export function emptyCardEngagement(address_id: string): AddressCardEngagement {
  return { address_id, shares: 0, opens: 0, clicks: 0, downloads: 0 };
}

export function addCardEvent(row: AddressCardEngagement, type: string) {
  if (type === 'qualified_open') row.opens++;
  else if (type === 'contact_downloaded') row.downloads++;
  else if (type.endsWith('_clicked') || type === 'referral_started') row.clicks++;
}

/** Union by the same logical address identity used by the campaign table. */
export function campaignEngagement<T extends { id: string; scans?: number | null; last_scanned_at?: string | null }>(
  addresses: T[], cards: AddressCardEngagement[], key: (address: T) => string
) {
  const keys = new Map(addresses.map(address => [address.id, key(address)]));
  const engaged = new Set(addresses.filter(a => Number(a.scans) > 0 || a.last_scanned_at).map(key));
  const byAddress = new Map<string, AddressCardEngagement>();
  for (const card of cards) {
    const logicalKey = keys.get(card.address_id);
    if (!logicalKey) continue;
    const row = byAddress.get(logicalKey) ?? emptyCardEngagement(card.address_id);
    row.shares += card.shares;
    row.opens += card.opens;
    row.clicks += card.clicks;
    row.downloads += card.downloads;
    byAddress.set(logicalKey, row);
    if (card.opens + card.clicks + card.downloads > 0) engaged.add(logicalKey);
  }
  const total = new Set(keys.values()).size;
  return { byAddress, engaged: engaged.size, rate: total ? Math.round(engaged.size / total * 100) : 0 };
}

export interface CardActivityTotals {
  opens: number;
  clicks: number;
  downloads: number;
}

/** An action also creates a qualified_open. Count open-only visits separately
 * so that synthetic opens never inflate the headline. Keep every button action. */
export function cardActivityCounter() {
  const opens = new Set<string>();
  const actions = new Set<string>();
  let clicks = 0;
  let downloads = 0;
  return {
    add(event: { share_id: string; visit_id: string; event_type: string }) {
      const visit = `${event.share_id}:${event.visit_id}`;
      if (event.event_type === 'qualified_open') opens.add(visit);
      else if (event.event_type === 'contact_downloaded') {
        downloads++;
        actions.add(visit);
      } else if (event.event_type.endsWith('_clicked') || event.event_type === 'referral_started') {
        clicks++;
        actions.add(visit);
      }
    },
    totals(): CardActivityTotals {
      return { opens: [...opens].filter(visit => !actions.has(visit)).length, clicks, downloads };
    },
  };
}
