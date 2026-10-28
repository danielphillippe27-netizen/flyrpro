import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import CocoCrm from "@/components/coco/CocoCrm";
export const dynamic = "force-dynamic";
export default async function ContactsPage() {
  const api = await getSupabaseServerClient();
  const {
    data: { user },
  } = await api.auth.getUser();
  if (!user) redirect("/login?next=/contacts");
  return <CocoCrm initialArea="Clients" />;
}
