import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { sb, UUID } from "./_sb";

export default defineTool({
  name: "get_deal_pipeline",
  title: "Get deal pipeline",
  description: "Return deals in the local pipeline for a client, optionally filtered by stage.",
  inputSchema: {
    client_id: z.string().uuid().regex(UUID),
    stage: z.string().optional(),
    limit: z.number().int().min(1).max(200).default(100).optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ client_id, stage, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    let q = sb(ctx).from("deals").select("*").eq("client_id", client_id).order("updated_at", { ascending: false });
    if (stage) q = q.eq("stage", stage);
    const { data, error } = await q.limit(limit ?? 100);
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? [], null, 2) }],
      structuredContent: { deals: data ?? [] },
    };
  },
});