# Nationwide Paving USA — Launch & Tracking Readiness

## What the review found

Client record exists (`Nationwide Paving USA`, active, AM: Emily, MB: Bill) with Meta ad account, GHL location and token connected. Data is flowing partially, but launch + tracking has real gaps:

**Working**
- GHL contacts/calls sync on (last contacts sync Jul 24, calls Jul 30). 1,234 leads, 267 calls on record; leads still arriving daily (Aug 2).
- Meta ads sync enabled, last ran Jul 31; 7 funnel steps mapped (website, FB lead form, booking, thank-you, SMS/email confirms).
- Public link live with password, KPI Google Sheet URL set, daily spend target $900, MRR $4,500, CPL thresholds 50/100.

**Blocking or broken**
1. **Ad spend stopped landing for this client.** `ad_spend_daily` has no rows after Jul 20 for Nationwide (other clients have rows through Jul 31), and `daily_metrics.ad_spend` is $0.00 every day since Jul 21. Every cost metric (CPL, cost/call, cost/showed) is therefore wrong right now.
2. **Google Sheet writes failing.** The last 7 ad-spend sync runs came back `partial` with Sheets HTTP 429 "Read requests per minute" quota errors, and `rows_written = 0`.
3. **Meta objects are stale.** Campaigns/ad sets/ads last updated Jun 12; insights last Jul 20. Two CBO lead-form campaigns show ACTIVE, four PAUSED — status is 7 weeks old and cannot be trusted.
4. **No Meta lead forms registered** (`meta_lead_forms` empty) and no form→client mapping, so FB lead-form leads cannot be attributed or CPL'd per form.
5. **Attribution is thin.** 601 of the last 30 days' leads have source `ghl_sync` (unattributed), 172 `Facebook`; funnel steps have no `ad_platform` and no ads linked, so funnel-stage CPL/CPA can't resolve by campaign.
6. **KPI targets empty.** `client_kpi_targets` row exists but every target (CPL, CPS, CPBC, cost-per-funded, max daily budget) is NULL, autonomy `copilot`. Nothing to alert against.
7. **Reporting not scheduled.** `stats_report_weekly_enabled = false`, zero report recipients, no Slack channel, `metrics_sheet_id` empty while `metrics_source_default = 'sheet'` — the dashboard's default source has no sheet behind it.
8. **Unused tracking surface.** No live ads synced (`ads_library_url` unset), no pixel verification, no MeetGeek/Fathom call QA, no deals/pipeline rows, no campaign launches.

## Plan

### 1. Restore spend accuracy (highest priority)
- Backfill Meta spend for Nationwide from Jul 20 → today (per-day, account timezone) into `ad_spend_daily`, then re-roll `daily_metrics.ad_spend` for that window.
- Add a per-client guard: if `meta_ads_sync_enabled` and no `ad_spend_daily` row for yesterday, log a discrepancy and retry once before the 6 AM PST report window.
- Fix the Sheets 429: serialize per-client sheet writes with backoff/jitter and cache the tab list per run instead of an `ensureTab` read per client, so `sheet_status` stops failing.

### 2. Refresh Meta objects and lead forms
- Run a full Meta structure sync for the account (campaigns, ad sets, ads, creatives, statuses) and daily insights from Jul 20 forward.
- Pull the account's lead forms into `meta_lead_forms` and map the active TOF lead-form campaigns to the `FB Lead` funnel step so lead-form CPL shows in Ads Manager.
- Set `ad_platform = 'meta'` on the ad-driven funnel steps and link the two ACTIVE CBO campaigns to the FB Lead / Booking steps.

### 3. Close attribution gaps
- Enable GHL conversations sync (`ghl_sync_conversations_enabled` is off) so Setter threads populate for this client.
- Apply the tiered UTM fallback to the `ghl_sync` leads: campaign/adset/ad from UTM, then form id, then landing page, so unattributed volume drops.
- Confirm the funded pipeline: `funded_pipeline_id` is set but `funded_stage_ids` and `committed_stage_ids` are empty — populate them from the GHL pipeline so commitments/funded stop reading zero.

### 4. Targets, alerting, reporting
- Fill `client_kpi_targets`: target CPL, cost per booked call, cost per showed, cost per funded, max daily budget (seeded from the $900/day and 50/100 CPL thresholds, then confirmed with the media buyer).
- Add report recipients and turn on the weekly stats report + Slack channel for the client.
- Set `metrics_sheet_id`/`gid` from the existing KPI sheet URL (or flip `metrics_source_default` to `db`) so the dashboard's default source resolves.

### 5. Launch readiness
- Pre-flight the Ads Manager New Campaign wizard for this account: creative set, lead form, pixel, page/Instagram actor, budget, geo.
- Turn on pixel verification for the booking and thank-you pages so conversion tracking is monitored.
- Enable live-ads sync by setting `ads_library_url` / page id for the brand.

## Technical notes
- Client id `53bce87a-…c4c2f5`, ad account `1297899512232165`, GHL location `3eu9Rp7yZ9Nq0AKRiyON`.
- Backfill runs through the existing ad-spend sync edge function with an explicit date range; no schema change needed except (optionally) a `last_spend_seen_at` style watchdog field, which can live in `ad_spend_sync_runs`.
- Sheets fix is in the sync function only (batching + retry), affecting all clients equally.
- All config changes are row updates in `clients`, `client_settings`, `client_kpi_targets`, `client_funnel_steps`, plus inserts into `meta_lead_forms` and `client_report_recipients`.
