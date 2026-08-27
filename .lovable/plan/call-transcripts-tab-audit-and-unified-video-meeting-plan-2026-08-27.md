# Call Transcripts tab — audit and unified video-meeting plan

## 1. What renders the tab

- `src/components/calls/CallTranscriptsTab.tsx` — the tab itself (KPIs, filters, table, CSV export, "Webhook URL" copy, "Run queue").
- Mounted in `src/pages/Index.tsx` (line 544) under the Reporting tab set.
- Detail drawer: `src/components/calls/CallTranscriptDetail.tsx`; helpers in `src/components/calls/callTranscriptUtils.ts`.
- Data layer: `src/hooks/useCallTranscripts.ts` (`useCallTranscripts`, `useReprocessCall`, `useProcessPendingCalls`).

## 2. Tables it touches

- Reads/writes **`public.phone_call_records`** only (created in `supabase/migrations/20260812214042_...sql`, 45 columns incl. `recording_url`, `transcript`, `speaker_segments`, `summary`, `outcome`, `intent_score`, `raw_payload`).
- Reads `clients` (via `useClients`) for the client filter labels.
- RLS today: public `SELECT` (`USING true`), `UPDATE` for anon/authenticated. Inserts happen only through the service-role Edge Function.

## 3. What feeds it

Yes — `supabase/functions/call-transcription/index.ts` is the sole feeder (plus `ai-caller-webhook` and `_shared/notetakerCoverage.ts`, which read/derive from the same table).

It has four modes: default `ingest`, `process_pending`, `reprocess`, `analyze_only`. Auth is `body.password` / `?password=` / `x-hpa-webhook-token` against the internal password. Transcription uses `_shared/transcription.ts` (Lovable AI Whisper endpoint, 20 MB chunking); analysis uses `_shared/openrouter.ts`; write-back note to GHL via `_shared/ghlMapping.ts`.

## 4. Payload it expects

`mapPayload()` (line 74) is tolerant and accepts many aliases:

```text
call_id | callId | CallSid | id            -> unique key (upsert onConflict: call_id)
recording_url | recordingUrl | RecordingUrl | recording
call_status | status | CallSid status       -> "completed|answered|ended" triggers inline processing
duration | duration_seconds | callDuration
started_at | call_start_time | startTime | dateAdded | calendar.startTime
contact_id | contactId | contact.id, contact_name, contact_phone, contact_email
assigned_user(.id/.phone), campaign, direction, appointment_id
client_id (optional uuid; else resolved from leads.external_id or last-10 phone digits)
password (required), transcribe:false / push_ghl:false (optional)
```

## 5. Why the tab looks empty/non-functional

Confirmed by querying production:

- `phone_call_records`: **267 rows, 0 with `recording_url`, 0 transcripts, 0 summaries**; all rows `transcription_status = 'awaiting_recording'`, all `provider = 'webhook'`.
- Sample `raw_payload` rows are **GHL appointment-booked payloads** (tags "call booked", `appointment_id`, future `started_at`), not completed-call events. So the webhook is currently wired to an appointment trigger, not a call/recording-complete trigger.
- Result: rows exist, but every transcript/summary/intent column is null, so KPIs read 0 and the table looks dead. `Run queue` is a no-op because `process_pending` requires `recording_url IS NOT NULL`.

Root cause is data-source wiring, not the UI or function code.

## 6. Video meetings — reuse or extend?

The MeetGeek path already exists and is separate: `supabase/functions/meetgeek-webhook/index.ts` writes `meeting_records` (provider, `meeting_external_id`, summary, `action_items`, `transcript_text`, `transcript_url`, `recording_url`), plus `lead_meeting_context`, `meeting_call_activity`, `meeting_ingest_events`, `notetaker_coverage`. `meeting_records` is currently **0 rows** (no meetings ingested yet under the calendar-gate rule that refuses ingest without a resolved client).

Recommendation: **do not re-point MeetGeek at `call-transcription`.** Keep MeetGeek's ingest, gating and idempotency as the system of record for meetings, and unify at the read layer.

### Recommended minimal-change architecture

1. **Unified read view** — new `public.v_unified_call_transcripts` (SQL view, no data migration):
   - phone leg: `phone_call_records` mapped to a common shape with `media_kind = 'audio'`, `source = 'phone'`.
   - video leg: `meeting_records` (+ `lead_meeting_context` for contact/lead attribution) mapped with `media_kind = 'video'`, `source = provider`, `transcript_text -> transcript`, `action_items -> next steps`, `duration_minutes * 60 -> duration_seconds`.
   - Grant `SELECT` to `anon`/`authenticated` to match the existing tab's access model.
2. **Hook change only** — `useCallTranscripts.ts` selects from the view instead of the table; add `media_kind`, `recording_url`, `action_items` to `CallTranscriptRecord`.
3. **UI** — `CallTranscriptsTab.tsx`: add a source filter (All / Phone / Video) and a media badge; `CallTranscriptDetail.tsx`: render an inline `<video>` player when `media_kind = 'video'` and the recording URL is playable, keep the existing audio/open-in-new-tab button otherwise, and show MeetGeek action items as a section.
4. **Mutations stay scoped** — `useReprocessCall` / `useProcessPendingCalls` remain phone-only (disable the buttons for video rows); video re-ingest continues through the MeetGeek admin/replay path.
5. **Fix the phone feed separately** — repoint the GHL webhook from the appointment-booked trigger to a call-completed / recording-ready trigger (or add a poller that fills `recording_url` on existing `appointment_id` rows), so `process_pending` can actually transcribe.

### Technical notes

- No changes to `call-transcription` are required for video support under this design; the only backend artifact is one read-only view.
- Attribution for video rows comes from the existing calendar gate: `meeting_records.client_id` + `lead_meeting_context.ghl_contact_id` / `lead_id`, so client and GHL contact matching is already solved.
- Keeping the two ingest paths distinct preserves MeetGeek's exactly-once terminal states in `notetaker_coverage` (recently hardened) and avoids a second writer to `phone_call_records`.

Nothing has been changed in this pass — this is inspection plus the proposed implementation.
