# Fix: Hide completed tasks in daily task views

## Problem
On the daily reporting page (`/eod` route → DailyReportPage with SOD/EOD tabs), the **SOD tab** shows tasks due today but does **not** filter out tasks that are already completed. This means a task marked as "Done" during SOD stays visible in the list instead of being removed.

The EOD tab already correctly filters completed tasks via its `bucketize()` helper, but the SOD tab's `dueToday` memo lacks the same guard.

## Changes
1. **`src/components/daily/SODView.tsx`** — add `t.status === 'completed' || t.stage === 'done'` filter inside the `dueToday` `useMemo` so completed tasks are excluded from the actionable list.

## Verification
- Mark a task as Done in the SOD tab → it should immediately disappear from the "Tasks Due Today" list.
- Refresh the page → the completed task should remain hidden.
- The EOD tab's Overdue / Due Today / Upcoming lists should continue to work as before (already filtered).