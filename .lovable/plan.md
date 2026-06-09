# Platform Improvement Plan

Synthesized from 4 parallel audits: **Frontend**, **Backend/Edge Functions**, **Integrations & AI**, **Security & Reliability**.

The plan is phased from "stop the bleeding" (security) -> "stop the silent failures" (reliability) -> "ship the missing loops" (product) -> "polish".

---

## Phase 1 — P0 Security (1–2 days, do first)

Critical issues that expose all client data to the public internet.

1. **Enable RLS on `public.sync_queue`** with a service-role-only policy. This table currently leaks lead PII for all clients.
2. **Rotate the 7 hardcoded anon JWTs in old migrations** — replace with `current_setting('app.settings.anon_key', true)`.
3. **Tighten blanket `USING (true)` policies** on `agency_members`, `leads`, `tasks`, `task_comments`, `member_activity_log`. Restrict mutations to `service_role` + scoped authenticated SELECT.
4. **Strip plaintext password logging + "HPA" backdoor from `verify-password`**; sign dashboard tokens with a dedicated `DASHBOARD_JWT_SECRET`, not the service-role key. *(Note: keeping the HPA1234$ edge-auth pattern as-is per user request)*
5. **Move `PublicLinkPasswordGate` verification server-side** — never ship the correct password to the browser as a prop; gate via server-issued token.
6. **Remove hardcoded `HPA1234$` from `external-data-api`** — replace with `EXTERNAL_API_SECRET` env var + constant-time compare; scope to anon key + RLS instead of service-role. *(Note: keeping the HPA1234$ edge-auth pattern as-is per user request)*

## Phase 2 — Reliability & Silent Failures (2–4 days)

Stop syncs, crons and integrations from failing invisibly.

7. **Unschedule the duplicate GHL cron** (`sync-ghl-all-clients-4h` overlaps `-2h` six times a day -> double-leads risk + wasted GHL quota).
8. **Add cron failure visibility** — wrap every `net.http_post` cron call in PL/pgSQL that logs non-2xx into a `cron_run_log` table and notifies `sync-failure-digest`.
9. **Add retry + DLQ to `sync-queue-worker`** — `attempt_count` / `max_attempts` columns, exponential backoff, Slack alert on final failure.
10. **Add Slack signature verification to `slack-events`** (HMAC of `X-Slack-Signature` + timestamp).
11. **Add HubSpot rate-limit retry** + schedule `sync-hubspot-all-clients` cron (currently only on-demand).
12. **Schedule `sync-meta-ads-daily` independently** so a `daily-master-sync` timeout doesn't take Meta sync down with it.
13. **Fix idempotency key collisions in `enqueue-sync-job.ts`** — bucket by date (`YYYY-MM-DD`) so `cursor_sync` and `master_sync` dedupe correctly per day.
14. **Add page-level `<ErrorBoundary>`** around `Index`, `DatabaseView`, `AdScrapingPage` and other heavy pages so one render crash doesn't blank the app.
15. **Strip `console.log` in production builds** via `vite-plugin-remove-console` (102 logs currently leaking query shapes and API responses).

## Phase 3 — Frontend Performance & UX (3–5 days)

16. **Sync `activeTab` <-> URL** in `src/pages/Index.tsx` — `setSearchParams` on tab change. Restores Back button + deep-link + shareable URLs across 25 tabs.
17. **Lazy-load per-tab data** — move the 12 `useQuery` hooks currently firing on every page load into their own tab components. ~80% reduction in initial API calls.
18. **Fix the duplicate `avatar-ad-gen` branch** at `Index.tsx:556` vs `676` (second is dead code).
19. **Audit the 40+ orphaned page files** — either register routes or delete; eliminates bundle weight and confusion.
20. **Split & virtualize `InlineRecordsView`** (2,167 lines) and `DraggableClientTable` (1,382 lines) — add `@tanstack/react-virtual` for lists >200 rows.
21. **Move Google Fonts** from blocking `@import` in `index.css` to a preconnect `<link>` in `index.html` with `font-display: swap`.
22. **Wire up dark mode toggle** — CSS variables already exist, no toggle attached to `<html>`.

## Phase 4 — AI Gateway Consolidation (1–2 days)

23. **Migrate the last 4 direct-Gemini functions** to the shared OpenRouter helper with auto-fallback: `generate-avatar`, `generate-broll`, `generate-video-from-image`, `poll-video-status`.
24. **Remove `ai-studio`'s bespoke OpenAI/OpenRouter fork** — use the shared `generateImage()` helper that already handles fallback.
25. **Extract `_shared/cors.ts`** — one canonical 8-header object; replace inline copies across 137 functions.
26. **Move Veo3 API keys out of localStorage** into agency settings (server-side) — current setup breaks across browsers/incognito.

## Phase 5 — High-ROI Product Loops (1–2 weeks)

The single biggest product gap: **the platform generates ads but has zero awareness of which ones convert**.

27. **Automated Meta sync every 6h** + a dedicated cron, removing the daily manual sync ritual.
28. **Creative performance feedback loop** — surface ad-level CTR/ROAS inside the Avatar Ad Generator and Static Ad Studio as "what's working for this client" context for the AI.
29. **Bidirectional GHL pipeline sync** — webhook in for stage changes -> update internal lead + Slack alert.
30. **HubSpot OAuth refresh + webhook listener** for deal-stage changes.
31. **Stripe webhook listener** writing to `stripe_events` + Slack alert on failed charges (silent churn prevention).
32. **MeetGeek webhook auto-ingest** + Slack ping to AM with action items for review.
33. **Slack Events API subscription** (replace 30s polling) + auto-assign on auto-created tasks.
34. **Replace dashboard "object count" widgets** with a live portfolio table: client x spend x ROAS x leads x MRR x churn risk.
35. **Embed a real calendar picker** (GHL / Calendly) in the onboarding kickoff step — biggest onboarding drop-off.
36. **Build the missing Google Ads sync** (currently a button that does nothing) — OAuth + `sync-google-ads` + reporting wired into existing dashboards.

## Phase 6 — Code Health Cleanup (ongoing, parallel)

37. **Decompose the 10 oversized components** (>1,000 lines each) into sub-components + hooks. Start with `CreativeApproval`, `AIStudioTab`, `ClientSettingsModal`.
38. **Consolidate `src/context/` and `src/contexts/`** into one directory. Delete duplicate `CapitalRaisingCalculator`.
39. **Add hot-path indexes**: `meta_campaigns(client_id, status)`, `meta_ad_sets(client_id, status)`, `meta_ads(client_id, status)`, `leads(client_id, status, created_at)`, `sync_queue(status, processing_started_at)`.
40. **Enable PITR** in Supabase dashboard + document a quarterly restore drill.

---

## Suggested Execution Order

Week 1: Phase 1 (P0 security)  ->  Phase 2 (reliability)
Week 2: Phase 3 (frontend perf/UX)  +  Phase 4 (AI gateway)
Week 3–4: Phase 5 (product loops — Meta auto-sync + perf feedback first)
Ongoing: Phase 6 (cleanup, indexes, decomposition)

The **single highest-ROI item** is the Phase 5 pair: **automated Meta sync + creative performance feedback into the AI generators**. It turns the studio from a content factory into an optimization engine. But it should not ship before Phase 1 security fixes — those are non-negotiable.

---

## Notes

- The `HPA1234$` edge-auth password pattern is kept as-is per user request; the `external-data-api` and `verify-password` fixes above remove hardcoded values but preserve the HPA1234$ body-password flow for other edge functions.
- All security migrations follow the standard order: `CREATE TABLE` -> `GRANT` -> `ENABLE RLS` -> `CREATE POLICY`.
- Cron failure logging: new `public.cron_run_log(id, job_name, status_code, body, ran_at)` table + PL/pgSQL wrapper around `net.http_post`.
- Idempotency key new format: `lead_upsert:{client_id}:{external_id}:{source}:{YYYY-MM-DD}`.
- AI gateway: continue with the existing `_shared/openrouter.ts` helper + `models: [...]` auto-fallback (no client-facing changes needed; client SSE parsers are model-agnostic).
- Performance feedback loop: read from existing `meta_ads` + `v_client_performance_*` views; inject the top 5 winning ad copies/styles into the AI Studio system prompt per client.
- Webhook secrets (Slack, Stripe, MeetGeek, HubSpot) go in `Deno.env`, verified before any DB write.
