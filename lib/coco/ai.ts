import { createAdminClient } from "@/lib/supabase/server";
import { decryptAiKey } from "@/lib/crm-ai/keys";
import { CrmRequestError } from "@/lib/mac-companion/server";
export async function personalCocoKey(userId: string, ws: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("crm_ai_connections")
    .select("encrypted_key,version")
    .eq("user_id", userId)
    .eq("workspace_id", ws)
    .maybeSingle();
  if (error || !data)
    throw new CrmRequestError(
      "Connect your personal OpenAI key in Integrations first.",
      403,
    );
  return {
    key: decryptAiKey(data.encrypted_key, userId, ws),
    version: data.version,
  };
}
