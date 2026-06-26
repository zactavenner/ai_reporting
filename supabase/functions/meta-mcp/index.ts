// Meta Ads MCP server (mcp-lite) — exposes Meta Graph API tools to AI agents.
// Token resolution: per-client `meta_access_token` → META_SHARED_ACCESS_TOKEN (Blue Capital global default).
import { Hono } from "npm:hono@4";
import { McpServer, StreamableHttpTransport } from "npm:mcp-lite@^0.10.0";
import { createClient } from "npm:@supabase/supabase-js@2";

const META_V = "v21.0";
const GRAPH = `https://graph.facebook.com/${META_V}`;

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

async function resolveToken(clientId?: string): Promise<{ token: string; adAccountId?: string; source: string }> {
  if (clientId) {
    const { data } = await sb
      .from("clients")
      .select("meta_access_token, meta_ad_account_id, name")
      .eq("id", clientId)
      .maybeSingle();
    if (data?.meta_access_token) {
      return { token: data.meta_access_token, adAccountId: data.meta_ad_account_id ?? undefined, source: `client:${data.name}` };
    }
  }
  const shared = Deno.env.get("META_SHARED_ACCESS_TOKEN");
  if (!shared) throw new Error("No Meta access token available (no per-client token and META_SHARED_ACCESS_TOKEN unset)");
  return { token: shared, source: "blue_capital_shared" };
}

async function graph(path: string, params: Record<string, string> = {}, method: "GET" | "POST" | "DELETE" = "GET") {
  const qs = new URLSearchParams(params);
  const url = `${GRAPH}${path}${method === "GET" ? `?${qs}` : ""}`;
  const init: RequestInit = { method };
  if (method !== "GET") {
    init.body = qs;
    init.headers = { "Content-Type": "application/x-www-form-urlencoded" };
  }
  const res = await fetch(url, init);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Meta ${method} ${path} ${res.status}: ${JSON.stringify(json).slice(0, 400)}`);
  return json;
}

async function logToolCall(tool: string, clientId: string | undefined, ok: boolean, error?: string) {
  try {
    await sb.from("meta_mcp_tool_calls").insert({
      tool_name: tool,
      client_id: clientId ?? null,
      success: ok,
      error_message: error ?? null,
    });
  } catch { /* table optional */ }
}

const mcp = new McpServer({ name: "meta-ads-mcp", version: "1.0.0" });

mcp.tool({
  name: "list_ad_accounts",
  description: "List Meta ad accounts accessible to the Blue Capital token.",
  inputSchema: { type: "object", properties: {}, required: [] },
  handler: async () => {
    const { token } = await resolveToken();
    const r = await graph("/me/adaccounts", { fields: "id,name,account_status,currency", limit: "200", access_token: token });
    await logToolCall("list_ad_accounts", undefined, true);
    return { content: [{ type: "text", text: JSON.stringify(r.data ?? [], null, 2) }] };
  },
});

mcp.tool({
  name: "list_campaigns",
  description: "List campaigns for a client (uses client's ad account or provided ad_account_id).",
  inputSchema: {
    type: "object",
    properties: {
      client_id: { type: "string" },
      ad_account_id: { type: "string", description: "e.g. act_123456789" },
      limit: { type: "number", default: 50 },
    },
  },
  handler: async ({ client_id, ad_account_id, limit }: any) => {
    const { token, adAccountId } = await resolveToken(client_id);
    const act = ad_account_id || adAccountId;
    if (!act) throw new Error("ad_account_id required (client has none configured)");
    const r = await graph(`/${act}/campaigns`, {
      fields: "id,name,status,effective_status,objective,daily_budget,lifetime_budget,created_time",
      limit: String(limit ?? 50),
      access_token: token,
    });
    await logToolCall("list_campaigns", client_id, true);
    return { content: [{ type: "text", text: JSON.stringify(r.data ?? [], null, 2) }] };
  },
});

mcp.tool({
  name: "get_insights",
  description: "Get insights (spend/impressions/clicks/leads) for a campaign, adset, or ad.",
  inputSchema: {
    type: "object",
    properties: {
      object_id: { type: "string", description: "campaign/adset/ad id" },
      client_id: { type: "string" },
      date_preset: { type: "string", default: "last_7d" },
    },
    required: ["object_id"],
  },
  handler: async ({ object_id, client_id, date_preset }: any) => {
    const { token } = await resolveToken(client_id);
    const r = await graph(`/${object_id}/insights`, {
      fields: "spend,impressions,clicks,ctr,cpm,cpc,actions,cost_per_action_type",
      date_preset: date_preset ?? "last_7d",
      access_token: token,
    });
    await logToolCall("get_insights", client_id, true);
    return { content: [{ type: "text", text: JSON.stringify(r.data ?? [], null, 2) }] };
  },
});

mcp.tool({
  name: "set_status",
  description: "Pause or resume a campaign, adset, or ad.",
  inputSchema: {
    type: "object",
    properties: {
      object_id: { type: "string" },
      status: { type: "string", enum: ["ACTIVE", "PAUSED"] },
      client_id: { type: "string" },
    },
    required: ["object_id", "status"],
  },
  handler: async ({ object_id, status, client_id }: any) => {
    const { token } = await resolveToken(client_id);
    const r = await graph(`/${object_id}`, { status, access_token: token }, "POST");
    await logToolCall("set_status", client_id, true);
    return { content: [{ type: "text", text: JSON.stringify(r) }] };
  },
});

mcp.tool({
  name: "update_budget",
  description: "Update daily or lifetime budget (in cents) for a campaign or adset.",
  inputSchema: {
    type: "object",
    properties: {
      object_id: { type: "string" },
      daily_budget: { type: "number", description: "in account currency cents" },
      lifetime_budget: { type: "number" },
      client_id: { type: "string" },
    },
    required: ["object_id"],
  },
  handler: async ({ object_id, daily_budget, lifetime_budget, client_id }: any) => {
    const { token } = await resolveToken(client_id);
    const params: Record<string, string> = { access_token: token };
    if (daily_budget) params.daily_budget = String(daily_budget);
    if (lifetime_budget) params.lifetime_budget = String(lifetime_budget);
    const r = await graph(`/${object_id}`, params, "POST");
    await logToolCall("update_budget", client_id, true);
    return { content: [{ type: "text", text: JSON.stringify(r) }] };
  },
});

mcp.tool({
  name: "list_lead_forms",
  description: "List Meta lead forms for a client's pages.",
  inputSchema: {
    type: "object",
    properties: { client_id: { type: "string" }, page_id: { type: "string" } },
  },
  handler: async ({ client_id, page_id }: any) => {
    const { token } = await resolveToken(client_id);
    if (!page_id) throw new Error("page_id required");
    const r = await graph(`/${page_id}/leadgen_forms`, {
      fields: "id,name,status,created_time,leads_count",
      access_token: token,
    });
    await logToolCall("list_lead_forms", client_id, true);
    return { content: [{ type: "text", text: JSON.stringify(r.data ?? [], null, 2) }] };
  },
});

const transport = new StreamableHttpTransport();
const app = new Hono();

app.options("/*", (c) => {
  return c.body(null, 204, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, content-type, mcp-session-id, accept",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  });
});

app.all("/*", async (c) => {
  const res = await transport.handleRequest(c.req.raw, mcp);
  res.headers.set("Access-Control-Allow-Origin", "*");
  return res;
});

Deno.serve(app.fetch);