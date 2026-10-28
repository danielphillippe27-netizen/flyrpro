import { NextRequest } from "next/server";
import { randomBytes, createHash } from "node:crypto";
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
import { gmailConfig, seal } from "@/lib/outreach/gmail";
import { READ, SEND } from "@/lib/coco/gmail";
export async function POST(request: NextRequest) {
  try {
    const { api, user } = await crmRequest(request, "mac", true);
    const body = z
      .object({
        workspaceId: z.string().uuid(),
        read: z.boolean().default(false),
        send: z.boolean().default(false),
        native: z.boolean().default(false),
      })
      .strict()
      .parse(await readCrmBody(request, 2000));
    await requireCrmWorkspace(api, body.workspaceId);
    if (!body.read && !body.send)
      throw new CrmRequestError("Choose Gmail read or sending access.");
    const config = gmailConfig();
    const origin = request.nextUrl.origin;
    if (
      !/^https:\/\/(wolfgrid\.app|flyrpro-[a-z0-9-]+\.vercel\.app)$/.test(
        origin,
      )
    )
      throw new CrmRequestError(
        "Use the secure WolfGrid app to connect Gmail.",
      );
    const id = randomBytes(32).toString("base64url"),
      challenge = randomBytes(32).toString("base64url"),
      verifier = randomBytes(32).toString("base64url");
    const scopes = [
      "openid",
      "email",
      ...(body.read ? [READ] : []),
      ...(body.send ? [SEND] : []),
    ];
    const { error } = await createAdminClient()
      .from("crm_gmail_auth_tickets")
      .insert({
        id,
        user_id: user.id,
        workspace_id: body.workspaceId,
        challenge_hash: createHash("sha256").update(challenge).digest("hex"),
        verifier_encrypted: seal({ verifier }),
        origin,
        native: body.native,
        scopes,
        expires_at: new Date(Date.now() + 600000).toISOString(),
      });
    if (error)
      throw new CrmRequestError("Could not begin Gmail connection.", 503);
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: "code",
      scope: scopes.join(" "),
      include_granted_scopes: "true",
      access_type: "offline",
      prompt: "consent select_account",
      state: `coco.${id}`,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
    }).toString();
    const response = privateJson({ url: url.toString(), ticket: id });
    response.cookies.set(`wg-gmail-${id.slice(0, 16)}`, challenge, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/api/coco/gmail",
      maxAge: 600,
    });
    return response;
  } catch (e) {
    return errorResponse(
      e instanceof z.ZodError
        ? new CrmRequestError("Invalid Gmail connection request.")
        : e,
    );
  }
}
