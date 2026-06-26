# AI Studio Agents — Phased Architecture Rollout

Goal: move from per-client ad-hoc agents to a 3-layer knowledge model — **Agency Agents** (shared workforce) → **Client Brain** (per-client memory) → **Offer Knowledge** (per-offer context) — with mass-training and creative-type routing.

## Layer model

```text
Agency Agents (shared)        Client Brain (per client)        Offer Knowledge (per offer)
─────────────────────────     ──────────────────────────       ───────────────────────────
Media Buyer                   Voice / tone / ICP                Offer doc, pricing, hooks
Reporting                     Brand assets / colors             Funnel, CTAs, target CPA
Static Ads Specialist         Win/loss patterns                 Creative training (per type)
Video Ads Specialist          Compliance rules                  Past ads + performance
Copywriter                    Historical learnings              Asset library
```

Every turn the agent runs with: Agency role prompt + Client Brain + Selected Offer context. Switching clients/offers swaps only the lower two layers.

---

## Phase 1 — Data model (1 migration)

New tables (all RLS + grants):

- `agency_agents` — id, slug, name, role, icon, default_model (`openrouter/owl-alpha`), system_prompt, allowed_creative_types[], is_active
- `agency_agent_training` — id, agent_id → agency_agents, kind (`doc|url|note|example`), title, body, file_url, weight
- `client_brain` — client_id PK, voice, icp, brand_guidelines, do_not_say, learnings (jsonb)
- `client_offer_training` — id, offer_id → client_offers, creative_type (`static|video|copy|reporting|media_buying`), title, body, asset_url

Seed 5 agency agents: `media_buyer`, `reporting`, `static_ads`, `video_ads`, `copywriter`. Owl Alpha default; per-agent override allowed (Owl Alpha / DeepSeek V4 Flash / GPT-5 / GPT-5 Mini only).

## Phase 2 — Three-column UI

New route `/agents` (rename existing tab):

```text
┌─────────────┬───────────────────────┬────────────────────────┐
│ Agency      │ Agent detail          │ Training / Context     │
│ Agents (5)  │ Prompt • Model • Type │ Tabs: Agency Training, │
│ + Client    │ Tools • Schedule      │ Client Brain, Offer    │
│   Brain     │                       │ Training               │
└─────────────┴───────────────────────┴────────────────────────┘
```

- Left rail: 5 shared agents + a "Client Brain" entry per active client.
- Middle: editable agent config (model picker restricted to the 4 approved models, Owl Alpha default).
- Right: 3-tab training surface; **Agency Training** is global, **Client Brain** auto-scopes to the selected client, **Offer Training** scopes to the selected offer with creative-type sub-tabs.

## Phase 3 — Mass training UI

"Agent Training" tab (renamed from References, already shipped) gets:

- Multi-select files/URLs → bulk attach to one or many agents.
- "Route by type" toggle: drops `static` examples onto Static Ads agent, `video` onto Video Ads, `copy` onto Copywriter, etc.
- CSV import for examples (prompt → desired output pairs).

## Phase 4 — Creative-train routing

In `AIStudioCanvas` the existing "Train on creative" action becomes type-aware:

- image / static asset → `static_ads` agent training (offer-scoped)
- video / reel → `video_ads` agent training
- script / caption → `copywriter` agent training

Stored in `client_offer_training` with `creative_type` set automatically from the asset MIME / canvas item kind.

## Phase 5 — Runtime context assembly (ai-studio edge function)

On every turn:

1. Resolve `agentSlug` (from `@mention` or active tab) → load agency prompt + training (top-K by weight, capped tokens).
2. Load `client_brain` for `selectedClientId`.
3. Load `client_offer_training` for `selectedOfferId`, filtered to the agent's `allowed_creative_types`.
4. Compose system prompt in fixed order: Agency role → Client Brain → Offer context → user request.
5. Model = agent's `default_model` (Owl Alpha unless overridden); never silently swap.

Knowledge isolation: an agent only ever sees the currently-selected client's brain and selected offer's training — no cross-client leakage.

## Phase 6 — Permissions

- `authenticated` can read/write agency agents & training (team workspace).
- Client brain + offer training scoped by existing client-membership policies.
- `service_role` for edge functions.

## Phase 7 — Migration of existing data

- Existing `client_agents` rows → mapped into `agency_agents` (deduped by role) + their per-client overrides moved into `client_brain.learnings`.
- Existing `agency_references` → `agency_agent_training` (kind=`doc`).
- Existing offer files already in `client_offer_files` are surfaced read-only inside the Offer Training tab — no data move needed.

---

## Build order (shippable per phase)

1. Phase 1 migration + seed 5 agents.
2. Phase 5 runtime assembly (so even the old UI immediately benefits from layered context).
3. Phase 2 three-column UI.
4. Phase 3 mass-training + Phase 4 creative routing.
5. Phase 7 data migration + retire legacy `client_agents` UI.

Approve and I'll start with Phase 1 + 2 + 5 in the first build pass (the highest-leverage slice: schema, layered context at runtime, and the new UI shell).
