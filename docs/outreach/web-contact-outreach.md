# Web contact outreach

The web Contacts screens, lead records, campaign Leads and farm Leads now expose native Messages/call handoffs and a personal Gmail composer.

## Native handoffs

- Individual contacts open `sms:` and `tel:` links directly.
- List actions select valid, deduplicated recipients and open one recipient at a time.
- Messages uses copy/paste for the body: browsers do not reliably prefill Apple Messages across macOS/iOS. The user sends in Messages, then manually advances in WolfGrid.
- Calls use the device's registered calling application. Mac cellular calls require Apple Continuity configured by the user. The browser cannot confirm dialling, answering, call end or message delivery. No successful-contact events are fabricated.
- Unsupported devices can still display the queue but may not have a handler for these links.

## Personal Gmail activation

Code is local; deployment and provider configuration have not been performed.

1. Apply `supabase/migrations/20261028010000_personal_gmail_outreach.sql`.
2. Register/configure a Google Web OAuth client with the Gmail API enabled. Request `openid`, `email`, and `https://www.googleapis.com/auth/gmail.send`. Configure test users while the app is in testing, and complete Google's applicable verification for public use.
3. Configure these server-only variables:
   - `GMAIL_OAUTH_CLIENT_ID`
   - `GMAIL_OAUTH_CLIENT_SECRET`
   - `GMAIL_OAUTH_REDIRECT_URI` — production callback `https://wolfgrid.app/api/outreach/gmail/callback`
   - `OUTREACH_ENCRYPTION_KEY` — independent randomly generated secret of at least 32 characters; changing it requires users to reconnect.
4. Deploy and connect a real test account in Settings → Integrations → Your Gmail.
5. With explicit authorization, send one test email and verify the Gmail Sent folder and recipient receipt before enabling broader use.

Connections belong to each signed-in user; encrypted tokens are service-role-only. OAuth uses a short-lived HttpOnly cookie, random state and PKCE. No inbox-read scope is requested. Disconnect removes the stored tokens; users can also revoke the WolfGrid grant in their Google account.

Sending is sequential while the page remains open. Each contact receives a separate email. The UI previews sender, subject, body and recipients. Requests are checked against workspace membership and contact ownership (owners/admins may access team contacts). A durable send reservation prevents replay of the same user/request/contact. Ambiguous provider failures are marked unknown and never automatically retried. Accepted is not delivery confirmation. Provider rate limits pause the queue. Background delivery, inbox synchronization, unsubscribe campaigns, Outlook and persistence of browser queue progress across reloads are not implemented.

## Verification

- `npx tsx lib/outreach/__tests__/native.test.ts`
- `npx tsx lib/outreach/__tests__/gmail.test.ts`
- `node scripts/test-gmail-outreach-server.cjs`
- `node scripts/test-web-outreach-browser.cjs`

Browser/API tests use mocks and never launch real calls or send real messages. Full repository TypeScript checking has unrelated pre-existing errors; new outreach files have no reported errors.
