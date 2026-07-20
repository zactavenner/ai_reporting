import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { sb, UUID } from "./_sb";

export default defineTool({
  name: "get_weekly_call",
  title: "Get a weekly call (with transcript)",
  description: "Fetch a single weekly client call by id, including full transcript, summary, and proposed action items.",
  inputSchema: {
    call_id: z.string().uuid().regex(UUID),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ call_id }, ctx) => {
    if (!ctx.isAuthenticated()) return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const { data, error } = await sb(ctx)
      .from("client_weekly_calls")
      .select("id, client_id, week_of, title, summary_text, transcript, proposed_tasks, actual_duration_s, avg_rating, started_at, ended_at, recording_url, status")
      .eq("id", call_id)
      .maybeSingle();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? {}, null, 2) }],
      structuredContent: { call: data ?? null },
    };
  },
});