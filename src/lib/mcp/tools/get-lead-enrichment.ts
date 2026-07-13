import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { sb, UUID } from "./_sb";

export default defineTool({
  name: "get_lead_enrichment",
  title: "Get lead enrichment",
  description: "Return enrichment data for a lead by id, or by client + external_id.",
  inputSchema: {
    lead_id: z.string().uuid().regex(UUID).optional(),
    client_id: z.string().uuid().regex(UUID).optional(),
    external_id: z.string().optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ lead_id, client_id, external_id }, ctx) => {
    if (!ctx.isAuthenticated()) return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    let q = sb(ctx).from("lead_enrichment").select("*").limit(1);
    if (lead_id) q = q.eq("lead_id", lead_id);
    else if (client_id && external_id) q = q.eq("client_id", client_id).eq("external_id", external_id);
    else return { content: [{ type: "text", text: "Provide lead_id or (client_id + external_id)" }], isError: true };
    const { data, error } = await q.maybeSingle();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? null, null, 2) }],
      structuredContent: { enrichment: data ?? null },
    };
  },
});