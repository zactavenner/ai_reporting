## Goal
Give operators a one-click "Run sync now" + date-ranged backfill for leads/calls/UTMs, and add an automated audit that reconciles Meta + GHL data on a daily/weekly/monthly cadence and reports discrepancies to the agency.

## 1. Manual "Run Sync Now" + Backfill UI
Location: Client detail page → new **Sync & Backfill** card (also expose on `SyncHealthPage`).

Controls:
- **Run sync now** (buttons): Leads (GHL contacts), Calls (appointments), Meta Ads insights, Enrichment (unenriched leads), Dispositions (custom fields), Pipelines (committed/funded).
- **Backfill range**: date range preset picker (reuse `DateRangePresetPicker`) + "Run backfill" per data type.
- Live status: shows last run, records processed, errors — polls `sync_runs` / `sync_health_snapshots`.

Wiring:
- Reuses existing edge functions: `sync-ghl-contacts` (mode `master_sync`), `sync-calendar-appointments`, `sync-meta-ad-daily-insights`, `enrich-leads-batch`, `sync-ghl-pipelines`, `sync-ghl-custom-fields`.
- Extend each to accept `{ start_date, end_date }` for windowed backfill (fall back to default lookback when absent).

## 2. Weekly Accuracy Audit Agent
New edge function: `audit-client-accuracy` — runs per client, compares source-of-truth (Meta API / GHL API) vs our DB for a window, writes findings to a new `client_audit_reports` table.

Checks (each row = one metric, with `expected`, `actual`, `variance_pct`, `severity`):
- **Ad stats** — Meta spend/impressions/clicks/leads for window vs `meta_ad_daily_insights` sum.
- **Leads + enrichment** — GHL contact count vs `leads`; enrichment coverage % (`lead_enrichment` join).
- **Calls + showed** — GHL appointments vs `calls`; showed count parity.
- **Lead dispositions** — GHL custom-field disposition distribution vs `lead_dispositions`.
- **Committed / funded** — GHL pipeline stage totals ($) vs `funded_investors` + `pipeline_opportunities`.

Auto-remediation: when variance > threshold, enqueue the matching sync (leads/calls/insights/pipelines) with the audit window as backfill.

## 3. Schedule
`pg_cron` jobs invoking `audit-client-accuracy`:
- **Daily** 04:00 UTC — last 2 days, alerts only on >5% variance.
- **Weekly** Mon 05:00 UTC — last 7 days, full report to agency.
- **Monthly** 1st 05:30 UTC — prior month, full report + trend.

## 4. Agency Reporting
- New tab **Audit Reports** in `FunnelAdminPage` → lists `client_audit_reports` rows grouped by client + cadence with severity chips and drill-down.
- Weekly/monthly runs post a Slack summary via existing `slack_bot_token` (client channel + agency channel) and optional email.

## 5. Schema
New tables (with GRANTs + RLS):
- `client_audit_reports` — id, client_id, cadence (daily/weekly/monthly), window_start, window_end, status, total_checks, passed, warnings, failures, created_at.
- `client_audit_findings` — id, report_id, client_id, category, metric, expected, actual, variance_pct, severity, remediation_action, remediated_at.

## Technical notes
- All manual sync buttons call `supabase.functions.invoke` with `{ client_id, start_date, end_date, mode }` and show progress via existing `useMasterSync` / `useSyncClient` patterns extended for date ranges.
- Audit function uses existing `META_SHARED_ACCESS_TOKEN` and per-client `ghl_api_key` / `ghl_location_id`.
- Variance thresholds: 2% info, 5% warning, 10% failure (configurable in `agency_settings`).

## Files (est.)
- Add: `src/components/client/SyncBackfillCard.tsx`, `src/components/admin/AuditReportsTab.tsx`, `supabase/functions/audit-client-accuracy/index.ts`, migration for audit tables + cron.
- Edit: `useSyncClient.ts` (add date range + per-type triggers), `sync-*` edge functions (accept date window), `AdminSidebar.tsx` + `FunnelAdminPage.tsx` (new tab), `SyncHealthPage.tsx` (expose backfill).

Approve and I'll build it end-to-end.