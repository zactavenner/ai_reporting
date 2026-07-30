## Goal

From the Setter panel: press **Call**, your phone rings, GHL bridges you to the lead using that client's GHL number, and the call is logged in the lead timeline. SMS and email to/from the lead appear in the same thread in near real time.

## Current state (verified)

- `setter-send-message` already sends SMS/email through each client's own GHL credentials (`clients.ghl_api_key` + `ghl_location_id`) and writes an outbound row into `contact_timeline_events`.
- Inbound messages arrive only through the scheduled conversation sync (`sync-ghl-contacts`), which normalizes direction and writes to `contact_timeline_events`. There is no inbound webhook, so replies lag.
- There is no calling path at all today — the panel only has a `mailto:` link. No Twilio/voice provider is configured.

Important constraint: the GHL public API cannot *dial* a call. `POST /conversations/messages/outbound` only **logs** an external call. The only API-reachable way to make GHL actually bridge a call from the client's number is to trigger a GHL **workflow** (Inbound Webhook trigger → Call action) in that sub-account. The plan uses that, with a graceful device-dial fallback.

## What gets built

### 1. Click-to-call (GHL bridge)

- New edge function `setter-place-call`:
  - Looks up the client's GHL creds, upserts/locates the contact.
  - Fires the client's configured **Inbound Webhook URL** with `{contact_id, phone, setter_phone, lead_id}` so the GHL workflow's Call action bridges setter → lead using the client's number.
  - Immediately writes a `contact_timeline_events` row (`event_type: call`, `outbound`, status `dialing`) so the timeline and speed-to-lead update instantly.
  - Also posts `POST /conversations/messages/outbound` type `Call` so the activity shows inside GHL's conversation too.
  - If the client has no call-workflow webhook configured, returns a `fallback: "device"` response and the UI opens the system dialer (`tel:`) while still logging the attempt.
- New per-client settings (in client settings): **Call workflow webhook URL** and default **outbound caller number**; per-user **setter callback phone** on the agency member record.
- UI: a real **Call** button in `SetterDetailPanel` next to Mail/SMS, with dialing state, connect/no-answer/voicemail quick disposition, and duration capture written back to the timeline + `calls` table.

### 2. Accurate, realtime SMS/email thread

- New public edge function `ghl-conversation-webhook` (HMAC/shared-secret verified, `verify_jwt=false`):
  - Accepts GHL `InboundMessage`, `OutboundMessage`, and call-status events.
  - Resolves client by `locationId`, resolves lead by `ghl_contact_id` / phone / email, and upserts into `contact_timeline_events` keyed by GHL `messageId` so nothing double-posts against the 15-min sync.
- Keep the existing 15-min sync as reconciliation only (idempotent upsert on message id).
- Thread rendering: unify `SmsThread` to render SMS **and** email in one chronological thread with direction-based bubbles, channel + provider label ("via GHL" vs "sent from platform"), delivery status, and unread badge clearing on view.
- Realtime subscription on `contact_timeline_events` for the open lead so inbound replies pop in without a refresh.

### 3. Accuracy guardrails

- Dedup key: `metadata.ghl_message_id` unique per client — used by webhook, sync, and outbound send.
- Phone normalization to E.164 before match/lookup so GHL and platform rows collapse onto the same lead.
- Small "Message health" strip in the Setter header: last webhook received, last sync, and count of unmatched inbound messages.

## Setup you'll need to do once per client sub-account

1. In GHL, create a workflow: **Inbound Webhook** trigger → **Call** action (call assigned user, then contact) — paste its webhook URL into the client's settings in the app.
2. Add the app's webhook URL to that sub-account's messaging webhook (or the marketplace app) so inbound SMS/email hits us instantly.

## Technical notes

- Edge functions: `setter-place-call` (new), `ghl-conversation-webhook` (new), `setter-send-message` (extended with message-id dedup).
- DB: add `call_workflow_webhook_url` + `outbound_caller_number` to `client_settings`, `setter_phone` to `agency_members`, and a unique index on `(client_id, (metadata->>'ghl_message_id'))` for `contact_timeline_events`.
- Frontend: `SetterDetailPanel.tsx`, `SmsThread.tsx`, `useSetterLeads.ts`, new `useLeadThread` realtime hook.
- A shared webhook secret will be requested via the secure secret form after the webhook endpoint is deployed.
