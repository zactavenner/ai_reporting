# Daily Huddle 2.0 — Per-Client Walkthrough

Model the Weekly Call cadence: quick wins → walk every active client from the Agency Dashboard in dashboard order → yesterday vs today commitments → recap. Full recording + transcription + AI finalize. Client Health stays hidden until lead-form data is trustworthy.

## New agenda (defaults, editable in Settings)

1. Wins + Attendance — 2 min
2. Yesterday's Numbers (rollup) — 3 min
3. Client Walkthrough — dynamic (per active client)
4. Commitments (Yesterday → Today) — 3 min
5. Recap & Close — 1 min

Total ~20 min target. Auto-advance on by default. 60-min hard cap (mirrors Weekly Call).

## Client Walkthrough (the core new segment)

- Source of truth: `useClients()` ordered by `sort_order` (same query the Agency Dashboard uses). Exclude `status === 'paused' | 'on_hold'`. `active` + `onboarding` show. Live reorder / pause on the dashboard instantly reflects in the running huddle (React Query invalidation + realtime on `clients`).
- One sub-segment per client, generated at huddle start and re-synced whenever the client list changes mid-meeting (append/remove without losing progress on already-completed clients).
- Per-client screen (three stacked panels + header):
  - Header: client name, status chip, quick links (Dashboard, Meta, GHL), suggested time chip (default 60s; editable in settings).
  - Panel A — Scorecard iframe: reuse the same Google Sheet iframe the Weekly Call scorecard uses (`client_settings.scorecard_url` or existing field). Link-out button.
  - Panel B — Tasks: embed the existing `TaskBoardView`/`TaskDetailPanel` filtered to `client_id = current`. Same components, same writes — edits during huddle persist immediately. No forked task UI.
  - Panel C — Last 3 AI meeting summaries: pulled from `client_weekly_calls` (title, date, summary, top action items) newest first, expandable.
- Per-client Next / Skip / Back and a "sticky" progress bar showing X of N clients. Skipping a client marks it "skipped" in `huddle_client_reviews` for the recap.

## Commitments (replaces Accountability/Blockers)

New table `huddle_commitments`:

- `id`, `huddle_id`, `member_id`, `member_name`
- `client_id` (nullable — allows internal/agency commitments)
- `commitment` text
- `for_date` (which day this commitment is FOR)
- `status` `pending | done | missed | rolled_over` (default pending)
- `notes` text, `created_at`, `updated_at`

UI has two columns:

- Yesterday's Commitments: auto-loads rows where `for_date = yesterday` grouped by member. Each row has done/missed/roll-over buttons + one-line note. Missed/rolled entries auto-create a Today row when the facilitator hits "Roll over".
- Today's Commitments: each member enters 1–3 client-tagged commitments (client dropdown fed by the same active-client list). Enter to add, drag to reorder.

Analytics surface in Monthly Recap: per-member completion rate, missed streaks, most-committed clients.

## Recording, transcription, finalize

Reuse the Weekly Call recording pattern verbatim:

- `MediaRecorder` starts on huddle start, chunks uploaded to `weekly-call-recordings` bucket under `huddles/<id>/`.
- Recording-status chip in header (idle / recording / uploading / transcribing / done) matching Weekly Call styling.
- Auto-stop on Finish, and hard-stop at 60 min.
- New edge function `huddle-finalize` (clone of `weekly-call-finalize`, Gemini 2.0 Flash) → returns `title`, `summary`, per-client `client_notes[]`, and `suggested_tasks[]`. Writes:
  - `huddles.summary_text`, `huddles.title`, `huddles.transcript_url`
  - `huddle_client_reviews` (one row per walked client with AI notes)
  - Suggested tasks land in a review queue on the History tab; approve → inserts into `tasks` linked to the correct `client_id`.

## What stays / what goes

- Keep: Wins (with existing Attendance panel), Numbers rollup, Monthly Recap, History.
- Remove from active agenda: Client Health, standalone Accountability, standalone Blockers. Delete the segment files and their agenda entries; History views for old huddles still render legacy segments read-only.
- Old `DEFAULT_AGENDA` swapped for the new one; existing huddle rows keep whatever agenda they were created with (already stored per-huddle).

## Files to add

- `src/components/huddle/segments/ClientWalkthroughSegment.tsx` — orchestrates per-client sub-index, renders panels below.
- `src/components/huddle/segments/ClientReviewCard.tsx` — one client's Scorecard + Tasks + Past Summaries panel.
- `src/components/huddle/segments/CommitmentsSegment.tsx` — Yesterday / Today two-column UI.
- `src/hooks/useHuddleClients.ts` — active clients in dashboard order with realtime subscription.
- `src/hooks/useHuddleCommitments.ts` — CRUD + roll-over helper.
- `src/hooks/useHuddleRecording.ts` — shared recorder (refactor of weekly-call recorder into a hook both use).
- `supabase/functions/huddle-finalize/index.ts` — Gemini finalize.

## Files to update

- `src/lib/huddle/types.ts` — new `DEFAULT_AGENDA` (wins, numbers, client_walkthrough, commitments, close). Extend `TimerState` with optional `sub_index` for per-client stepping.
- `src/components/huddle/HuddleRunner.tsx` — route new segment keys; add recording chip + hard cap; per-client Next/Back inside walkthrough delegates to sub_index before advancing segment; realtime resync of client list.
- `src/components/huddle/HuddleSettingsDrawer.tsx` — expose per-client default duration + toggle to include onboarding clients.
- `src/components/huddle/HuddleHistory.tsx` — show title, per-client review list, approve-tasks queue, commitment completion.
- `src/components/huddle/HuddleMonthlyRecap.tsx` — add commitment completion rate + clients-covered %.
- Delete: `ClientHealthSegment.tsx`, `AccountabilitySegment.tsx`, `BlockersSegment.tsx` (drop imports from Runner).

## Database migration

```sql
-- Commitments
CREATE TABLE public.huddle_commitments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  huddle_id uuid NOT NULL REFERENCES public.huddles(id) ON DELETE CASCADE,
  member_id uuid,
  member_name text NOT NULL,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  commitment text NOT NULL,
  for_date date NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.huddle_commitments TO authenticated;
GRANT ALL ON public.huddle_commitments TO service_role;
ALTER TABLE public.huddle_commitments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read/write huddle_commitments" ON public.huddle_commitments
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Per-client review notes captured during / after a huddle
CREATE TABLE public.huddle_client_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  huddle_id uuid NOT NULL REFERENCES public.huddles(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  position int NOT NULL,
  status text NOT NULL DEFAULT 'pending', -- pending|reviewed|skipped
  duration_s int,
  notes text,
  ai_summary text,
  ai_action_items jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(huddle_id, client_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.huddle_client_reviews TO authenticated;
GRANT ALL ON public.huddle_client_reviews TO service_role;
ALTER TABLE public.huddle_client_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth rw huddle_client_reviews" ON public.huddle_client_reviews
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Add title + transcript_url to huddles if not present
ALTER TABLE public.huddles
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS transcript_url text,
  ADD COLUMN IF NOT EXISTS recording_url text;
```

## Out of scope (per your call)

- Client Health metrics — leaving hidden until lead-form data is trusted.
- No changes to Weekly Call, Agency Dashboard, or Tasks module internals — Huddle embeds them.

Ready to build this. Approve and I'll ship the migration, edge function, hooks, and refactored components in one pass.
