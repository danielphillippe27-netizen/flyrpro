import { z } from "zod";
import { canUseInbox } from "@/lib/coco/inbox-access";
import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import CocoCrm from "@/components/coco/CocoCrm";
export const dynamic = "force-dynamic";
export default async function ContactsPage({ searchParams }: { searchParams: Promise<{ contact?: string }> }) {
  const api = await getSupabaseServerClient();
  const {
    data: { user },
  } = await api.auth.getUser();
  if (!user) redirect("/login?next=/contacts");
  const contact = z.string().uuid().safeParse((await searchParams).contact);
  return <CocoCrm initialArea="Clients" initialContact={contact.success ? contact.data : undefined} canUseInbox={canUseInbox(user.email)} />;
}
