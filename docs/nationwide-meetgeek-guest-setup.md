# Nationwide — MeetGeek guest-only calendar setup

**Status: DISABLED.** Nationwide stays disabled until every item in the evidence
checklist below is signed off. Saving the config with "enabled" on while any
blocker exists persists it as `blocked` and keeps `enabled = false` by design.

## Model

The MeetGeek notetaker account is **only ever a guest (attendee)** on the
organizer's own Google Calendar event. It is never:

- a linked GHL calendar,
- a GHL appointment owner or `assignedUserId`,
- a conflict calendar,
- a Google event organizer/creator.

`assertOwnerPreserved()` blocks any payload containing `organizer`, `creator`,
`owner`, `assignedUserId`, `calendarId` or `transferOwnership`, and refuses to
mark the bot as organizer.

## Server pieces

| Piece | Purpose |
| --- | --- |
| `google-calendar-oauth-start` | Operator-gated; least-privilege `calendar.events` + `userinfo.email` |
| `google-calendar-oauth-callback` | Signed-state exchange; refresh token stored server-side only |
| `meetgeek-guest-admin` | Operator-gated status/config; returns redacted connection metadata only |
| `ghl-appointment-webhook` | Signed intake → server-side appointment read → gate → idempotent guest invite |
| `google_calendar_connections` | Token store; RLS on, no policies, `service_role` only |
| `client_meetgeek_guest_configs` | Per-client mapping + enabled flag; `service_role` only |
| `meetgeek_guest_invite_jobs` | Operational audit trail; `service_role` only |

Secrets used: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` (existing,
unchanged) and `GHL_APPOINTMENT_WEBHOOK_SECRET` (new, server-held). The existing
Gmail OAuth flow and its scopes are untouched.

## Outbound GHL Workflow (exact setup)

1. **Sub-account:** Nationwide only.
2. **Automation → Workflows → Create Workflow → Start from Scratch.** Name:
   `MeetGeek guest invite — <calendar name>`.
3. **Trigger:** `Customer Booked Appointment`.
   - Add filter **Calendar** `is` → the single Nationwide calendar mapped in
     Settings. No other calendar may be selected. Do not add a second trigger.
4. **Action:** `Webhook`.
   - Method: `POST`
   - URL: `https://<project-ref>.supabase.co/functions/v1/ghl-appointment-webhook`
   - Headers:
     - `Content-Type: application/json`
     - `x-hpa-signature: sha256=<HMAC-SHA256 hex of the exact raw body, keyed with GHL_APPOINTMENT_WEBHOOK_SECRET>`
   - Body (JSON): must include `appointmentId`, `calendarId`, `locationId`.
5. Publish the workflow, but leave the client **disabled** in Settings until the
   checklist passes.

Unsigned, wrongly signed, unmapped, disabled, mismatched-location or
mismatched-calendar calls are rejected (401 / `202 rejected`) and logged to the
job table with a reason. Never paste the secret anywhere except the workflow
header field and Project Settings → Secrets.

### Event linkage requirement

GHL's appointment payload usually has **no Google event id**. The webhook
therefore:

1. searches the organizer's calendar for a prior event tagged
   `privateExtendedProperty=hpaGhlAppointmentId=<appointment id>` → patch it;
2. otherwise searches the appointment's exact time window on the organizer's
   calendar and adopts it **only when exactly one** event matches (then tags it);
3. otherwise parks the job as `needs_event_link` — it never creates a second
   event, so duplicates are impossible.

For full automation, the mapped GHL calendar must book into the connected
organizer's Google Calendar (so step 2 resolves to one event), or GHL must send
the Google event id.

## Evidence checklist (all required before enabling Nationwide)

- [ ] Organizer Google Calendar connection exists and `Verify` returns OK.
- [ ] Guest config saved with the one mapped CRM calendar, organizer calendar id
      and notetaker guest email; validation status `validated`.
- [ ] `GHL_APPOINTMENT_WEBHOOK_SECRET` configured; Settings shows the secret as
      configured.
- [ ] Controlled test booking on the mapped calendar only.
- [ ] Organizer unchanged on the Google event (organizer/creator identical
      before/after).
- [ ] GHL appointment owner / `assignedUserId` unchanged.
- [ ] Notetaker appears as a **guest** on the event.
- [ ] MeetGeek joins the meeting.
- [ ] Transcript ingests into the meeting record.
- [ ] Quality score (HNWI QA rubric) runs and stores a total + gate status.
- [ ] Client match resolves to Nationwide (no cross-client leakage).
- [ ] GHL activity/note writeback succeeds.
- [ ] Replay of the same webhook produces no duplicate event and no second
      invite (job stays `invited`).

Only after every box is checked may `enabled` be turned on for Nationwide.