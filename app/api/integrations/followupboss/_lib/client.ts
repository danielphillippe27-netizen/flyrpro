const FUB_API_BASE = 'https://api.followupboss.com/v1';

const PERSON_NOT_READY_PATTERNS = [
  /contact not found/i,
  /person not found/i,
  /record not found/i,
];

export { FUB_API_BASE };

export function isTransientPersonAvailabilityError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return PERSON_NOT_READY_PATTERNS.some((pattern) => pattern.test(message));
}

export async function withFubPersonRetry<T>(
  action: () => Promise<T>,
  options: {
    attempts?: number;
    initialDelayMs?: number;
  } = {}
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 5);
  let delayMs = Math.max(100, options.initialDelayMs ?? 400);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      if (attempt >= attempts || !isTransientPersonAvailabilityError(error)) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      delayMs *= 2;
    }
  }

  throw new Error('FUB retry loop exited unexpectedly');
}

export function extractPersonId(payload: unknown): number | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const obj = payload as Record<string, unknown>;

  const direct = obj.personId;
  if (direct != null && Number.isFinite(Number(direct))) {
    return Number(direct);
  }

  const person = obj.person;
  if (person && typeof person === 'object') {
    const id = (person as Record<string, unknown>).id;
    if (id != null && Number.isFinite(Number(id))) {
      return Number(id);
    }
  }

  const nested = obj.data;
  if (nested && typeof nested === 'object') {
    return extractPersonId(nested);
  }

  return undefined;
}

export function extractPersonIdFromPeopleSearch(payload: unknown): number | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const people = (payload as { people?: unknown }).people;
  if (!Array.isArray(people) || people.length === 0) return undefined;
  const first = people[0];
  if (!first || typeof first !== 'object') return undefined;
  const id = (first as { id?: unknown }).id;
  if (id == null || !Number.isFinite(Number(id))) return undefined;
  return Number(id);
}

export async function resolvePersonIdByContact(
  headers: Record<string, string>,
  details: {
    email?: string | null;
    phone?: string | null;
  }
): Promise<number | undefined> {
  const email = details.email?.trim();
  if (email) {
    const res = await fetch(
      `${FUB_API_BASE}/people?email=${encodeURIComponent(email)}&limit=1&fields=id`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
      }
    );
    if (res.ok) {
      const data = (await res.json()) as unknown;
      const personId = extractPersonIdFromPeopleSearch(data);
      if (personId != null) return personId;
    }
  }

  const phone = details.phone?.trim();
  if (phone) {
    const res = await fetch(
      `${FUB_API_BASE}/people?phone=${encodeURIComponent(phone)}&limit=1&fields=id`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
      }
    );
    if (res.ok) {
      const data = (await res.json()) as unknown;
      const personId = extractPersonIdFromPeopleSearch(data);
      if (personId != null) return personId;
    }
  }

  return undefined;
}

export async function getCurrentUserId(headers: Record<string, string>): Promise<number | undefined> {
  const res = await fetch(`${FUB_API_BASE}/me`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `FUB /me returned ${res.status}`);
  }

  const data = (await res.json()) as { id?: number | string };
  const id = data?.id;
  if (id == null || !Number.isFinite(Number(id))) {
    return undefined;
  }
  return Number(id);
}
