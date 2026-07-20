import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { sb, UUID } from "./_sb";

export default defineTool({
  name: "list_weekly_calls",
  title: "List weekly client calls",
  description: "List past weekly client calls with titles, dates, summaries, and proposed action items. Filter by client_id.",
  inputSchema: {
    client_id: z.string().uuid().regex(UUID).optional(),
    limit: z.number().int().min(1).max(50).default(10).optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ client_id, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    let q = sb(ctx)
      .from("client_weekly_calls")
      .select("id, client_id, week_of, title, summary_text, proposed_tasks, actual_duration_s, avg_rating, ended_at, status")
      .neq("status", "cancelled")
      .order("week_of", { ascending: false });
    if (client_id) q = q.eq("client_id", client_id);
    const { data, error } = await q.limit(limit ?? 10);
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? [], null, 2) }],
      structuredContent: { calls: data ?? [] },
    };
  },
});