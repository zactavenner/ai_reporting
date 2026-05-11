// AI Studio edge function - streaming SSE chat with Google Docs/Sheets tools + image generation
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const GOOGLE_DOCS_API_KEY = Deno.env.get("GOOGLE_DOCS_API_KEY");
const GOOGLE_SHEETS_API_KEY = Deno.env.get("GOOGLE_SHEETS_API_KEY");
const GATEWAY = "https://connector-gateway.lovable.dev";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function extractDocId(url: string): string | null {
  const m = url.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}
function extractSheetId(url: string): string | null {
  const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

async function gFetch(connectorPath: string, apiKey: string, init?: RequestInit) {
  const res = await fetch(`${GATEWAY}${connectorPath}`, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      "Authorization": `Bearer ${LOVABLE_API_KEY}`,
      "X-Connection-Api-Key": apiKey,
      "Content-Type": "application/json",
    },
  });
  const text = await res.text();
  let data: any; try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(`[${res.status}] ${typeof data === "string" ? data : JSON.stringify(data)}`);
  return data;
}

// ----- Tool implementations -----
async function readDoc(docId: string) {
  if (!GOOGLE_DOCS_API_KEY) throw new Error("Google Docs not connected");
  const doc = await gFetch(`/google_docs/v1/documents/${docId}`, GOOGLE_DOCS_API_KEY, { method: "GET" });
  const text = (doc.body?.content || [])
    .flatMap((el: any) => el.paragraph?.elements?.map((e: any) => e.textRun?.content || "") || [])
    .join("");
  return { title: doc.title, text: text.slice(0, 20000), endIndex: doc.body?.content?.slice(-1)?.[0]?.endIndex || 1 };
}
async function appendToDoc(docId: string, content: string) {
  if (!GOOGLE_DOCS_API_KEY) throw new Error("Google Docs not connected");
  const doc = await gFetch(`/google_docs/v1/documents/${docId}`, GOOGLE_DOCS_API_KEY, { method: "GET" });
  const endIdx = (doc.body?.content?.slice(-1)?.[0]?.endIndex || 2) - 1;
  await gFetch(`/google_docs/v1/documents/${docId}:batchUpdate`, GOOGLE_DOCS_API_KEY, {
    method: "POST",
    body: JSON.stringify({ requests: [{ insertText: { location: { index: endIdx }, text: "\n" + content } }] }),
  });
  return { ok: true, appended_chars: content.length };
}
async function replaceDocText(docId: string, find: string, replace: string) {
  if (!GOOGLE_DOCS_API_KEY) throw new Error("Google Docs not connected");
  await gFetch(`/google_docs/v1/documents/${docId}:batchUpdate`, GOOGLE_DOCS_API_KEY, {
    method: "POST",
    body: JSON.stringify({ requests: [{ replaceAllText: { containsText: { text: find, matchCase: true }, replaceText: replace } }] }),
  });
  return { ok: true };
}
async function readSheet(sheetId: string, range: string) {
  if (!GOOGLE_SHEETS_API_KEY) throw new Error("Google Sheets not connected");
  const data = await gFetch(`/google_sheets/v4/spreadsheets/${sheetId}/values/${range}`, GOOGLE_SHEETS_API_KEY, { method: "GET" });
  return { range: data.range, values: (data.values || []).slice(0, 200) };
}
async function updateSheetRange(sheetId: string, range: string, values: any[][]) {
  if (!GOOGLE_SHEETS_API_KEY) throw new Error("Google Sheets not connected");
  await gFetch(`/google_sheets/v4/spreadsheets/${sheetId}/values/${range}?valueInputOption=USER_ENTERED`, GOOGLE_SHEETS_API_KEY, {
    method: "PUT",
    body: JSON.stringify({ range, values, majorDimension: "ROWS" }),
  });
  return { ok: true, updated_cells: values.flat().length };
}
async function appendSheetRow(sheetId: string, range: string, values: any[][]) {
  if (!GOOGLE_SHEETS_API_KEY) throw new Error("Google Sheets not connected");
  await gFetch(`/google_sheets/v4/spreadsheets/${sheetId}/values/${range}:append?valueInputOption=USER_ENTERED`, GOOGLE_SHEETS_API_KEY, {
    method: "POST",
    body: JSON.stringify({ values, majorDimension: "ROWS" }),
  });
  return { ok: true, appended_rows: values.length };
}
async function generateAdImage(prompt: string, model: "nano-banana-2" | "gpt-image"): Promise<{ url: string; mime: string }> {
  const actualModel = model === "gpt-image" ? "openai/gpt-image-1" : "google/gemini-3.1-flash-image-preview";
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: actualModel,
      messages: [{ role: "user", content: prompt }],
      modalities: ["image", "text"],
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Image gen failed [${res.status}]: ${err}`);
  }
  const data = await res.json();
  const imgUrl = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!imgUrl) throw new Error(`No image returned`);
  if (imgUrl.startsWith("data:")) {
    const supa = createClient(SUPABASE_URL, SERVICE_KEY);
    const match = imgUrl.match(/^data:(.+?);base64,(.+)$/);
    if (match) {
      const mime = match[1]; const b64 = match[2];
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const ext = mime.split("/")[1] || "png";
      const path = `ai-studio/${crypto.randomUUID()}.${ext}`;
      const { error } = await supa.storage.from("creatives").upload(path, bytes, { contentType: mime, upsert: false });
      if (!error) {
        const { data: pub } = supa.storage.from("creatives").getPublicUrl(path);
        return { url: pub.publicUrl, mime };
      }
    }
  }
  return { url: imgUrl, mime: "image/png" };
}

const tools = [
  { type: "function", function: { name: "read_doc", description: "Read text content of the active Google Doc.", parameters: { type: "object", properties: {}, required: [] } } },
  { type: "function", function: { name: "append_to_doc", description: "Append new content to the end of the active Google Doc.", parameters: { type: "object", properties: { content: { type: "string" } }, required: ["content"] } } },
  { type: "function", function: { name: "replace_doc_text", description: "Find and replace all instances of a string in the active Google Doc.", parameters: { type: "object", properties: { find: { type: "string" }, replace: { type: "string" } }, required: ["find", "replace"] } } },
  { type: "function", function: { name: "read_sheet", description: "Read a range from the active Google Sheet (e.g. 'Sheet1!A1:Z100').", parameters: { type: "object", properties: { range: { type: "string" } }, required: ["range"] } } },
  { type: "function", function: { name: "update_sheet_range", description: "Overwrite cells in the active Google Sheet at the given A1 range.", parameters: { type: "object", properties: { range: { type: "string" }, values: { type: "array", items: { type: "array", items: {} } } }, required: ["range", "values"] } } },
  { type: "function", function: { name: "append_sheet_row", description: "Append rows to the bottom of the active Google Sheet at the given A1 range.", parameters: { type: "object", properties: { range: { type: "string" }, values: { type: "array", items: { type: "array", items: {} } } }, required: ["range", "values"] } } },
  { type: "function", function: { name: "generate_ad_image", description: "Generate an ad creative image. Use 'nano-banana-2' for photo-real or 'gpt-image' for text-heavy ads.", parameters: { type: "object", properties: { prompt: { type: "string" }, model: { type: "string", enum: ["nano-banana-2", "gpt-image"] } }, required: ["prompt", "model"] } } },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const { messages, docUrl, sheetUrl, defaultImageModel } = await req.json();
  const docId = docUrl ? extractDocId(docUrl) : null;
  const sheetId = sheetUrl ? extractSheetId(sheetUrl) : null;

  const sysParts = [
    "You are an AI Studio assistant for an ads agency. You help the user edit Google Docs/Sheets and generate ad creative images.",
    "Use tools whenever the user asks to read, write, edit, append, or summarize a doc or sheet, or to create/edit ad images.",
    "When generating images, prefer 'nano-banana-2' for photo-real visuals; use 'gpt-image' when the ad has lots of text/typography.",
    "Keep responses concise. After running tools, summarize what was changed.",
    "Compliance: never use the word 'guaranteed' for investments; use 'targeted returns' and include risk disclaimers when writing investor copy.",
    docId ? `Active Google Doc: ${docUrl} (id ${docId})` : "No active Google Doc.",
    sheetId ? `Active Google Sheet: ${sheetUrl} (id ${sheetId})` : "No active Google Sheet.",
    defaultImageModel ? `User default image model: ${defaultImageModel}.` : "",
  ].filter(Boolean);

  const convo: any[] = [
    { role: "system", content: sysParts.join("\n") },
    ...messages,
  ];

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (obj: any) => {
        try { controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`)); } catch {}
      };
      const aborted = { v: false };
      req.signal.addEventListener("abort", () => { aborted.v = true; });

      try {
        for (let step = 0; step < 8; step++) {
          if (aborted.v) break;
          send({ type: "step", step });

          const llm = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: { "Authorization": `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "google/gemini-2.5-pro",
              messages: convo,
              tools,
              tool_choice: "auto",
              stream: true,
            }),
            signal: req.signal,
          });
          if (!llm.ok) {
            const err = await llm.text();
            if (llm.status === 429) throw new Error("Rate limit exceeded. Try again shortly.");
            if (llm.status === 402) throw new Error("AI credits exhausted. Add credits in Settings.");
            throw new Error(`AI gateway [${llm.status}]: ${err}`);
          }

          // Parse OpenAI-style SSE: stream text deltas to client; accumulate tool_calls
          const reader = llm.body!.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let assistantText = "";
          const toolCallsAcc: any[] = []; // {id,name,args:string}

          outer: while (true) {
            if (aborted.v) { try { reader.cancel(); } catch {} break; }
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";
            for (const raw of lines) {
              const line = raw.trim();
              if (!line.startsWith("data:")) continue;
              const payload = line.slice(5).trim();
              if (payload === "[DONE]") break outer;
              let evt: any; try { evt = JSON.parse(payload); } catch { continue; }
              const delta = evt.choices?.[0]?.delta;
              if (!delta) continue;
              if (typeof delta.content === "string" && delta.content) {
                assistantText += delta.content;
                send({ type: "text", delta: delta.content });
              }
              if (Array.isArray(delta.tool_calls)) {
                for (const tc of delta.tool_calls) {
                  const idx = tc.index ?? 0;
                  if (!toolCallsAcc[idx]) toolCallsAcc[idx] = { id: tc.id, name: "", args: "" };
                  if (tc.id) toolCallsAcc[idx].id = tc.id;
                  if (tc.function?.name) toolCallsAcc[idx].name += tc.function.name;
                  if (tc.function?.arguments) toolCallsAcc[idx].args += tc.function.arguments;
                }
              }
            }
          }

          // Push assistant message into convo
          const assistantMsg: any = { role: "assistant", content: assistantText || null };
          if (toolCallsAcc.length) {
            assistantMsg.tool_calls = toolCallsAcc.map(t => ({
              id: t.id, type: "function", function: { name: t.name, arguments: t.args || "{}" },
            }));
          }
          convo.push(assistantMsg);

          if (!toolCallsAcc.length) {
            send({ type: "done", text: assistantText });
            break;
          }

          // Execute tools sequentially, streaming progress
          for (const tc of toolCallsAcc) {
            if (aborted.v) break;
            const name = tc.name;
            let args: any = {}; try { args = JSON.parse(tc.args || "{}"); } catch {}
            send({ type: "tool_start", id: tc.id, name, args });
            let result: any;
            try {
              if (name === "read_doc") {
                if (!docId) throw new Error("No active Google Doc URL provided.");
                result = await readDoc(docId);
              } else if (name === "append_to_doc") {
                if (!docId) throw new Error("No active Google Doc URL provided.");
                result = await appendToDoc(docId, args.content);
              } else if (name === "replace_doc_text") {
                if (!docId) throw new Error("No active Google Doc URL provided.");
                result = await replaceDocText(docId, args.find, args.replace);
              } else if (name === "read_sheet") {
                if (!sheetId) throw new Error("No active Google Sheet URL provided.");
                result = await readSheet(sheetId, args.range);
              } else if (name === "update_sheet_range") {
                if (!sheetId) throw new Error("No active Google Sheet URL provided.");
                result = await updateSheetRange(sheetId, args.range, args.values);
              } else if (name === "append_sheet_row") {
                if (!sheetId) throw new Error("No active Google Sheet URL provided.");
                result = await appendSheetRow(sheetId, args.range, args.values);
              } else if (name === "generate_ad_image") {
                const model = args.model || defaultImageModel || "nano-banana-2";
                result = await generateAdImage(args.prompt, model);
              } else {
                result = { error: `Unknown tool: ${name}` };
              }
            } catch (e: any) {
              result = { error: e?.message || String(e) };
            }
            send({ type: "tool_end", id: tc.id, name, args, result });
            convo.push({
              role: "tool",
              tool_call_id: tc.id,
              content: JSON.stringify(result).slice(0, 8000),
            });
          }
        }
      } catch (e: any) {
        console.error("ai-studio stream error", e);
        send({ type: "error", message: e?.message || String(e) });
      } finally {
        try { controller.close(); } catch {}
      }
    },
  });

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
});
