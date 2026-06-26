
# Agent Workforce v2 — 5 Core Agents + Audit Trail

## 1. Collapse to 5 core agents

Replace the current 15-agent roster (Agency Agents) with a fixed hierarchy. Deactivate (don't delete) the rest so historical runs/escalations stay intact.

```text
                 HERMES  ⇄  JARVIS  (OPS / AI COO)
                              │
        ┌────────────┬────────┴────────┬────────────┐
   MEDIA BUYER    CREATIVE         REPORTING        QA
   (SCALE)        (CANVAS)         (PULSE)          (SENTRY)
```

Each agent gets:
- Slug, default model (Owl Alpha), system prompt aligned to role
- Connector matrix (Meta, GHL, Sheets, Slack, WhatsApp, Tasks, DB, Stripe)
- `parent_agent_id` → all four report to Jarvis; Jarvis ⇄ Hermes peer link
- `allowed_creative_types` for Creative includes static + video

**Creative (CANVAS)** Static Ads sub-config:
- Image model picker with two options: **GPT Image 2** (`openai/gpt-image-2`) and **Nano Banana Pro 2** (`google/gemini-3-pro-image`)
- Per-agent default + per-run override surfaced in the Static Ads Generator UI
- Wire selection through `useStaticBatchGeneration` → `generate-static-ads` edge function

## 2. Per-client + agency scope

- Agency-level: the 5 agents exist once, visible only in agency view (`/agents`)
- Each client gets a mirror row in `client_agents` so connectors/access/training can be overridden per client without forking the agent definition
- Effective config = client override ⟶ falls back to agency default
- Agency Agents page shows the 5 cards; clicking opens tabs: Overview / Config / Agent Training / **Channel** / Runs / Escalations

## 3. Inter-agent channels (audit trail)

New schema:

```sql
agent_channels        -- one per (scope, agent) + system channels
  id, scope ('agency'|'client'), client_id NULL,
  agent_id NULL, kind ('agent'|'jarvis-hermes'|'jarvis-team'), name

agent_messages
  id, channel_id, from_agent_id, to_agent_id NULL,
  role ('agent'|'human'|'system'),
  user_id NULL, kind ('message'|'command'|'handoff'|'escalation'|'task-comment'),
  body, payload jsonb, task_id NULL, run_id NULL, created_at
```

Channel layout per scope (auto-seeded):
- `#hermes-jarvis` — loop/commands between the two brains
- `#jarvis-mediabuyer`, `#jarvis-creative`, `#jarvis-reporting`, `#jarvis-qa` — Jarvis ↔ each report (humans can read & post)
- One agency-wide read view aggregating all channels (filter by agent/client/kind)

Every backend agent action (model call, tool call, task touch, escalation) writes an `agent_messages` row → complete audit trail.

## 4. Task comments by agents

- When any agent edits/closes/comments on a `tasks` row, the same write fans out as a `task-comment` message into that agent's channel **and** as a normal task comment visible on the task card
- Reuse existing `task_comments` table; add `author_agent_id` column so UI can render the agent avatar inline
- Hermes/Jarvis orchestrator updated to require a comment whenever it mutates a task

## 5. UI

- `AgencyAgentsManager` rewritten as 5 fixed cards (no "New Agent" for core five; keep button for custom)
- New **Channel** tab inside each agent: Slack-style thread, filter chips (commands/handoffs/escalations/task-comments), human reply box (posts as `role='human'`, routed to that agent)
- Agency-level "Comms" page: unified inbox of all channels with client/agent filters
- Per-client agent page reuses the same component, scoped to that client's channels

## 6. Migration / seed

- Seed/upsert the 5 agents (idempotent on slug)
- Deactivate non-core agents (`is_active=false`) but keep rows
- Backfill `agent_channels` for every existing client
- One-time copy of recent `hermes_logs` / `agent_runs` into `agent_messages` so the audit view isn't empty

## Technical notes
- Tables: `agent_channels`, `agent_messages`, `client_agents` (mirror), plus `tasks.author_agent_id`, `task_comments.author_agent_id`
- RLS: agency-only on agency channels; client team members can read their client's channels but not other clients'
- GRANTs to `authenticated` + `service_role` per the public-schema rule
- Realtime enabled on `agent_messages` for live channel updates
- Edge function `agent-bus` is the single write path so audit logging can't be bypassed
- Static ads model picker stored on `agency_agents.config.static_image_model`, overridable per run
- No new chat models introduced — Owl Alpha stays default
