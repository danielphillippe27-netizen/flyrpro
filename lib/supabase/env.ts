function cleanSupabaseUrl(url: string): string {
  return url.trim().replace(/\/$/, '');
}

export function getSupabaseUrl(): string {
  const value = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!value) {
    throw new Error(
      'SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL is required. Set it in your environment.'
    );
  }
  return cleanSupabaseUrl(value);
}

export function getSupabaseAnonKey(): string {
  const value = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!value) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_ANON_KEY is required. Set it in your environment.'
    );
  }
  return value;
}

export function getSupabaseServiceRoleKey(): string {
  const value = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!value) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is required. Set it in your environment.'
    );
  }
  return value;
}

export function getSupabaseJwtSecret(): string {
  const value = process.env.SUPABASE_JWT_SECRET;
  if (!value) {
    throw new Error(
      'SUPABASE_JWT_SECRET is required. Set it in your environment.'
    );
  }
  return value;
}
