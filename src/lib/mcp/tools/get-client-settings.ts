import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { sb, UUID } from "./_sb";

export default defineTool({
  name: "get_client_settings",
  title: "Get client settings",
  description: "Fetch client configuration (KPI thresholds, integration ids, targets, report cadence).",
  inputSchema: {
    client_id: z.string().uuid().regex(UUID),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ client_id }, ctx) => {
    if (!ctx.isAuthenticated()) return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const { data, error } = await sb(ctx)
      .from("client_settings")
      .select("*")
      .eq("client_id", client_id)
      .maybeSingle();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? null, null, 2) }],
      structuredContent: { settings: data ?? null },
    };
  },
});