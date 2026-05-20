# Plan: Meta Ads management via MCP

Extend the existing `mcp-agent-server` edge function with Meta Ads tools, then expose an "AI Agent (MCP)" panel inside the Ads Manager tab so operators can see/test what the agent can do.

## 1. Extend MCP server (`supabase/functions/mcp-agent-server/index.ts`)

Add new tools that wrap the existing Meta edge functions (no new ads logic — reuse what works):

Read-only:
- `meta_list_campaigns` (client_id, status?) → reads `meta_campaigns`
- `meta_list_adsets` (campaign_id) → reads `meta_adsets`
- `meta_list_ads` (adset_id | campaign_id, status?) → reads `meta_ads`
- `meta_get_ad_performance` (ad_id | campaign_id, days?) → reads `meta_insights` / daily views
- `meta_list_creatives` (client_id) → reads creative assets

Write / launch (invokes existing functions internally):
- `meta_create_campaign` → calls `create-meta-campaign`
- `meta_create_ad` → calls `create-meta-ad`
- `meta_upload_creative` → calls `upload-meta-creative`
- `meta_toggle_status` (id, level: campaign|adset|ad, status: ACTIVE|PAUSED) → calls `toggle-meta-status`
- `meta_update_budget` (id, level, daily_budget|lifetime_budget) → calls `update-meta-budget`
- `meta_duplicate` (id, level) → calls `duplicate-meta-object`
- `meta_sync_account` (client_id) → calls `sync-meta-ads`

Auth pattern stays the same as current MCP tools (service-role internal fetches with `HPA1234$` body password per project standard). Per-client `meta_access_token` is resolved server-side inside the wrapped functions; no token ever returned to the agent.

Safety:
- Mark write tools with `"x-requires-confirmation": true` in description so the Lovable agent / Claude prompts before launching.
- Validate `client_id` belongs to an active client before any write.
- Never expose access tokens, ad account secrets, or system token in tool outputs.

## 2. Ads Manager UI — "AI Agent" panel

In `src/components/ads-manager/AdsManagerTab.tsx`, add a collapsible card at the top:
- Shows the MCP endpoint URL for this project + copy button (for Claude Desktop / Cursor config)
- Lists the new Meta tools with one-line descriptions
- Status pill: "Connected" if `mcp-agent-server` responds to `initialize`
- "Test tool" mini-runner: pick a read-only tool (e.g. `meta_list_campaigns`), pass current client_id, see JSON result — proves the agent path works without leaving the app

No changes to existing ad table, creation flows, or sync logic.

## 3. Out of scope (do later if needed)

- Adding Meta tools to Composio/LinkedIn MCP proxies
- Per-user OAuth for MCP (current internal-password auth is fine for our server)
- Approval workflow UI for agent-launched ads (can add a `pending_agent_actions` table in a follow-up)

## Technical notes

- All new tools live in the existing `TOOLS` array + `handleToolCall` switch — single file change on backend.
- Internal calls use `fetch(SUPABASE_URL/functions/v1/<name>, { body: { ...args, password: 'HPA1234$' } })` matching the existing internal-auth memory.
- No schema migrations required.
- No new secrets; reuses `META_SHARED_ACCESS_TOKEN` fallback and per-client tokens already in DB.
