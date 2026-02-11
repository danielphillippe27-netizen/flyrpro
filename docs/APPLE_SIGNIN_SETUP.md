# Apple Sign In – Setup checklist (FLYR WEB)

Use this with your existing Apple key **P5ZUJLY9D2** and Team ID **2AR5T8ZYAS**.

---

## 1. Services ID (required for web)

The **App ID** `com.danielphillippe.FLYR` is for native apps. For **web** Sign in with Apple you need a **Services ID**.

1. In [Apple Developer](https://developer.apple.com/account/resources/identifiers/list/serviceId) go to **Identifiers** → filter by **Services IDs**.
2. If you don’t have one for FLYR WEB, click **+** and create a **Services ID** (e.g. `com.danielphillippe.FLYR.web` or `com.danielphillippe.FLYR.signin`). This will be your **Client ID** in Supabase.
3. Edit that Services ID and enable **Sign in with Apple**.
4. Under **Configure** (Sign in with Apple), set:
   - **Primary App ID:** `com.danielphillippe.FLYR`
   - **Domains and Subdomains:** `kfnsnwqylsdsbgnwgxva.supabase.co`
   - **Return URLs:** `https://kfnsnwqylsdsbgnwgxva.supabase.co/auth/v1/callback`  
     (must be exactly this; no trailing slash)

Save. The “Unable to exchange external code” error is often caused by a wrong or missing Return URL here.

---

## 2. Generate the Apple client secret (JWT)

Supabase does **not** take the raw `.p8` file. You must generate a **client secret** (JWT) from it.

- **Option A:** Use Supabase’s generator in the Apple provider docs:  
  [Login with Apple – Supabase](https://supabase.com/docs/guides/auth/social-login/auth-apple) → scroll to “Use this tool to generate a new Apple client secret” (use Chrome/Firefox, not Safari).
- **Option B:** Use [supabasejwt.com](https://www.supabasejwt.com/) (client-side, no data sent to servers).

You will need:

| Field    | Value            |
|----------|------------------|
| Team ID  | `2AR5T8ZYAS`     |
| Key ID   | `P5ZUJLY9D2`     |
| Client ID (sub) | Your **Services ID** from step 1 (e.g. `com.danielphillippe.FLYR.web`) |
| Private Key | Contents of `AuthKey_P5ZUJLY9D2.p8` |

The generated JWT is valid for a limited time (e.g. 6 months). When it expires, generate a new one and update it in Supabase.

---

## 3. Supabase Dashboard – Apple provider

In [Supabase](https://supabase.com/dashboard) → your project → **Authentication** → **Providers** → **Apple**:

| Field        | Value |
|-------------|--------|
| **Enable Sign in with Apple** | On |
| **Services ID** (Client ID) | Your Services ID from step 1 (e.g. `com.danielphillippe.FLYR.web`) |
| **Team ID** | `2AR5T8ZYAS` |
| **Key ID**  | `P5ZUJLY9D2` |
| **Secret**  | The **JWT** you generated in step 2 (not the raw .p8 contents) |

Save.

---

## 4. Redirect allow list (Supabase)

In **Authentication** → **URL configuration** → **Redirect URLs**, ensure your app URLs are allowed, e.g.:

- `http://localhost:3000/auth/callback`
- `https://your-production-domain.com/auth/callback`

---

## Quick verification

- **Apple:** Services ID exists, Sign in with Apple configured, Return URL = `https://kfnsnwqylsdsbgnwgxva.supabase.co/auth/v1/callback`.
- **Supabase:** Apple provider enabled, Services ID / Team ID / Key ID match, **Secret** = current JWT from .p8 (not the .p8 file itself).
- **Secret:** If it’s older than 6 months, generate a new JWT and update Supabase.

After that, try Sign in with Apple again; the “Unable to exchange external code” error should go away once the Return URL and client secret are correct.
