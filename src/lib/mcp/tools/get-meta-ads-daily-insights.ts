import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { sb, UUID } from "./_sb";

export default defineTool({
  name: "get_meta_ads_daily_insights",
  title: "Get Meta ads daily insights",
  description: "Return daily Meta ad spend/impression/lead insights for a client over a date range.",
  inputSchema: {
    client_id: z.string().uuid().regex(UUID),
    start_date: z.string().describe("ISO date (YYYY-MM-DD) inclusive."),
    end_date: z.string().describe("ISO date (YYYY-MM-DD) inclusive."),
    limit: z.number().int().min(1).max(1000).default(500).optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ client_id, start_date, end_date, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const { data, error } = await sb(ctx)
      .from("meta_ad_daily_insights")
      .select("*")
      .eq("client_id", client_id)
      .gte("date_account_tz", start_date)
      .lte("date_account_tz", end_date)
      .order("date_account_tz", { ascending: false })
      .limit(limit ?? 500);
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? [], null, 2) }],
      structuredContent: { rows: data ?? [] },
    };
  },
});