import type { createAdminClient } from '@/lib/supabase/server';

type AdminClient = ReturnType<typeof createAdminClient>;

export async function calendarContact(
  admin: AdminClient,
  contactId: string,
  userId: string,
  workspaceId: string | null,
  canScheduleForTeam: boolean,
) {
  let query = admin.from('contacts').select('id, full_name, address').eq('id', contactId);
  query = workspaceId ? query.eq('workspace_id', workspaceId) : query.is('workspace_id', null);
  if (!workspaceId || !canScheduleForTeam) query = query.eq('user_id', userId);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}
