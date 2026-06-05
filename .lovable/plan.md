# RetargetIQ V2 — Enrichment Platform Overhaul

Rebuilds the Lead Enrichment feature into an automated, observable system with an executive dashboard. Coverage % (Enriched / Total) is the headline KPI throughout.

## 1. Database (single migration)

New columns on `lead_enrichment`:
- `last_enriched_at timestamptz` (defaults to `enriched_at` for existing rows)
- `enrichment_version int default 2`
- `confidence_score numeric` (0–100)
- Derived numerics (already mostly present): keep `net_worth_midpoint`, `home_value`, `median_home_value`, `household_income`, plus new `estimated_income numeric`, `home_equity numeric`, `investor_score int`, `accredited_probability text` ('low'|'medium'|'high'), `business_owner bool`.

New tables:
- `lead_enrichment_history` — append-only audit (id, client_id, lead_id, external_id, event_type ['initial','refresh','field_update'], changes jsonb, created_at). RLS: authenticated read; service_role write.
- `enrichment_run_log` — per-client per-day rollup (client_id, run_date, processed, succeeded, failed, skipped_recent, duration_ms). Powers charts.
- `enrichment_alerts` — (client_id, type ['ghl_disconnected','no_runs_24h','low_success','api_error_spike'], severity, message, resolved_at).

Views:
- `v_client_enrichment_coverage` — per client: total_contacts (leads count), enriched_contacts, coverage_pct, failed_matches, last_24h, last_7d, last_run_at.
- `v_agency_enrichment_kpis` — global totals: clients, total_contacts, total_enriched, coverage_pct, accredited_found, millionaires_found, daily_enrichments, last_sync_at, estimated_prospect_value (sum of net_worth_midpoint for accredited/high-networth bucket).

Grants + RLS on all new tables.

## 2. Edge functions

### `enrich-lead-retargetiq` (modify)
- After successful match, compute & store `confidence_score`, `home_equity` (home_value − mortgage_amount), `investor_score` (weighted: net worth, income, accredited flags, investments, business), `accredited_probability`, `business_owner`.
- Set `last_enriched_at = now()`, bump `enrichment_version = 2`.
- Push to GHL:
  - **Custom fields**: `estimated_net_worth`, `estimated_income`, `home_value`, `home_equity`, `investor_score`, `accredited_probability`, `business_owner`, `last_enrichment_date`. Auto-create missing custom fields via GHL `customFields` API (cache field IDs on `client_settings.ghl_custom_field_map jsonb`).
  - **Tags**: always `enriched`; conditional `networth_1m_plus`, `networth_5m_plus`, `income_250k_plus`, `income_500k_plus`, `likely_accredited`, `business_owner`.
  - **Note**: new "Financial Snapshot" markdown formatted with bullets/spacing.
- Insert `lead_enrichment_history` row.

### `auto-enrich-all` (rewrite)
- Run for every eligible client (no longer requires `retargetiq_auto_enrich` opt-in — daily for all connected). Setting flag now means "skip".
- For each client, pull leads where `last_enriched_at IS NULL OR last_enriched_at < now() - 30 days OR missing key fields`. Skip rows enriched within 30 days.
- Process up to `per_client` (default 50) per cron tick to stay within timeout; record `enrichment_run_log`.
- Emit alerts: GHL disconnected, success rate < 50%, no successful runs in 24h, error spike.

### `bulk-enrich-account` (new)
- Body: `{ client_id }`. Creates a `sync_queue`-style job that the worker chews through in 50-lead batches until complete, resumable. Returns a `job_id`. Progress polled via new `enrichment_jobs` table (id, client_id, total, processed, succeeded, failed, status, started_at, finished_at).
- A second function `bulk-enrich-account-worker` ticks the next batch (called by cron every minute).

### `enrichment-monitor` (new, cron hourly)
- Computes alerts and inserts/resolves rows in `enrichment_alerts`.

### Cron (via supabase--insert pg_cron)
- `auto-enrich-all` every hour (it self-limits per client/day).
- `bulk-enrich-account-worker` every minute.
- `enrichment-monitor` every hour.

## 3. Frontend (`src/components/admin/LeadsTab.tsx` → real implementation)

Replace stub with a full Enrichment Dashboard. New components under `src/components/enrichment/`:

- `ExecutiveDashboard.tsx` — top KPI strip: Total Clients, Total Contacts, Total Enriched, **Coverage %** (hero), Accredited Found, Millionaires Found, Daily Enrichments, Last Sync.
- `CoverageCharts.tsx` — 30-day enrichment volume line + coverage donut (recharts, already in project).
- `ClientLeaderboard.tsx` — sortable table by coverage %; highlight top 5 green, bottom 5 red. Columns: Client, Contacts, Enriched, Coverage %, Last Run, Status badge.
- `AlertsPanel.tsx` — red badges from `enrichment_alerts` with one-click "View client".
- `BulkBackfillPanel.tsx` — per-client "Bulk Enrich Entire Account" button → starts job, shows progress bar with live updates via `enrichment_jobs` realtime subscription.
- `AgencyLeadSearch.tsx` — cross-client filterable search: Net Worth ≥, Income ≥, Home Value ≥, Investor Score ≥, Accredited (any/likely), Business Owner. Paginated results with client column.
- `ContactTimeline.tsx` — drop-in to existing contact drawer: reads `lead_enrichment_history` and renders dated list.
- `AgencyRevenuePanel.tsx` — "Estimated prospect value" from `v_agency_enrichment_kpis`.

Hooks under `src/hooks/`:
- `useEnrichmentKpis`, `useClientCoverage`, `useEnrichmentAlerts`, `useEnrichmentJob`, `useAgencyLeadSearch`, `useEnrichmentHistory`.

Tabs inside LeadsTab: Overview | Leaderboard | Search | Alerts.

Coverage % shown in the page header and in `AdminSidebar` Leads label as a badge.

## 4. Out of scope (this pass)
- Per-contact webhook ingestion (already covered by existing GHL sync).
- Custom field mapping UI (auto-created/cached; manual mapping deferred).
- Multi-currency, internationalization.

## Technical notes
- Confidence score formula: weighted sum of method count, identity count, presence of phone+email+address. Clamp 0–100.
- Investor score: `min(100, 0.35*networth_norm + 0.25*income_norm + 0.20*accredited + 0.10*investments + 0.10*business)`.
- Coverage denominator excludes spam leads (`is_spam = false`) and requires non-empty email+phone (matches existing eligibility rule in memory).
- Existing `lead_enrichment` rows backfilled with `last_enriched_at = enriched_at`, `enrichment_version = 1` so the 30-day refresh logic kicks in naturally.
