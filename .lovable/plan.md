## Meta connection options

**Short answer:** There is no official Meta/Facebook MCP connector in the Lovable catalog right now. But your app is **already connected to the Meta Graph API directly** — and that's the right path for ads/leads data.

---

### What already exists in your project

Edge functions calling Graph API v21.0 with per-client `meta_access_token` (or `META_SHARED_ACCESS_TOKEN` fallback):
- `meta-leadforms-sync` — pulls lead forms per ad account
- `toggle-meta-status` — pause/activate campaigns, ad sets, ads
- `update-meta-budget` — daily/lifetime budget updates
- `upload-meta-creative` — image/video upload to ad account
- (plus the broader Meta Ads sync stack feeding `meta_campaigns`, `meta_ad_sets`, `meta_ads`)

So Graph API access is live. Tokens are stored per client in `clients.meta_access_token` with a shared fallback secret.

---

### Three paths forward — pick one

**1. Keep using Graph API directly (recommended)**
Add any new Meta endpoint as a new edge function following the existing pattern. Fastest, no new infra. Best for: ads management, insights, lead forms, creative uploads, audiences.

**2. Build a Meta MCP server (for Hermes / AI Studio tool use)**
Wrap the Graph API behind a Supabase Edge Function MCP server (mcp-lite) so Hermes / the AI Studio agent can call Meta as tools — list campaigns, pause ad, fetch insights, etc. Best for: letting the AI agent take actions on Meta on its own.

**3. Connect a community Meta MCP**
No first-party Lovable connector exists. We'd point an HTTP MCP client at a third-party hosted Meta MCP (you'd provide the URL + token). Not recommended unless you already use one — adds an external dependency.

---

### Recommended plan (path 1 + path 2 if you want AI control)

1. Confirm what Meta capability you actually need (e.g. "let Hermes pause a campaign", "sync custom audiences", "fetch ad insights on demand"). I'll only build what's missing.
2. If it's just more data/actions → add edge function(s) following the existing `toggle-meta-status` / `meta-leadforms-sync` pattern.
3. If you want the AI agent (Hermes / AI Studio) to call Meta as tools → add a `meta-mcp` edge function (mcp-lite + Hono) exposing scoped tools (`list_campaigns`, `get_insights`, `pause_ad`, `update_budget`, `upload_creative`, `list_lead_forms`), reusing the existing token resolution logic. Then register it in the Hermes/AI Studio tool loader.
4. No new secrets needed — `META_SHARED_ACCESS_TOKEN` + per-client `meta_access_token` already cover auth.

---

**Question before I build:** Which do you want?
- (a) Direct Graph API only — tell me the exact endpoint/action to add
- (b) Build the Meta MCP server so Hermes/AI Studio can act on Meta autonomously
- (c) Both
