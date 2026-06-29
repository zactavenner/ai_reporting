
## Goal
Verify the "Executive Scorecard" tab on every client's KPI Google Sheet is readable end-to-end (Sheets API → `fetch-sheet-metrics` edge function → app), and report any gaps. Then make the integration treat it correctly — today the function aggregates every non-denylisted tab, and "Executive Scorecard" isn't in the denylist or in any explicit allowlist, so it may be silently double-counting (if it's a rollup) or being missed (if it's the wrong shape).

## What I'll do

### 1. Audit pass (read-only)
For each active/cc_error client with a `kpi_google_sheet_url`:
- Call `fetch-sheet-metrics` with `action: 'list_tabs'` to enumerate tab titles + gids
- Identify the Executive Scorecard tab (case-insensitive match on "executive", "scorecard", "exec scorecard")
- Call `fetch-sheet-metrics` with `action: 'raw_grid'` and that tab's gid to confirm headers + non-zero rows come back
- Record per-client: tab found? headers present? row count? fetch latency? errors?

Produces a status table covering all ~22 clients (plus the 2 with no sheet configured).

### 2. Classify the tab shape
For each sheet's Executive Scorecard, determine whether it's:
- **Rollup** (totals / KPI summary, not date-indexed) — should be denylisted so it doesn't double-count daily metrics
- **Record/daily** (date-indexed rows) — keep included in aggregation
- **Empty / formula-only** — flag for the client to fix

### 3. Code fixes in `supabase/functions/fetch-sheet-metrics/index.ts`
Based on classification:
- Add `'scorecard'`, `'executive scorecard'`, `'exec scorecard'` to `TAB_DENYLIST` if (as expected) it's a KPI rollup, so it stops contaminating daily aggregation
- OR add a dedicated parser branch that surfaces the scorecard values separately under a new `scorecard` field in the response, leaving daily aggregation untouched
- Add a structured log line `[scorecard] sheet=<id> tab=<title> rows=<n>` so future audits can grep edge logs

### 4. Surface in the app (optional, ask)
If you want the Executive Scorecard values shown anywhere in the dashboard (not just hidden from aggregation), I'll add a small read-only panel on the client dashboard that calls `fetch-sheet-metrics` with `action: 'raw_grid'` on the scorecard tab and renders the KPI rows.

### 5. Deliverable
- Markdown audit table posted in chat (✅ found & healthy, ⚠️ found but empty/broken, ❌ no scorecard tab, ⛔ no sheet configured)
- Code patch + redeploy of `fetch-sheet-metrics`
- Spot-check 3 clients after deploy to confirm aggregation totals didn't drop (rollup removed) or jump (records added)

## Open questions before I build
1. Is "Executive Scorecard" the **exact** tab name to look for, or are aliases ("Exec Scorecard", "Executive KPIs", etc.) in play?
2. Should the scorecard be **excluded from daily aggregation** (denylist) or **surfaced separately** in a new dashboard panel? Or both?
3. For clients missing the tab, do you want me to flag them only, or auto-create the tab from the master template via `create-client-sheet`?
