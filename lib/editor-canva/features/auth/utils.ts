import { redirect } from "next/navigation";

import { getSupabaseServerClient } from "@/lib/supabase/server";

export const protectServer = async () => {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/api/auth/signin");
  }
};
