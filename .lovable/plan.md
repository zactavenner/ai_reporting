## Goal

Build a **v2 lead-status sync API** that any agent (Jarvis Ironman, Sales Agent, Reporting Agent, etc.) can call to:

1. Pull the current status of a lead (or a batch of leads) from GHL via the v2 Private Integration Token
2. Write the normalized status back into the reporting tables the dashboard reads
3. Guarantee the full attribution chain **Meta Ad → Lead → Booked → Showed → Committed → Funded** is up to date

The dashboard already reads from `leads`, `calls`, `funded_investors`, `pipeline_opportunities`, and the derived views (`v_client_performance_*`, `daily_metrics`). This plan wires GHL v2 as the source of truth for lead lifecycle and closes the attribution loop to Meta campaigns.

---

## Architecture

```text
                    ┌──────────────────────────────┐
   Agent / cron ───▶│  edge: lead-status-sync-v2   │
   Dashboard ──────▶│  (single + batch + client)   │
                    └──────────────┬───────────────┘
                                   │  GHL v2 PIT (client token → agency PIT fallback)
                                   ▼
                    ┌──────────────────────────────┐
                    │  GHL v2 REST                  │
                    │  /contacts /opportunities     │
                    │  /appointments /conversations │
                    └──────────────┬───────────────┘
                                   ▼
   Normalize → upsert
   ┌────────────┬──────────┬──────────────────────┬────────────────┐
   │  leads     │  calls   │ pipeline_opportunities│ funded_investors│
   └────────────┴──────────┴──────────────────────┴────────────────┘
                                   │
                                   ▼
                    ┌──────────────────────────────┐
                    │  attribute-lead-to-meta      │
                    │  (UTM tiered fallback +      │
                    │   meta_ad_id → campaign)     │
                    └──────────────┬───────────────┘
                                   ▼
                recalculate-daily-metrics (client + date window)
                                   ▼
                    v_client_performance_* views ▶ dashboard
```

---

## Deliverables

### 1. New edge function: `lead-status-sync-v2`

Single entry point, three modes:

| Mode | Body | Purpose |
|---|---|---|
| `single` | `{ mode:"single", client_id, lead_id? | external_id? | email? | phone? }` | Real-time fetch used by an agent when it needs one lead |
| `batch` | `{ mode:"batch", client_id, lead_ids:[...] }` (max 100) | Agent bulk refresh |
| `client` | `{ mode:"client", client_id, sinceHours?=24 }` | Scheduled catch-up sweep |

For each contact it fetches in parallel:
- `GET /contacts/{id}` (custom fields, tags, status)
- `GET /contacts/{id}/appointments` (booked / showed)
- `GET /opportunities/search?contact_id=` (pipeline stage, monetary value)
- `GET /contacts/{id}/notes` (funded amount / commitment parsing)

Uses the token fallback already implemented in `sync-ghl-contacts` (client v2 PIT → `AGENCY_GHL_PIT_TOKEN`).

Returns a normalized JSON envelope agents can consume directly:

```json
{
  "lead_id": "uuid",
  "status": "funded",
  "stage": "Closed Won",
  "booked_at": "...",
  "showed": true,
  "committed_amount": 25000,
  "funded_amount": 25000,
  "attribution": {
    "meta_campaign_id": "...",
    "campaign_name": "...",
    "adset_name": "...",
    "ad_id": "..."
  },
  "updated_tables": ["leads","calls","pipeline_opportunities","funded_investors"]
}
```

### 2. Write path (deterministic, idempotent)

Each contact result upserts into:

- `leads` — `status`, `opportunity_stage`, `opportunity_value`, `custom_fields`, `ghl_synced_at`
- `calls` — one row per appointment (`booked_at`, `showed`, `outcome`, `appointment_status`)
- `pipeline_opportunities` — stage/value from `/opportunities/search`
- `funded_investors` — created when GHL tags/custom fields match `funded` / `commitment` rules (existing rule set in `sync-ghl-contacts`, extracted into a shared helper)

All upserts key on `(client_id, external_id)` — no duplicates (memory: Record Deduplication).

### 3. Attribution helper: `attribute-lead-to-meta`

Extracted from existing UTM logic so both real-time webhook and this sync share it:

1. If lead has `meta_ad_id` (from lead form) → join `meta_ads` → adset → campaign
2. Else UTM tiered fallback (memory: UTM Mapping Strategy)
3. Writes `campaign_name`, `ad_set_name`, `ad_id`, and increments `attributed_leads` / `attributed_funded` / `attributed_funded_dollars` on the matching `meta_campaigns` / `meta_ad_sets` / `meta_ads` row so `get_top_performers` and the dashboard reflect it.

### 4. Metrics refresh

After each sync call, invoke `recalculate-daily-metrics` scoped to the affected `client_id` and touched dates only (not full recompute — cheap and keeps `daily_metrics` correct).

### 5. Agent tool wiring

Add two callable tools to `jarvis-chat` and the master agents (`sales-agent`, `reporting-agent`):

- `get_lead_status(client_id, identifier)` → calls `lead-status-sync-v2` in `single` mode
- `refresh_client_leads(client_id, sinceHours)` → calls `client` mode

This is what lets Sales Agent / Jarvis pull live GHL data mid-conversation.

### 6. Schedule

`pg_cron` job every 15 min → `lead-status-sync-v2` in `client` mode with `sinceHours=1` for every active client whose GHL token is green. Feeds the existing sync watchdog (memory: Sync Reliability).

### 7. Dashboard indicator

Small badge on the client card: "Lead status: synced Xm ago" reading `max(ghl_synced_at)` from `leads` — confirms the loop is live.

---

## Files to add / edit

**New**
- `supabase/functions/lead-status-sync-v2/index.ts` — the endpoint
- `supabase/functions/_shared/ghl-v2-client.ts` — v2 REST wrapper w/ agency fallback, retry, rate-limit
- `supabase/functions/_shared/attribute-lead-to-meta.ts` — shared attribution
- `supabase/migrations/…_lead_status_sync_v2.sql` — pg_cron schedule + index on `leads(client_id, ghl_synced_at)`

**Edit**
- `supabase/functions/jarvis-chat/index.ts` — register the two agent tools
- `supabase/functions/agents/*` master agent prompts — document the new tool
- `src/hooks/useSyncHealth.ts` + client card — surface "last lead-status sync"

**Reuse (no change)**
- `sync-ghl-contacts` v2 token fallback logic (import the helper it now shares)
- `recalculate-daily-metrics`
- `v_client_performance_*` views

---

## Success criteria

1. Calling `lead-status-sync-v2` in `single` mode returns fresh data in <3s and every field the dashboard needs is written.
2. A brand-new Meta lead flows: webhook → `leads` row → 15-min sweep enriches booking/showed/funded → `meta_campaigns.attributed_funded_dollars` increments → dashboard "Funded by Campaign" reflects it without manual sync.
3. Sales Agent, asked "what's the status of lead X", calls the tool and answers with live GHL data.
4. `daily_metrics` for today matches GHL within 15 minutes with no manual click.
