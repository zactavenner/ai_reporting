// AI Studio edge function - Manus-style chat with Google Docs/Sheets tools + image generation
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
  const modelId = model === "gpt-image" ? "openai/gpt-5-nano" : "google/gemini-3.1-flash-image-preview";
  // Note: gpt image model name on gateway may differ; using image-capable models.
  const actualModel = model === "gpt-image" ? "openai/gpt-image-1" : "google/gemini-3.1-flash-image-preview";
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
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
  const images = data.choices?.[0]?.message?.images;
  const imgUrl = images?.[0]?.image_url?.url;
  if (!imgUrl) throw new Error(`No image returned: ${JSON.stringify(data).slice(0, 500)}`);

  // Upload data URL to storage so client can persist it
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

// ----- Tool schema for OpenAI-compatible function calling -----
const tools = [
  { type: "function", function: { name: "read_doc", description: "Read text content of the active Google Doc.", parameters: { type: "object", properties: {}, required: [] } } },
  { type: "function", function: { name: "append_to_doc", description: "Append new content (paragraphs/markdown-style text) to the end of the active Google Doc.", parameters: { type: "object", properties: { content: { type: "string" } }, required: ["content"] } } },
  { type: "function", function: { name: "replace_doc_text", description: "Find and replace all instances of a string in the active Google Doc.", parameters: { type: "object", properties: { find: { type: "string" }, replace: { type: "string" } }, required: ["find", "replace"] } } },
  { type: "function", function: { name: "read_sheet", description: "Read a range from the active Google Sheet (e.g. 'Sheet1!A1:Z100').", parameters: { type: "object", properties: { range: { type: "string" } }, required: ["range"] } } },
  { type: "function", function: { name: "update_sheet_range", description: "Overwrite cells in the active Google Sheet at the given A1 range.", parameters: { type: "object", properties: { range: { type: "string" }, values: { type: "array", items: { type: "array", items: {} } } }, required: ["range", "values"] } } },
  { type: "function", function: { name: "append_sheet_row", description: "Append rows to the bottom of the active Google Sheet at the given A1 range.", parameters: { type: "object", properties: { range: { type: "string" }, values: { type: "array", items: { type: "array", items: {} } } }, required: ["range", "values"] } } },
  { type: "function", function: { name: "generate_ad_image", description: "Generate an ad creative image. Use 'nano-banana-2' (Gemini 3.1 Flash Image, fast, photo-real) or 'gpt-image' (OpenAI, best for typography/text-heavy ads).", parameters: { type: "object", properties: { prompt: { type: "string" }, model: { type: "string", enum: ["nano-banana-2", "gpt-image"] } }, required: ["prompt", "model"] } } },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { messages, docUrl, sheetUrl, defaultImageModel } = await req.json();
    const docId = docUrl ? extractDocId(docUrl) : null;
    const sheetId = sheetUrl ? extractSheetId(sheetUrl) : null;

    const sysParts = [
      "You are an AI Studio assistant for an ads agency. You help the user edit Google Docs/Sheets and generate ad creative images.",
      "Use tools whenever the user asks to read, write, edit, append, or summarize a doc or sheet, or to create/edit ad images.",
      "When generating images, prefer 'nano-banana-2' for photo-real or general visuals; use 'gpt-image' when the ad has lots of text/typography.",
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

    const toolEvents: any[] = [];
    let finalText = "";

    for (let step = 0; step < 8; step++) {
      const llm = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-2.5-pro",
          messages: convo,
          tools,
          tool_choice: "auto",
        }),
      });
      if (!llm.ok) {
        const err = await llm.text();
        if (llm.status === 429) throw new Error("Rate limit exceeded. Try again shortly.");
        if (llm.status === 402) throw new Error("AI credits exhausted. Add credits in Settings.");
        throw new Error(`AI gateway [${llm.status}]: ${err}`);
      }
      const data = await llm.json();
      const msg = data.choices?.[0]?.message;
      if (!msg) throw new Error("No message in AI response");
      convo.push(msg);

      const toolCalls = msg.tool_calls || [];
      if (!toolCalls.length) {
        finalText = msg.content || "";
        break;
      }

      for (const call of toolCalls) {
        const name = call.function.name;
        let args: any = {};
        try { args = JSON.parse(call.function.arguments || "{}"); } catch {}
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
        toolEvents.push({ name, args, result });
        convo.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(result).slice(0, 8000),
        });
      }
    }

    return new Response(JSON.stringify({ text: finalText, tools: toolEvents }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("ai-studio error", e);
    return new Response(JSON.stringify({ error: e?.message || String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
