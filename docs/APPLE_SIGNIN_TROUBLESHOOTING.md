# Apple Sign In – Why is it not working?

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

Apple is **case-sensitive**. The same string must be used in all three places:

| Place | Value to use |
|-------|----------------|
| **Supabase** → Apple provider → **Client IDs** | Your Services ID, e.g. `com.danielphillippe.flyr.web` |
| **Apple** → Services ID identifier | The **exact same** string |
| **JWT generator** → Client ID / "sub" | The **exact same** string |

If Supabase has `com.danielphillippe.flyr.web` but the JWT was generated with `com.danielphillippe.FLYR.web`, the exchange will fail. Make all three identical.

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
