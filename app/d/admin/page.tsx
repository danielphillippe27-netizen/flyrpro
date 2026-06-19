import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

type DemoLinkRow = {
  slug: string;
  company: string | null;
  created_at: string | null;
};

type DemoEventRow = {
  slug: string;
  event: string;
  beat: number | null;
  meta: Record<string, unknown> | null;
  created_at: string;
};

type SummaryRow = {
  slug: string;
  company: string | null;
  opened: boolean;
  lastOpen: string | null;
  maxBeatReached: number | null;
  totalDwellSeconds: number;
  replays: number;
  phoneTaps: number;
  ctaClicked: boolean;
  ctaVariant: string | null;
  territoryCity: string | null;
  territoryCityAt: string | null;
};

async function loadRows() {
  const admin = createAdminClient();
  const [{ data: links, error: linksError }, { data: events, error: eventsError }] = await Promise.all([
    admin.from('demo_links').select('slug, company, created_at').order('created_at', { ascending: false }),
    admin.from('demo_events').select('slug, event, beat, meta, created_at').order('created_at', { ascending: false }),
  ]);

  if (linksError) {
    throw linksError;
  }

  if (eventsError) {
    throw eventsError;
  }

  return {
    links: (links ?? []) as DemoLinkRow[],
    events: (events ?? []) as DemoEventRow[],
  };
}

function asTime(value: string | null) {
  if (!value) return 'never';
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function aggregate(links: DemoLinkRow[], events: DemoEventRow[]): SummaryRow[] {
  const bySlug = new Map<string, SummaryRow>();

  for (const link of links) {
    bySlug.set(link.slug, {
      slug: link.slug,
      company: link.company,
      opened: false,
      lastOpen: null,
      maxBeatReached: null,
      totalDwellSeconds: 0,
      replays: 0,
      phoneTaps: 0,
      ctaClicked: false,
      ctaVariant: null,
      territoryCity: null,
      territoryCityAt: null,
    });
  }

  for (const event of events) {
    const current =
      bySlug.get(event.slug) ??
      ({
        slug: event.slug,
        company: null,
        opened: false,
        lastOpen: null,
        maxBeatReached: null,
        totalDwellSeconds: 0,
        replays: 0,
        phoneTaps: 0,
        ctaClicked: false,
        ctaVariant: null,
        territoryCity: null,
        territoryCityAt: null,
      } satisfies SummaryRow);

    if (event.event === 'open') {
      current.opened = true;
      if (!current.lastOpen || event.created_at > current.lastOpen) {
        current.lastOpen = event.created_at;
      }
    }

    if (!current.lastOpen || event.created_at > current.lastOpen) {
      current.lastOpen = event.created_at;
    }

    if (typeof event.beat === 'number') {
      current.maxBeatReached = Math.max(current.maxBeatReached ?? 0, event.beat);
    }

    // Dwell is an approximation: each heartbeat represents one visible 15-second interval.
    if (event.event === 'heartbeat') {
      current.totalDwellSeconds += 15;
    }

    if (event.event === 'replay') {
      current.replays += 1;
    }

    if (event.event === 'phone_tap') {
      current.phoneTaps += 1;
    }

    if (event.event === 'cta_click') {
      current.ctaClicked = true;
      const variant = event.meta?.variant;
      const city = event.meta?.city;
      current.ctaVariant = typeof variant === 'string' ? variant : current.ctaVariant;
      if (typeof city === 'string' && city.trim() && (!current.territoryCityAt || event.created_at > current.territoryCityAt)) {
        current.territoryCity = city;
        current.territoryCityAt = event.created_at;
      }
    }

    bySlug.set(event.slug, current);
  }

  return [...bySlug.values()].sort((a, b) => {
    if (!a.lastOpen && !b.lastOpen) return a.slug.localeCompare(b.slug);
    if (!a.lastOpen) return 1;
    if (!b.lastOpen) return -1;
    return b.lastOpen.localeCompare(a.lastOpen);
  });
}

export default async function DemoAdminPage() {
  let rows: SummaryRow[] = [];
  let error: string | null = null;

  try {
    const { links, events } = await loadRows();
    rows = aggregate(links, events);
  } catch (loadError) {
    console.error('[demo-admin] Failed to load analytics readout:', loadError);
    error = loadError instanceof Error ? loadError.message : 'Failed to load demo analytics.';
  }

  return (
    <main style={{ minHeight: '100dvh', padding: '8dvh 4vw', background: 'var(--ink)', color: 'var(--paper)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 18, alignItems: 'baseline', marginBottom: 28 }}>
        <div>
          <div style={{ color: 'var(--orange)', fontSize: 12, fontWeight: 700, letterSpacing: '.22em' }}>
            FLYR PRO · DEMO SENSOR
          </div>
          <h1
            style={{
              margin: '10px 0 0',
              fontFamily: 'var(--disp)',
              fontSize: 'clamp(38px, 7vw, 88px)',
              fontWeight: 900,
              fontStretch: '73%',
              lineHeight: .9,
              textTransform: 'uppercase',
            }}
          >
            Analytics
          </h1>
        </div>
        <Link href="/d/admin/new" style={linkButtonStyle}>
          New link
        </Link>
      </div>

      {error ? (
        <div style={{ border: '1px solid var(--red)', color: 'var(--red)', padding: 16 }}>{error}</div>
      ) : (
        <div style={{ overflowX: 'auto', border: '1px solid rgba(217,213,203,.3)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 920 }}>
            <thead>
              <tr>
                {[
                  'Company / Slug',
                  'Opened',
                  'Last Open',
                  'Max Beat',
                  'Dwell (s)',
                  'Replays',
                  'Phone Taps',
                  'CTA Clicked',
                  'Territory City',
                  'Preview',
                ].map(
                  (heading) => (
                    <th key={heading} style={thStyle}>
                      {heading}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.slug}>
                  <td style={tdStyle}>
                    <div style={{ color: row.company ? 'var(--paper)' : 'rgba(217,213,203,.45)' }}>
                      {row.company || 'Unknown'}
                    </div>
                    <div style={{ color: 'var(--orange)' }}>{row.slug}</div>
                  </td>
                  <td style={tdStyle}>{row.opened ? 'yes' : 'no'}</td>
                  <td style={tdStyle}>{asTime(row.lastOpen)}</td>
                  <td style={tdStyle}>{row.maxBeatReached ?? '-'}</td>
                  <td style={tdStyle}>{row.totalDwellSeconds}</td>
                  <td style={tdStyle}>{row.replays}</td>
                  <td style={tdStyle}>{row.phoneTaps}</td>
                  <td style={tdStyle}>{row.ctaClicked ? row.ctaVariant ?? 'yes' : 'no'}</td>
                  <td style={tdStyle}>{row.territoryCity ?? '-'}</td>
                  <td style={tdStyle}>
                    <Link href={`/d/${row.slug}`} target="_blank" style={{ color: 'var(--paper)' }}>
                      open
                    </Link>
                  </td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td style={tdStyle} colSpan={10}>
                    No demo links or events yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

const thStyle = {
  borderBottom: '1px solid rgba(217,213,203,.3)',
  color: 'var(--orange)',
  fontSize: 11,
  letterSpacing: '.16em',
  padding: '12px 14px',
  textAlign: 'left' as const,
  textTransform: 'uppercase' as const,
  whiteSpace: 'nowrap' as const,
};

const tdStyle = {
  borderBottom: '1px solid rgba(217,213,203,.16)',
  fontSize: 12,
  padding: '13px 14px',
  verticalAlign: 'top' as const,
  whiteSpace: 'nowrap' as const,
};

const linkButtonStyle = {
  border: '1px solid var(--orange)',
  color: 'var(--orange)',
  display: 'inline-flex',
  alignItems: 'center',
  minHeight: 44,
  padding: '10px 16px',
  textDecoration: 'none',
  textTransform: 'uppercase' as const,
  letterSpacing: '.16em',
  fontSize: 12,
  fontWeight: 700,
};
