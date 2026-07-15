# Meta Ad Spend Reporting Pipeline (Reporting 5.0)

Additive to the existing app. Reuses the current Meta integration (`META_SHARED_ACCESS_TOKEN`, `meta_ad_accounts`, `clients`) and the existing Google Sheets connector.

## 1. Database (single migration)

**`public.ad_spend_daily`**
- `date` (date), `client_id` (uuid → clients), `client_name` (text), `ad_account_id` (text), `campaign_id` (text), `campaign_name` (text)
- `spend` numeric(14,2), `impressions` int, `clicks` int, `leads` int, `currency` text default 'USD'
- `synced_at` timestamptz default now()
- **Unique (date, campaign_id)** → upsert on conflict (idempotent)
- Indexes: (client_id, date desc), (date desc)

**`public.sync_runs`**
- `ad_account_id` text, `client_id` uuid, `client_name` text
- `status` text check in ('success','error','partial'), `error_message` text
- `rows_written` int default 0, `sheet_status` text ('ok' | 'error' | 'skipped'), `sheet_error` text
- `started_at`, `finished_at` timestamptz

Both tables: GRANTs for authenticated + service_role, RLS on, admin-only read policy via `has_role`.

Setting: add `meta_spend_sheet_url` (text) column to `agency_settings` for the Sheet URL.

## 2. Edge function: `sync-meta-ad-spend`

- Accepts `{ mode: 'daily' | 'manual', client_id?: uuid, date?: 'YYYY-MM-DD' }` (default = yesterday, all active accounts).
- Loads active accounts from `meta_ad_accounts` joined to `clients` where `status='active'`.
- For each account, in its own try/catch:
  1. `POST sync_runs` row (started).
  2. Call Meta Insights: `/{ad_account_id}/insights?level=campaign&time_range={since:date,until:date}&fields=campaign_id,campaign_name,spend,impressions,clicks,actions&access_token=…`
  3. Extract `leads` from `actions[action_type='lead']` (fallback `onsite_conversion.lead_grouped`).
  4. Upsert into `ad_spend_daily` on `(date,campaign_id)`.
  5. Retry once with 2s backoff on failure.
  6. Append/upsert to Google Sheet "Daily Spend" tab (see §3). Sheet errors do NOT fail the account — logged separately.
  7. Update `sync_runs`: status, rows_written, sheet_status, finished_at.
- Loop returns aggregate summary `{ ok, failed, total_rows }`.

Scheduled via `pg_cron` + `pg_net` at 09:00 UTC daily (yesterday's data, finalized).

## 3. Google Sheets mirror

- Uses existing `google_sheets` connector (already linked — `GOOGLE_SHEETS_API_KEY` present).
- Read Sheet URL from `agency_settings.meta_spend_sheet_url`. Extract spreadsheet ID.
- Ensure "Daily Spend" tab exists with header row: `Date, Client, Account ID, Campaign ID, Campaign Name, Spend, Impressions, Clicks, Leads, Synced At`.
- **Dedupe strategy:** read column A+D (Date + Campaign ID) into a Set. For each new row, if `(date|campaign_id)` exists → `values.update` that row; else buffer for a single `values:append` at the end. Keeps writes to 1 read + 1 append + N updates per account.
- Any Sheet failure → `sync_runs.sheet_status='error'` + `sheet_error=…`. Supabase write is authoritative.

## 4. UI: `/reporting/data-health` (new page + sidebar entry "Data Health")

- **Top card:** last cron run summary (started, ok/failed counts, total rows).
- **Manual sync bar:** "Sync Yesterday" + date picker + optional client filter → calls `sync-meta-ad-spend` with `mode:'manual'`. Toasts progress.
- **Client table:** one row per active ad account.
  - Client · Account ID · Last successful sync · Last run status (badge) · Rows written · Sheet status · Error message
  - **Red row** if `last_success_at < now() - 36h` OR last run status='error'.
  - Row action: "Retry this client" → invokes function scoped to that `client_id`.
- Backed by a Supabase view `v_ad_spend_health` that joins latest `sync_runs` per account with `ad_spend_daily` freshness.

Settings tab gets one new field: "Meta Spend Google Sheet URL" (paste + save).

## 5. Files touched (additive)

New:
- `supabase/migrations/…_ad_spend_pipeline.sql`
- `supabase/functions/sync-meta-ad-spend/index.ts`
- `src/pages/DataHealthPage.tsx`
- `src/hooks/useAdSpendHealth.ts`
- `src/components/settings/MetaSpendSheetSetting.tsx`

Modified:
- `src/App.tsx` (route)
- `src/components/layout/AppSidebar.tsx` (nav entry under Reporting)
- Existing agency settings page (add the sheet URL field)

No changes to existing Meta sync, reporting views, or dashboards.

## Assumptions (flag if wrong)

- Reuse `META_SHARED_ACCESS_TOKEN` for Insights calls (existing pattern in project).
- "Leads" = Meta `actions.lead` (form + onsite). If you want CRM-attributed leads instead, say so and I'll join `leads` table by campaign_id.
- Sheet is owned by the account behind the `google_sheets` connector (developer-owned, not per-user).
- Yesterday's data is finalized enough — no re-sync of trailing 3-day window. Say if you want a 3-day rolling refresh.
