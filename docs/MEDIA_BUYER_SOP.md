# Media Buyer Agent — Standard Operating Procedures (SOP)

**Audience:** Agency operators running the AI agent fleet across capital-raising clients.
**Status:** Draft SOP. Several steps below depend on Phase 0/1 fixes in `ADS_MANAGER_AUDIT.md` (scheduling, security, delivery). Items that are **not yet automated** are flagged ⚠️ MANUAL.

---

## 0. Agent fleet roles (the canonical 8)

| Agent | What it does | Owner reads it… |
|---|---|---|
| 🧠 JARVIS | Daily orchestrator — KPI snapshot, health score, escalations | Daily |
| 🎬 BROOKLYN (Media Buyer) | Ad performance analysis + copy/angle recommendations | Daily |
| ⚙️ OPS | Data accuracy + Meta token health + sync verification | Daily |
| 🎯 HUNTER | Lead scoring, stuck pipeline, pre-call briefs | Daily |
| 📞 ANALYST | Call scoring + coaching + compliance flags | Daily |
| 🤝 KEEPER | Client health + churn signals | Weekly |
| 🔍 Data QA | Cross-source reconciliation | Weekly |
| 💰 LEDGER | P&L, cost-per-funded, ROAS | Weekly |

> **Important:** BROOKLYN currently **analyzes and recommends**. It does **not** execute changes on Meta. Treat every recommendation as a proposal a human approves and applies in Meta Ads Manager, until the Graph API write layer (Phase 2) ships with spend guardrails.

---

## 1. Daily monitoring SOP (per operator, ~10 min)

**When:** Each morning after the 06:00 UTC `daily-master-sync` completes.

1. Open the **Agents** tab → confirm no agent shows `last_run_status = failed` or is auto-disabled (3 consecutive failures disables an agent automatically — `run-agent` line 43).
2. Read **JARVIS** for each client: check `health_score`, KPI snapshot (leads / calls / shows / funded / spend), and `issues`.
3. Triage **escalations** (Agents → Escalations): handle `critical`/`high` first. Record resolution in the escalation notes. ⚠️ MANUAL: there is no resolution UI yet — resolve in DB / via Slack and note it.
4. Read **BROOKLYN**: review `creative_insights` and `ad_copy_suggestions`. For any "scale winner / kill loser" recommendation, **apply it manually in Meta Ads Manager** and log what you changed.
5. Check **OPS**: if `meta_token_status` is near expiry, rotate the client's Meta token **before** it lapses (tokens last ~60 days, no auto-refresh).

**Escalation thresholds (recommended defaults):**
- CPL > 1.5× the client's 7-day average → BROOKLYN escalation, operator reviews creatives.
- Spend with zero leads for > 24h → `critical`, pause and investigate same day.
- Show rate < 40% → ANALYST escalation, coaching follow-up.
- Meta token < 7 days to expiry → OPS escalation, rotate immediately.

---

## 2. Weekly reporting SOP (per client, Mondays)

1. Trigger **`weekly-brief-generator`** for all active clients. ⚠️ MANUAL today (no cron — see Phase 1 fix #7). Until then, invoke it Monday morning.
2. Review each client's brief (`creative_briefs`, status `pending`): week-over-week spend/CPL/CTR, top 3 creatives, CPL trend, recommended improvements, and the generated video/static scripts.
3. Approve/edit the briefs, then **deliver to the client** (Slack channel or email). ⚠️ MANUAL: briefs are not auto-delivered yet.
4. Pull **LEDGER** (cost-per-funded, ROAS) and **KEEPER** (health/churn) for the weekly client update.
5. Send the consolidated weekly report. Suggested structure: *Results vs. last week → What we changed → What we recommend next → Asks of the client.*

---

## 3. Communicating with JARVIS (daily)

- **Cadence:** JARVIS is templated to run at `:05` and `:35`. Once Phase 1 scheduling is live, it posts a per-client summary to Slack via the `slack` connector.
- **Owner DM:** `run-agent` already DMs the agency owner a per-run summary (score, #actions, tokens, slack_message) when `agency_settings.slack_dm_user_id` is set and `agent_notification_slack_dm` is on. Configure this in Settings.
- **Reading JARVIS output:** it returns `summary`, `kpi_snapshot`, `health_score (1-100)`, `issues[]`, `escalations[]`, `next_priorities[]`, `slack_message`. Use `health_score` as the daily traffic-light per client.
- ⚠️ JARVIS does **not** yet delegate work to other agents. Treat its `next_priorities` as a human task list until the `agent_tasks` orchestration (Phase 2 fix #9) is built.

---

## 4. Onboarding a new client onto the agent fleet

⚠️ Entirely manual today (onboarding does not provision agents). Per new client:

1. Create the client and store **per-client** `meta_ad_account_id` + `meta_access_token` (prefer a **Meta System User token**, not a 60-day Explorer token), plus GHL keys.
2. Verify the Meta connection (Settings → Integrations test) and run one manual `sync-meta-ads` to confirm data lands in `meta_campaigns` / `daily_metrics`.
3. Create (or clone) the agent set for that client: set each agent's `client_id` to the new client, choose model + connectors, set `schedule_cron`, and enable.
   - Cheaper models (Gemini Flash) for high-frequency agents (OPS, BROOKLYN); stronger models (Gemini Pro / GPT-5) for JARVIS, HUNTER, ANALYST.
4. Map the client's Slack channel in `client_settings.slack_channel_id` so agent messages route correctly.
5. Run each agent once manually and confirm a clean `agent_runs` record before relying on the schedule.

> Target end-state (Phase 2 fix #11): a "Deploy fleet to client" action that instances all 8 agents on onboarding automatically.

---

## 5. Best practices & guardrails

- **Money safety:** never let an agent change spend without a human approval step and a hard per-client daily spend cap. This is mandatory before any Graph API write capability is enabled.
- **Token hygiene:** rotate Meta tokens on a 50-day calendar reminder (ahead of the 60-day expiry); store only in Vault/encrypted columns once Phase 0 ships.
- **Model cost control:** watch `tokens_used` per run in `agent_runs`; if an agent's prompt/data grows, cap `max_tokens` and prefer Flash-tier models for frequent runs.
- **Failure handling:** an agent auto-disables after 3 consecutive failures — investigate the `error` on the failed `agent_runs` before re-enabling.
- **Compliance:** ANALYST surfaces `compliance_flags` on calls and BROOKLYN should flag non-compliant ad claims — route these to a human reviewer; capital-raising ads carry regulatory risk.
- **Data trust:** rely on Data QA / OPS reconciliation scores before sending any number to a client; the daily accuracy check exists for this reason.

---

## 6. Pre-launch checklist (gate before connecting real client accounts)

- [ ] RLS rewritten with real tenant isolation; verified Client A cannot read Client B.
- [ ] Real Supabase Auth live; `HPA` / `HPA1234$` hardcoded passwords removed; password logging removed.
- [ ] All tokens/keys in Vault; `.env` untracked; Supabase + all client keys rotated.
- [ ] Sensitive edge functions require auth (`verify_jwt`/HMAC).
- [ ] `pg_cron` (or scheduler) actually invokes `run-agent` per agent schedule — verified by live runs.
- [ ] `weekly-brief-generator` scheduled **and** delivering to clients.
- [ ] Automatic per-client daily report posting to client Slack.
- [ ] Meta API standardized on one current version; token-refresh + 429 backoff in place.
- [ ] Spend guardrails + audit log in place IF any Graph API write capability is enabled.
- [ ] Cost metering, escalation SLAs, and a sync-health/alerting dashboard live.
</content>
