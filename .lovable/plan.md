# MeetGeek key activation + full invite coverage

## What's true right now (verified)

- No MeetGeek API key is stored anywhere in the database: `agency_settings.meetgeek_api_key` is empty for all rows, and 0 clients have a client-level key or `meetgeek_enabled`. The webhook falls back to the `MEETGEEK_API_KEY` environment secret.
- That fallback is failing: 44 signature-valid MeetGeek ingest events are parked with `hydration_code = unauthorized` (most recent Sep 2), so transcripts/summaries/quality scores are not being pulled.
- Notetaker invite coverage is incomplete for active clients:
  - `retireatlas.com` — no guest config at all.
  - `Evia Company` and `JJ Dental` — config exists but `validation_status = blocked`, `enabled = false`.
  - The remaining 14 active clients are `validated` + enabled, but 6 of them have never sent an invite (`last_invite_at` null): Clear Summit Investments, Icon American Fund, Lansing Capital, Paradyme, Shepherd Premier Senior Living, SugarFina, Texas State Oil.
- 378 invite jobs sit at `pending`, 54 of them for meetings still in the future (through Sep 16).

## Plan

1. **Store the key server-side only**
   - Save the supplied key as the `MEETGEEK_API_KEY` secret and pin `MEETGEEK_REGION = eu` (the key is EU-prefixed, and pinning skips region probing so a US probe can never mislabel the account).
   - Rebind secrets and redeploy the MeetGeek functions so the new value is live. The key stays out of code, the client bundle, and logs.

2. **Verify authentication before anything else**
   - Run the existing MeetGeek connection test and one authenticated meeting read. If it returns `unauthorized`, stop and report — no further steps run on a bad key.

3. **Recover the 44 stalled meetings**
   - Invoke the bounded `mg_replay_hydration_failures` recovery action (service-role auth, capped at 50 per run) to re-hydrate transcripts, summaries, and quality scores for the parked events. Report per-code counts afterward.

4. **Close the invite gaps for every active client**
   - Diagnose the `blocked` validation reason for Evia Company and JJ Dental, fix the underlying mapping (location/calendar), and enable them once validation returns `validated`.
   - Create and validate a guest config for `retireatlas.com` with `theainotetaker@gmail.com` as the guest.
   - For the 7 validated-but-never-invited clients, confirm whether they simply have no bookings yet or whether their calendar mapping isn't matching — fix mapping where it's the cause.

5. **Flush pending invites and confirm**
   - Run the guest poller (which also reconciles the coverage ledger) so the 54 future-dated pending jobs get their shadow invites sent to the notetaker inbox.
   - Re-read the coverage ledger and invite-job statuses, then confirm the AI Meetings tab shows hydrated summaries/quality scores.

## Security note

The key was pasted into chat, so treat it as exposed. After it's working I recommend rotating it in MeetGeek and re-saving the new value through the secret store; nothing in the app needs the old value once rotated.

## Technical detail

- Key resolution path: `resolveMeetgeekApi` → client override → `resolveAgencyMeetgeekApi` → `agency_settings.meetgeek_api_key` → `MEETGEEK_API_KEY` env. We use the env secret only.
- Region: `_shared/meetgeekRegion.ts` short-circuits probing when `MEETGEEK_REGION` is set.
- Recovery: `meetgeek-webhook` action `mg_replay_hydration_failures`, already auto-invoked every 10 minutes by `meetgeek-guest-poll`; we trigger it once immediately.
- Invite pipeline: `_shared/guestPoller.ts` + `icsInvite.ts` shadow invites (no Google OAuth), audited in `meetgeek_guest_invite_jobs`.
- Configs live in `client_meetgeek_guest_configs` (service-role only).
