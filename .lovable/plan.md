
# Agent Workforce v3 — Claude-Style Profiles

Rebuild the Agent Workforce section into a profile-based UI inspired by the reference screenshot. Five master agents live at the agency level; their config trickles into every client. Per-client view adds offer/client-specific extras only.

## Visual layout (per agent profile)

Two-column layout, Apple-clean:

```text
┌──────────────────────────────────────────┬──────────────────────────────┐
│ Agent header (icon, name, role, model)   │  Memory          [edit]      │
│ ── tabs: Conversations | Activity ──     │  short purpose/context note  │
│                                          │  Last updated …              │
│ Recent runs / chat threads list          │ ──────────────────────────── │
│   - "Brief for HRT" — 2d ago             │  Instructions    [+]         │
│   - "Weekly report" — 5d ago             │  (system prompt summary)     │
│                                          │ ──────────────────────────── │
│                                          │  Files           [+]         │
│                                          │  [▓░░░] 12% capacity used    │
│                                          │  • file cards (name, lines)  │
│                                          │ ──────────────────────────── │
│                                          │  Connectors                  │
│                                          │  chips: Meta · GHL · Stripe  │
│                                          │ ──────────────────────────── │
│                                          │  Available Models            │
│                                          │  chips per capability        │
│                                          │   (Creative → GPT Image 2,   │
│                                          │   Nano Banana Pro, Seedance) │
└──────────────────────────────────────────┴──────────────────────────────┘
```

The agent list (left rail at agency view) shows the 5 masters with status dot, model, last run.

## Data model

Reuse existing tables — add only what's missing:

1. `agency_agents` already exists → use as master profile. Add columns:
   - `memory_md text` (the "Purpose & context" block)
   - `instructions_md text` (extra tailoring on top of system_prompt)
   - `connectors jsonb default '[]'` (list of connector slugs the agent may call)
   - `capabilities jsonb default '{}'` (e.g. `{ "image": ["openai/gpt-image-2","google/gemini-3.1-flash-image"], "video": ["bytedance/seedance-2.0-fast"] }`)

2. New `agency_agent_files` table for uploads:
   ```
   id uuid pk, agent_id uuid fk → agency_agents, client_id uuid null
   (null = master, non-null = client-specific addendum),
   name text, mime text, size_bytes bigint, lines int,
   storage_path text, created_at timestamptz default now()
   ```
   With GRANTs + RLS (authenticated read/write).

3. `client_agents` already exists per client — extend to read master profile and only override `instructions_md` / files when `is_customized=true`. Per-client extras = offer/client cards rendered from existing `client_brain` + `client_offers`.

4. Capacity = `sum(size_bytes) / model_context_window`. Window taken from a small `MODEL_CONTEXT` map in `src/lib/modelRegistry.ts`.

## Files & storage

- New bucket `agent-files` (public read off; signed URLs via edge function).
- Upload component uses `supabase.storage.from('agent-files').upload(...)`, then inserts row, computing line count for `.md/.txt/.json` on the client.

## Trickle-down

- Master-level memory/instructions/files = `client_id IS NULL`.
- Each client view shows: master profile (read-only banner "Inherited from agency") + an "Additional for {client}" panel:
  - extra files (insert with `client_id` set)
  - offer cards (from `client_offers`)
  - client brain summary (from `client_brain`)
- No duplication — clients can't edit master fields; they can only append.

## Components to create

- `src/components/agents/AgentWorkforceV3.tsx` — agency-level grid of 5 agent cards + selected agent profile.
- `src/components/agents/AgentProfilePanel.tsx` — the two-column profile (Memory / Instructions / Files / Connectors / Models).
- `src/components/agents/AgentFilesUploader.tsx` — drag-drop, capacity bar, file cards.
- `src/components/agents/AgentConnectorsRow.tsx` — chips from `standard_connectors` list + each agent's allowed slugs.
- `src/components/agents/AgentModelsRow.tsx` — chips grouped by capability (Chat / Image / Video) from `capabilities`.
- `src/hooks/useAgencyAgentFiles.ts` — list/insert/delete with capacity calc.

Mount `AgentWorkforceV3` at the top of the existing Agents tab (replacing the current "Agent Workforce" hero section). Update `AIStudioAgentsTab.tsx` so the per-client view renders the same `AgentProfilePanel` with `clientId` prop → shows inherited master block + per-client extras.

## Backend changes

- One migration: add 4 columns to `agency_agents`, create `agency_agent_files` (with grants + RLS), create `agent-files` storage bucket.
- Seed the 5 master agents' `capabilities` JSON (Jarvis, Media Buyer, Creative, Reporting, QA).
- No edge-function changes required — existing `ai-studio` / `hermes-task-executor` already read `agency_agents`.

## Out of scope

- No changes to Hermes routing logic.
- No changes to AI Studio chat surface itself.
- Existing `AgencyAgentsManager` remains as the underlying CRUD; new UI sits on top.
