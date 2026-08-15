# Reporting 5.0 — Production-Safe Daily Reporting (Nationwide Paving USA first)

Funnel contract: Ads > Leads > Discovery Calls > Reconnect Calls > Commitments > Funded Wire.

## What I verified in production before writing this

- `calls` has `appointment_status`, `booked_at`, `showed_at`, `scheduled_at`, `showed`, `is_reconnect`, `ghl_calendar_id`.
- **384 rows** agency-wide (8 for Nationwide Paving, client `53bce87a…`) have `showed = true` with `appointment_status` in `confirmed/new` — the false-show bug is real. Distinct statuses in production: `showed, noshow, cancelled, confirmed, new, invalid, NULL`.
- **4,723 rows** have `showed_at = scheduled_at` (attendance timestamp fabricated from the schedule).
- `booked_at` is **never null** today (0 rows), so booked bucketing is safe — but nothing enforces it going forward.
- `funded_investors`: 992 rows, **830 with `funded_amount <= 0`** (sources include `tag_sync`, `pipeline_stage`, `commitment_stage`). No `committed_at`, no verification columns.
- `recalculate-daily-metrics` counts `showed` straight off the boolean, derives funded dollars by falling back to `commitment_amount`, counts commitments off `funded_at`, and reads spend from `meta_ad_daily_insights` (not `ad_spend_daily`).
- `get_client_source_metrics` (used by client reports) has the same `showed` boolean bug.
- `generate-client-report` selects `daily_metrics.spend` — **that column does not exist** (`ad_spend` does), so spend/CPL/CoC in weekly client emails are silently 0.
- RLS: `calls` allows public `SELECT`, `INSERT`, `DELETE` with `true`. `clients` allows public `SELECT` of **all columns** (including API keys) whenever `public_token` or `slug` is set.
- ~195 cron jobs embed the anon key / bearer tokens inline in `cron.job.command`.
- `client_report_sends` already has `idempotency_key` — reuse it for de-duplication.

## Phase 1 — One normalization contract (schema + SQL functions)

New migration, additive only:

- `public.normalize_appointment_status(text) → text` (immutable): maps to `showed | noshow | cancelled | rescheduled | pending | invalid`. `confirmed/booked/new/pending` → `pending`. This is the single documented normalizer.
- `public.call_is_showed(status text) → boolean` = normalized in (`showed`,`completed`).
- `public.call_is_eligible(status text, scheduled_at timestamptz) → boolean` = `scheduled_at < now()` AND normalized not in (`cancelled`,`rescheduled`,`invalid`).
- `calls`: add `attendance_source text`, `booked_at_missing boolean default false`, plus indexes on `(client_id, booked_at)` and `(client_id, scheduled_at)`.
- `funded_investors`: add `committed_at timestamptz`, `is_verified_funded boolean default false`, `verification_source text`, `flags jsonb default '{}'`.
- `lead_quality_normalize(status, current_disposition, is_spam, quality_score)` → `qualified | bad | pending` (single source; no double counting).
- Two reporting views used by every consumer: `v_daily_funnel_day` (per client/day: leads total/qualified/bad/pending, discovery booked, discovery eligible, discovery showed, discovery noshow, reconnect booked/eligible/showed/noshow, commitments + $, verified funded + $, spend/impressions/clicks/CTR/leads/CPL from `ad_spend_daily`) and `v_daily_funnel_freshness` (last sync per source + row counts).

## Phase 2 — Safe data repair (idempotent, audited)

Runs after Phase 1, inside a transaction, writing before/after counts into a new `reporting_repair_log` table.

```sql
-- 2a. Un-set fabricated shows (pending/cancelled/rescheduled/future)
UPDATE public.calls c
   SET showed = false,
       showed_at = NULL,
       attendance_source = 'repair_status_normalization'
 WHERE c.showed = true
   AND ( public.normalize_appointment_status(c.appointment_status) <> 'showed'
      OR c.scheduled_at > now() );

-- 2b. Flag attendance timestamps that were copied from the schedule
UPDATE public.calls
   SET attendance_source = COALESCE(attendance_source,'schedule_copy_unverified')
 WHERE showed = true AND showed_at = scheduled_at;

-- 2c. Flag (never delete) zero-dollar funded rows; only >0 counts as funded
UPDATE public.funded_investors
   SET is_verified_funded = (COALESCE(funded_amount,0) > 0),
       verification_source = CASE WHEN COALESCE(funded_amount,0) > 0 THEN source ELSE NULL END,
       flags = flags || jsonb_build_object('zero_dollar_source', source)
 WHERE is_verified_funded IS DISTINCT FROM (COALESCE(funded_amount,0) > 0);

-- 2d. Seed committed_at where a commitment exists; leave unknowns NULL + flagged
UPDATE public.funded_investors
   SET committed_at = CASE WHEN source IN ('commitment_stage','pipeline_stage') THEN funded_at ELSE NULL END,
       flags = flags || CASE WHEN source IN ('commitment_stage','pipeline_stage')
                             THEN '{}'::jsonb ELSE jsonb_build_object('committed_at_unknown', true) END
 WHERE COALESCE(commitment_amount,0) > 0 AND committed_at IS NULL;
```

Dry-run first (`SELECT count(*)` with the same predicates) and record the numbers; expected 2a ≈ 384, 2c ≈ 830.

## Phase 3 — Ingest + calculation fixes

- `supabase/functions/sync-calendar-appointments/index.ts`: persist raw GHL status, set `showed` only via `call_is_showed`, set `booked_at` only from `dateAdded/createdAt` (never `scheduled_at`) and set `booked_at_missing = true` + a `data_discrepancies` row when absent, set `showed_at` only from a real attendance event, and classify reconnect strictly by `client_settings.reconnect_calendar_ids`.
- `supabase/functions/recalculate-daily-metrics/index.ts`: read from the Phase 1 views; booked by `booked_at`, attendance/eligibility by `scheduled_at`; show rate = showed / eligible; funded = `is_verified_funded AND funded_amount > 0`; commitments by `committed_at`; spend/impressions/clicks/CTR/CPL from `ad_spend_daily`.
- `get_client_source_metrics`: rewrite over the same views so public dashboards inherit the fix without changing their column contract.
- `generate-client-report`: fix `daily_metrics.spend` → `ad_spend` (or read the view) — this alone unblanks spend/CPL/CoC in client emails.
- `sync-meta-ad-spend`: always refresh yesterday **plus trailing 7 days**; treat a zero row as "unproven" unless the API response confirms it, and record that in freshness.

## Phase 4 — The 6:00 AM America/Los_Angeles ordered run

New `supabase/functions/daily-report-run/index.ts` — one function, ordered stages, each stage recorded in a new `daily_report_runs` table (`run_date`, `stage`, `status`, `metrics`, `anomalies`, `report_json`, `delivered_at`, unique on `client_id, run_date`):

1. Sync — Meta (`sync-meta-ad-spend` yesterday + 7d), GHL contacts, calendar appointments, pipelines.
2. Normalize/repair — re-apply the Phase 2 predicates to newly-synced rows.
3. Recalculate — `recalculate-daily-metrics` for yesterday + 7d.
4. Validate — freshness, zero-spend-with-leads, missing `booked_at`, unclassified statuses, reconciliation vs `ad_spend_daily`; hard-fail on missing sync.
5. Report — deterministic numbers computed in SQL; AI narrative optional and text-only, never numeric.
6. Deliver — guarded by `client_report_sends.idempotency_key = client|run_date|daily`.

Cron: `0 13 * * *` UTC (PDT) with a DST-safe guard inside the function that checks local time in `America/Los_Angeles` before proceeding.

Google scorecard sheet: written **only** in stage 6 after stage 4 passes; never read as a calculation source.

## Phase 5 — Staged security hardening (no public dashboard breakage)

1. Add `public.get_public_client_report(p_token text)` — `SECURITY DEFINER`, returns only presentation columns (never `*_api_key`, `*_token`, location ids), and point the public dashboard at it.
2. Replace the `clients` public `SELECT` policy with a column-safe view/RPC once step 1 is live and verified against the public route.
3. Replace `calls` public `INSERT`/`DELETE`/`SELECT` policies with service-role-only; webhooks already run service-role, so nothing user-facing changes.
4. Migrate cron commands to Vault (`vault.decrypted_secrets`) so keys are no longer stored in `cron.job.command`; re-create jobs one family at a time.

Phase 5 ships last and is reversible per step.

## Validation queries (run after each phase)

- `SELECT count(*) FROM calls WHERE showed AND normalize_appointment_status(appointment_status) <> 'showed';` → expect 0.
- `SELECT count(*) FROM calls WHERE showed AND scheduled_at > now();` → expect 0.
- `SELECT count(*) FROM funded_investors WHERE is_verified_funded AND COALESCE(funded_amount,0) <= 0;` → expect 0.
- Nationwide yesterday: compare `v_daily_funnel_day` against `daily_metrics` and against the sheet; differences must be explainable by the documented rules only.
- `SELECT * FROM v_daily_funnel_freshness WHERE client_id = '53bce87a-ad8c-4bf7-bc4f-4b3a91c4c2f5';`

## Rollback

- Phase 1 is additive — drop the new functions/views/columns to revert.
- Phase 2 writes `reporting_repair_log` with the affected ids, so `showed`/`showed_at` and the funded flags can be restored row-by-row.
- Phase 3/4 are function deploys — redeploy the previous version; `daily_metrics` can be rebuilt by re-running the old recalc.
- Phase 5 policies are dropped/re-created individually; keep the old policy SQL in the migration comments.

## Shippable without touching public reports

Phases 1, 2, 3 (except the `get_client_source_metrics` rewrite) and 4 are safe. The `get_client_source_metrics` rewrite and all of Phase 5 need a public-dashboard smoke test on Nationwide's tokenized link before rollout.

## Open assumptions

- Nationwide's discovery vs reconnect split comes from `client_settings.tracked_calendar_ids` / `reconnect_calendar_ids` as currently configured.
- "Verified funded" = `funded_amount > 0`; if the agency wants a wire-confirmation gate stricter than that, say so and I'll make `verification_source` the gate instead.