## Goal

Add a **Weekly Call** tab under each client in `ClientDetail.tsx` that runs a structured, timed weekly meeting for that client — same "flow" as the Daily Huddle (segments, big timer, next/back/pause, auto‑advance, chime, notes captured live) but scoped per client and per week.

## Agenda (default segments)

1. **Wins (3 min)** — quick wins from the past week, per attendee.
2. **Scorecard (5 min)** — auto‑pulled KPIs for the last 7d (leads, booked/showed, funded, spend, CPL, blended CPA) with a spot for commentary + red/yellow/green.
3. **Pipeline & Deals (4 min)** — biggest deals moved, stalled, closest to close (auto from `deals` / `pipeline_opportunities`).
4. **Creative Review (4 min)** — top creatives from `WeeklyRecapCard` data + notes.
5. **Tasks / Accountability (5 min)** — last week's tasks (done vs open) + add this week's tasks straight into `tasks` for that client.
6. **Blockers & Risks (3 min)** — capture blockers, assign owners.
7. **Ideas / Experiments (3 min)** — parking lot for ideas to test.
8. **Wrap‑up (2 min)** — recap, next steps, one‑line summary, email/slack recap toggle.

Total default: ~30 min, editable per client via a settings drawer (same UX as `HuddleSettingsDrawer`).

## Backend (new tables, all with RLS + GRANTs)

```text
client_weekly_calls
  id, client_id, week_of (date, Mon), started_at, ended_at,
  planned_duration_s, actual_duration_s, facilitator_id,
  status, agenda (jsonb), timer_state (jsonb),
  summary_text, avg_rating

client_weekly_call_items       -- unified store for wins/blockers/ideas/notes
  id, call_id, client_id, kind ('win'|'blocker'|'idea'|'note'|'scorecard_note'|'creative_note'),
  member_id, member_name, text, meta (jsonb), created_at

client_weekly_call_tasks       -- tasks reviewed / created in the call
  id, call_id, task_id (fk tasks), action ('reviewed'|'created'|'completed'),
  created_at

client_weekly_call_ratings
  id, call_id, member_id, rating (1‑5), comment, created_at

client_weekly_call_settings    -- one row per client for default agenda override
  client_id (pk), agenda (jsonb)
```

Realtime enabled on the four content tables so multiple viewers stay in sync (same pattern as `huddle_*`).

## Frontend

- **`src/pages/ClientDetail.tsx`** — add `<TabsTrigger value="weekly-call">Weekly Call</TabsTrigger>` (with `CalendarClock` icon) and a matching `<TabsContent>` that renders `<WeeklyCallTab clientId={clientId} />`.
- **`src/components/weekly-call/`** (new):
  - `WeeklyCallTab.tsx` — landing view: "This week's call" card + button to Start/Resume, plus a compact history list of past weekly calls with summaries & ratings.
  - `WeeklyCallRunner.tsx` — mirrors `HuddleRunner`: header with segment name + progress dots, giant timer, per‑segment body, sticky footer with Start/Pause/Resume/+30s/Back/Skip/Next/Auto‑advance/Finish. Reuses `playChime`, `fmt`, timing hook logic (extract shared helpers from `useHuddle` into `src/lib/timedMeeting/*` and reuse for both huddle + weekly).
  - `segments/WinsSegment.tsx` — same UX as huddle wins, scoped by `call_id`.
  - `segments/ScorecardSegment.tsx` — pulls from `useWeeklyRecap(clientId, weekStart)` and shows KPI tiles + a notes textarea saved as `scorecard_note`.
  - `segments/PipelineSegment.tsx` — top movers / stalled / closest deals from `useDeals` filtered to `client_id`, plus notes.
  - `segments/CreativeSegment.tsx` — top creatives from recap; notes.
  - `segments/TasksSegment.tsx` — two columns: "Last week" (tasks completed/open from `tasks` where `client_id=` and updated in window) and "This week" quick‑add that inserts new `tasks` rows and links them via `client_weekly_call_tasks`.
  - `segments/BlockersSegment.tsx` — capture + owner assignment.
  - `segments/IdeasSegment.tsx` — parking lot.
  - `segments/WrapupSegment.tsx` — auto‑generated one‑line summary (AI via `lovable-ai` edge function using this call's items), rating widget, toggle "Email recap to team" (reuses existing recap sender if present, otherwise inserts a row into `weekly_syncs` so the current `WeeklyRecapCard`/recap emailer picks it up).
  - `WeeklyCallSettingsDrawer.tsx` — edit agenda per client.
  - `WeeklyCallHistory.tsx` — list past calls with duration, avg rating, click → read‑only replay.
- **`src/hooks/useThisWeekCall.ts`** — mirrors `useTodayHuddle`: loads or creates the row for the current week (`week_of = start of ISO week`), subscribes to realtime updates, exposes `updateTimer` / `updateCall` / `updateAgenda`.

## Extras (worth adding while building)

- **Auto‑fill from recap** — button in Wrap‑up that pushes the summary + numbers into `weekly_syncs` for that client so the existing `WeeklyRecapCard` and email flow stay in sync.
- **Attendance** — small avatar row driven by `TeamMemberContext`, stored in a `client_weekly_call_attendance` table (same pattern as `huddle_attendance`).
- **Post‑call Slack ping** — if `slack_channel_mappings` exists for that client, post the one‑line summary + ratings.
- **Read‑only replay** — clicking a past call opens the Runner in `readOnly` mode showing what was captured, useful for absent teammates.
- **Deep link** — `/clients/:id?tab=weekly-call` already works via existing `handleTabChange`; also support `?week=YYYY-MM-DD` to jump to a specific week.

## Technical notes

- ISO week start helper: Monday 00:00 in the browser TZ; store as `date`.
- All new tables: `ENABLE ROW LEVEL SECURITY`, policies gated by `authenticated`, plus `GRANT SELECT, INSERT, UPDATE, DELETE ... TO authenticated` and `GRANT ALL ... TO service_role` per project rules.
- Reuse `TeamMemberContext` for `member_id` / `member_name` and facilitator election (first presser).
- Extract `fmt`, `playChime`, `segmentElapsedS`, `useSegmentTiming` into `src/lib/timedMeeting/` so both `HuddleRunner` and `WeeklyCallRunner` share one implementation — no behavior change for the huddle.
- No changes to existing huddle tables or `weekly_syncs` schema; we only *write* into `weekly_syncs` from the wrap‑up step.

Ship in one pass: migration → shared helpers → hook → segments → runner → tab wiring.
