import { z } from 'zod';

export const httpUrl = z.string().url().max(2000).refine(value => /^https?:\/\//i.test(value));
export const fields = ['website', 'email', 'phone', 'owner', 'address'] as const;
const fact = z.object({ value: z.string().max(500), sourceUrl: httpUrl }).strict();
export const resultSchema = z.object({
  name: z.string().trim().min(1).max(180), area: z.string().trim().min(1).max(100),
  website: fact.nullable(), email: fact.nullable(), phone: fact.nullable(), owner: fact.nullable(), address: fact.nullable(),
  notes: z.string().max(2000),
}).strict();

export function validateResearchResult(value: unknown, sources: Set<string>) {
  const result = resultSchema.parse(value);
  for (const field of fields) if (result[field] && !sources.has(result[field]!.sourceUrl)) result[field] = null;
  if (result.website && !httpUrl.safeParse(result.website.value).success) result.website = null;
  if (result.email && !z.string().email().safeParse(result.email.value).success) result.email = null;
  return result;
}
