# Daily Huddle — Runner Upgrade Plan

## What we're fixing

1. **Back button** — currently one-way; you can't step back.
2. **Segment timers don't reset/auto-start** — moving forward inherits stale state.
3. **Today's Tasks aren't real** — Accountability shows only huddle-tagged tasks. Should pull the whole team's real workload.
4. **Client Health drags** — no per-client pacing, easy to lose the room.
5. **Data accuracy** — assignee names, completion, and rollovers need to be truthful and live.

---

## Changes

### 1. Back button + segment reset + auto-start

- Add a **Back** button next to Next in the runner footer.
- On Back **or** Next: reset that segment's timer state on the server (`segment_started_at = now()`, `paused_elapsed_s = 0`, `extra_s = 0`, `running = true`), so every arrival at a segment starts a fresh countdown for every viewer.
- Entries already written (wins, blockers, tasks, ratings, flags) are **kept** — navigation only touches timer state.
- Chime guard resets on segment change (already in place; verify).
- Facilitator-agnostic: anyone can navigate; last-write-wins via Realtime (matches current model).

### 2. Client Health — 45s per client, auto-advance

- Replace the single scrollable list with a **one-client-at-a-time card** (big client name, health color, CPL vs 7-day baseline, spend, leads).
- 45-second sub-timer per flagged client; auto-advance to next client when it hits 0 or when facilitator clicks "Next client".
- Segment ends when the last flagged client is done (or segment timer expires, whichever first).
- Skip-green banner stays at top ("X of Y green — skipped").
- "Create task" and reason input remain inline on the active card; task writes to real `tasks` table with `source='huddle'`.

### 3. Accountability — real Today's Tasks, grouped by client → assignee

**Data sources merged (deduped by task id):**
- All open tasks in `tasks` where `due_date <= today` AND `status NOT IN ('completed','done','cancelled')` — resolved via `task_assignees` for multi-assignee accuracy.
- Yesterday's `daily_reports` (EOD) `top_priorities` — surfaced as commitment chips per member.
- Rolled-over huddle commitments — yesterday's `tasks` with `source='huddle'` still open.
- Restrict clients to `status IN ('active','onboarding')`.

**Display:**
- Grouped by **Client** (accordion), then **Assignee** inside each client.
- Unassigned tasks + agency-level (no client) grouped under "Agency / Unassigned".
- Each row: checkbox (toggle completed), title, due date pill (red if overdue), assignee avatar/initials.
- Follow-through scoreboard chips stay at top (uses yesterday's huddle tasks, unchanged logic).
- Live updates via Realtime on `tasks` + `task_assignees` — check/uncheck by any viewer reflects everywhere within ~1s.

**Yesterday's Commitments panel** (left column) stays but pulls from *both* yesterday's huddle tasks AND yesterday's EOD `top_priorities` to catch commitments made outside the huddle.

### 4. Data accuracy pass

- Resolve assignee names via `task_assignees` join (currently only reads legacy `tasks.assigned_to`), so multi-assignee tasks show every owner.
- Client name resolution via a single `clients` map fetched once per segment mount.
- Realtime channels added for `tasks` and `task_assignees` on the Accountability segment only (torn down on unmount).
- Numbers segment: verify CPL/CPS/CPBC use yesterday's `daily_metrics` for onboarding + active clients (already fixed) — add a "as of" timestamp and a manual refresh button so the room trusts the number.

### 5. Suggestions to make it the best huddle possible (opt-in — I'll build the ones you check)

- **Attendance roll-call chip strip** at the top of the runner: green dot per member present, gray if not yet joined. One-click "mark present" from a phone.
- **Speaker rotation** in Wins: 20s per attendee auto-advance so no one hogs the mic.
- **Blocker → task** button so every blocker leaves the huddle as a real assigned task with a due date.
- **Yesterday-vs-today delta line** in Numbers (green/red arrows on CPL/CPS/CPBC).
- **Streak flames** on the scoreboard (7-day, 30-day follow-through) instead of just today's %.
- **"Copy summary to Slack"** button (in addition to clipboard) — posts to a configured huddle channel via existing Slack integration.
- **Keyboard shortcuts**: Space = pause, → = next, ← = back, N = new task, R = rate.
- **Persistent history search + filter by tag** on the History view.

## Technical notes

- Files touched: `HuddleRunner.tsx` (Back button, reset-on-nav), `useHuddle.ts` (add `resetSegmentTimer(index)`), `AccountabilitySegment.tsx` (rewritten data pull + grouping + realtime), `ClientHealthSegment.tsx` (per-client card + 45s sub-timer), small addition to `summary.ts` for grouped output.
- No DB migration required for the core fixes. If you pick "Copy to Slack" or "Blocker→task" enhancements, no schema change either — both use existing tables/functions.
- No changes to existing routes, auth, reporting logic, or agent workflows.

## Confirm before I build

- Green-light the core changes (1–4).
- Tell me which of the 8 suggestions in section 5 to include — or "all", "none", or a subset.
