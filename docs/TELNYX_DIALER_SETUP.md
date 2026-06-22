# Telnyx Dialer Setup

Telnyx is available as a second telecom provider behind the existing FLYR dialer APIs.

## What Works Now

- Outbound SMS through Telnyx Messaging API.
- Telnyx signed webhook verification with `TELNYX_PUBLIC_KEY`.
- Outbound message delivery status updates at `/api/telnyx/messaging/status`.
- Inbound SMS intake at `/api/telnyx/messaging/incoming`.
- Workspace and salesperson number ordering through Telnyx Number Orders.
- Browser softphone calling through `@telnyx/webrtc` when `DIALER_TELECOM_PROVIDER=telnyx`.
- Browser incoming-call UI with Answer and Decline controls for Telnyx WebRTC notifications.
- Explicit remote-audio attachment for Telnyx browser calls.
- Telnyx warning surfacing and idle token refresh/reconnect before JWT expiry.
- Native iOS token issuance through `/api/dialer/token?platform=ios` for a Telnyx iOS SDK client.
- Voice status webhooks at `/api/telnyx/voice/status`.
- Inbound Voice API forwarding at `/api/telnyx/voice/incoming`.
- Telnyx WebRTC JWT creation from `/api/dialer/token` when `TELNYX_TELEPHONY_CREDENTIAL_ID` is set.

## Client Calling

Web browser calling uses the Telnyx JavaScript WebRTC SDK. Native iOS should use Telnyx's iOS SDK against the same token route:

```text
GET /api/dialer/token?workspaceId=<workspace-id>&platform=ios
```

When Telnyx is active, the response includes:

```json
{
  "provider": "telnyx",
  "sdkTarget": "telnyx-ios",
  "token": "<telnyx-jwt>",
  "telnyxTelephonyCredentialId": "<credential-id>",
  "requiresTelnyxVoiceSdk": true
}
```

Native iOS CallKit/PushKit ringing still needs the iOS app repo to install/configure the Telnyx iOS SDK and, for background incoming calls, Telnyx mobile push credentials in the SIP Credential Connection's WebRTC settings.

## Environment

```text
DIALER_TELECOM_PROVIDER=telnyx
TELNYX_API_KEY=
TELNYX_PUBLIC_KEY=
TELNYX_DEFAULT_FROM_NUMBER=
TELNYX_DEFAULT_SMS_FROM_NUMBER=
TELNYX_MESSAGING_PROFILE_ID=
TELNYX_CONNECTION_ID=
TELNYX_OUTBOUND_VOICE_PROFILE_ID=
TELNYX_TELEPHONY_CREDENTIAL_ID=
TELNYX_WEBHOOK_BASE_URL=
TELNYX_INBOUND_FORWARD_TO=
DIALER_CANADA_FROM_NUMBER=
DIALER_US_FROM_NUMBER=
```

`TELNYX_WEBHOOK_BASE_URL` should be a public HTTPS URL in local testing, such as an ngrok URL. In production it can be omitted when `NEXT_PUBLIC_APP_URL` or `APP_BASE_URL` is already public HTTPS.

## Telnyx Portal

1. Create or choose a Messaging Profile.
2. Set the inbound message webhook URL to `/api/telnyx/messaging/incoming`.
3. Copy the account public key into `TELNYX_PUBLIC_KEY`.
4. Create or choose a Voice API application and set its webhook URL to `/api/telnyx/voice/incoming`.
5. Assign Telnyx phone numbers to that Voice API application.
6. Set `TELNYX_CONNECTION_ID` to the SIP Credential Connection id.
7. Set `TELNYX_OUTBOUND_VOICE_PROFILE_ID` to the outbound voice profile id for operational tracking.
8. Create a SIP Credential Connection, then create a Telephony Credential under it.
9. Set `TELNYX_TELEPHONY_CREDENTIAL_ID` to the generated Telephony Credential id, not the SIP Credential Connection id.
10. For native iOS incoming/background ringing, configure iOS push credentials under the SIP Credential Connection WebRTC settings.

## Database

Run migration `20260620090000_add_telnyx_dialer_provider.sql` before enabling Telnyx in production.
