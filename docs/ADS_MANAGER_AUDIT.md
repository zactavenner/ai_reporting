# Ads Manager + AI Media Buyer — Commercial Readiness Audit

**Date:** 2026-06-27
**Scope:** The Ads Manager, the AI agent system (the "media buyer" + JARVIS orchestrator + the agent fleet), Meta Graph API integration, daily/weekly reporting, and multi-tenant security.
**Question asked:** *"Is it 100% ready to go live for commercial use across all capital-raising clients?"*

## Verdict: ❌ NOT READY FOR COMMERCIAL LAUNCH

The platform is a well-built **analytics & reporting** product with a strong UI and a real agent framework. But three classes of problems block live commercial use with real client ad accounts and money:

1. **Critical multi-tenant security failures** — every client's Meta tokens, GHL keys, leads, and investor data are readable by anyone with the public app key. This is a launch-blocker, full stop.
2. **The "media buyer" does not actually buy media** — the Meta integration is **read-only**. No agent can pause a campaign, change a budget, or launch an ad. It analyzes and recommends; a human still executes.
3. **The automation isn't wired to run** — agents have schedules in the UI but **no cron actually triggers them**, and JARVIS is a prompt template, not a working orchestrator. Nothing runs daily on its own yet.

Below is the detail, ranked by what blocks launch.

---

## 1. The agent fleet — what exists vs. what the request assumes

There are **8 agent templates** defined in `src/hooks/useAgents.ts:201` (the request mentioned "five" — worth aligning on the canonical set):

| Agent | Role | Connectors | Template schedule |
|---|---|---|---|
| 🧠 **JARVIS** (AI COO) | Orchestrator — oversees agents, KPIs, escalations | database, slack | `5,35 * * * *` |
| 🎬 **BROOKLYN** (Marketing) | **The "media buyer"** — ad performance analysis, copy suggestions | database, meta_ads, slack | `10 * * * *` |
| ⚙️ **OPS** | Data accuracy / token health / sync checks | database, meta_ads | `*/15 * * * *` |
| 🎯 **HUNTER** (Sales) | Lead scoring, pipeline, pre-call briefs | database, ghl_crm | `*/30 * * * *` |
| 📞 **ANALYST** | Call scoring (rapport/qualification/objections) | database, slack | `0 5 * * *` |
| 🤝 **KEEPER** (Client Success) | Health scoring, churn detection | database, slack | `0 * * * *` |
| 🔍 **Data QA** | Cross-checks sources vs. daily_metrics | database, ghl_crm, meta_ads, slack | `0 6 * * *` |
| 💰 **LEDGER** (Finance) | P&L, margins, cost-per-funded | database | `0 13 * * *` |

**How a run works** (`supabase/functions/run-agent/index.ts`): loads the agent, gathers per-connector data for the target client(s), interpolates `{{client_name}}/{{date}}/{{data}}` into the prompt, calls the Lovable AI gateway, then parses the JSON response to (a) upsert metric corrections, (b) create escalations, and (c) post Slack messages. This core loop is solid and genuinely useful.

### Blockers in the agent layer
- **No automatic scheduling.** `schedule_cron` is stored and editable in the UI, but **no `pg_cron` job invokes `run-agent`** for it. Verified: `grep cron.schedule` finds jobs for calendar sync, GHL sync, and daily-master-sync — **none for `run-agent`**. Today agents only run when a human clicks "Run." → *"Monitor it daily" does not happen on its own yet.*
- **JARVIS is a prompt, not an orchestrator.** The `agent_tasks` table (created_by_agent / assigned_to_agent) exists and is displayed read-only, but **nothing writes to it or executes from it.** There is no inter-agent routing, no conflict resolution, no "JARVIS delegates to HUNTER" logic. JARVIS just produces a report like every other agent.
- **No per-client provisioning.** `onboard-client` / `onboard-from-form` do **not** create any agents. Assigning an agent to each new client is 100% manual, one agent at a time (`run-agent` can fan out to all active clients when `client_id` is null, but there's no per-client agent instancing or bulk "deploy to all clients").
- **Escalations have no resolution workflow** and are **not surfaced into reports or Slack-alerted** on creation.

---

## 2. Meta Graph API — read-only, version-fragmented

**The most important expectation gap:** there are **zero write calls** to the Graph API anywhere in the codebase. Every Meta call is a `GET` on `/insights` or entity reads. The system **cannot** create/pause campaigns, change budgets, edit targeting, or launch creatives. The `meta_create_campaign` / `meta_upload_creatives` items in `fulfill-client-browser/index.ts:58` are **queued manual browser tasks**, not API automation. So "AI media buyer" today = "AI media *analyst*."

Other findings:
- **API version fragmentation.** Primary sync uses **v21.0** (current), but `run-agent/index.ts:212` uses **v19.0** and `sync-client-data` / `scrape-fb-ads` use **v18.0** (both deprecated; will break as Meta EOLs them). Standardize on a single current version.
- **Tokens are plaintext** in `clients.meta_access_token` and fall back to a shared `META_SHARED_ACCESS_TOKEN`. They're **manual 60-day Graph Explorer tokens** with **no refresh** — guaranteed outage every ~60 days unless someone rotates them. For commercial use you want a **Meta System User long-lived token** per client (or a proper OAuth/Business Manager flow).
- **No retry/backoff on Meta 429s.** There's a 190-call soft budget and a 30s inter-client delay, but a throttle or 5xx fails the sync hard. Add exponential backoff.
- **Query-level client isolation is correct** (every query filters `client_id`), but there is **no database-level (RLS) isolation** behind it — see §3.

---

## 3. Security — CRITICAL, launch-blocking

This is the section that turns "not ready" into "do not connect real client accounts yet."

- **No tenant isolation in the database.** Verified: **52 policies use `USING (true)` / `WITH CHECK (true)` and exactly 0 policies use `auth.uid()` / `auth.jwt()`.** Core tables — `clients`, `leads`, `calls`, `funded_investors`, `daily_metrics`, `agents`, `agent_runs`, `client_settings` — are effectively world-readable/writable. Client A can read Client B's data, tokens, and investor lists.
- **The app key is committed and the key alone unlocks everything.** `.env` is **tracked in git** (it is not in `.gitignore`) and holds the Supabase anon/publishable key. An anon key is *designed* to be public **only because RLS is supposed to protect the data** — but with §3.1's open RLS, this key = full read/write to every client's data. This is the single most dangerous combination in the codebase.
- **`client_settings` is publicly writable** (`Public can insert/update ... WITH CHECK (true)`), including `stripe_customer_id`, `tracked_calendar_ids`, and webhook mappings — i.e. anyone can reassign billing or hijack integrations.
- **Hardcoded master passwords.** `verify-password/index.ts:61` accepts the literal password **`HPA`** for *any* member, and **logs the plaintext password** (lines 54-57). The MCP server hardcodes **`HPA1234$`** (`mcp-agent-server/index.ts:174`). Auth is a client-side `localStorage` gate, not real Supabase Auth, so it's trivially bypassed.
- **~35 edge functions run with `verify_jwt = false`** (`config.toml`), including `stripe-payments`, `external-data-api`, `daily-master-sync`, `sync-meta-ads`, and `weekly-brief-generator` — all publicly invokable with no auth.

**Compliance note:** in its current state the platform would not pass SOC 2 / GDPR basics, which matters because the clients are capital-raising firms handling investor PII.

---

## 4. Reporting & Slack — partial, not yet "daily/weekly automatic"

- **What runs automatically today:** `daily-master-sync` at `0 6 * * *` (orchestrates Meta/GHL/HubSpot sync + metric recalc + accuracy check + Meta token expiry check), GHL sync every 4h, calendar sync hourly. This data backbone is real and working.
- **Daily reports are member/team-level, not client-level**, and are **manually submitted** (SOD/EOD), delivered to one internal agency Slack channel. There is **no automatic per-client daily KPI/health report**.
- **Weekly briefs** (`weekly-brief-generator`) are genuinely good and **per-client** (week-over-week spend/CPL/CTR, top creatives, AI scripts) — but **have no cron** (never auto-run) and **no delivery** (they sit in `creative_briefs` as `pending`, no Slack/email to the client).
- **Agent output isn't in any report.** `agent_runs` and `agent_escalations` are logged but not aggregated into the daily/weekly reporting or alerted.

---

## 5. Remediation roadmap (what "100% ready" actually requires)

Ordered by dependency. Items in **Phase 0 are non-negotiable** before any real client account is connected.

### Phase 0 — Security (blocks launch; ~1–2 weeks)
1. Replace all `USING (true)` policies with real tenant scoping (agency-member → client mapping via `auth.jwt()`), starting with `clients`, `client_settings`, `leads`, `calls`, `funded_investors`, `daily_metrics`, `agents*`.
2. Stand up real Supabase Auth (per-user accounts + roles); delete the `HPA` / `HPA1234$` hardcoded passwords and the plaintext password logging; replace the localStorage gate.
3. Move all third-party credentials (Meta, GHL, Stripe, AI keys) into Supabase Vault / encrypted columns; rotate every currently-committed/exposed secret.
4. Add `verify_jwt = true` (or HMAC-signed service-to-service auth) to every function that isn't a genuinely public webhook; lock down `stripe-payments`, `external-data-api`, `run-agent`, `mcp-agent-server`.
5. `git rm --cached .env`, add it to `.gitignore`, rotate the Supabase keys.

### Phase 1 — Make the automation actually run (~1 week)
6. Add a `pg_cron` job (or a scheduler edge function) that reads each enabled agent's `schedule_cron` and invokes `run-agent`. This is what turns "monitor daily" on.
7. Schedule `weekly-brief-generator` (e.g. Monday 07:00) **and** add per-client Slack/email delivery.
8. Add an automatic **per-client daily report** (KPI snapshot + open escalations) posted to each client's Slack channel.

### Phase 2 — Real orchestration + real media buying (~3–6 weeks)
9. Wire JARVIS to actually write `agent_tasks` and build an `orchestrate-agents` worker that executes/retries them — that's the "JARVIS coordinates the fleet daily" capability.
10. Decide the media-buying scope. If clients expect the agent to *act* on Meta (pause losers, scale winners, launch creatives), build the Graph API **write** layer with guardrails (spend caps, human approval thresholds, full audit log). Until then, position BROOKLYN honestly as "recommendations a human approves."
11. Per-client agent provisioning on onboarding + a "deploy fleet to all clients" bulk action; standardize on one Meta API version with token-refresh handling and 429 backoff.

### Phase 3 — Commercial hardening
12. Cost/usage metering per client, escalation SLAs + alerting, sync-health dashboard, load test (100 clients × 8 agents), backup/restore + incident runbook.

---

## 6. Honest one-paragraph summary for the team

The bones are excellent: a real agent framework, a working data sync backbone, a strong UI, and a genuinely good weekly-brief generator. But it is **not** a turnkey commercial media-buying product yet. It is **read-only** (no agent can touch a live campaign), the **automation isn't scheduled to run**, **JARVIS doesn't actually orchestrate**, and — most importantly — the **database has no tenant isolation**, so connecting multiple real clients' ad accounts today would expose every client's tokens and investor data to every other client. Fix the security layer first (Phase 0), turn on scheduling and reporting (Phase 1), then decide whether you're shipping an AI *analyst* or a true AI *media buyer* (Phase 2).
</content>
</invoke>
