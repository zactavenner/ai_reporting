
# Weekly & Monthly Client Reports (Email + SMS via GHL)

## Goal
Auto-send a branded performance recap to each active client every **Monday 9am client TZ** (weekly) and on the **1st of each month** (monthly), with the same content delivered to **multiple stakeholders per client** over **email and SMS through your agency GHL account**. The SMS contains a short headline + a link to the existing public client report (the "scorecard"). The email contains the full branded recap.

## On the "Executive Scorecard" question
There is no dedicated Executive Scorecard feature today — the source of truth for client-facing numbers is the **existing public client report** at `/public/:token`. We will keep that as the scorecard and have every email/SMS deep-link to it. Google Sheets is already connected (used by `fetch-sheet-metrics`), so we can optionally write the same weekly/monthly snapshot to a per-client tab later — flagged as out-of-scope for v1 unless you want it.

## What the report contains
Headline KPIs (current period vs prior, color-coded deltas):
1. **Spend, Leads, CPL**
2. **Calls booked, Calls showed, Show rate**
3. **Funded $ and CoC%** (cost of capital = spend ÷ funded $)
4. **Top performing ad** — thumbnail + name + CPL + funded $ (uses existing `get_top_performers` RPC)

Plus: client logo header, period label, "View full report" CTA → public link, compliance footer ("targeted returns", SEC/FINRA disclaimer), unsubscribe link.

## Recipients (multi-stakeholder)
New table `client_report_recipients` so each client can have several people:
- `id`, `client_id`, `name`, `role` (CEO/CMO/Ops/Other), `email`, `phone_e164`, `channels text[]` (`email`, `sms`, or both), `cadences text[]` (`weekly`, `monthly`), `active`, `unsubscribed_at`, timestamps.
- Seeded on creation from the existing `clients.notification_email` / `notification_phone`.
- Managed in **Client Settings → Reporting Recipients** (add/edit/remove, toggle channel + cadence).

## Delivery via GHL (agency account)
Secrets already present: `AGENCY_GHL_API_KEY`, `AGENCY_GHL_LOCATION_ID`, `AGENCY_GHL_PIT_TOKEN`. New edge function `send-ghl-message` wraps two GHL endpoints:
- **Email**: `POST /conversations/messages` with `type: "Email"`, branded HTML body.
- **SMS**: `POST /conversations/messages` with `type: "SMS"`, ≤300-char headline + report link.
- Requires a GHL contact; function upserts contact by email/phone before sending.
- Logs every send to a new `client_report_sends` table (`recipient_id`, `cadence`, `channel`, `period_start`, `period_end`, `status`, `ghl_message_id`, `error`, `sent_at`).
- Idempotency key = `${client_id}:${cadence}:${period_start}:${recipient_id}:${channel}` to prevent double-sends on retry.

## Report generation
New edge function `generate-client-report`:
- Input: `client_id`, `cadence` (`weekly` | `monthly`).
- Computes current-period and prior-period windows in the client's TZ.
- Pulls metrics via existing `get_client_source_metrics` RPC + `get_top_performers` + `daily_metrics` for spend.
- Returns `{ kpis, deltas, topPerformer, publicReportUrl }` plus pre-rendered branded HTML (inline-styled, Apple/Capital-Creative aesthetic: Deep Green `#0B2B26`, Gold `#C5A55A`, Playfair Display headings) and a ≤300-char SMS string.

## Orchestrator + schedule
New edge function `dispatch-client-reports`:
- For each active client, calls `generate-client-report`, then for each active recipient matching the cadence, calls `send-ghl-message` per channel, logging results.
- pg_cron jobs:
  - `weekly-client-reports` — Mondays 14:00 UTC (covers 9am ET; function re-checks client TZ).
  - `monthly-client-reports` — 1st of month 14:00 UTC.
- Both POST to the dispatcher with the right cadence.

## Admin UI
- **Settings → Client Reports** page:
  - List clients × recipients with channel/cadence chips.
  - "Send test now" button (uses a `?test=true` flag, only goes to one chosen recipient).
  - Recent send log with status + GHL message ID.
- **Per-client Settings → Reporting tab**: recipient editor + last-sent timestamps.

## Out of scope (v1)
- Writing snapshots to Google Sheets (can be added later — Sheets connector is wired).
- WhatsApp delivery (existing `send-whatsapp-report` stays untouched).
- Building a separate in-app scorecard page (we reuse the existing public report).

## Technical details
- Migration: `client_report_recipients`, `client_report_sends` with RLS (`authenticated` read/write scoped via `agency_members`, `service_role` full).
- Edge functions: `generate-client-report`, `send-ghl-message`, `dispatch-client-reports` (all `verify_jwt = false`, internal `HPA1234$` body password per project convention).
- Compliance: HTML/SMS strings go through the existing `complianceLint` pattern (no "guaranteed"; auto-append risk disclaimer to email footer).
- Unsubscribe: per-recipient one-click link → public page sets `unsubscribed_at`; dispatcher skips unsubscribed rows.
- Branding tokens read from the project memory (Capital Creative: `#0B2B26` / `#C5A55A`, Playfair Display + Inter) — no hardcoded colors outside the email HTML template.
