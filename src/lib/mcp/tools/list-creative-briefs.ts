import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { sb, UUID } from "./_sb";

export default defineTool({
  name: "list_creative_briefs",
  title: "List creative briefs",
  description: "List creative briefs for a client with optional status filter.",
  inputSchema: {
    client_id: z.string().uuid().regex(UUID),
    status: z.string().optional(),
    limit: z.number().int().min(1).max(50).default(10).optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ client_id, status, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    let q = sb(ctx).from("creative_briefs").select("*").eq("client_id", client_id).order("created_at", { ascending: false });
    if (status) q = q.eq("status", status);
    const { data, error } = await q.limit(limit ?? 10);
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? [], null, 2) }],
      structuredContent: { briefs: data ?? [] },
    };
  },
});