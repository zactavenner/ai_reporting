## Goal

1. Make Google Sheets ingestion read **every tab** in each client's sheet (not just the saved year-tab + year siblings) so the executive dashboard reflects 100% of the data.
2. Dedupe overlapping dates so rolled-up totals stay accurate.
3. Roll the merged per-client totals into the agency executive dashboard (already wired — verify after change).
4. Add a "Best Performing Campaigns / Targeting / Ads" widget on the executive dashboard, sourced from Meta ad insights already in the DB.

Lead-dedup + auto-enrichment automation will be unblocked once all tabs are flowing; covered as a follow-up note, not in this build.

## Changes

### 1. `supabase/functions/fetch-sheet-metrics/index.ts` — read ALL tabs

Replace the current "year-sibling only" detection with a full-sheet scan:

- After resolving the primary tab from `gid`, list **every** tab via the existing metadata call.
- Filter out tabs that are clearly not daily metrics:
  - Title matches a denylist: `notes`, `instructions`, `readme`, `template`, `dashboard`, `summary`, `monthly`, `weekly`, `mtd`, `ytd`, `pivot`, `chart`, `lookup`, `config`, `archive` (case-insensitive substring match).
  - Tab returns 0 parseable date columns / rows (already handled — empty `part` is skipped).
- Fetch remaining tabs in parallel (chunked at 8 at a time to stay under quota, with the existing `fetchWithRetry` 429 backoff).
- Parse each with the existing `parseColumnMajor` / row-major fallback.

### 2. Dedupe on merge

Today the merge **sums** values for the same date across tabs. That's correct for year siblings (no overlap) but will double-count when a "Q1" tab and a "2025" tab both contain the same dates.

Change merge strategy:
- Track `(date, metric) → max value seen across tabs` instead of summing.
- Rationale: if the same date appears in two tabs, the tab with the most complete numbers wins per-metric. Prevents inflation while still picking up dates that only exist in one tab.
- Recompute CTR from merged impressions/clicks at the end.

### 3. Surface tab coverage in the response

Add to the JSON response:
- `tabsScanned: string[]` — every tab title fetched.
- `tabsUsed: string[]` — tabs that contributed at least one date.
- `tabsSkipped: { title: string; reason: string }[]` — denylist hits + empty tabs.

Used by Sheets Health page and the dashboard "data source" tooltip so we can see which tabs are flowing.

### 4. Sheets Health page — show coverage

`src/pages/SheetsHealthPage.tsx`: render the new `tabsUsed` / `tabsSkipped` arrays in a small expandable section per client so we can audit at a glance.

### 5. Executive dashboard — Best Performing widget

New component `src/components/dashboard/BestPerformingPanel.tsx` rendered in `src/pages/Index.tsx` under the KPI grid (dashboard tab only).

Three small cards side-by-side, scoped to the active date range and the agency-wide client filter already in state:

- **Top Campaign** — highest funded $ / lowest cost-per-funded, falling back to lowest CPL when no funded data.
- **Top Targeting** — best-performing ad set by the same ranking.
- **Top Ad** — best-performing creative (ad) with thumbnail.

Data source: existing `meta_ads_insights` + `meta_campaigns` / `meta_adsets` / `meta_ads` tables (already synced — confirmed in memory `[Meta Ads Configuration]`). Aggregate spend + funded $ per campaign/adset/ad in a single Supabase query via a new RPC `get_top_performers(p_start, p_end, p_client_ids)` returning the top row per scope. Tiebreak: lowest CPL.

Each card shows: name, spend, leads, funded $, CPL, cost-per-funded, and a "View" link to the Ads Manager view filtered to that entity.

### 6. Migration

New migration adds the `get_top_performers` SQL function (read-only, `SECURITY DEFINER`, scoped to `public`).

## Out of scope (follow-up)

- Lead-level dedupe + auto-enrichment trigger: once all tabs land cleanly, we'll add a nightly job that calls the existing RetargetIQ enrichment for any new unenriched leads. Tracked separately.

## Technical notes

- Cache key in the edge function stays per `sheet_id+gid+range+mapping`; with the new "scan all tabs" behavior the gid effectively just picks the primary tab title for layout detection, and TTL stays at 90s so multi-client dashboards still coalesce.
- Denylist is a constant array at the top of the file; easy to extend later without a redeploy of any other surface.
- `get_top_performers` returns at most 3 rows (one per scope) so the dashboard query stays cheap.
