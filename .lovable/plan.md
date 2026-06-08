
# Ads Manager — Optimization & Tracking Plan

Goal: turn the Ads Manager into a true operations + automation tool with trustworthy attribution. Audit found a solid foundation (Meta sync, toggle, budget edit, AI insights, attribution) but critical accuracy gaps and zero automation.

---

## Phase 0 — Quick Wins (1 day, ship first)

1. **Fix attribution settings disconnect** — `run-attribution` ignores the UTM mapping + window saved in `AttributionSettings`. Read `client_settings.webhook_mappings.attribution` and apply it.
2. **Show zero-spend / paused ads** — remove implicit `spend > 0` filter in `AdsManagerTab` (replace with a toggle, default off) so freshly launched ads aren't invisible.
3. **Add ROAS + Attribution-Quality % columns** to both client and admin tables.
4. **Add Frequency column + fatigue badge** (orange ≥3.5, red ≥4.5).
5. **Batch attribution DB writes** — replace serial `.update().eq()` loops with `upsert([…])` for ~10× faster runs.
6. **Dedupe attribution logic** — move `attributeCRMData()` into `supabase/functions/_shared/`; remove the drifted copy in `sync-meta-ads`.
7. **Bump `scrape-fb-ads` Graph API to v21.0**; fix `EditableBudgetCell` cents/dollars optimistic bug; fix `sourceUtils` vs run-attribution UTM normalization mismatch.

---

## Phase 1 — Tracking Accuracy (largest ROI)

### 1A. Click-ID Capture (`fbclid`, `gclid`, `_fbc`, `_fbp`)
- Add columns to `leads`: `fbclid`, `fbc`, `fbp`, `gclid`, `click_id_captured_at`.
- Update `webhook-ingest` + `process-lead-upsert` edge functions to extract from URL params / posted payload.
- Update funnel landing pages to persist `fbclid`/`gclid` to hidden form fields and `_fbc` cookie on first touch.
- Extend `run-attribution` to match `lead.fbclid → meta_ads.meta_ad_id` first, before name/UTM fallback.

### 1B. Meta Conversions API (CAPI)
- New edge function `send-meta-capi-event` (Lead / Schedule / Purchase) with SHA-256 hashed PII, `event_id` dedup, `fbc`/`fbp` passthrough.
- Trigger from: `process-lead-upsert` (Lead), GHL appointment webhook (Schedule), funded reconciliation (Purchase).
- Per-client secrets: `META_PIXEL_ID_{client}`, `META_CAPI_TOKEN_{client}` (or store in `client_settings`).

### 1C. UTM Builder in Launch Wizard
- `LaunchCampaignWizard` auto-injects `utm_source=facebook&utm_medium={{adset.name}}&utm_campaign={{campaign.name}}&utm_content={{ad.id}}` into ad link URLs at creation time.

### 1D. Discrepancy Monitoring
- Banner in `AdminAdsManagerTab` when `|metaLeads − crmLeads| / metaLeads > 0.5` per client, linking to Attribution Settings.

---

## Phase 2 — Automation Engine

### 2A. Rules Engine (`ad_automation_rules` table + `evaluate-ad-rules` edge function)
Rule types:
- `spend_no_leads` — pause/alert when spend ≥ $X and leads = 0 over N days.
- `high_cpl` — pause/alert when CPL > $X over N days with min spend.
- `high_frequency` — pause when frequency > X and CTR drops > Y% week-over-week.
- `budget_shift` — increase top-ROAS campaign budget by Y% (capped) and reduce bottom-ROAS by same dollars.
- `creative_refresh` — when fatigue triggers, auto-create a "Refresh creative" task (reuse `VariationTaskModal` task path) + Slack ping.

Execution:
- `pg_cron` daily after master sync.
- Actions call existing `toggle-meta-status` / `update-meta-budget`.
- Every action logged to `ad_automation_log` with before/after snapshot and reversible undo window.
- New `AutomationRulesPanel.tsx` per-client settings UI with rule templates + dry-run mode.

### 2B. Scheduled AI Insights + Slack Alerts
- New `daily-ads-alert` cron calls existing `ads-insights` for each active client; pushes `severity: critical` findings to Slack with deep-links.

---

## Phase 3 — UX & Reporting

- **Column chooser** (persisted in localStorage) on the metric tables.
- **Spend / CPL sparklines** per row, backed by a new `meta_ad_daily_stats` snapshot table populated during sync.
- **Extended RowActionsMenu**: Archive, Rename, Copy-as-template (feeds Launch Wizard).
- **Pagination** for `AdminAdsManagerTab` (remove hidden 2000-row cap).
- **Side-by-side compare** for 2–3 selected ads.
- **Lifetime budget editing** in `EditableBudgetCell`.
- **Fix divergent winner logic** — unify `isWinningAd` and `getAdHealth` on `healthSignals.ts`.

---

## Phase 4 — Google Ads (optional, after Meta is solid)
- `sync-google-ads` edge function (Google Ads API v17), `google_campaigns` / `google_ads` tables.
- `gclid` matching mirrors `fbclid` path from Phase 1A.
- Surface in `AdminAdsManagerTab` via the existing (currently unused) `platform` filter prop.

---

## Technical Details

**New tables**
- `ad_automation_rules` (client_id, rule_type, thresholds, action, is_active, dry_run)
- `ad_automation_log` (rule_id, ad_id, action_taken, before/after JSONB, reverted_at)
- `meta_ad_daily_stats` (ad_id, date, spend, impressions, clicks, leads, frequency)
- `google_campaigns`, `google_ads` (Phase 4)

**New / modified edge functions**
- New: `send-meta-capi-event`, `evaluate-ad-rules`, `daily-ads-alert`, `_shared/attributeCRMData.ts`, `rename-meta-object`, `sync-google-ads`
- Modified: `run-attribution`, `sync-meta-ads`, `webhook-ingest`, `process-lead-upsert`, `scrape-fb-ads`, `create-meta-ad`

**Lead table migration**
- Add `fbclid`, `fbc`, `fbp`, `gclid`, `click_id_captured_at`.

**Secrets** (per Lovable Cloud)
- Meta CAPI tokens per client (store encrypted in `client_settings` JSONB rather than 100-secret cap).

**Compliance** — keep existing "targeted returns" / SEC disclaimer guards on any AI-generated copy in the rules engine outputs (per project memory).

---

## Suggested Build Order
1. Phase 0 quick wins (1 PR)
2. Phase 1A click-ID capture + 1C UTM builder
3. Phase 1B CAPI
4. Phase 2A rules engine (MVP: `spend_no_leads` + `high_cpl` + alert-only)
5. Phase 2A full actions + Phase 2B alerts
6. Phase 3 UX polish
7. Phase 4 Google Ads (gated on user demand)

Want me to proceed with Phase 0 first, or jump straight into Phase 1 tracking accuracy?
