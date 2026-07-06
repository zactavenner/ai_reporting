# GHL Workflow Audit Dashboard

Read-only, multi-client workflow inventory + health monitor for Reporting 5.0, built on the GHL public Workflow API. Cached in Supabase, refreshed every 6h. Existing internal-API editor is preserved under an "Advanced" tab.

## 1. Database

**Migration:** `create_ghl_workflow_audit_tables.sql`

- `public.ghl_workflows` — canonical cache, one row per (client, workflow).
  - `client_id`, `workflow_id`, `name`, `name_normalized` (generated: trim + lower + collapse spaces, for duplicate detection), `status`, `version`, `ghl_created_at`, `ghl_updated_at`, `fetched_at`, `raw jsonb`.
  - Unique `(client_id, workflow_id)`. Indexes on `client_id`, `status`, `(client_id, name_normalized)`.
- `public.ghl_workflow_history` — append-only diff log for change indicators.
  - `client_id`, `workflow_id`, `changed_at`, `field` (`version` | `status` | `ghl_updated_at`), `old_value`, `new_value`.
  - Written from the edge function only when a real diff is detected.
- `public.ghl_workflow_sync_runs` — per-client sync outcome for the audit table's Status column and error state.
  - `client_id`, `started_at`, `finished_at`, `status` (`success` | `error`), `workflow_count`, `error_message`, `http_status`.

RLS: `authenticated` SELECT on all three, `service_role` ALL. Full GRANTs per project rules. No anon.

Also add `linked_ghl_workflow_id text NULL` to `client_funnel_steps` for the Campaign Canvas link in section 7.

## 2. Edge function: `ghl-workflows-audit`

Path: `supabase/functions/ghl-workflows-audit/index.ts`.

- Input: `{ clientId?: string }` — omit to sync all active clients.
- For each target client with a valid GHL API key + location id:
  1. `GET https://services.leadconnectorhq.com/workflows/?locationId={id}` with `Authorization: Bearer <key>`, `Version: 2021-07-28`, `Accept: application/json`.
  2. Load existing rows from `ghl_workflows` for that client.
  3. For each returned workflow: diff `version`/`status`/`ghl_updated_at` against cache, write diffs to `ghl_workflow_history`, then upsert into `ghl_workflows` (`onConflict: client_id,workflow_id`).
  4. Record `ghl_workflow_sync_runs` row with count or error.
- One client's failure never aborts the loop; error is captured per-client.
- Returns `{ clients, workflows, successful, errors: [{ clientId, clientName, error }] }`.
- Uses `SUPABASE_SERVICE_ROLE_KEY`, CORS via `npm:@supabase/supabase-js@2/cors`, JWT validation for the `clientId?` refresh path.

## 3. Scheduled sync

Add pg_cron entry (via `supabase--insert`, not migration — contains project URL/anon key) running every 6 hours: `0 */6 * * *` → `net.http_post` to `ghl-workflows-audit` with empty body.

## 4. Page rebuild: `/ghl-workflows`

Restructure `src/pages/GhlWorkflowsPage.tsx` with two tabs:

- **Workflow Audit** (default) — new component `GhlWorkflowAuditDashboard`.
- **Advanced** — the current single-client JSON editor, unchanged.

### Audit dashboard layout

Header KPI strip (reads from cache):
`Total Workflows · Published · Draft · Stale · Clients · Sync Errors`.

Toolbar: search clients, `Refresh All` button (calls the edge function with no `clientId`).

Table (client-level rollup, one row per client):

```text
CLIENT           WORKFLOWS  PUBLISHED  DRAFT  STALE  LAST SYNC  STATUS
Acme Capital     42         38         4      6      2m ago     Healthy
Beacon Fund      17         15         2      1      6h ago     Error
```

Status pill: `Healthy` / `Error` / `Never synced` derived from the most recent `ghl_workflow_sync_runs` row. Per-row refresh icon calls `ghl-workflows-audit` with that `clientId`.

Sort by issues first (errors → stale count → draft count → healthy).

Visual language matches existing Reporting 5.0 admin tables (`SortableTableHeader`, shadcn `Table`, subtle status pills — no colored row backgrounds).

## 5. Client drawer

Clicking a client row opens a right-side `Sheet` with that client's workflows:

- Search input
- Filter chips: `All` `Published` `Draft` `Stale` `Duplicates` `Changed`
- Sort default: sync errors → drafts → stale → duplicates → healthy
- Each workflow card shows: name, status pill, version, `Updated Xd ago`, badges (`Stale`, `Draft`, `Duplicate name`, `Changed since last sync`).
- Clicking `Changed since last sync` shows a popover listing the diffs from `ghl_workflow_history` (last 5).

## 6. Audit rules (derived client-side from cache)

- **Draft** — `status !== 'published'`.
- **Stale** — `ghl_updated_at < now() - 90 days`. Threshold is a constant `STALE_DAYS = 90` in one file for later config.
- **Sync problem** — latest `ghl_workflow_sync_runs.status === 'error'`, or no successful run in 24h.
- **Duplicate name** — `count(*) > 1` grouped by `(client_id, name_normalized)`. Computed in the drawer via a memoized map.

Nothing is auto-deleted or merged.

## 7. Campaign Canvas link (foundation only)

In `FunnelStepCard` for step kinds `sms`, `email`, `note`, `booking` (nurture types):

- Add a small `Link GHL Workflow` action in the step's overflow menu.
- Opens a `Command`/searchable picker populated from `ghl_workflows` filtered by that campaign's `client_id`.
- Persists selection to `client_funnel_steps.linked_ghl_workflow_id`.
- Card renders a compact linked-workflow chip: name + status pill + version + updated date. Chip is informational, no edit affordance.

No auto-import from GHL; user-initiated link only.

## 8. Change indicators

`ghl_workflow_history` powers a `Changed since last sync` badge on each workflow. Badge shows if there is any history row with `changed_at > previous sync time for that workflow`. Popover lists the last few diffs in the form `Version 16 → 17`, `Draft → Published`, etc.

No step-level or content-level comparisons — public list API only gives metadata.

## 9. Empty & error states

- No GHL credentials → "GHL Not Connected" card with `Go to Client Settings` link.
- Auth error captured in latest sync run → "GHL Connection Error" card with `Update Connection` link.
- API returns empty array → "No Workflows Found" state inside the drawer.
- Never synced yet → dashboard row shows `Never synced` pill + `Refresh` primary action.

## 10. Hooks

- `src/hooks/useGhlWorkflowAudit.ts` — react-query hook for the client rollup (joins `clients` + latest sync run + workflow counts).
- `src/hooks/useGhlClientWorkflows.ts` — per-client workflow list + history for the drawer.
- Both read from Supabase cache only; a `refreshWorkflows(clientId?)` mutation invokes the edge function then invalidates queries.

## 11. Explicit scope guardrails

The audit UI must not expose any control that implies editing on the public-API path: no edit workflow, edit triggers, edit SMS/email copy, add/delete steps, publish/unpublish, enable/disable. All such capability remains only inside the existing "Advanced" tab (internal-API path, unchanged).

## Files touched

- new: `supabase/functions/ghl-workflows-audit/index.ts`
- new: migration for `ghl_workflows`, `ghl_workflow_history`, `ghl_workflow_sync_runs`, and `client_funnel_steps.linked_ghl_workflow_id`
- new: cron `supabase--insert` (6-hour schedule)
- new: `src/components/ghl/GhlWorkflowAuditDashboard.tsx`
- new: `src/components/ghl/ClientWorkflowsDrawer.tsx`
- new: `src/hooks/useGhlWorkflowAudit.ts`, `src/hooks/useGhlClientWorkflows.ts`
- edited: `src/pages/GhlWorkflowsPage.tsx` — wrap current UI in tabs, add Audit tab
- edited: `src/components/funnel/FunnelStepCard.tsx` — Link GHL Workflow menu + chip
- edited: `src/components/funnel/FunnelPreviewTab.tsx` — pass link state through
- edited: `.lovable/plan.md`

Nothing in the existing internal-API editor, funnel canvas, or other sync functions is renamed or removed.
