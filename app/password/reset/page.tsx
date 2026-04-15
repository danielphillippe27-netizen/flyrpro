import { redirect } from 'next/navigation';

export default async function PasswordResetAliasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = new URLSearchParams();
  const resolvedSearchParams = await searchParams;

  for (const [key, value] of Object.entries(resolvedSearchParams)) {
    if (Array.isArray(value)) {
      value.forEach((entry) => params.append(key, entry));
      continue;
    }

    if (typeof value === 'string') {
      params.set(key, value);
    }
  }

  const destination = params.toString()
    ? `/reset-password?${params.toString()}`
    : '/reset-password';

  redirect(destination);
}
