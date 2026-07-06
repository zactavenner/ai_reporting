# Phase 3A — Media Buyer Agent

Additive build: new agent + tables + edge functions + one page. No changes to existing tables, cron jobs, billing, or auth. All proposals flow through `agent-gatekeeper` → `approval_queue` → `/approvals`.

## Assumptions (please correct if wrong)
- Agent registered in existing `agents` table (name `media-buyer`, `is_core=true`, `enabled=true`, `template_key='media-buyer'`); the operating doctrine is stored in `prompt_template`.
- LLM call uses the same `LOVABLE_API_KEY` Lovable AI Gateway pattern the rest of the project uses. Model requested was "claude-sonnet-4-6" — not routable through Lovable AI Gateway; I'll use `openai/gpt-5.4` (best reasoning available) with the model id stored on the agent row so it can be swapped later without a redeploy.
- Meta write calls (budget/pause/launch) use the existing `_shared/meta.ts` helper + `client.meta_access_token` fallback to `META_SHARED_ACCESS_TOKEN`.
- "Never touch" existing cron jobs — I'll add NEW cron jobs only.

## New tables (single migration)
- `media_buyer_runs` — per spec.
- `ad_classifications` — per spec, unique on `(run_id, meta_ad_id)`.
- `creative_intel_findings` — per spec.
- All: `service_role ALL`, `authenticated SELECT/INSERT/UPDATE/DELETE`, RLS on with a permissive authenticated policy (mirrors existing agent tables).

## New edge function: `media-buyer-agent`
Input: `{ run_type, client_id?, lookback_days=14 }`. Pipeline:
1. Gather context strictly from DB — no Meta API calls:
   - `meta_campaigns`, `meta_ad_sets`, `meta_ads` (status=ACTIVE + last-touched in window)
   - `daily_metrics` for lookback window + prior equal window (trend deltas)
   - Downstream joins: `leads`, `calls`, `funded_investors` aggregated per client
   - `client_kpi_targets` (targets + guardrails + autonomy_mode)
   - `client_offers` primary offer
   - Active `agent_lessons` where `agent_name='media-buyer'`
2. Call Lovable AI Gateway with the media-buyer system prompt + run_type instruction. Strict JSON schema requested via `response_format: json_object`, parsed defensively.
3. Persist to `media_buyer_runs` / `ad_classifications` / `creative_intel_findings`. Portfolio-scope creative_intel `pattern_type in ('hook','headline','cta')` also inserted into `copy_library` (type mapped, `client_id=null`, tags include `['media-buyer','winner']`); `pattern_type in ('format','visual','spokesperson')` inserted into `swipe_file` (title=pattern_description, notes=recommendation, tags include `['media-buyer']`).
4. For each proposal with `confidence >= 0.7`, POST to `agent-gatekeeper` (agent_name `media-buyer`) with proper `action_type` and `queue_type` mapping:
   - `budget_change` → `queue_type: 'budget'`, `action_type: 'budget_change'`
   - `creative_kill` → `queue_type: 'creative'`, `action_type: 'creative_kill'`
   - `creative_scale` → `queue_type: 'budget'`, `action_type: 'creative_scale'`
   - `creative_launch` → `queue_type: 'launch'`, `action_type: 'creative_launch'`
   - `task_created` → `queue_type: 'creative'`, `action_type: 'task_created'` (kept for pixel-audit findings)
   - `inputs` includes `budget_delta_pct` and `target_ad_id` so gatekeeper guardrails apply.
5. `run_type='pixel_audit'`: reads `funnel_analytics`, `pixel_verifications`, `pixel_expected_events` if present; builds VERIFIED/LIKELY/UNKNOWN/NEEDS TESTING report in `findings_md` + `structured_findings`. For each NEEDS TESTING item, insert a `tasks` row (category `pixel-audit`, priority `high`, `client_id`, `created_by='media-buyer'`, assigned to first `agency_member` on the client's pod when available).

## Executor extension: `execute-approved-action`
Add two handlers (existing message/report handlers untouched):
- `queue_type='budget'`: re-check guardrails from `client_kpi_targets`; call Meta Graph `POST /{adset_id}` with `daily_budget` or `POST /{ad_id}` with `status=PAUSED|ACTIVE`. Any Meta write error (200/278/permissions) → create a `tasks` row "Manual Meta action required: …" with the full payload in the description, respond `{executed:false, fallback:'task_created', task_id}`. Never throw.
- `queue_type='launch'`: creates campaign → adset → ad in `PAUSED` status via Graph API from `preview_payload.launch_spec`. Same fallback-to-task on any error.
- Uses `_shared/meta.ts` + `client.meta_access_token` fallback to `META_SHARED_ACCESS_TOKEN` for auth.

## Scheduling (new pg_cron jobs only, via `supabase--insert`)
- `media-buyer-fatigue-scan` — every 6 hours, portfolio-wide `fatigue_scan`
- `media-buyer-daily-review` — 05:30 America/Los_Angeles (cron `30 12 * * *` UTC ≈ 5:30 AM PST/PDT; note the standard DST caveat — I'll document in the SQL comment)
- `media-buyer-weekly-review` — Sundays 18:00 America/Los_Angeles
- `media-buyer-creative-intel` — Mondays 07:00 America/Los_Angeles
- Each cron fires a per-client fan-out inside the edge function (single HTTP call per schedule, loops active clients server-side).

## Frontend: `/media-buyer`
- Route added to `src/App.tsx`, sidebar item added to `src/components/layout/AppSidebar.tsx` with `TrendingUp` icon.
- `src/pages/MediaBuyerPage.tsx` composed from four small components in `src/components/media-buyer/`:
  - `RunControls.tsx` — client selector (uses existing `useClients`) + button per run_type; shows current running status via query on `media_buyer_runs.status='running'`.
  - `ClassificationBoard.tsx` — 6 columns (SCALE / KEEP / WATCH / ITERATE / PAUSE / INSUFFICIENT DATA) from latest run; joins `meta_ads.thumbnail_url` for each card; cards show CPL/CPS/CPBC + frequency + reasoning.
  - `CreativeIntelPanel.tsx` — latest `creative_intel_findings` grouped by `pattern_type`; shows evidence ad ids + recommendation.
  - `RunHistoryList.tsx` — recent runs; expand → renders `findings_md` via `react-markdown` (already in deps).
- Existing dashboard tokens (glass-card, forest/gold), Space Grotesk; mobile responsive with tabs on <md.

## Initial live run
- After deploy, POST `/functions/v1/media-buyer-agent` with `{ run_type: 'fatigue_scan' }` (portfolio-wide).
- Report back: findings summary from the run, count of classifications inserted, count of proposals queued.

## Files touched / created
- New migration: `supabase/migrations/<ts>_media_buyer_tables.sql`
- Insert-tool call: cron schedules + `agents` seed row (contains project URL + anon key — kept out of migrations per project rules)
- New edge fn: `supabase/functions/media-buyer-agent/index.ts`
- Edit edge fn: `supabase/functions/execute-approved-action/index.ts` (append budget + launch handlers)
- New page: `src/pages/MediaBuyerPage.tsx` + 4 components under `src/components/media-buyer/`
- Edit: `src/App.tsx`, `src/components/layout/AppSidebar.tsx`

## Explicit non-goals for this phase
- No changes to `agent-gatekeeper`, `approval_queue`, `autonomous_audit_log`, or any existing cron.
- No new secrets requested — reuses `LOVABLE_API_KEY` and existing Meta token pattern.
- No re-syncing Meta data — the agent reads only what already exists in DB.
