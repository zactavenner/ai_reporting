import { defineTool } from "@lovable.dev/mcp-js";
import { sb } from "./_sb";

export default defineTool({
  name: "get_sync_health",
  title: "Get sync queue health",
  description: "Return aggregate sync queue counts (pending, processing, completed, failed, records processed).",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const { data, error } = await sb(ctx).rpc("get_sync_queue_stats");
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const row = Array.isArray(data) ? data[0] : data;
    return {
      content: [{ type: "text", text: JSON.stringify(row ?? {}, null, 2) }],
      structuredContent: { stats: row ?? {} },
    };
  },
});