
# Simplify Dashboard & Consolidate Settings

Two goals: (1) cut clutter from the main dashboard, (2) collapse the 3–4 places Meta Ads (and other integrations) are configured into ONE source of truth.

---

## Problem today

**Dashboard clutter** — `DashboardPage.tsx` mixes: 4 stat cards, 4 quick actions, recent assets, batch jobs, sync banners, pie charts, agency status panels. Most users only need: which clients need attention, what synced today, and 2–3 actions.

**Meta Ads is configured in 4 places** (confirmed via grep):
1. `components/settings/AgencyIntegrationsTab.tsx` — agency-level token/account
2. `components/settings/ClientSettingsModal.tsx` — per-client `meta_access_token` + ad account
3. `components/ads-manager/AdminAdsManagerTab.tsx` — admin override of ad account
4. `components/ads-manager/shared/AdsConnectionHealthPanel.tsx` — re-prompt for token when broken
   Plus the `META_SHARED_ACCESS_TOKEN` secret fallback. Same fragmentation exists for GHL, HubSpot, Slack, Fathom (each has its own `*IntegrationSection.tsx`).

---

## Plan

### Part 1 — Unified "Connections" hub (one place per client)

Build `src/components/client/ConnectionsTab.tsx` as the **single** integration surface per client, replacing the integration cards scattered across `ClientSettingsModal`, `AdminAdsManagerTab`, and `AdsConnectionHealthPanel`.

Layout: one card per platform (Meta, Google, GHL, HubSpot, Slack, Fathom, MeetGeek). Each card shows:
- Status pill: **Connected / Needs attention / Not connected** (driven by existing `useIntegrationStatus` + a token-expiry check)
- Account name + ID (e.g. "act_123… — Acme LLC")
- Last sync time + one-click **Sync now**
- **Edit** opens an inline drawer with the 2–3 fields that actually matter (token, account ID, sync toggles). Advanced fields collapsed behind "Advanced".

Wire it to the existing `clients` table columns (`meta_access_token`, `meta_ad_account_id`, `ghl_api_key`, etc.) so no schema change is required. The agency-wide `META_SHARED_ACCESS_TOKEN` fallback stays — but is shown read-only on a separate **Agency Defaults** tab in `SettingsPage` so it's clearly "fallback, not per-client".

**Deprecate / remove:**
- The Meta section inside `ClientSettingsModal` → link out to Connections tab
- `AdsConnectionHealthPanel` token re-entry UI → replace with a banner that deep-links to Connections
- `AdminAdsManagerTab` ad-account override → fold into the same Meta card

After migration, `meta_access_token` is set in exactly **one** place per client.

### Part 2 — Simplified agency Settings page

Reduce `SettingsPage.tsx` from 8 tabs to 4:
1. **API Keys** (Gemini / Veo pool — keep as-is, this is genuinely complex)
2. **Agency Defaults** (shared Meta token fallback, brand refs, ad styles)
3. **Integrations** (scraping, voices, Apify — non-per-client services)
4. **Team & Access** (members, API access, webhooks)

Move `Image References`, `Video References`, `Ad Styles` under Agency Defaults as sub-sections. Collapse `Scraping Schedule` + `Voices` + `Apify` into Integrations.

### Part 3 — Slim the main Dashboard

Rewrite `DashboardPage.tsx` to three stacked sections, nothing else:

1. **Today** — single row: active clients, ad spend today, leads today, open tasks. No pie charts.
2. **Needs attention** — list of clients with broken syncs, paused-but-active campaigns, or threshold breaches. Each row has a "Fix" button that deep-links to the right tab.
3. **Quick actions** — 3 buttons max: New Client, Generate Ad, Open Video Editor.

Move the pie chart (assets by type) + batch jobs + recent assets into a new `/dashboard/activity` route reachable from a "View activity" link. Keep `AgencySyncStatusPanel` but collapse it by default.

### Part 4 — Health/sync consolidation

Today: `SyncHealthBanner`, `SyncHealthIndicator`, `SyncQueueStatus`, `AgencySyncStatusPanel`, `SyncOverviewTab` all show overlapping info. Keep one banner (top of dashboard, only when something is red) + the full `SyncHealthPage` for deep-dive. Remove the duplicate widgets from the dashboard.

---

## Implementation order

1. Build `ConnectionsTab.tsx` + add it to `ClientDetail` tabs (no removals yet — verify it works)
2. Migrate Meta config UI into Connections; remove the Meta block from `ClientSettingsModal` and `AdsConnectionHealthPanel`
3. Migrate GHL, HubSpot, Slack, Fathom, MeetGeek the same way
4. Rewrite `DashboardPage.tsx` (move old version to `/dashboard/activity`)
5. Restructure `SettingsPage.tsx` tabs
6. Remove dead sync widgets

## Technical notes

- No DB migration needed — all token fields already exist on `clients` / `client_settings`
- `useIntegrationStatus` hook already exists; extend it to also return token-expiry where the platform exposes it (Meta = 60d)
- "Needs attention" list = single query joining `clients` + `client_settings` + most recent `sync_logs` row, filtered to red/yellow
- Keep `AgentMcpPanel` (just added) under the Meta connection card, since it's Meta-agent-specific

## Out of scope

- OAuth flows (still manual token paste — that's a separate effort)
- Mobile redesign
- Renaming any DB columns

---

## Open questions before I build

1. For the per-client Connections tab — keep it as a **tab inside ClientDetail**, or promote it to its own route `/clients/:id/connections`? Tab is faster; route is more discoverable.
2. The "Activity" page (old dashboard widgets) — keep it, or just delete the charts/recent-assets sections entirely? Honest answer: most users never look at them.
3. Should I auto-migrate existing per-client Meta tokens that were entered in `ClientSettingsModal` into the new UI (they're the same DB column, so technically zero-touch), or surface a one-time "review your connections" prompt?
