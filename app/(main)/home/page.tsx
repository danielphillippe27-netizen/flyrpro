import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveDashboardAccessLevel } from '@/app/api/_utils/workspace';
import { HomePageClient } from './HomePageClient';

export default async function HomePage() {
  const supabase = await getSupabaseServerClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    redirect('/login');
  }
  const admin = createAdminClient();
  const access = await resolveDashboardAccessLevel(admin, user.id);
  if (access.level === 'founder') {
    redirect('/admin');
  }
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-50 dark:bg-background flex items-center justify-center">
          <p className="text-muted-foreground">Loading…</p>
        </div>
      }
    >
      <HomePageClient accessLevel={access.level} />
    </Suspense>
  );
}
