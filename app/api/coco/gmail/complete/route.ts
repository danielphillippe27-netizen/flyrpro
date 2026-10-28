import { NextRequest } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import {
  crmRequest,
  requireCrmWorkspace,
  readCrmBody,
  privateJson,
  errorResponse,
  CrmRequestError,
} from "@/lib/mac-companion/server";
export async function POST(request: NextRequest) {
  try {
    const { api, user } = await crmRequest(request, "mac", true);
    const body = z
      .object({
        workspaceId: z.string().uuid(),
        ticket: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
      })
      .strict()
      .parse(await readCrmBody(request, 2000));
    await requireCrmWorkspace(api, body.workspaceId);
    const admin = createAdminClient();
    const { data: t } = await admin
      .from("crm_gmail_auth_tickets")
      .select("*")
      .eq("id", body.ticket)
      .eq("user_id", user.id)
      .eq("workspace_id", body.workspaceId)
      .eq("origin", request.nextUrl.origin)
      .is("claimed_at", null)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    const cookie = request.cookies.get(
      `wg-gmail-${body.ticket.slice(0, 16)}`,
    )?.value;
    if (
      !t ||
      !cookie ||
      !t.pending_tokens ||
      !timingSafeEqual(
        Buffer.from(createHash("sha256").update(cookie).digest("hex")),
        Buffer.from(t.challenge_hash),
      )
    )
      throw new CrmRequestError(
        "Gmail connection expired or belongs to another session. Start again.",
        403,
      );
    const { data: claimed, error } = await admin
      .from("crm_gmail_auth_tickets")
      .update({ claimed_at: new Date().toISOString() })
      .eq("id", body.ticket)
      .is("claimed_at", null)
      .select("id")
      .maybeSingle();
    if (error || !claimed)
      throw new CrmRequestError(
        "This Gmail connection was already completed.",
        409,
      );
    const saved = await admin
      .from("personal_gmail_connections")
      .upsert({
        user_id: user.id,
        email: t.email,
        tokens_encrypted: t.pending_tokens,
        updated_at: new Date().toISOString(),
      });
    if (saved.error)
      throw new CrmRequestError(
        "Could not save Gmail connection. Start again.",
        503,
      );
    await admin
      .from("crm_gmail_auth_tickets")
      .delete()
      .eq("id", body.ticket)
      .eq("user_id", user.id);
    const response = privateJson({ connected: true, email: t.email });
    response.cookies.set(`wg-gmail-${body.ticket.slice(0, 16)}`, "", {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/api/coco/gmail",
      maxAge: 0,
    });
    return response;
  } catch (e) {
    return errorResponse(
      e instanceof z.ZodError
        ? new CrmRequestError("Invalid Gmail connection.")
        : e,
    );
  }
}
