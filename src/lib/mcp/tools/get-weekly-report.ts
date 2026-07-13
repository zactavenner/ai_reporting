import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { sb, UUID } from "./_sb";

export default defineTool({
  name: "get_weekly_report",
  title: "Get weekly report",
  description: "Fetch the latest weekly sync/recap for a client (most recent first).",
  inputSchema: {
    client_id: z.string().uuid().regex(UUID),
    limit: z.number().int().min(1).max(12).default(1).optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ client_id, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const { data, error } = await sb(ctx)
      .from("weekly_syncs")
      .select("*")
      .eq("client_id", client_id)
      .order("week_of", { ascending: false })
      .limit(limit ?? 1);
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? [], null, 2) }],
      structuredContent: { reports: data ?? [] },
    };
  },
});