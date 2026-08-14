// Minimal MCP Streamable-HTTP client for Deno edge functions.
// Handles the JSON-RPC handshake, session header, SSE-framed responses,
// tools/list and tools/call. Bearer token optional.

export type McpTool = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

type Rpc = { jsonrpc: "2.0"; id?: number; method: string; params?: unknown };

function parseBody(text: string, contentType: string): any {
  if (contentType.includes("text/event-stream")) {
    // Take the last `data:` payload that parses as JSON-RPC.
    const lines = text.split(/\r?\n/).filter((l) => l.startsWith("data:"));
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        return JSON.parse(lines[i].slice(5).trim());
      } catch { /* keep looking */ }
    }
    return null;
  }
  try { return JSON.parse(text); } catch { return null; }
}

export class McpClient {
  private sessionId: string | null = null;
  private nextId = 1;
  private initialized = false;

  constructor(private url: string, private token?: string | null) {}

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2025-06-18",
    };
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    if (this.sessionId) h["Mcp-Session-Id"] = this.sessionId;
    return h;
  }

  private async send(payload: Rpc, expectResult = true): Promise<any> {
    const res = await fetch(this.url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(payload),
    });
    const sid = res.headers.get("mcp-session-id");
    if (sid) this.sessionId = sid;
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`MCP ${payload.method} failed [${res.status}]: ${text.slice(0, 400)}`);
    }
    if (!expectResult) return null;
    const body = parseBody(text, res.headers.get("content-type") || "");
    if (body?.error) throw new Error(`MCP ${payload.method} error: ${body.error.message || JSON.stringify(body.error)}`);
    return body?.result ?? null;
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    await this.send({
      jsonrpc: "2.0",
      id: this.nextId++,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "hpa-reporting-agents", version: "1.0.0" },
      },
    });
    await this.send({ jsonrpc: "2.0", method: "notifications/initialized" }, false).catch(() => null);
    this.initialized = true;
  }

  async listTools(): Promise<McpTool[]> {
    await this.init();
    const out: McpTool[] = [];
    let cursor: string | undefined;
    do {
      const result = await this.send({
        jsonrpc: "2.0",
        id: this.nextId++,
        method: "tools/list",
        params: cursor ? { cursor } : {},
      });
      for (const t of result?.tools || []) out.push(t as McpTool);
      cursor = result?.nextCursor;
    } while (cursor && out.length < 300);
    return out;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    await this.init();
    const result = await this.send({
      jsonrpc: "2.0",
      id: this.nextId++,
      method: "tools/call",
      params: { name, arguments: args || {} },
    });
    const parts = (result?.content || [])
      .map((c: any) => (c?.type === "text" ? c.text : c?.type ? `[${c.type}]` : ""))
      .filter(Boolean);
    const text = parts.join("\n\n") || JSON.stringify(result?.structuredContent ?? result ?? {});
    return result?.isError ? `TOOL ERROR: ${text}` : text;
  }
}

/** Convert MCP tools to OpenAI/OpenRouter function-tool descriptors. */
export function toOpenAiTools(tools: McpTool[]) {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: (t.description || t.name).slice(0, 1000),
      parameters:
        t.inputSchema && typeof t.inputSchema === "object"
          ? t.inputSchema
          : { type: "object", properties: {} },
    },
  }));
}
