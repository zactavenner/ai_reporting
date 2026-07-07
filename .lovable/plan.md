## Phase 3B — Windowed Insights, Dispositions & CAPI Conditioning

Large multi-part build. All additive — no existing tables, cron jobs, or agent logic will be restructured.

### Part 1 — Windowed Ad Insights (extends existing table)
`meta_ad_daily_insights` already exists from Phase 3B round 1. Additive migration:
- Add `video_3s_views int`, `video_thruplay int` columns.
- Extend existing `sync-meta-ad-daily-insights` function to pull those two video action fields (fields list edit only).
- Shorten the trailing window kickoff from 7 → 3 days for the rolling upsert (late-attribution safe), keep the function accepting `days` param so backfill can still request 30.
- **One-time backfill:** invoke the function with `{days: 30}` after deploy and report row count for one client.

Rationale for reusing the existing function (not creating a companion): it's already isolated, background, continue-on-error, and fired from the main sync — a companion would duplicate identical Meta calls.

### Part 2 — Lead Dispositions & Quality
New tables:
- `lead_dispositions` (immutable log)
- `disposition_mappings` (global + per-client overrides, seeded with defaults)
- `ad_lead_quality` (7d/30d rollups per meta_ad_id)

Additive columns on `leads`: `current_disposition`, `disposition_updated_at`, `quality_score` (all nullable).

New edge functions:
- `sync-lead-dispositions` — hourly cron. Reads recent leads (`ghl_synced_at` cursor), applies mappings against `opportunity_stage`, `custom_fields` tags, inserts new disposition rows on change, updates `leads.current_disposition`.
- `lead-quality-rollup` — 2 AM PT daily. Joins `leads.ad_id` → `meta_ad_id` per client, computes 7d/30d qualified/bad/booked/funded rates, upserts `ad_lead_quality`.

Media-buyer `loadContext` gets `ad_lead_quality` (latest 7d row per ad) appended. No other agent changes.

### Part 3 — Pixel Conditioning (CAPI)
Discovery result: no pixel/dataset column exists on `clients` or `client_settings`. Additive columns on `clients`: `meta_pixel_id`, `meta_capi_access_token` (nullable). If unset → skip silently.

New:
- `capi_events_sent` table (dedupe by `lead_disposition_id`).
- `capi-conversion-feedback` edge function, hourly cron 5 min after disposition sync. Sends `QualifiedLead`/`BookedCall`/`ShowedCall`/`Funded` custom events with SHA-256 hashed email/phone + `fbc`/`fbp` from `leads.custom_fields` when present. Uses `META_SHARED_ACCESS_TOKEN` fallback if per-client token missing.

Media-buyer `daily_review` instruction gets one paragraph appended about disposition-quality signals → audience/form/creative fix proposals via existing gatekeeper flow.

### Part 4 — UI: `/lead-quality`
Single new page + sidebar entry (UserCheck icon). Sections:
1. Client selector (reuse existing client picker pattern).
2. 7d summary cards: Leads, Qualified Rate, Bad Rate, Booked Rate, CPL, CPS, CPBC (from `daily_metrics`).
3. Ads table ranked by qualified_rate showing CPL + spend + qualified_rate + bad_rate (cheap-vs-quality tradeoff).
4. Disposition feed (latest 50 rows: lead name, disposition badge, reason, rep, relative time).
5. CAPI health strip (24h events sent by type + failure count).

Mobile responsive. Uses existing glass-card / semantic tokens — no new colors.

### Verification (end of build)
- Backfill 30d insights for one active client → row count.
- Trigger `sync-lead-dispositions` once → dispositions detected + mapped count.
- Trigger `media-buyer-agent` `fatigue_scan` → number of ads with windowed metrics, classifications produced.
- Report CAPI config status: X of Y clients have `meta_pixel_id` (initially 0/N since column is brand new — expected, will note as configuration work outstanding).

### Files to create/modify
Migrations: 1 (all new tables + leads columns + clients columns + seed mappings + cron jobs).
Edge functions: `sync-lead-dispositions`, `lead-quality-rollup`, `capi-conversion-feedback` (new). Modify: `sync-meta-ad-daily-insights` (video fields, 3d default), `media-buyer-agent` (loadContext + daily_review instruction).
Frontend: `src/pages/LeadQualityPage.tsx`, sidebar entry, route in `App.tsx`.

### Assumptions (flag if wrong)
- Lead→ad attribution uses `leads.ad_id` (present) — no separate attribution table needed.
- Disposition source is primarily `leads.opportunity_stage` + `custom_fields` tags synced by existing GHL functions; we read the already-synced data, we don't add new GHL API calls.
- CAPI dataset/token is not yet configured anywhere; adding columns is Part 3 setup — actual event delivery will start once user populates them.