export const DEMO_EMAIL_DOMAIN = 'wolfgrid.app';
export const DEMO_EMAIL_HANDLE_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;

export type DemoEmailSalesperson = {
  id?: string | null;
  full_name?: string | null;
  email?: string | null;
  demo_email_handle?: string | null;
};

export type HandleLookupClient = {
  from: (table: 'salespeople') => {
    select: (columns: string) => {
      in: (column: string, values: string[]) => unknown;
    };
  };
};

function cleanText(value: string | null | undefined): string {
  return (value ?? '').trim();
}

function cleanToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => DEMO_EMAIL_HANDLE_PATTERN.test(value))));
}

export function normalizeDemoEmailHandle(value: string | null | undefined): string | null {
  const cleaned = cleanText(value).toLowerCase();
  if (!cleaned) return null;
  return cleaned.replace(new RegExp(`@${DEMO_EMAIL_DOMAIN.replace('.', '\\.')}$`, 'i'), '');
}

export function buildDemoEmailHandleCandidates(
  salesperson: DemoEmailSalesperson | null,
  userEmail: string | null | undefined
): string[] {
  const fullNameParts = cleanText(salesperson?.full_name)
    .split(/\s+/)
    .filter(Boolean);
  const emailLocalParts = cleanText(salesperson?.email || userEmail)
    .split('@')[0]
    .split(/[._+-]+/)
    .filter(Boolean);

  const first = cleanToken(fullNameParts[0] || emailLocalParts[0] || 'demo');
  const lastInitial = cleanToken(fullNameParts[1]?.[0] || emailLocalParts[1]?.[0] || '');
  const fullNameCompact = cleanToken(fullNameParts.join(''));
  const emailCompact = cleanToken(emailLocalParts.join(''));

  const base = first || 'demo';
  const candidates = unique([
    base,
    lastInitial ? `${base}${lastInitial}` : '',
    fullNameCompact,
    emailCompact,
    'demo',
  ]).map((candidate) => candidate.slice(0, 64));

  const numberedBase = candidates[1] || candidates[0] || 'demo';
  for (let index = 2; index <= 20; index += 1) {
    candidates.push(`${numberedBase}${index}`.slice(0, 64));
  }

  return unique(candidates);
}

export function buildFallbackDemoEmailHandle(
  salesperson: DemoEmailSalesperson | null,
  userEmail: string | null | undefined
): string {
  return buildDemoEmailHandleCandidates(salesperson, userEmail)[0] || 'demo';
}

export async function resolveAvailableDemoEmailHandle(
  admin: HandleLookupClient,
  salesperson: DemoEmailSalesperson | null,
  userEmail: string | null | undefined
): Promise<string> {
  const existingHandle = normalizeDemoEmailHandle(salesperson?.demo_email_handle);
  if (existingHandle && DEMO_EMAIL_HANDLE_PATTERN.test(existingHandle)) return existingHandle;

  const candidates = buildDemoEmailHandleCandidates(salesperson, userEmail);
  if (candidates.length === 0) return 'demo';

  let query = admin
    .from('salespeople')
    .select('demo_email_handle')
    .in('demo_email_handle', candidates) as {
      neq?: (column: string, value: string) => unknown;
      then: PromiseLike<{ data: Array<{ demo_email_handle: string | null }> | null; error: unknown }>['then'];
    };

  if (salesperson?.id && typeof query.neq === 'function') {
    query = query.neq('id', salesperson.id) as typeof query;
  }

  const { data, error } = await query;
  if (error) return candidates[0] || 'demo';

  const taken = new Set(
    (data ?? [])
      .map((row) => normalizeDemoEmailHandle(row.demo_email_handle))
      .filter((handle): handle is string => Boolean(handle))
  );

  return candidates.find((candidate) => !taken.has(candidate)) ?? candidates[0] ?? 'demo';
}
