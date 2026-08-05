# Weekly Report inside Sheet Stats

Add a **Weekly Report** block directly under the existing weekly/KPI section of Sheet Stats (per client), modeled on the sheet layout but in the Apple-style card language already used there. It merges Meta ad data with CRM data, adds a scored lead list, is editable, and can be emailed on a schedule using the report plumbing that already exists.

## 1. Weekly Report card (last 7 days vs prior 7 days)

One compact table/grid, each row = metric, columns = This week / Prior week / Δ:

- Ad spend
- Leads, Cost per lead
- Discovery calls booked, Cost per discovery call
- Showed calls, Show rate, Cost per show
- Commitments, Commitment $, Cost per commitment
- Funded investors, Funded $, Cost per investor
- Cost of capital (ad spend ÷ funded $, shown as %)

Definitions used (from existing data): discovery calls = non-reconnect calls booked in range; showed = `showed = true`; reconnect calls tracked separately so they don't inflate discovery cost.

## 2. Lead dispositions + lead quality list

- Disposition mix for the week (reuses the existing Outcome Mix rollup, scoped to the week).
- **Lead table**: every lead created in the week — name, contact validity, source/campaign, disposition, call/show status, and a **Quality score 1–10** badge (color-graded), sortable, with CSV export.

Scoring is deterministic and explainable (a tooltip shows why a lead got its score), built from signals already in the database: valid email + phone, non-spam, enrichment coverage (accreditation/net-worth/investment-range signals), stated investment range, disposition, call booked / showed, funded. Scores are computed nightly and stored on `leads.quality_score` (currently empty for all 54,776 leads), so the list and the email both read the same number.

## 3. Editable + emailable

- Inline editable commentary fields (Wins, Risks, Next week's plan) saved per client + week so the note persists and appears in the emailed report.
- Recipients and weekly send schedule reuse the existing Sheet Stats report dialog and dispatch functions — the weekly report becomes an available template alongside the current one.
- Creative section already present stays, scoped to the report week.

## 4. Accuracy — the part that keeps breaking

A **Data freshness strip** at the top of the Weekly Report, per client: last Meta spend day, last CRM sync, last sheet write, and whether sheet totals match database totals for the week. If anything is stale or mismatched, the card shows an amber/red state and the email is flagged rather than silently sending wrong numbers.

Verified while planning: Nationwide Paving USA is on Meta ad account `1297899512232165`, but both `meta_ad_daily_insights` and `ad_spend_daily` stop at **2026-07-20** — roughly two weeks stale. So the freshness strip is not theoretical; that client's spend pipeline needs a re-check and backfill as part of this work.

## Technical notes

- New `WeeklyReportCard` component under `src/components/sheet-stats/`, plus a `useWeeklyReport` hook that pulls the week and prior week from the same merged Meta + sheet/CRM source `SheetStatsTab` already uses (so header stats and the weekly report can't disagree).
- New table for the editable weekly commentary (client_id + week_start, RLS + grants).
- New scoring edge function writing `leads.quality_score` with a nightly `pg_cron` schedule; also runnable on demand from the card.
- Freshness checks read existing sync/reconciliation tables (`ad_spend_sync_runs`, `data_discrepancies`) — no new sync infrastructure.
- Email template extended in the existing send/dispatch functions; no new mail provider.
- Investigate and backfill Nationwide Paving USA spend from 2026-07-21 to yesterday.
