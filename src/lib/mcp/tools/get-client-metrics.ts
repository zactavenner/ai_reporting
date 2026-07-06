import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

function sb(ctx: ToolContext) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default defineTool({
  name: "get_client_metrics",
  title: "Get client source metrics",
  description:
    "Aggregate lead/call/funded metrics per client for an optional date range. Returns rows from get_client_source_metrics.",
  inputSchema: {
    client_id: z.string().uuid().optional().describe("Filter to a single client id."),
    start_date: z.string().optional().describe("ISO date (YYYY-MM-DD) inclusive."),
    end_date: z.string().optional().describe("ISO date (YYYY-MM-DD) inclusive."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ client_id, start_date, end_date }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const { data, error } = await sb(ctx).rpc("get_client_source_metrics", {
      p_start_date: start_date ?? null,
      p_end_date: end_date ?? null,
    });
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const rows = (data ?? []).filter((r: any) => !client_id || r.client_id === client_id);
    return {
      content: [{ type: "text", text: JSON.stringify(rows, null, 2) }],
      structuredContent: { rows },
    };
  },
});