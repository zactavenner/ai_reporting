import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { sb, UUID } from "./_sb";

export default defineTool({
  name: "list_tasks",
  title: "List tasks",
  description: "List tasks visible to the signed-in user, optionally filtered by client, assignee, and status.",
  inputSchema: {
    client_id: z.string().uuid().regex(UUID).optional(),
    assignee_id: z.string().uuid().regex(UUID).optional(),
    status: z.enum(["open", "in_progress", "done", "cancelled"]).optional(),
    limit: z.number().int().min(1).max(100).default(25).optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ client_id, assignee_id, status, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    let q = sb(ctx).from("tasks").select("*").order("created_at", { ascending: false });
    if (client_id) q = q.eq("client_id", client_id);
    if (assignee_id) q = q.eq("assigned_to", assignee_id);
    if (status) q = q.eq("status", status);
    const { data, error } = await q.limit(limit ?? 25);
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? [], null, 2) }],
      structuredContent: { tasks: data ?? [] },
    };
  },
});