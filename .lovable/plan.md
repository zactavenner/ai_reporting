## Meta Ads Manager v1 — Implementation Plan

Extends the existing Creatives and Reporting modules. Uses existing `meta_*` tables and the approved `ads_management` Meta App. Phased to ship usable value fast.

---

### Phase 1 — Foundation (week 1)

**Schema additions** (new tables, all RLS + GRANTs):
- `meta_campaign_templates` — saved campaign blueprints (objective, budget, placements, targeting JSON, optimization goal, naming convention, default lead form, UTM template).
- `meta_lead_forms` — synced lead forms per ad account (questions JSON, completion_rate, cpl, conversion_rate, status).
- `meta_lead_form_templates` — reusable form blueprints (Investor / Accredited / Real Estate / etc.).
- `meta_lead_form_mappings` — field → CRM mapping (GHL / HubSpot / Salesforce / webhook).
- `meta_creative_tags` — Winner / Emerging / Fatigued / Underperforming (computed daily + manual override).
- `meta_ai_creative_insights` — daily AI analysis output per ad (hooks, headlines, angles, scores).
- `meta_weekly_briefs` — generated weekly winners reports.
- `meta_rules` — automated rule definitions (trigger, condition JSON, action, schedule).
- `meta_rule_runs` — execution log with before/after metrics.
- `meta_alerts` — CPL spike / ROAS drop / fatigue / rejection / pixel issue events.
- `meta_swipe_files` — saved competitor ads from Meta Ad Library.
- `meta_creative_comments` — team comments + approval state on creatives.

**Edge functions (new)**:
- `meta-leadforms-sync` — pulls all forms from connected ad accounts, computes CPL/conversion.
- `meta-creative-tagger` — daily job, tags ads as Winner/Emerging/Fatigued/Underperforming using spend/CPL/CTR/frequency thresholds.
- `meta-ai-analyze-creatives` — daily, runs `openrouter/owl-alpha` over top-spending ads, extracts hooks/angles/insights.

**Cron**: tagger + AI analyzer at 4 AM PST daily; lead forms sync hourly.

---

### Phase 2 — Campaign Launch Center (week 2)

Lives as a new tab inside the existing **Creatives** module: `Creatives → Launch`.

- **Template library** — list, create, edit, duplicate templates.
- **Naming engine** — live preview of `CLIENT | OFFER | GOAL | MONTH` etc., overridable per launch.
- **One-click launch wizard**: pick template → adjust budget/audience/geo/lead form/creative/dates → preview → launch.
- **Edge function `meta-campaign-launch`**: validates payload, calls Meta Graph API to create campaign + ad set + ads, writes back to `meta_campaigns/_ad_sets/_ads`, logs to `sync_outbound_events`.
- **Duplicate previous campaign** — pulls existing campaign config, opens wizard pre-filled.

---

### Phase 3 — Lead Form Management (week 2)

New tab `Creatives → Lead Forms`:
- Library view (search/filter by client, account, status, CPL).
- Form detail drawer: questions, conditional logic, completion rate, CPL, conversion.
- Template library (save form as template, instantiate from template via `meta-leadforms-create` edge fn).
- **Drag-and-drop CRM mapping UI** (uses dnd-kit, already in project) — maps form fields to GHL / HubSpot / Salesforce / generic webhook. Stored in `meta_lead_form_mappings`. Routed at lead intake.

---

### Phase 4 — Creative Intelligence + AI (week 3)

New tab inside Reporting: `Reporting → Creative Intelligence`.

- **Creative library**: searchable grid of every historical + active ad with HD asset, filters (client/campaign/objective/date/spend/leads/CPL/ROAS), winner tags.
- **Winner panel**: top CTR / top conversion / lowest CPL / highest ROAS / fastest scaling.
- **AI insights feed**: cards from `meta_ai_creative_insights` ("Ads mentioning passive income generated 37% lower CPL").
- **AI Creative Generator**: one-click "Generate variants" → calls `meta-ai-generate-creatives` edge fn → returns hooks/headlines/primary text/image prompts/video scripts/UGC concepts. Export to OpenAI/Claude/Google AI Studio prompts (clipboard) or save to `meta_swipe_files`.
- **Weekly Brief**: button + cron (Mon 7 AM PST) → `meta-weekly-brief` edge fn → builds Winners Report (spend/leads/CPL/CTR/ROAS/frequency + AI recommendations Scale/Refresh/Pause/Duplicate + 10–20 new creative concepts). Export PDF / Google Doc / Notion / ClickUp task.

---

### Phase 5 — Rules Engine + Dashboards + Alerts (week 4)

New tab `Reporting → Automation`:
- **Rule builder UI**: trigger (schedule), condition (metric op threshold, e.g. CPL > $80 for 2d AND spend > $50), action (pause / scale +10/20/30% / notify / duplicate), scope (account/campaign/ad set/ad).
- Edge fn `meta-rules-runner` (every 30 min via pg_cron) — evaluates conditions, executes via Graph API write, logs to `meta_rule_runs`.
- **Executive / Creative / Account dashboards** — three new dashboard views built on existing `daily_metrics` + new creative tag aggregates.
- **Alerts**: CPL spike, ROAS drop, fatigue, campaign rejected, lead form disconnected, pixel issue. Fan-out via Slack (existing connector), email (Resend connector), in-app toast/badge. Settings panel per user/client for channel preferences.

---

### Phase 6 — Stubs for v2 (week 4 tail)

- `meta_swipe_files` table + simple "Save from Ad Library URL" form (full Ad Library scraper deferred).
- `meta_creative_comments` + comment thread on creative detail drawer (full approval workflow + roles deferred).

---

### Out of scope for v1 (explicit)
- Google / TikTok / LinkedIn / YouTube Ads (architecture leaves room — `platform` column on rules/insights/templates).
- Hyros / Cometly / Triple Whale / Northbeam (read-only display only; no ingestion).
- Full role matrix (Admin/Buyer/Strategist/Designer/Client) — uses existing `user_roles`.
- SMS alerts (Slack + email + in-app only).

---

### Tech notes
- All Meta writes go through `meta-campaign-launch` / `meta-rules-runner` with retry + exponential backoff and `sync_outbound_events` logging (matches existing GHL outbound pattern).
- AI defaults to `openrouter/owl-alpha` per project memory.
- All new tables: `GRANT` to `authenticated` + `service_role`, RLS scoped by client/agency membership matching existing `meta_*` policies.
- No new client-side secrets; reuses `META_APP_ID`, `META_APP_SECRET`, `META_SHARED_ACCESS_TOKEN`, `LOVABLE_API_KEY`, `SLACK_BOT_TOKEN`.

---

Approve to start Phase 1 (schema + lead form sync + creative tagger + AI analyzer). I'll surface each phase's migration for review before running it.