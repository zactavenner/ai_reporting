import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { sb, UUID } from "./_sb";

export default defineTool({
  name: "list_meetings",
  title: "List meetings",
  description: "List recent agency meetings, optionally filtered by client.",
  inputSchema: {
    client_id: z.string().uuid().regex(UUID).optional(),
    limit: z.number().int().min(1).max(50).default(10).optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ client_id, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    let q = sb(ctx).from("agency_meetings").select("*").order("meeting_date", { ascending: false });
    if (client_id) q = q.eq("client_id", client_id);
    const { data, error } = await q.limit(limit ?? 10);
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? [], null, 2) }],
      structuredContent: { meetings: data ?? [] },
    };
  },
});