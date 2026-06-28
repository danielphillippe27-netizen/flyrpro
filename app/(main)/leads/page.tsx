import { redirect } from 'next/navigation';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveDashboardAccessLevel } from '@/app/api/_utils/workspace';
import { resolveSalespersonForUser } from '@/lib/dialer/salesperson-settings';
import { ContactsHubView } from '@/components/crm/ContactsHubView';
import { CrmContactsHub } from '@/components/crm/CrmContactsHub';

/**
 * /leads — routes to one of two completely separate views:
 *
 *   Salesperson  → ContactsHubView  (dialer-centric: scraper lists, call stats, Send to Dialler)
 *   Owner/member → CrmContactsHub   (campaign CRM: contacts from campaigns + manual entries)
 *
 * These are distinct products sharing a server. The boundary is enforced here.
 */
export default async function LeadsPage() {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    redirect('/login');
  }

  const admin = createAdminClient();
  const access = await resolveDashboardAccessLevel(admin, user.id);
  const normalizedEmail = user.email?.trim().toLowerCase() ?? null;

  // Owners and admins are never salespersons, even if their email appears in the salespeople table
  const isSalesperson =
    access.role !== 'owner' &&
    access.role !== 'admin' &&
    !access.isFounder &&
    !!(await resolveSalespersonForUser(admin, {
      userId: user.id,
      email: normalizedEmail,
      workspaceId: access.workspaceId,
    }));

  return (
    <div className="flex min-h-screen flex-col bg-gray-50 dark:bg-background">
      <main className="flex min-h-0 flex-1 overflow-hidden">
        {isSalesperson ? <ContactsHubView /> : <CrmContactsHub />}
      </main>
    </div>
  );
}
