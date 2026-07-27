# Automate daily "FB Spend" Google Sheet sync

## Goal
Every day, automatically append yesterday's Meta ad performance (per campaign, per client) into the **FB Spend** tab of each client's KPI Google Sheet — matching the exact columns in the screenshot, plus a few useful extras.

## Columns written to the "FB Spend" tab

| # | Column | Source |
|---|---|---|
| 1 | Date | insights day |
| 2 | Campaign Name | Meta campaign name |
| 3 | Ad Spend | insights.spend |
| 4 | Impressions | insights.impressions |
| 5 | Clicks | insights.clicks (link clicks) |
| 6 | Frequency | insights.frequency |
| 7 | CTR | insights.ctr |
| 8 | Reach | insights.reach *(new)* |
| 9 | CPM | insights.cpm *(new)* |
| 10 | CPC | insights.cpc *(new)* |
| 11 | Leads | actions → lead |
| 12 | Cost/Lead | spend / leads *(new)* |
| 13 | Campaign ID | for dedupe key *(hidden-friendly)* |
| 14 | Account ID | for multi-account clients |
| 15 | Synced At | run timestamp |

Header row is written once on tab creation and auto-repaired if column count changes.

## Behavior

- **Per-client sheet**: writes to the URL in `client_settings.kpi_google_sheet_url` (falls back to `metrics_sheet_id`). Clients without a sheet URL are skipped and logged.
- **Tab name**: `FB Spend` (created if missing, header written on create).
- **Dedupe key**: `Date + Campaign ID + Account ID`. If a row for that key exists, it's updated in place; otherwise appended. No duplicate rows on re-runs or backfills.
- **Backfill window**: default = yesterday. Function accepts `{ days_back: N }` for one-off backfills (up to 30 days).
- **Also writes to Supabase**: continues upserting `ad_spend_daily` so Data Health + reporting stay in sync (this already works; we just extend the row with reach/frequency/ctr/cpm/cpc).
- **Multi-account clients**: one row per campaign per account per day; account column disambiguates.

## Schedule

- `pg_cron` job **`fb-spend-sheet-daily`** at **06:15 UTC (~11:15 PM PT)** — after Meta's day-close, before the 6 AM PT accuracy window.
- A safety re-run at **13:30 UTC (~6:30 AM PT)** with `days_back: 3` to catch late-attributed conversions.
- Each run logged to `ad_spend_sync_runs` with status + row counts (already exists; extend with sheet write counts).

## Files touched

- `supabase/functions/sync-meta-ad-spend/index.ts` — extend Meta fields fetched (`reach,frequency,ctr,cpm,cpc,actions`), extend sheet writer, switch to per-client `kpi_google_sheet_url`, rename tab constant to `FB Spend`, expand header, extend dedupe key to include Campaign ID + Account ID.
- `supabase/migrations/<ts>_fb_spend_sync.sql`:
  - Add columns to `ad_spend_daily`: `reach`, `frequency`, `ctr`, `cpm`, `cpc`, `cost_per_lead` (all `numeric`, nullable).
  - Add pg_cron jobs `fb-spend-sheet-daily` (06:15 UTC) and `fb-spend-sheet-safety` (13:30 UTC).
- `src/pages/DataHealthPage.tsx` — add a "FB Spend sheet" column showing last successful sheet write per client, with a manual "Run now" button that calls the edge function with `days_back: 1`.

## Edge cases handled

- Missing sheet URL → skip, log `skipped_no_sheet` in `ad_spend_sync_runs`.
- Meta token expired → surface provider error verbatim (existing pattern).
- Rate-limit / 429 from Sheets → exponential backoff, honor `Retry-After`.
- Zero-spend days → still written (spend = 0) so gaps are visible in the sheet.
- Client with 2 Meta accounts → separate rows keyed by Account ID.

## What the user gets

Open any client's KPI sheet → **FB Spend** tab is filled and refreshed every morning with Date, Campaign, Spend, Impressions, Clicks, Frequency, CTR — plus Reach, CPM, CPC, Leads, Cost/Lead. No manual work.
