# Daily Huddle

A guided, timed daily stand-up at `/huddle` that pulls tasks, client health, and yesterday's reporting into one screen-share-friendly flow with realtime sync, per-person accountability, and history.

## Navigation

- Add "Daily Huddle" to `AppSidebar.tsx` with the `Timer` icon (from `lucide-react`), route `/huddle`.
- Register `/huddle` in `App.tsx` behind `PasswordGate` (matches every other internal route).
- Inside the page, two tabs: **Run Huddle** (default) and **History**.

## The Runner (screen-share UI)

Full-viewport layout, large typography (base 20px, timer 96px+), high-contrast on the existing design tokens — no new colors. Layout:

```text
┌─────────────────────────────────────────────────────┐
│  Segment name        ● ● ● ○ ○ ○   Overall 04:32    │
│                                                     │
│              [ 01:47 ]  ← 96px countdown            │
│                                                     │
│  ── segment body (varies per segment) ──            │
│                                                     │
│  Start  Pause  +30s  Skip  Next ▶   ☐ Auto-advance  │
└─────────────────────────────────────────────────────┘
```

- Timer color: neutral → `amber` at ≤20% remaining → `destructive` when overtime.
- Soft chime (`<audio>` with a short generated tone / bundled asset) on segment end.
- One facilitator (first to press Start) writes timer state; all others read via Supabase Realtime on `huddles` + a lightweight `huddle_state` channel.

### 6 segments (name/duration/order editable in a Settings drawer, stored in `huddle_settings`)

1. **Wins — 2:00.** Inline input (name + one line). New wins render as cards; yesterday's wins shown faded below.
2. **Yesterday's Numbers — 3:00.** Pull yesterday's rows from existing reporting views (`v_client_performance_*` / `daily_metrics`) grouped per client/pod: spend, leads, CPL, CPS, CPBC, booked calls, closes. **CPL/CPS/CPBC always render as a trio in one cell — never CPL alone.** Each row shows delta vs 7-day average with up/down arrows, sorted worst-trending first. "Flag as issue" button creates a huddle task pre-linked to that client.
3. **Client Health — 3:00.** Read `clients` + latest health status. Show only Yellow/Red as cards with a one-line reason input; Green count collapsed to a banner ("18 of 22 Green — skipped"). "Create task" pre-links the client.
4. **Accountability — 4:00.** Two panes:
   - Left: yesterday's huddle commitments (tasks where `source='huddle'` and `due_date=yesterday`) as checkboxes grouped by owner. Marking not-done requires a reason and auto-reschedules to today.
   - Right: each teammate adds today's Top 3 (title, optional client, due date defaulting to today).
   - Scoreboard at the top: % of yesterday's commitments completed per person, with streak count.
5. **Blockers — 2:00.** Quick-add (description + who unblocks). "Convert to task" in one tap.
6. **Close & Cascade — 1:00.** Auto-compiled plain-text summary preview + 1–10 rating input per attendee.

## Accountability layer

- Every item created in the huddle becomes a task with `owner`, `due_date`, optional `client_id`, `source='huddle'`, `huddle_id`.
- Overdue huddle tasks pin to the top of the Accountability segment until cleared.
- Attendance auto-logged: on Runner mount insert into `huddle_attendance` (member_id, huddle_id, joined_at); update `left_at` on unmount.

## End of huddle

On "Finish", persist to `huddles` (date, planned_duration, actual_duration, summary_text, ratings_avg) and generate the plain-text summary with a Copy button. Redirect to History tab with the new record highlighted.

## History view

Table of past huddles: date, duration (actual/planned), avg rating, attendance %. Header shows a 30-day line chart of team follow-through % (recharts, already installed).

## Data model (new tables only; reuse `clients`, `tasks`, `agency_members`, reporting views)

```sql
huddles(id, date unique, started_at, ended_at, planned_duration_s, actual_duration_s,
        facilitator_id → agency_members, summary_text, avg_rating, agenda jsonb)
huddle_wins(id, huddle_id, member_id, text, created_at)
huddle_blockers(id, huddle_id, member_id, description, unblocker_id, task_id nullable)
huddle_attendance(id, huddle_id, member_id, joined_at, left_at)
huddle_ratings(id, huddle_id, member_id unique-per-huddle, rating 1-10, note)
huddle_settings(id singleton, agenda jsonb)  -- [{key, name, duration_s, order}]
huddle_flags(id, huddle_id, client_id, reason, task_id nullable) -- from Numbers/Health segments
```

Extend `tasks`: add `source text` and `huddle_id uuid` columns (nullable, defaults preserve existing rows). If the migration detects the extension is unsafe, fall back to a `huddle_tasks` join table — but the direct columns are preferred so overdue queries stay simple.

RLS mirrors existing app pattern (authenticated read/write, service_role all); realtime enabled on `huddles`, `huddle_wins`, `huddle_blockers`, `huddle_attendance`, `huddle_ratings` so all viewers sync.

## Files to add

- `src/pages/HuddlePage.tsx` — tabs shell (Run / History).
- `src/components/huddle/HuddleRunner.tsx` — full-screen runner + timer engine.
- `src/components/huddle/segments/{WinsSegment,NumbersSegment,ClientHealthSegment,AccountabilitySegment,BlockersSegment,CloseSegment}.tsx`
- `src/components/huddle/HuddleHistory.tsx`
- `src/components/huddle/HuddleSettingsDrawer.tsx`
- `src/hooks/useHuddle.ts` (create/join/finish), `useHuddleTimer.ts` (realtime state), `useHuddleYesterdayMetrics.ts`, `useHuddleAccountability.ts`.
- `src/lib/huddle/summary.ts` — plain-text summary builder + copy helper.

## Files to edit (minimal, additive)

- `src/App.tsx` — new lazy route.
- `src/components/layout/AppSidebar.tsx` — new nav entry (`Timer` icon, `/huddle`).
- `supabase/migrations/*` — new tables, `tasks` extension, RLS, realtime publication.

## Guardrails

- No changes to existing routes, auth, reporting logic, agent workflows, or the sync pipeline.
- CPL/CPS/CPBC rendered together always — enforced in the `NumbersSegment` component (single `<MetricTrio>` sub-component; no code path renders CPL alone).
- Uses only existing design tokens and shadcn components; mobile responsive via the same breakpoint pattern the app already uses.

## Out of scope

- Editing reporting math, task ownership rules, or pod membership.
- New auth roles — everyone with app access can join a huddle; facilitator is whoever presses Start first.
- Video/audio conferencing (this is a companion to whatever call tool the team already uses).
