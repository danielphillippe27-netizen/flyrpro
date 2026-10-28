import { NextRequest } from "next/server";
import { z } from "zod";
import {
  crmRequest,
  requireCrmWorkspace,
  readCrmBody,
  privateJson,
  errorResponse,
  CrmRequestError,
} from "@/lib/mac-companion/server";
import { createAdminClient } from "@/lib/supabase/server";
import { cocoGmailAccess } from "@/lib/coco/gmail";
import { personalCocoKey } from "@/lib/coco/ai";
import { extractThread } from "@/lib/coco/gmail-ai-import";
export const maxDuration = 120;
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  let usage: string | undefined, owner: string | undefined;
  try {
    const { api, user } = await crmRequest(request, "ai", true);
    owner = user.id;
    const date = z.string().regex(/^$|^\d{4}-\d{2}-\d{2}$/);
    const b = z
      .object({
        workspace_id: z.string().uuid(),
        page_token: z.string().max(1000).nullable().optional(),
        consent: z.literal(true),
        after: date.default(""),
        before: date.default(""),
      })
      .strict()
      .parse(await readCrmBody(request, 4000));
    await requireCrmWorkspace(api, b.workspace_id);
    if (b.after && b.before && b.after >= b.before)
      throw new CrmRequestError("Choose a valid date range.");
    const saved = await personalCocoKey(user.id, b.workspace_id);
    const model = process.env.CRM_AI_IMPORT_MODEL ?? process.env.CRM_AI_MODEL;
    if (!model)
      throw new CrmRequestError("The AI model is not configured.", 503);
    const gmail = await cocoGmailAccess(user.id, "read");
    const url = new URL(
      "https://gmail.googleapis.com/gmail/v1/users/me/threads",
    );
    url.searchParams.set(
      "q",
      `${b.after ? `after:${b.after}` : ""} ${b.before ? `before:${b.before}` : ""}`.trim(),
    );
    url.searchParams.set("includeSpamTrash", "true");
    url.searchParams.set("maxResults", "1");
    if (b.page_token) url.searchParams.set("pageToken", b.page_token);
    const listing = await fetch(url, {
      headers: { Authorization: `Bearer ${gmail.token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
    if (!listing.ok)
      throw new CrmRequestError(
        "Gmail search failed. Reconnect Gmail read access.",
        502,
      );
    const page = (await listing.json()) as {
      threads?: { id: string }[];
      nextPageToken?: string;
    };
    const candidates = [],
      warnings: string[] = [];
    for (const item of page.threads ?? []) {
      const response = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(item.id)}?format=full`,
        {
          headers: { Authorization: `Bearer ${gmail.token}` },
          cache: "no-store",
          signal: AbortSignal.timeout(20000),
        },
      );
      if (!response.ok)
        throw new CrmRequestError(
          "Gmail could not read the next thread. Retry this batch.",
          502,
        );
      const thread = await response.json();
      if ((thread.messages?.length ?? 0) > 40) {
        thread.messages = thread.messages.slice(-40);
        warnings.push(
          "This thread exceeds 40 messages. Only its latest 40 were analyzed.",
        );
      }
      const reserved = await api.rpc("reserve_crm_ai_request", {
        ws: b.workspace_id,
        ai_model: model,
      });
      if (reserved.error)
        throw new CrmRequestError(
          "You have reached the hourly AI limit. Resume later.",
          429,
        );
      usage = reserved.data;
      const result = await extractThread(
        thread,
        gmail.token,
        gmail.email,
        saved.key,
        model,
      );
      await requireCrmWorkspace(api, b.workspace_id);
      const current = await personalCocoKey(user.id, b.workspace_id);
      if (current.version !== saved.version)
        throw new CrmRequestError(
          "Your OpenAI connection changed. Start this batch again.",
          409,
        );
      const logged = await createAdminClient()
        .from("crm_ai_usage")
        .update({
          status: "completed",
          input_tokens: result.usage?.input_tokens ?? 0,
          output_tokens: result.usage?.output_tokens ?? 0,
        })
        .eq("id", usage!)
        .eq("user_id", user.id);
      if (logged.error)
        throw new CrmRequestError("Could not record usage. Scan paused.", 503);
      usage = undefined;
      candidates.push(...result.candidates);
      warnings.push(...result.warnings);
    }
    return privateJson({
      candidates,
      warnings,
      scanned: (page.threads ?? []).length,
      nextPageToken: page.nextPageToken ?? null,
    });
  } catch (e) {
    if (usage && owner)
      await createAdminClient()
        .from("crm_ai_usage")
        .update({ status: "failed", error_code: "gmail_import_failed" })
        .eq("id", usage)
        .eq("user_id", owner);
    return errorResponse(
      e instanceof z.ZodError
        ? new CrmRequestError(
            "Choose dates and allow AI analysis before scanning.",
          )
        : e,
    );
  }
}
