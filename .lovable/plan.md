# Agent Workforce v4 — Custom Agents, Schedules, Hermes Gateway

Three waves, shipped in order. Each is independently useful.

## Wave 1 — Custom Master Agents

Let you create/edit/delete agents at the master (agency) level beyond the 6 seeded ones. Every custom master agent automatically becomes available in every client (same mapping the 6 seeded agents already use).

Schema (migration):
- `agents` already exists at master scope. Add:
  - `is_custom boolean default false` (seeded=false, user-created=true)
  - `created_by text` (team_member_id)
  - `archived_at timestamptz`
- Keep existing `client_agent_overrides` for per-client tweaks — custom agents inherit the same override mechanism for free.

UI (`AgentProfilePanel` / workforce list):
- "New Agent" button on master view → modal (name, role, primary model, fallbacks, instructions, connectors)
- Edit/Archive controls on custom agents only (seeded 6 remain read-name)
- Client view (`ClientAgentsManager`) auto-lists all non-archived master agents (seeded + custom) with the same dual-tab editor already built

## Wave 2 — Schedules / Cadences

Give each agent an optional cron schedule. Master schedule runs the agent against agency scope; client-scoped schedule runs it inside that client's workspace.

Schema:
- New `agent_schedules` table:
  - `id`, `agent_id`, `client_id nullable` (null = master), `cron text`, `timezone text default 'America/Los_Angeles'`, `task_prompt text`, `enabled bool`, `last_run_at`, `next_run_at`, `created_by`
  - GRANTs + RLS (authenticated read/write, service_role all)

Backend:
- New edge function `agent-schedule-tick` — every minute, pg_cron pings it; it selects rows where `enabled AND next_run_at <= now()`, enqueues an `agent_tasks` row per due schedule (client_id from row), updates `last_run_at` / `next_run_at` using cron parser
- pg_cron: `select cron.schedule('agent-schedule-tick','* * * * *', $$ net.http_post(...) $$)`

UI:
- New "Schedule" section in `AgentProfilePanel` (master scope) and in `ClientAgentsManager` per-client tab
- Cadence presets (Hourly / Daily 9am / Weekly Mon / Custom cron) + task prompt textarea + enable toggle
- List of upcoming runs (next 5) computed from cron

## Wave 3 — Hermes ↔ Jarvis Two-Way

Hermes (external ops agent) can push a request → Jarvis routes to correct client + offer + specialist agent, executes, and reports back.

Schema:
- Reuse `hermes_tasks` (exists) + new `hermes_task_type_routes` (exists). Add:
  - `hermes_tasks.requested_by text` (hermes|jarvis|user)
  - `hermes_tasks.reply_to text` (webhook/thread id)
  - `hermes_tasks.jarvis_conversation_id uuid` (link to jarvis thread when routed)

Backend:
- Edit `jarvis-chat` edge function: when a Hermes-tagged message arrives (system role or `source:hermes` in body), Jarvis:
  1. Parses target (client, offer, agent) — uses existing hermes_task_type_routes for routing
  2. Creates `agent_tasks` row for target specialist
  3. Streams progress back into the Jarvis↔Hermes side panel (already built)
  4. On completion, POSTs summary back to `reply_to`
- New edge function `hermes-inbound`: HMAC-verified webhook Hermes calls to push tasks → forwards into jarvis-chat with `source:hermes`

UI:
- Jarvis Command Center already has the Jarvis↔Hermes panel — add badge "Inbound from Hermes" + "Route to…" quick action
- Show which client/agent Jarvis routed to inline in the thread

---

## Order & verification
1. Wave 1 migration + UI + smoke-test create/edit/delete + verify shows in a client
2. Wave 2 migration + edge fn + pg_cron + smoke-test with a 1-min schedule
3. Wave 3 schema tweak + edge fns + smoke-test Hermes-simulated inbound → task created → response

I'll ship Wave 1 first, then confirm before Wave 2 & 3 to keep blast radius small.