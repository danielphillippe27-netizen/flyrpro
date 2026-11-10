import Link from "next/link";
import { redirect } from "next/navigation";
import { EmailTemplatesSettings } from "@/components/settings/EmailTemplatesSettings";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export default async function EmailTemplatesPage() {
  const api = await getSupabaseServerClient();
  const { data: { user } } = await api.auth.getUser();
  if (!user) redirect("/login");

  return (
    <main className="mx-auto max-w-3xl space-y-5 px-4 py-6 sm:px-6">
      <Link href="/settings" className="text-sm text-muted-foreground hover:underline">Back to Settings</Link>
      <h1 className="text-2xl font-bold">Email templates</h1>
      <EmailTemplatesSettings userId={user.id} />
    </main>
  );
}
