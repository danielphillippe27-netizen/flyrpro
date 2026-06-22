# Twilio Web Dialer Setup

The FLYR power dialer is implemented in the main Next.js web app at `/dialer`.

## Required environment variables

Set these for the deployment that serves the web app:

- `TWILIO_ACCOUNT_SID`
- `TWILIO_API_KEY_SID`
- `TWILIO_API_KEY_SECRET`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_TWIML_APP_SID`
- `TWILIO_DEFAULT_FROM_NUMBER`

Optional:

- `TWILIO_DEFAULT_SMS_FROM_NUMBER`
- `TWILIO_INBOUND_FORWARD_TO`
- `TWILIO_INBOUND_FALLBACK_MESSAGE`
- `TWILIO_IOS_PUSH_CREDENTIAL_SID`
- `TWILIO_VOICEMAIL_DROP_AUDIO_URL`
- `TWILIO_VOICEMAIL_DROP_MESSAGE`
- `STRIPE_PRICE_DIALER_CAD_MONTHLY`
- `STRIPE_PRICE_DIALER_USD_MONTHLY`

Legacy fallback:

- `STRIPE_PRICE_DIALER_MONTHLY`

The add-on now prefers regional pricing:

- Canada and non-US traffic: `STRIPE_PRICE_DIALER_CAD_MONTHLY`
- United States traffic: `STRIPE_PRICE_DIALER_USD_MONTHLY`

## Twilio Console setup

Create a TwiML App in Twilio and point its Voice Request URL to:

- `https://<your-domain>/api/twilio/voice/outgoing`

The browser token route grants access to that TwiML App through `TWILIO_TWIML_APP_SID`.

If you want your Twilio phone number to forward inbound calls to another number, point the phone number's incoming Voice webhook to:

- `https://<your-domain>/api/twilio/voice/incoming`

Then set:

- `TWILIO_INBOUND_FORWARD_TO=+1...`

By default, Twilio forwards the original caller ID to the forwarded number when you use `<Dial>` for an inbound call.

For iOS in-app call answering, create a Twilio Voice Push Credential for the FLYR iOS VoIP Services certificate and set:

- `TWILIO_IOS_PUSH_CREDENTIAL_SID=CR...`

The iOS app registers its PushKit token with Twilio using `/api/dialer/token?platform=ios`, and salesperson-owned inbound numbers ring the salesperson's iOS Twilio client identity before falling back to PSTN forwarding.

To create the Twilio Push Credential from PEM files instead of using the Console, export the Apple VoIP Services certificate and private key as PEM and run:

```bash
TWILIO_IOS_VOIP_CERTIFICATE_PATH=/path/to/cert.pem \
TWILIO_IOS_VOIP_PRIVATE_KEY_PATH=/path/to/key.pem \
TWILIO_IOS_PUSH_SANDBOX=true \
npm run twilio:ios-push-credential -- --write-env
```

Use `TWILIO_IOS_PUSH_SANDBOX=true` for Debug/development-signed iOS builds and `TWILIO_IOS_PUSH_SANDBOX=false` for Release/TestFlight/App Store builds. The iOS entitlements use `APS_ENVIRONMENT=development` for Debug and `APS_ENVIRONMENT=production` for Release so the Twilio credential sandbox flag must match the build you are testing.

After the script prints the `CR...` SID, set `TWILIO_IOS_PUSH_CREDENTIAL_SID` in the deployed web environment and redeploy the web app. Without that deployed environment variable, iOS can place Twilio calls but cannot receive native incoming CallKit rings through APNs.

If you want one-tap voicemail drop inside the power dialer, set one of:

- `TWILIO_VOICEMAIL_DROP_AUDIO_URL=https://.../voicemail.mp3`
- `TWILIO_VOICEMAIL_DROP_MESSAGE=...`

The audio URL is preferred because it behaves like a true prerecorded drop.

## Database migration

Apply:

- `supabase/migrations/20260421103000_add_twilio_power_dialer.sql`
- `supabase/migrations/20260427111500_workspace_dialer_addon_and_numbers.sql`

This adds:

- `workspace_dialer_settings`
- `workspace_billing_addons`
- `dialer_sessions`
- `dialer_session_leads`
- `dialer_calls`
- `dialer_sms_followups`
- contact phone normalization columns on `contacts`

## Runtime flow

1. Open `/dialer`
2. Initialize the browser device and allow microphone access
3. Start a queue from workspace contacts
4. The client fetches a Twilio browser token from `/api/dialer/token`
5. Outbound call requests are created in `/api/dialer/calls`
6. Twilio requests TwiML from `/api/twilio/voice/outgoing`
7. Twilio sends status updates to `/api/twilio/voice/status`
8. Twilio posts call recording updates to `/api/twilio/voice/recording-status`
9. The user saves a disposition, which writes back into `contacts` and `contact_activities`
10. If SMS follow-up is enabled, the post-call modal can queue a Twilio text and track delivery updates from `/api/twilio/messaging/status`
11. Owners/admins can enable the CA$20/month Power Dialer add-on from Billing
12. After the add-on is active, owners/admins can claim a dedicated Twilio number for the workspace from Integrations
13. If the inbound number belongs to a salesperson with a mapped user, Twilio rings that salesperson's iOS app identity from `/api/twilio/voice/incoming`
14. If iOS client routing is unavailable and inbound forwarding is enabled, Twilio forwards calls from `/api/twilio/voice/incoming` to the workspace override first, then `TWILIO_INBOUND_FORWARD_TO`
15. If voicemail drop is enabled, the live outbound leg can be redirected to prerecorded audio from `/api/dialer/calls/[callId]/voicemail-drop`

## Current MVP scope

- Outbound browser calling only
- One active browser call at a time
- Queueing from existing `contacts`
- Automatic call recording metadata with in-app playback
- One-tap voicemail drop during a live call
- Post-call disposition logging
- Optional post-call SMS follow-up with delivery status syncing
- Workspace-level dialer billing add-on and dedicated Twilio number assignment
- Optional inbound call forwarding to another phone number
- Salesperson-owned inbound calls can ring the iOS app through Twilio Voice, PushKit, and CallKit when `TWILIO_IOS_PUSH_CREDENTIAL_SID` is configured
- Follow-up and appointment writeback into the existing CRM model

Not included yet:

- browser-based inbound answer inside the web dialer
- voicemail drop
- predictive dialing
