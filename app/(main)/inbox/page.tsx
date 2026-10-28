import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import CocoCrm from "@/components/coco/CocoCrm";
export const dynamic = "force-dynamic";
export default async function InboxPage() {
  const api = await getSupabaseServerClient();
  const {
    data: { user },
  } = await api.auth.getUser();
  if (!user) redirect("/login?next=/inbox");
  return <CocoCrm initialArea="Inbox" />;
}
