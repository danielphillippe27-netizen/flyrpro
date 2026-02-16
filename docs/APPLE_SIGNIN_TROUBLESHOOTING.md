# Apple Sign In – Why is it not working?

## Scenario B: Web login – token exchange (client_id must match JWT `sub`)

If you are logging in on the **web** (React/Next.js) using a Services ID like `com.danielphillippe.flyr.signin.web`:

**The problem:** When Supabase exchanges the authorization code with Apple, it sends a `POST` to `https://appleid.apple.com/auth/token`. The **`client_id`** in that request must match the **`sub`** claim in your client secret (JWT) **exactly** (case-sensitive). If they differ, Apple returns an error and you see "Sign in with Apple didn't complete" or "Unable to exchange external code".

**What Apple expects** (for reference; Supabase sends this):

```http
POST https://appleid.apple.com/auth/token
Content-Type: application/x-www-form-urlencoded

client_id=com.danielphillippe.flyr.signin.web   ← MUST MATCH JWT 'sub' EXACTLY
client_secret=<The JWT from your generator>
code=<The authorization code>
grant_type=authorization_code
redirect_uri=<Return URL configured in Apple Developer Portal>
```

**The fix:**

1. **Pick one Services ID** and use it everywhere, e.g. `com.danielphillippe.flyr.signin.web`.
2. **Apple Developer** → Identifiers → Services IDs → that identifier (exact spelling/casing).
3. **Supabase** → Authentication → Providers → Apple → **Services ID** (Client IDs) = that exact string.
4. **JWT generator** (for the client secret): **Client ID / "sub"** = that exact same string. Paste the generated JWT into Supabase → Apple → **Secret**.

If the JWT was built with a different `sub` (e.g. `com.danielphillippe.FLYR.web`) than the Services ID in Supabase, the token exchange will fail. Make all three identical.

---

## "invalid_request" / "Invalid client id or web redirect url"

This error appears **on Apple’s page** before any code exchange. Apple is rejecting the **client_id** or **redirect_uri** sent in the authorize request.

**Fix:**

1. **Client ID (Services ID)**  
   - In [Apple Developer → Identifiers → Services IDs](https://developer.apple.com/account/resources/identifiers/list/serviceId), your Services ID (e.g. `com.danielphillippe.FLYR.web`) must **exactly** match the value in **Supabase** → Authentication → Providers → Apple → **Services ID** (case-sensitive).
2. **Redirect URL (Return URL)**  
   - In Apple, open that Services ID → **Configure** next to Sign in with Apple → **Return URLs**.  
   - Add **exactly** (no trailing slash): `https://<YOUR-SUPABASE-PROJECT-REF>.supabase.co/auth/v1/callback`  
   - Get the real ref from Supabase Dashboard (Project Settings → General → Reference ID) or from your project URL.  
   - If you use multiple Supabase projects (e.g. staging vs prod), each needs its own Return URL in Apple.
3. **Domains**  
   - Under the same Configure screen, **Domains and Subdomains** must include that Supabase host, e.g. `kfnsnwqylsdsbgnwgxva.supabase.co` (no `https://`).

Save in Apple, then try Sign in with Apple again.

---

If you get **"Sign in with Apple didn't complete"** or **"Unable to exchange external code"**, the failure happens when **Supabase** tries to exchange the authorization code with **Apple**. Fix the configuration (not the app code) using this checklist.

---

## 1. Return URL in Apple (most common cause)

- Go to [Apple Developer → Identifiers → Services IDs](https://developer.apple.com/account/resources/identifiers/list/serviceId).
- Open your **FLYR WEB** Services ID (e.g. `com.danielphillippe.flyr.web`).
- Click **Configure** next to **Sign in with Apple**.
- **Return URLs** must be **exactly** this (copy-paste, no spaces or trailing slash):

  ```
  https://kfnsnwqylsdsbgnwgxva.supabase.co/auth/v1/callback
  ```

- Save. If this URL is wrong or missing, the exchange will fail.

---

## 2. Client ID / Services ID must match everywhere (case-sensitive)

This is what Scenario B above is about: the `client_id` in the token POST must match the JWT `sub`. Apple is **case-sensitive**. The same string must be used in all three places:

| Place | Value to use |
|-------|----------------|
| **Supabase** → Apple provider → **Client IDs** (Services ID) | Your Services ID, e.g. `com.danielphillippe.flyr.signin.web` |
| **Apple** → Services ID identifier | The **exact same** string |
| **JWT generator** → Client ID / **"sub"** | The **exact same** string (this becomes the JWT’s `sub` claim) |

If Supabase sends `com.danielphillippe.flyr.signin.web` but the JWT was generated with `com.danielphillippe.FLYR.web` (different casing), the token exchange will fail. Make all three identical.

---

## 3. Secret key (JWT) in Supabase

- The value in **Secret Key (for OAuth)** must be the **JWT** from a generator (e.g. [Supabase docs](https://supabase.com/docs/guides/auth/social-login/auth-apple) or [supabasejwt.com](https://www.supabasejwt.com/)), **not** the raw contents of the `.p8` file.
- The JWT expires (e.g. after 6 months). If it’s old, generate a **new** JWT and paste it into Supabase → Save.

---

## 4. Redirect allow list in Supabase

- **Authentication** → **URL configuration** → **Redirect URLs**
- Add: `http://localhost:3000/auth/callback`
- Add your production URL when you deploy (e.g. `https://yourdomain.com/auth/callback`).

---

## 5. See the exact error

- **Browser:** When sign-in fails, open DevTools (F12) → **Console**. Look for `[Apple Sign-In]` and the message after it.
- **Server:** In the terminal where Next.js is running, look for `Auth Callback` and `error_description` when you’re redirected back to your app.

Use that message to confirm it’s an “exchange” error and that the checklist above is complete.
