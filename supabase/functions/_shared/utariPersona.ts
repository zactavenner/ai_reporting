// Utari Persona MCP client (Jeremy AI).
// This is the ONE request path for Jeremy AI: send_message on the persona MCP
// server, then poll get_response until the persona's reply lands. The persona
// keeps running server-side even if a single HTTP hop times out, so we never
// block on one long request — we hand off to run_id polling.
//
// The endpoint itself is NOT hardcoded here: callers resolve it from the
// `agency_personas` registry via `_shared/personas.ts` (`resolvePersona`) so
// personas can be added / switched / rotated from Settings → Personas.


export type PersonaReply = {
  reply: string;
  conversation_id: string | null;
  run_id: string | null;
  polls: number;
};

type PersonaPayload = {
  status?: string;
  reply?: string;
  message?: string;
  text?: string;
  conversation_id?: string;
  run_id?: string;
  error?: string;
};

async function mcpCall(url: string, method: string, params: unknown): Promise<any> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2025-06-18",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: Math.floor(Math.random() * 1_000_000), method, params }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`persona MCP ${method} ${res.status}: ${text.slice(0, 300)}`);
  const dataLine = text.split("\n").find((l) => l.startsWith("data: "));
  const raw = (dataLine ? dataLine.slice(6) : text).trim();
  let parsed: any;
  try { parsed = JSON.parse(raw); } catch { throw new Error(`persona MCP parse failed: ${raw.slice(0, 300)}`); }
  if (parsed.error) throw new Error(`persona MCP error: ${parsed.error.message || JSON.stringify(parsed.error)}`);
  return parsed.result;
}

function readPayload(result: any): PersonaPayload {
  const content = Array.isArray(result?.content) ? result.content : [];
  const textNode = content.find((c: any) => c?.type === "text");
  const raw = textNode?.text ?? "";
  try {
    const j = JSON.parse(raw);
    if (j && typeof j === "object") return j as PersonaPayload;
  } catch { /* plain text reply */ }
  return { status: raw ? "completed" : "running", reply: raw };
}

function replyText(p: PersonaPayload): string {
  return (p.reply || p.message || p.text || "").trim();
}

/**
 * Send a message to Jeremy's persona and poll until the reply arrives.
 * Never blocks on a single long request: send_message returns a run handle and
 * get_response is polled on our own schedule.
 */
export async function askUtariPersona(opts: {
  message: string;
  conversationId?: string | null;
  mcpUrl?: string;
  /** Total wall-clock budget for the reply (default 4 min). */
  timeoutMs?: number;
  /** Delay between polls (default 3s). */
  pollMs?: number;
  onPoll?: (info: { attempt: number; elapsedMs: number; status: string }) => void;
}): Promise<PersonaReply> {
  const url = opts.mcpUrl || UTARI_PERSONA_MCP_URL;
  const timeoutMs = opts.timeoutMs ?? 240_000;
  const pollMs = opts.pollMs ?? 3_000;
  const started = Date.now();

  const sent = readPayload(await mcpCall(url, "tools/call", {
    name: "send_message",
    arguments: {
      message: opts.message,
      conversation_id: opts.conversationId || "",
      wait_for_reply: false,
    },
  }));
  if (sent.error) throw new Error(`persona send_message: ${sent.error}`);

  let conversationId = sent.conversation_id || opts.conversationId || null;
  const runId = sent.run_id || null;
  let reply = replyText(sent);
  let polls = 0;

  // Already answered inside the send call.
  if (reply && String(sent.status || "").toLowerCase() !== "running") {
    return { reply, conversation_id: conversationId, run_id: runId, polls };
  }
  if (!runId && !conversationId) {
    throw new Error("persona send_message returned neither a reply nor a run handle");
  }

  while (Date.now() - started < timeoutMs) {
    await new Promise((r) => setTimeout(r, pollMs));
    polls++;
    let p: PersonaPayload;
    try {
      p = readPayload(await mcpCall(url, "tools/call", {
        name: "get_response",
        arguments: {
          run_id: runId || "",
          conversation_id: conversationId || "",
          wait_for_reply: false,
        },
      }));
    } catch (e) {
      // Transient poll failure — keep polling within the budget.
      opts.onPoll?.({ attempt: polls, elapsedMs: Date.now() - started, status: "poll_error" });
      if (polls > 3 && Date.now() - started > timeoutMs - pollMs) throw e;
      continue;
    }
    if (p.conversation_id) conversationId = p.conversation_id;
    const status = String(p.status || "").toLowerCase();
    opts.onPoll?.({ attempt: polls, elapsedMs: Date.now() - started, status: status || "unknown" });
    if (p.error) throw new Error(`persona get_response: ${p.error}`);
    reply = replyText(p);
    if (status === "running" || status === "pending" || status === "queued") continue;
    if (reply) return { reply, conversation_id: conversationId, run_id: runId, polls };
  }

  throw new Error(`persona reply timed out after ${Math.round(timeoutMs / 1000)}s (run ${runId || conversationId})`);
}
