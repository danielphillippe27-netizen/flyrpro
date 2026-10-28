import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import {
  gmailConfig,
  googleToken,
  seal,
  unseal,
  type GmailTokens,
} from "@/lib/outreach/gmail";
// Public OAuth callback can cross deployment origins. Tokens stay pending until
// the original signed-in browser proves its HttpOnly per-attempt challenge.
export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("state") ?? "";
  const id = raw.replace(/^coco\./, "");
  if (!/^[A-Za-z0-9_-]{43}$/.test(id))
    return new NextResponse("Invalid Gmail connection.", { status: 400 });
  const admin = createAdminClient();
  const { data: t } = await admin
    .from("crm_gmail_auth_tickets")
    .select("*")
    .eq("id", id)
    .is("claimed_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (!t)
    return new NextResponse(
      "This Gmail connection expired. Start again in WolfGrid.",
      { status: 400 },
    );
  let status = "error";
  try {
    const code = request.nextUrl.searchParams.get("code");
    if (!code || request.nextUrl.searchParams.has("error"))
      throw Error("Declined");
    const { verifier } = unseal<{ verifier: string }>(t.verifier_encrypted);
    const tokens = await googleToken({
      grant_type: "authorization_code",
      code,
      redirect_uri: gmailConfig().redirectUri,
      code_verifier: verifier,
    });
    const scopes = (tokens.scope ?? "").split(" ");
    if (
      t.scopes.some(
        (s: string) => !["openid", "email"].includes(s) && !scopes.includes(s),
      )
    )
      throw Error("Permission declined");
    const profile = await fetch(
      "https://openidconnect.googleapis.com/v1/userinfo",
      {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!profile.ok) throw Error("No profile");
    const p = await profile.json();
    if (!p.email || !p.email_verified) throw Error("Unverified email");
    let refresh = tokens.refresh_token;
    if (!refresh) {
      const { data: prior } = await admin
        .from("personal_gmail_connections")
        .select("email,tokens_encrypted")
        .eq("user_id", t.user_id)
        .eq("email", p.email)
        .maybeSingle();
      if (prior)
        refresh = unseal<GmailTokens>(prior.tokens_encrypted).refreshToken;
    }
    if (!refresh) throw Error("Reconnect needed");
    const { error } = await admin
      .from("crm_gmail_auth_tickets")
      .update({
        email: p.email,
        pending_tokens: seal({
          accessToken: tokens.access_token,
          refreshToken: refresh,
          expiresAt: Date.now() + tokens.expires_in * 1000,
          scopes,
        }),
      })
      .eq("id", id)
      .is("pending_tokens", null)
      .is("claimed_at", null);
    if (error) throw Error("Save failed");
    status = "ready";
  } catch {
    /* No authorization codes, credentials, or email bodies in logs. */
  }
  const destination = t.native
    ? `wolfgrid-mac://gmail/callback?ticket=${encodeURIComponent(id)}&status=${status}`
    : `${t.origin}/contacts?gmail_ticket=${encodeURIComponent(id)}&gmail=${status}`;
  return NextResponse.redirect(destination);
}
