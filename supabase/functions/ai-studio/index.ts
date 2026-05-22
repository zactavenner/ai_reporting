// AI Studio v2 — streaming SSE chat with Google Docs/Sheets tools, high-quality static ad
// generation, server-side persistence, and Manus-style canvas events.
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
const OPENAI_API_KEY_ENV = Deno.env.get("OPENAI_API_KEY");
const GOOGLE_DOCS_API_KEY = Deno.env.get("GOOGLE_DOCS_API_KEY");
const GOOGLE_SHEETS_API_KEY = Deno.env.get("GOOGLE_SHEETS_API_KEY");
const GATEWAY = "https://connector-gateway.lovable.dev";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function base64UrlEncode(value: ArrayBuffer): string {
  const bytes = new Uint8Array(value);
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function verifyDashboardToken(token: string | null): Promise<string | null> {
  try {
    if (!token || !token.includes(".")) return null;
    const [payload, signature] = token.split(".");
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(SERVICE_KEY),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const expected = base64UrlEncode(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
    if (signature !== expected) return null;
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const parsed = JSON.parse(atob(base64 + "=".repeat((4 - base64.length % 4) % 4)));
    if (!parsed?.memberId || typeof parsed.exp !== "number" || parsed.exp < Date.now()) return null;
    return parsed.memberId;
  } catch {
    return null;
  }
}

// ---------- helpers ----------
const extractDocId = (u: string) => u.match(/\/document\/d\/([a-zA-Z0-9_-]+)/)?.[1] ?? null;
const extractSheetId = (u: string) => u.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)?.[1] ?? null;

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, Math.min(i + chunk, bytes.length))));
  }
  return btoa(binary);
}

function getDimensions(ar: string) {
  switch (ar) {
    case "1:1": return { w: 1024, h: 1024 };
    case "4:5": return { w: 1024, h: 1280 };
    case "9:16": return { w: 768, h: 1365 };
    case "16:9": return { w: 1365, h: 768 };
    default: return { w: 1024, h: 1024 };
  }
}

async function gFetch(path: string, apiKey: string, init?: RequestInit) {
  const res = await fetch(`${GATEWAY}${path}`, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "X-Connection-Api-Key": apiKey,
      "Content-Type": "application/json",
    },
  });
  const text = await res.text();
  let data: any; try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(`[${res.status}] ${typeof data === "string" ? data : JSON.stringify(data)}`);
  return data;
}

// ---------- Google tools ----------
async function readDoc(docId: string) {
  if (!GOOGLE_DOCS_API_KEY) throw new Error("Google Docs not connected");
  const doc = await gFetch(`/google_docs/v1/documents/${docId}`, GOOGLE_DOCS_API_KEY, { method: "GET" });
  const text = (doc.body?.content || [])
    .flatMap((el: any) => el.paragraph?.elements?.map((e: any) => e.textRun?.content || "") || [])
    .join("");
  return { title: doc.title, text: text.slice(0, 20000) };
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
async function listSheetTabs(sheetId: string) {
  if (!GOOGLE_SHEETS_API_KEY) throw new Error("Google Sheets not connected");
  const data = await gFetch(
    `/google_sheets/v4/spreadsheets/${sheetId}?fields=sheets(properties(sheetId,title,index,gridProperties(rowCount,columnCount)))`,
    GOOGLE_SHEETS_API_KEY,
    { method: "GET" },
  );
  const tabs = (data.sheets || []).map((s: any) => ({
    gid: s.properties?.sheetId,
    title: s.properties?.title,
    index: s.properties?.index,
    rows: s.properties?.gridProperties?.rowCount,
    cols: s.properties?.gridProperties?.columnCount,
  }));
  return { spreadsheet_id: sheetId, tab_count: tabs.length, tabs };
}
async function batchGetSheet(sheetId: string, ranges: string[]) {
  if (!GOOGLE_SHEETS_API_KEY) throw new Error("Google Sheets not connected");
  const qs = ranges.map((r) => `ranges=${encodeURIComponent(r)}`).join("&");
  const data = await gFetch(
    `/google_sheets/v4/spreadsheets/${sheetId}/values:batchGet?${qs}&valueRenderOption=FORMATTED_VALUE`,
    GOOGLE_SHEETS_API_KEY,
    { method: "GET" },
  );
  const valueRanges = (data.valueRanges || []).map((vr: any) => ({
    range: vr.range,
    values: (vr.values || []).slice(0, 200),
  }));
  return { value_ranges: valueRanges };
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

// ---------- Image generation ----------
function buildAdPrompt(args: {
  prompt: string;
  aspectRatio: string;
  brandColors?: string[];
  brandFonts?: string[];
  offerDescription?: string;
  productDescription?: string;
  includeDisclaimer?: boolean;
  disclaimerText?: string;
  strictBrandAdherence?: boolean;
  hasReference?: boolean;
}) {
  const { w, h } = getDimensions(args.aspectRatio);
  const hasBrand = !!args.brandColors?.length;
  const colorRule = hasBrand
    ? args.strictBrandAdherence
      ? `STRICT BRAND ADHERENCE: Use ONLY these exact brand colors — no deviations: ${args.brandColors!.join(", ")}`
      : `Use these brand colors prominently: ${args.brandColors!.join(", ")}.`
    : args.hasReference
      ? `Extract and replicate the EXACT color palette from the reference image.`
      : "";
  const fontRule = args.brandFonts?.length
    ? `Brand fonts: ${args.brandFonts.join(", ")}`
    : "";
  const product = args.productDescription ? `Product/Service: ${args.productDescription}` : "";
  const offer = args.offerDescription ? `Offer/Value Proposition: ${args.offerDescription}` : "";
  const refRule = args.hasReference
    ? `CRITICAL — PIXEL-PERFECT REPLICATION: A reference ad image is included. CLONE its layout, composition, colors, typography style, effects, and overall design. Replace ONLY the copy with the new product's messaging. Treat the reference as an exact template.`
    : "";
  const disclaimer = args.includeDisclaimer && args.disclaimerText
    ? `MANDATORY DISCLAIMER: Include this disclaimer clearly legible at the bottom in a small but readable font: "${args.disclaimerText}"`
    : "";
  const safeZone = args.aspectRatio === "9:16"
    ? `INSTAGRAM STORIES/REELS SAFE ZONE: Do NOT place important content in the top 14% or bottom 20%.`
    : "";
  return `Create a high-converting advertisement image.

${args.prompt}

${product}
${offer}
${colorRule}
${fontRule}
${refRule}
${disclaimer}
${safeZone}

Image dimensions: ${w}x${h} (${args.aspectRatio} aspect ratio).

REQUIREMENTS:
- Professional advertisement quality
- Eye-catching visual design with clear focal point
- Balanced composition, modern polished aesthetic
- Suitable for paid social platforms
- Ultra high resolution

DO NOT include:
- Watermarks
- Logos or brand marks of any kind
- Stock photo artifacts
- Low quality or blurry elements
- The word "guaranteed" — for investment offers use "targeted returns"`.trim();
}

type ImageResult = { url: string; mime: string; storage_path: string; model: string; aspect_ratio: string };

async function generateStaticAd(opts: {
  prompt: string;
  aspectRatio?: string;
  referenceImageUrl?: string;
  clientId: string | null;
  brandContext: any;
  quality: "pro" | "fast";
  model?: "nano-banana" | "openai" | null;
}): Promise<ImageResult> {
  const aspect = opts.aspectRatio || "1:1";
  const supa = createClient(SUPABASE_URL, SERVICE_KEY);

  const fullPrompt = buildAdPrompt({
    prompt: opts.prompt,
    aspectRatio: aspect,
    brandColors: opts.brandContext?.brandColors,
    brandFonts: opts.brandContext?.brandFonts,
    offerDescription: opts.brandContext?.offerDescription,
    productDescription: opts.brandContext?.productDescription,
    includeDisclaimer: opts.brandContext?.includeDisclaimer,
    disclaimerText: opts.brandContext?.disclaimerText,
    strictBrandAdherence: opts.brandContext?.strictBrandAdherence,
    hasReference: !!opts.referenceImageUrl,
  });

  let base64Image = "";
  let mime = "image/png";
  let modelUsed = "";

  // Effective model selection: explicit `model` arg wins; else quality maps to pro=openai (gpt-image-2), fast=nano-banana
  const effectiveModel: "nano-banana" | "openai" =
    opts.model === "openai" || opts.model === "nano-banana"
      ? opts.model
      : (opts.quality === "pro" ? "openai" : "nano-banana");

  if (effectiveModel === "openai") {
    // Prefer the agency-stored OpenAI API key (set in Agency Settings → API Keys).
    // Fall back to env, then OpenRouter passthrough.
    let agencyOpenAi: string | null = null;
    try {
      const { data: a } = await supa.from("agency_settings").select("openai_api_key").limit(1).maybeSingle();
      const v = (a as any)?.openai_api_key;
      if (typeof v === "string" && v.trim()) agencyOpenAi = v.trim();
    } catch (_) { /* ignore */ }
    const openaiKey = agencyOpenAi || OPENAI_API_KEY_ENV || null;
    const sizeMap: Record<string, string> = { "1:1": "1024x1024", "16:9": "1536x1024", "9:16": "1024x1536", "4:5": "1024x1280", "3:2": "1536x1024", "2:3": "1024x1536" };
    const sz = sizeMap[aspect] || "1024x1024";
    let res: Response;
    if (openaiKey) {
      modelUsed = "openai/gpt-image-2 (direct)";
      res = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-image-2",
          prompt: fullPrompt + (opts.referenceImageUrl ? `\n\nReference image (clone style/layout): ${opts.referenceImageUrl}` : ""),
          size: sz,
          n: 1,
        }),
      });
    } else if (OPENROUTER_API_KEY) {
      modelUsed = "openai/gpt-image-2 (via openrouter)";
      res = await fetch("https://openrouter.ai/api/v1/images/generations", {
        method: "POST",
        headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}`, "Content-Type": "application/json", "HTTP-Referer": "https://lovable.dev", "X-Title": "AI Studio" },
        body: JSON.stringify({
          model: "openai/gpt-image-2",
          prompt: fullPrompt + (opts.referenceImageUrl ? `\n\nReference image (clone style/layout): ${opts.referenceImageUrl}` : ""),
          size: sz,
          n: 1,
          response_format: "b64_json",
        }),
      });
    } else {
      throw new Error("No OpenAI API key configured. Add one in Agency Settings → API Keys to enable GPT Image 2.");
    }
    if (!res.ok) throw new Error(`OpenAI image [${res.status}]: ${(await res.text()).slice(0, 400)}`);
    const data = await res.json();
    const b64 = data?.data?.[0]?.b64_json;
    const url = data?.data?.[0]?.url;
    if (b64) { base64Image = b64; mime = "image/png"; }
    else if (url) {
      const r = await fetch(url); const buf = await r.arrayBuffer();
      base64Image = arrayBufferToBase64(buf); mime = r.headers.get("content-type") || "image/png";
    } else throw new Error("OpenAI returned no image data");
  } else {
    // Nano Banana 2 via AI Gateway
    modelUsed = "google/gemini-3.1-flash-image-preview";
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelUsed,
        messages: [{ role: "user", content: fullPrompt }],
        modalities: ["image", "text"],
      }),
    });
    if (!res.ok) throw new Error(`Gateway image [${res.status}]: ${(await res.text()).slice(0, 400)}`);
    const data = await res.json();
    const imgUrl = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    if (!imgUrl?.startsWith("data:")) throw new Error("Gateway returned no inline image");
    const m = imgUrl.match(/^data:(.+?);base64,(.+)$/)!;
    mime = m[1]; base64Image = m[2];
  }

  // Upload
  const bytes = Uint8Array.from(atob(base64Image), c => c.charCodeAt(0));
  const ext = (mime.split("/")[1] || "png").split("+")[0];
  const path = `ai-studio/${opts.clientId || "shared"}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
  const { error } = await supa.storage.from("creatives").upload(path, bytes, { contentType: mime, upsert: false });
  if (error) throw new Error(`Storage upload: ${error.message}`);
  const { data: pub } = supa.storage.from("creatives").getPublicUrl(path);

  // Save to client_assets so it appears in existing asset views
  if (opts.clientId) {
    await supa.from("client_assets").insert({
      client_id: opts.clientId,
      asset_type: "static_ad",
      title: opts.prompt.slice(0, 120),
      status: "completed",
      content: {
        image_url: pub.publicUrl,
        storage_path: path,
        model: modelUsed,
        aspect_ratio: aspect,
        source: "ai_studio",
        prompt: opts.prompt.slice(0, 1000),
      },
    });
  }

  return { url: pub.publicUrl, mime, storage_path: path, model: modelUsed, aspect_ratio: aspect };
}

// ---------- Edit existing static ad ----------
function buildEditPrompt(args: {
  editInstruction: string;
  newOffer?: string;
  newHook?: string;
  newColors?: string[];
  newDisclaimer?: string;
  brandContext: any;
  aspectRatio: string;
}) {
  const { w, h } = getDimensions(args.aspectRatio);
  const colorRule = args.newColors?.length
    ? `Override the color palette with these EXACT colors: ${args.newColors.join(", ")}.`
    : (args.brandContext?.brandColors?.length
        ? `Keep the brand palette: ${args.brandContext.brandColors.join(", ")}.`
        : "");
  const offerLine = args.newOffer ? `Update the offer / value proposition to: ${args.newOffer}` : "";
  const hookLine = args.newHook ? `Replace the headline / hook with: "${args.newHook}"` : "";
  const disclaimerLine = args.newDisclaimer
    ? `Update the bottom disclaimer to read clearly: "${args.newDisclaimer}"`
    : (args.brandContext?.includeDisclaimer
        ? `Keep a small legible bottom disclaimer: "${args.brandContext.disclaimerText}"`
        : "");
  return `Revise the attached advertisement image. Preserve the overall composition, layout grid, photography/illustration treatment and brand feel. Only change what is requested.

EDIT INSTRUCTION: ${args.editInstruction}

${hookLine}
${offerLine}
${colorRule}
${disclaimerLine}

Output dimensions: ${w}x${h} (${args.aspectRatio}). Ultra high resolution, no watermarks, no logos. Never use the word "guaranteed" for investment offers — use "targeted returns".`.trim();
}

async function editStaticAd(opts: {
  sourceImageUrl: string;
  editInstruction: string;
  newOffer?: string;
  newHook?: string;
  newColors?: string[];
  newDisclaimer?: string;
  aspectRatio?: string;
  clientId: string | null;
  brandContext: any;
  quality: "pro" | "fast";
}): Promise<ImageResult & { parent_image_url: string }> {
  const aspect = opts.aspectRatio || "1:1";
  const supa = createClient(SUPABASE_URL, SERVICE_KEY);
  const fullPrompt = buildEditPrompt({
    editInstruction: opts.editInstruction,
    newOffer: opts.newOffer,
    newHook: opts.newHook,
    newColors: opts.newColors,
    newDisclaimer: opts.newDisclaimer,
    brandContext: opts.brandContext,
    aspectRatio: aspect,
  });

  // Fetch source image as base64
  const srcRes = await fetch(opts.sourceImageUrl);
  if (!srcRes.ok) throw new Error(`Could not fetch source image (${srcRes.status})`);
  const srcMime = srcRes.headers.get("content-type") || "image/png";
  const srcB64 = arrayBufferToBase64(await srcRes.arrayBuffer());

  let base64Image = "";
  let mime = "image/png";
  let modelUsed = "";

  if (opts.quality === "pro" && GEMINI_API_KEY) {
    modelUsed = "gemini-3-pro-image-preview";
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: fullPrompt }, { inlineData: { mimeType: srcMime, data: srcB64 } }] }],
          generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
        }),
      },
    );
    if (!res.ok) throw new Error(`Gemini edit [${res.status}]: ${(await res.text()).slice(0, 400)}`);
    const data = await res.json();
    const imagePart = (data.candidates?.[0]?.content?.parts || []).find((p: any) =>
      p.inlineData?.mimeType?.startsWith("image/"),
    );
    if (!imagePart?.inlineData?.data) throw new Error("No image in Gemini edit response");
    base64Image = imagePart.inlineData.data;
    mime = imagePart.inlineData.mimeType || "image/png";
  } else {
    modelUsed = "google/gemini-3.1-flash-image-preview";
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelUsed,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: fullPrompt },
            { type: "image_url", image_url: { url: `data:${srcMime};base64,${srcB64}` } },
          ],
        }],
        modalities: ["image", "text"],
      }),
    });
    if (!res.ok) throw new Error(`Gateway edit [${res.status}]: ${(await res.text()).slice(0, 400)}`);
    const data = await res.json();
    const imgUrl = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    if (!imgUrl?.startsWith("data:")) throw new Error("Gateway returned no inline image");
    const m = imgUrl.match(/^data:(.+?);base64,(.+)$/)!;
    mime = m[1]; base64Image = m[2];
  }

  const bytes = Uint8Array.from(atob(base64Image), c => c.charCodeAt(0));
  const ext = (mime.split("/")[1] || "png").split("+")[0];
  const path = `ai-studio/${opts.clientId || "shared"}/edit-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
  const { error } = await supa.storage.from("creatives").upload(path, bytes, { contentType: mime, upsert: false });
  if (error) throw new Error(`Storage upload: ${error.message}`);
  const { data: pub } = supa.storage.from("creatives").getPublicUrl(path);

  if (opts.clientId) {
    await supa.from("client_assets").insert({
      client_id: opts.clientId,
      asset_type: "static_ad",
      title: `Edit: ${opts.editInstruction.slice(0, 100)}`,
      status: "completed",
      content: {
        image_url: pub.publicUrl,
        storage_path: path,
        model: modelUsed,
        aspect_ratio: aspect,
        source: "ai_studio",
        parent_image_url: opts.sourceImageUrl,
        edit_instruction: opts.editInstruction,
        new_offer: opts.newOffer || null,
        new_hook: opts.newHook || null,
        new_colors: opts.newColors || null,
        new_disclaimer: opts.newDisclaimer || null,
      },
    });
  }

  return {
    url: pub.publicUrl, mime, storage_path: path, model: modelUsed,
    aspect_ratio: aspect, parent_image_url: opts.sourceImageUrl,
  };
}

// ---------- Variations (multiple options, save-on-pick) ----------
async function generateOneVariation(opts: {
  prompt: string;
  aspectRatio: string;
  brandContext: any;
  variantHint: string;
  sourceImageUrl?: string;
  clientId: string | null;
}): Promise<ImageResult> {
  const supa = createClient(SUPABASE_URL, SERVICE_KEY);
  const basePrompt = buildAdPrompt({
    prompt: `${opts.prompt}\n\nVARIATION DIRECTION: ${opts.variantHint}`,
    aspectRatio: opts.aspectRatio,
    brandColors: opts.brandContext?.brandColors,
    brandFonts: opts.brandContext?.brandFonts,
    offerDescription: opts.brandContext?.offerDescription,
    includeDisclaimer: opts.brandContext?.includeDisclaimer,
    disclaimerText: opts.brandContext?.disclaimerText,
    hasReference: !!opts.sourceImageUrl,
  });

  const modelUsed = "google/gemini-3.1-flash-image-preview";
  const userContent: any = opts.sourceImageUrl
    ? [
        { type: "text", text: basePrompt },
        ...(await (async () => {
          try {
            const r = await fetch(opts.sourceImageUrl);
            if (!r.ok) return [];
            const m = r.headers.get("content-type") || "image/png";
            const b = arrayBufferToBase64(await r.arrayBuffer());
            return [{ type: "image_url", image_url: { url: `data:${m};base64,${b}` } }];
          } catch { return []; }
        })()),
      ]
    : basePrompt;

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: modelUsed, messages: [{ role: "user", content: userContent }], modalities: ["image", "text"] }),
  });
  if (!res.ok) throw new Error(`Variation [${res.status}]: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const imgUrl = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!imgUrl?.startsWith("data:")) throw new Error("No image in variation response");
  const m = imgUrl.match(/^data:(.+?);base64,(.+)$/)!;
  const mime = m[1]; const base64Image = m[2];

  const bytes = Uint8Array.from(atob(base64Image), c => c.charCodeAt(0));
  const ext = (mime.split("/")[1] || "png").split("+")[0];
  const path = `ai-studio/${opts.clientId || "shared"}/variations/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
  const { error } = await supa.storage.from("creatives").upload(path, bytes, { contentType: mime, upsert: false });
  if (error) throw new Error(`Storage upload: ${error.message}`);
  const { data: pub } = supa.storage.from("creatives").getPublicUrl(path);
  return { url: pub.publicUrl, mime, storage_path: path, model: modelUsed, aspect_ratio: opts.aspectRatio };
}

const VARIATION_HINTS = [
  "Bold typographic poster — oversized headline, generous negative space, single hero element.",
  "Editorial split layout — strong photography on one half, clean copy block on the other.",
  "Premium gradient background with layered glass UI elements and a centered headline.",
  "Lifestyle/product-in-context scene with a small floating badge for the headline.",
  "Conversion-focused layout — big number/stat as the visual hero, supporting headline below.",
];

async function generateAdVariations(opts: {
  prompt: string;
  aspectRatio?: string;
  count?: number;
  sourceImageUrl?: string;
  clientId: string | null;
  brandContext: any;
}) {
  const aspect = opts.aspectRatio || "1:1";
  const count = Math.max(2, Math.min(5, opts.count || 4));
  const hints = VARIATION_HINTS.slice(0, count);
  const settled = await Promise.allSettled(
    hints.map(h => generateOneVariation({
      prompt: opts.prompt,
      aspectRatio: aspect,
      brandContext: opts.brandContext,
      variantHint: h,
      sourceImageUrl: opts.sourceImageUrl,
      clientId: opts.clientId,
    })),
  );
  const variants = settled
    .map((r, i) => r.status === "fulfilled" ? { ...r.value, hint: hints[i] } : null)
    .filter(Boolean) as (ImageResult & { hint: string })[];
  const errors = settled.filter(r => r.status === "rejected").map((r: any) => String(r.reason?.message || r.reason));
  if (variants.length === 0) throw new Error(`All variations failed: ${errors.join(" | ")}`);
  return { variants, aspect_ratio: aspect, errors };
}

// ---------- Storyboard / Scene tools ----------
async function planStoryboard(opts: {
  brief: string;
  sceneCount: number;
  aspectRatio: string;
  styleNotes?: string;
  brandContext: any;
  conversationId: string;
  userId: string;
}) {
  const supa = createClient(SUPABASE_URL, SERVICE_KEY);
  const sys = `You are a creative director. Break the brief into ${opts.sceneCount} cinematic scenes (8 seconds each) for a ${opts.aspectRatio} video. Output STRICT JSON: { "scenes": [{ "title": string, "image_prompt": string, "video_prompt": string }] }. image_prompt must describe a single static keyframe (subject, environment, lighting, composition). video_prompt describes the motion/animation that begins from that keyframe (camera move, subject action, ~8s). No copy/text overlays unless explicitly asked. ${opts.brandContext?.brandColors?.length ? `Brand palette: ${opts.brandContext.brandColors.join(", ")}.` : ""} ${opts.styleNotes || ""}`;
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-pro",
      messages: [
        { role: "system", content: sys },
        { role: "user", content: opts.brief },
      ],
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) throw new Error(`plan_storyboard [${res.status}]: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  let parsed: any = {};
  try { parsed = JSON.parse(data.choices?.[0]?.message?.content || "{}"); } catch {}
  const rawScenes: any[] = Array.isArray(parsed.scenes) ? parsed.scenes.slice(0, 8) : [];
  if (rawScenes.length === 0) throw new Error("Storyboard produced no scenes");
  const storyboardId = crypto.randomUUID();
  const scenes = rawScenes.map((s, i) => ({
    id: `${storyboardId}-s${i + 1}`,
    order: i + 1,
    title: String(s.title || `Scene ${i + 1}`).slice(0, 120),
    image_prompt: String(s.image_prompt || "").slice(0, 1200),
    video_prompt: String(s.video_prompt || "").slice(0, 800),
    duration: 8,
  }));
  const ci = await supa.from("ai_studio_canvas_items").insert({
    conversation_id: opts.conversationId,
    user_id: opts.userId,
    kind: "storyboard",
    payload: {
      storyboard_id: storyboardId,
      brief: opts.brief.slice(0, 1000),
      aspect_ratio: opts.aspectRatio,
      style_notes: opts.styleNotes || "",
      scenes,
    },
  }).select("id, kind, payload, created_at").single();
  return { storyboardItem: ci.data, storyboardId, scenes, aspect_ratio: opts.aspectRatio };
}

async function generateSceneImage(opts: {
  storyboardId: string;
  sceneId: string;
  sceneOrder: number;
  prompt: string;
  aspectRatio: string;
  clientId: string | null;
  conversationId: string;
  userId: string;
}) {
  const supa = createClient(SUPABASE_URL, SERVICE_KEY);
  const fullPrompt = `Create a single cinematic keyframe image for a video scene.\n\n${opts.prompt}\n\nAspect ratio: ${opts.aspectRatio}. Photoreal cinematic look. No text overlays or watermarks.`;

  let base64Image = "", mime = "image/png", modelUsed = "";
  if (GEMINI_API_KEY) {
    modelUsed = "gemini-3-pro-image-preview";
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: fullPrompt }] }],
          generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
        }),
      },
    );
    if (!res.ok) throw new Error(`Scene image [${res.status}]: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    const imagePart = (data.candidates?.[0]?.content?.parts || []).find((p: any) => p.inlineData?.mimeType?.startsWith("image/"));
    if (!imagePart?.inlineData?.data) throw new Error("No image in scene response");
    base64Image = imagePart.inlineData.data;
    mime = imagePart.inlineData.mimeType || "image/png";
  } else {
    modelUsed = "google/gemini-3.1-flash-image-preview";
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: modelUsed, messages: [{ role: "user", content: fullPrompt }], modalities: ["image", "text"] }),
    });
    if (!res.ok) throw new Error(`Scene image [${res.status}]: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    const imgUrl = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    if (!imgUrl?.startsWith("data:")) throw new Error("Scene image: no inline image");
    const m = imgUrl.match(/^data:(.+?);base64,(.+)$/)!;
    mime = m[1]; base64Image = m[2];
  }

  const bytes = Uint8Array.from(atob(base64Image), c => c.charCodeAt(0));
  const ext = (mime.split("/")[1] || "png").split("+")[0];
  const path = `ai-studio/${opts.clientId || "shared"}/storyboards/${opts.storyboardId}/scene-${opts.sceneOrder}-${Date.now()}.${ext}`;
  const { error } = await supa.storage.from("creatives").upload(path, bytes, { contentType: mime, upsert: false });
  if (error) throw new Error(`Storage upload: ${error.message}`);
  const { data: pub } = supa.storage.from("creatives").getPublicUrl(path);

  const ci = await supa.from("ai_studio_canvas_items").insert({
    conversation_id: opts.conversationId,
    user_id: opts.userId,
    kind: "scene_image",
    payload: {
      storyboard_id: opts.storyboardId,
      scene_id: opts.sceneId,
      scene_order: opts.sceneOrder,
      image_url: pub.publicUrl,
      storage_path: path,
      mime,
      model: modelUsed,
      aspect_ratio: opts.aspectRatio,
      prompt: opts.prompt,
    },
  }).select("id, kind, payload, created_at").single();
  return { item: ci.data, image_url: pub.publicUrl, storage_path: path, model: modelUsed, mime };
}

async function generateSceneVideo(opts: {
  storyboardId: string;
  sceneId: string;
  sceneOrder: number;
  imageUrl: string;
  videoPrompt: string;
  aspectRatio: string;
  clientId: string | null;
  conversationId: string;
  userId: string;
}) {
  const supa = createClient(SUPABASE_URL, SERVICE_KEY);
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY required for video generation");

  const imgRes = await fetch(opts.imageUrl);
  if (!imgRes.ok) throw new Error(`Could not fetch keyframe (${imgRes.status})`);
  const imgB64 = arrayBufferToBase64(await imgRes.arrayBuffer());
  const imgMime = imgRes.headers.get("content-type") || "image/png";

  const veoUrl = `https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-generate-preview:predictLongRunning?key=${GEMINI_API_KEY}`;
  const startRes = await fetch(veoUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      instances: [{ prompt: opts.videoPrompt, image: { bytesBase64Encoded: imgB64, mimeType: imgMime } }],
      parameters: { aspectRatio: opts.aspectRatio, durationSeconds: 8, sampleCount: 1 },
    }),
  });
  if (!startRes.ok) {
    const t = await startRes.text();
    throw new Error(`Veo start [${startRes.status}]: ${t.slice(0, 300)}`);
  }
  const startData = await startRes.json();
  const opName: string | undefined = startData.name;
  if (!opName) throw new Error("Veo did not return operation name");

  let videoUri: string | null = null;
  const maxAttempts = 36;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const pollRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/${opName}?key=${GEMINI_API_KEY}`);
    if (!pollRes.ok) continue;
    const poll = await pollRes.json();
    if (poll.done) {
      const uri = poll.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
      if (uri) { videoUri = uri; break; }
      if (poll.error) throw new Error(`Veo failed: ${poll.error.message || "unknown"}`);
      throw new Error("Veo finished with no video");
    }
  }
  if (!videoUri) throw new Error("Veo timed out after 3 minutes");

  const sep = videoUri.includes("?") ? "&" : "?";
  const dlRes = await fetch(`${videoUri}${sep}key=${GEMINI_API_KEY}`);
  if (!dlRes.ok) throw new Error(`Veo download [${dlRes.status}]`);
  const videoBytes = new Uint8Array(await dlRes.arrayBuffer());
  const path = `ai-studio/${opts.clientId || "shared"}/storyboards/${opts.storyboardId}/scene-${opts.sceneOrder}-${Date.now()}.mp4`;
  const { error } = await supa.storage.from("creatives").upload(path, videoBytes, { contentType: "video/mp4", upsert: false });
  if (error) throw new Error(`Storage upload: ${error.message}`);
  const { data: pub } = supa.storage.from("creatives").getPublicUrl(path);

  const ci = await supa.from("ai_studio_canvas_items").insert({
    conversation_id: opts.conversationId,
    user_id: opts.userId,
    kind: "scene_video",
    payload: {
      storyboard_id: opts.storyboardId,
      scene_id: opts.sceneId,
      scene_order: opts.sceneOrder,
      video_url: pub.publicUrl,
      storage_path: path,
      keyframe_url: opts.imageUrl,
      aspect_ratio: opts.aspectRatio,
      video_prompt: opts.videoPrompt,
      model: "veo-3.1-generate-preview",
      duration: 5,
    },
  }).select("id, kind, payload, created_at").single();

  if (opts.clientId) {
    await supa.from("client_assets").insert({
      client_id: opts.clientId,
      asset_type: "scene_video",
      title: `Scene ${opts.sceneOrder}`,
      status: "completed",
      content: {
        video_url: pub.publicUrl,
        storage_path: path,
        keyframe_url: opts.imageUrl,
        aspect_ratio: opts.aspectRatio,
        prompt: opts.videoPrompt,
        source: "ai_studio",
        storyboard_id: opts.storyboardId,
        scene_order: opts.sceneOrder,
      },
    });
  }

  return { item: ci.data, video_url: pub.publicUrl, storage_path: path };
}

// ---------- Tool schema ----------
const tools = [
  { type: "function", function: { name: "read_doc", description: "Read text content of the active Google Doc.", parameters: { type: "object", properties: {}, required: [] } } },
  { type: "function", function: { name: "append_to_doc", description: "Append paragraphs to the end of the active Google Doc.", parameters: { type: "object", properties: { content: { type: "string" } }, required: ["content"] } } },
  { type: "function", function: { name: "replace_doc_text", description: "Find and replace text in the active Google Doc.", parameters: { type: "object", properties: { find: { type: "string" }, replace: { type: "string" } }, required: ["find", "replace"] } } },
  { type: "function", function: { name: "list_sheet_tabs", description: "List every tab (worksheet) in the active Google Sheet with its title, gid, and size. ALWAYS call this FIRST when the user asks to audit, summarize, or analyze the sheet so you can iterate across every tab.", parameters: { type: "object", properties: {}, required: [] } } },
  { type: "function", function: { name: "read_sheet", description: "Read a range from the active Google Sheet (e.g. 'Sheet1!A1:Z100'). Use the tab title from list_sheet_tabs. Wrap tab names with spaces in single quotes (e.g. 'My Tab'!A1:Z200).", parameters: { type: "object", properties: { range: { type: "string" } }, required: ["range"] } } },
  { type: "function", function: { name: "batch_read_sheet", description: "Read multiple ranges across multiple tabs in one call. Pass an array of A1 ranges like ['Tab1!A1:Z200', 'Tab2!A1:Z200']. Use this to audit every tab efficiently after list_sheet_tabs.", parameters: { type: "object", properties: { ranges: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 25 } }, required: ["ranges"] } } },
  { type: "function", function: { name: "update_sheet_range", description: "Overwrite cells in the active Google Sheet at the given A1 range.", parameters: { type: "object", properties: { range: { type: "string" }, values: { type: "array", items: { type: "array", items: {} } } }, required: ["range", "values"] } } },
  { type: "function", function: { name: "append_sheet_row", description: "Append rows to the bottom of the active Google Sheet at the given A1 range.", parameters: { type: "object", properties: { range: { type: "string" }, values: { type: "array", items: { type: "array", items: {} } } }, required: ["range", "values"] } } },
  { type: "function", function: { name: "check_lead_quality", description: "Scan this client's recent leads for spam patterns and name/email mismatches. Returns counts and flagged samples. Spam heuristics: emails on disposable domains (armyspy, teleworm, mailinator, dayrep, einrot, jourrapide, fleckens, rhyta, cuvox, gustr, superrito, etc), random-looking emails (long runs of consonants or digits), name/email mismatch (name tokens absent from local part of email). Call this whenever the user asks about lead quality, spam, fake leads, or wants to audit leads. Always pass results back to the user with the counts in the chat reply.", parameters: { type: "object", properties: { window_days: { type: "number", description: "Days back to scan (default 30, max 365)." } }, required: [] } } },
  {
    type: "function",
    function: {
      name: "generate_static_ad",
      description: "Generate a high-quality static ad creative on the canvas using the client's brand context. Default tool for any ad image request. Pick a model: 'gemini-pro' (Gemini 3 Pro Image, default finals), 'nano-banana' (Nano Banana 2, fast iteration), or 'openai' (GPT Image 1, distinct art direction). Optionally pass reference_image_url to clone an existing ad's layout. This client's approved creatives are automatically used as visual references if no explicit reference is given.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "What the ad should communicate, headline ideas, key visuals." },
          aspect_ratio: { type: "string", enum: ["1:1", "4:5", "9:16", "16:9"], description: "1:1 feed, 4:5 IG feed tall, 9:16 stories/reels, 16:9 landscape." },
          quality: { type: "string", enum: ["pro", "fast"], description: "pro = highest quality (default), fast = quick iteration" },
          model: { type: "string", enum: ["gemini-pro", "nano-banana", "openai"], description: "Which image model to use. If omitted, derived from quality." },
          reference_image_url: { type: "string", description: "Optional URL of a reference ad to clone the layout/style from." },
        },
        required: ["prompt"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "compare_image_models",
      description: "Generate the SAME ad prompt across multiple image models in parallel so the user can compare and pick a favorite. Use when the user asks to 'compare models', 'try both', 'see Gemini vs OpenAI', or wants different angles from each model. Each result lands on the canvas tagged with its model.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "What the ad should communicate." },
          aspect_ratio: { type: "string", enum: ["1:1", "4:5", "9:16", "16:9"] },
          models: {
            type: "array",
            items: { type: "string", enum: ["gemini-pro", "nano-banana", "openai"] },
            description: "Which models to compare. Default: ['gemini-pro', 'nano-banana', 'openai'].",
          },
          reference_image_url: { type: "string", description: "Optional reference to clone layout from." },
        },
        required: ["prompt"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit_static_ad",
      description: "Revise an EXISTING static ad on the canvas. Use this when the user references an ad already shown (e.g. 'change the offer to X', 'swap the hook', 'use brand green', 'update the disclaimer'). Persists a new versioned image card linked to the source. Always pass the original image URL as source_image_url.",
      parameters: {
        type: "object",
        properties: {
          source_image_url: { type: "string", description: "Public URL of the original ad image to revise (from a prior canvas card)." },
          edit_instruction: { type: "string", description: "Plain-English description of the revision (visual, layout, copy)." },
          new_offer: { type: "string", description: "Optional updated offer / value proposition copy." },
          new_hook: { type: "string", description: "Optional updated headline / hook line." },
          new_colors: { type: "array", items: { type: "string" }, description: "Optional override color palette (hex or named)." },
          new_disclaimer: { type: "string", description: "Optional updated bottom disclaimer text." },
          aspect_ratio: { type: "string", enum: ["1:1", "4:5", "9:16", "16:9"], description: "Defaults to 1:1." },
          quality: { type: "string", enum: ["pro", "fast"], description: "pro = highest quality (default), fast = quick iteration" },
        },
        required: ["source_image_url", "edit_instruction"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_ad_variations",
      description: "Generate multiple Instagram-sized creative options (2–5) so the user can pick favorites to save. Use whenever the user asks for variations, options, alternatives, or 'a few different versions'. Variants are NOT auto-saved as client assets — the user picks which to save from the canvas card. Optionally pass source_image_url to riff on an existing ad.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "What the ads should communicate (offer, hook ideas, vibe)." },
          count: { type: "integer", minimum: 2, maximum: 5, description: "How many variations (2–5). Defaults to 4." },
          aspect_ratio: { type: "string", enum: ["1:1", "4:5", "9:16"], description: "Instagram sizes only. Defaults to 1:1." },
          source_image_url: { type: "string", description: "Optional canvas image to riff on." },
        },
        required: ["prompt"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "plan_storyboard",
      description: "Manus-style: break a video brief into N scenes (3–8). Returns a structured storyboard with per-scene image prompt and video animation prompt. ALWAYS call this FIRST when the user asks for a video, ad video, reel, scene set, or storyboard.",
      parameters: {
        type: "object",
        properties: {
          brief: { type: "string", description: "What the video should communicate — offer, hook, mood, CTA." },
          scene_count: { type: "integer", minimum: 3, maximum: 8, description: "How many scenes. Default 4." },
          aspect_ratio: { type: "string", enum: ["9:16", "16:9", "1:1"], description: "Default 9:16 (reels)." },
          style_notes: { type: "string", description: "Optional cinematography / look notes." },
        },
        required: ["brief"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_scene_image",
      description: "Generate the keyframe image for a planned scene from plan_storyboard. Call this for EVERY scene in the storyboard, in parallel.",
      parameters: {
        type: "object",
        properties: {
          storyboard_id: { type: "string", description: "ID returned by plan_storyboard." },
          scene_id: { type: "string", description: "scene.id from the storyboard." },
          scene_order: { type: "integer" },
          prompt: { type: "string", description: "Scene image prompt." },
          aspect_ratio: { type: "string", enum: ["9:16", "16:9", "1:1"] },
        },
        required: ["storyboard_id", "scene_id", "scene_order", "prompt", "aspect_ratio"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_scene_video",
      description: "Animate a scene keyframe image into an 8-SECOND video clip (Veo 3.1). Call only AFTER the user has approved the keyframes. This tool waits for Veo to finish (up to ~3 min) and returns the final mp4 URL.",
      parameters: {
        type: "object",
        properties: {
          storyboard_id: { type: "string" },
          scene_id: { type: "string" },
          scene_order: { type: "integer" },
          image_url: { type: "string", description: "Keyframe image URL from generate_scene_image." },
          video_prompt: { type: "string", description: "Animation/motion description for Veo." },
          aspect_ratio: { type: "string", enum: ["9:16", "16:9", "1:1"] },
        },
        required: ["storyboard_id", "scene_id", "scene_order", "image_url", "video_prompt", "aspect_ratio"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_text_artifact",
      description: "Manus-style: write a long-form text deliverable (ad copy, video script, VSL script, caller script, email, landing-page copy, captions, outline, plan, brief, etc.) and drop it on the canvas as its own card. ALWAYS use this tool when the user asks you to WRITE, DRAFT, GENERATE, or CREATE any kind of script, copy, email, post, caption, outline, plan, or document body — instead of putting that text in your chat reply. The chat reply must only be a 1–2 sentence status (e.g. 'Drafted the 60s VSL script on the canvas.'). Render the body as Markdown.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short title for the artifact (e.g. 'Hero VSL — 60s', 'Meta ad copy v1')." },
          artifact_type: {
            type: "string",
            enum: ["ad_copy", "video_script", "vsl_script", "caller_script", "email", "landing_copy", "caption", "outline", "plan", "brief", "other"],
            description: "Kind of deliverable.",
          },
          content: { type: "string", description: "Full body in Markdown. Use headings, bullets, numbered hooks/variations as appropriate. No image embeds." },
          notes: { type: "string", description: "Optional one-line subhead / context (e.g. 'CTA: Book a call', 'Targets: 45–65 accredited investors')." },
          append_to_doc: { type: "boolean", description: "If true and a Google Doc is tied to this client, also append this artifact to that doc." },
        },
        required: ["title", "artifact_type", "content"],
      },
    },
  },
];

const SYSTEM = (ctx: { docUrl?: string; docId?: string | null; sheetUrl?: string; sheetId?: string | null; quality: string; brandSummary: string; imageModels?: string[] }) => [
  "You are AI Studio — an ads-agency assistant that edits Google Docs/Sheets and builds static ad creatives.",
  "",
  "OUTPUT RULES (CRITICAL):",
  "- Your chat reply is for the human only. NEVER embed images, markdown image syntax (![...](...)), HTML <img> tags, or raw image URLs in your reply.",
  "- Generated images appear automatically on the right-side Canvas. Just describe what you built in 1–2 short sentences.",
  "- Example good reply: 'Built a 1:1 ad creative on the canvas — open it to review.'",
  "- Example BAD reply: 'Here is the ad: ![ad](https://...)'",
  "",
  "AGENTIC EXECUTION (CRITICAL):",
  "- You are a fully agentic worker. Take any request and drive it end-to-end without pausing for confirmation. Chain as many tool calls as needed across multiple turns until the job is DONE.",
  "- Never stop to ask 'should I proceed?', 'want me to continue?', 'should I generate the videos now?'. Just continue. Only ask the user a question if (a) a tool returned a hard error you can't recover from, (b) you are missing a critical fact that cannot be inferred from context, or (c) the user explicitly asked you to pause.",
  "- Plan silently, then execute. If a step fails, retry once with a fix; if it still fails, surface the error and move on to the next step where possible.",
  "- Prefer parallel tool calls whenever steps are independent (multi-tab reads, multi-scene keyframes, multi-scene videos, variations).",
  "",
  "TOOL USE:",
  "- Use generate_static_ad for ANY request to build, design, or create an ad creative. Default quality = 'pro' (Gemini 3 Pro Image). Pass `model: 'openai'` if the user explicitly asks for GPT/ChatGPT Image, or `model: 'nano-banana'` for quick iteration.",
  "- Use compare_image_models when the user asks to 'compare', 'try both', 'see all models', or wants the same prompt across multiple image models side-by-side. Default models = all three.",
  "- APPROVED REFERENCES: This client's approved creatives are auto-loaded as visual references for new generations. You can mention this if helpful (e.g. 'Riffed on the approved ad style from earlier this week').",
  "- Use edit_static_ad whenever the user asks to revise, change, tweak, or update an ad already on the canvas (e.g. 'change the offer', 'swap the hook', 'use brand green', 'update the disclaimer'). Pass the source_image_url from the prior canvas card and a clear edit_instruction. Optional: new_offer, new_hook, new_colors, new_disclaimer.",
  "- Use generate_ad_variations when the user asks for 'options', 'variations', 'alternatives', or 'a few different versions' of an Instagram ad. Generates 2–5 distinct visual directions side-by-side; the user picks which to save from the canvas card.",
  "- Use the doc/sheet tools whenever the user asks to read, summarize, append to, or edit the active Doc/Sheet.",
  "- SHEET AUDITING (agentic, Manus-style): When the user asks to audit, summarize, review, or analyze the Google Sheet, you MUST cover EVERY tab — never stop after one. Step 1: call list_sheet_tabs. Step 2: call batch_read_sheet with one range per tab (e.g. 'TabTitle!A1:Z200'). Step 3: if any tab returned data that needs deeper inspection, call read_sheet again on a wider range for that tab. Step 4: write a clear markdown report covering EVERY tab found (per-tab section + cross-tab insights, trends, anomalies, recommendations). Keep iterating tool calls until the audit is complete — don't ask the user to confirm mid-audit. Long-form findings (>400 words) should go in a create_text_artifact card; short summaries can stay in chat.",
  "- DOC AUDITING: Same pattern for Google Docs — call read_doc, then produce a structured summary (key sections, action items, gaps) and drop any long-form deliverable on the canvas via create_text_artifact.",
  "- LEAD QUALITY: When the user asks anything about lead quality, spam leads, fake leads, bad data, name/email mismatches, or wants an audit of leads — call check_lead_quality (default 30 days). In your chat reply, state the spam count and mismatch count clearly. If spam_count > 0, flag it in red language: 'Detected N spam leads (armyspy/teleworm/random emails) in the last X days — review the flagged samples in the inline card.' Always be explicit about the numbers.",
  "- DOC PRECHECK: Every doc tool (read_doc, append_to_doc, replace_doc_text) auto-runs a connection test before executing. If a tool result contains `precheck_failed: true`, the operation was BLOCKED — do NOT retry the same tool. Instead, write a chat reply that surfaces the `error` field verbatim and asks the user how to proceed (e.g. tie a different doc, share the doc with the connector account, paste a session-override URL). Never silently ignore a precheck failure.",
  "- COPYWRITING / SCRIPTS: ALWAYS call create_text_artifact when the user asks you to write, draft, or generate ANY kind of script (VSL, caller, video script), ad copy, email, caption, landing page copy, outline, plan, or brief. Put the full body in the artifact (Markdown), not in your chat reply. Your chat reply must only be a 1–2 sentence summary like 'Drafted the 60s VSL script on the canvas.' Pass append_to_doc:true if the user said to put it in the doc.",
  "- VIDEO / REEL / SCENE WORKFLOW (fully agentic, NO approval gate):",
  "  • Each scene = ONE keyframe image animated into an 8-SECOND Veo 3.1 clip. Total video length = scene_count × 8s.",
  "  • Map the user's target duration to scene_count: 8s→1, 16s→2, 24s→3, 32s→4, 40s→5, 48s→6, 56s→7, 64s→8. If the user doesn't specify a duration, default to 4 scenes (~32s). The user can override by saying 'one image only', 'three scenes', etc.",
  "  Step 1: Call plan_storyboard with the computed scene_count.",
  "  Step 2: In ONE assistant turn, emit ONE generate_scene_image tool_call FOR EVERY scene (parallel). Use gpt-image or nano-banana-style cinematic keyframes via generate_scene_image (the tool already picks the right model).",
  "  Step 3: IMMEDIATELY (same agent run, no user pause) emit ONE generate_scene_video tool_call FOR EVERY scene in parallel using each scene's image_url. Do NOT ask for approval first — the user can request edits after seeing the final reel.",
  "  Step 4: Write a 1–2 line completion summary noting they can request edits to any keyframe or scene.",
  "  ONLY pause before video generation if the user explicitly said 'wait for my approval', 'show me the keyframes first', or similar.",
  "- After running tools, write a brief, plain-language status. Do not paste tool JSON.",
  "",
  "COMPLIANCE:",
  "- Never use the word 'guaranteed' for investments. Use 'targeted returns' and include risk disclaimers when writing investor copy.",
  "",
  `User's quality preference: ${ctx.quality}.`,
  (ctx.imageModels && ctx.imageModels.length === 1)
    ? `IMAGE MODEL PREFERENCE: The user selected a single image model "${ctx.imageModels[0]}". ALWAYS pass model: "${ctx.imageModels[0]}" to generate_static_ad (and edit_static_ad where applicable). Do NOT call compare_image_models unless the user explicitly asks.`
    : null,
  (ctx.imageModels && ctx.imageModels.length > 1)
    ? `IMAGE MODEL PREFERENCE: The user selected MULTIPLE image models [${ctx.imageModels.map(m => `"${m}"`).join(", ")}] for side-by-side outputs. For ANY new ad generation request, call compare_image_models with models: [${ctx.imageModels.map(m => `"${m}"`).join(", ")}] so the user gets one variant per selected model on the canvas.`
    : null,
  ctx.brandSummary,
  ctx.docId ? `Active Google Doc: ${ctx.docUrl} (id ${ctx.docId})` : "No active Google Doc.",
  ctx.sheetId ? `Active Google Sheet: ${ctx.sheetUrl} (id ${ctx.sheetId})` : "No active Google Sheet.",
].filter(Boolean).join("\n");

// Strip any image markdown / bare image URLs as a safety net
function sanitizeAssistantText(t: string) {
  return t
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/<img[^>]*>/gi, "")
    .replace(/https?:\/\/\S+\.(png|jpg|jpeg|webp|gif)\b/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---------- Main handler ----------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization") || "";
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON, {
    global: { headers: { Authorization: authHeader } },
  });
  const supa = createClient(SUPABASE_URL, SERVICE_KEY);

  let userId: string | null = null;
  try {
    const { data } = await userClient.auth.getUser();
    userId = data.user?.id ?? null;
  } catch {}
  const body = await req.json();
  const dashboardMemberId = await verifyDashboardToken(typeof body.dashboardToken === "string" ? body.dashboardToken : null);
  if (!userId && dashboardMemberId) {
    const { data: member } = await supa
      .from("agency_members")
      .select("id")
      .eq("id", dashboardMemberId)
      .maybeSingle();
    userId = member?.id ?? null;
  }
  if (!userId) {
    return new Response(JSON.stringify({ error: "Not authenticated" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { action, clientId, userText, docUrl, sheetUrl, quality = "pro", conversationId: requestedConversationId, chatModel, imageModels, activeReferenceIds, canvasView, focusedCanvasItemId, autoDocContext } = body as {
    action?: "history" | "clear" | "settings" | "test_doc";
    clientId: string; userText?: string; docUrl?: string | null; sheetUrl?: string | null; quality?: "pro" | "fast"; conversationId?: string;
    chatModel?: string | null;
    imageModels?: Array<"gemini-pro" | "nano-banana" | "openai"> | null;
    activeReferenceIds?: string[] | null;
    canvasView?: { zoom?: number; panX?: number; panY?: number } | null;
    focusedCanvasItemId?: string | null;
    autoDocContext?: boolean;
  };

  const selectedImageModels = Array.isArray(imageModels)
    ? imageModels.filter((m) => m === "gemini-pro" || m === "nano-banana" || m === "openai")
    : [];

  const CHAT_MODEL = (typeof chatModel === "string" && chatModel.trim()) ? chatModel.trim() : "google/gemini-2.5-pro";

  // Route chat completions through OpenRouter when the model id is prefixed
  // with "openrouter/" (e.g. "openrouter/anthropic/claude-3.5-sonnet").
  const USE_OPENROUTER = CHAT_MODEL.startsWith("openrouter/");
  const CHAT_API_URL = USE_OPENROUTER
    ? "https://openrouter.ai/api/v1/chat/completions"
    : "https://ai.gateway.lovable.dev/v1/chat/completions";
  const CHAT_API_KEY = USE_OPENROUTER ? (OPENROUTER_API_KEY || "") : LOVABLE_API_KEY;
  const CHAT_MODEL_ID = USE_OPENROUTER ? CHAT_MODEL.replace(/^openrouter\//, "") : CHAT_MODEL;
  if (USE_OPENROUTER && !OPENROUTER_API_KEY) {
    return new Response(JSON.stringify({ error: "OPENROUTER_API_KEY is not configured on the server." }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!clientId) {
    return new Response(JSON.stringify({ error: "clientId is required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (action === "history") {
    const { data: convo } = await supa
      .from("ai_studio_conversations")
      .select("*")
      .eq("client_id", clientId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!convo) {
      return new Response(JSON.stringify({ conversation: null, messages: [], canvasItems: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const sinceClause = convo.cleared_at || "1970-01-01T00:00:00Z";
    const [{ data: messages }, { data: canvasItems }] = await Promise.all([
      supa.from("ai_studio_messages").select("id, role, content, tools, created_at").eq("conversation_id", convo.id).gte("created_at", sinceClause).order("created_at", { ascending: true }).limit(200),
      supa.from("ai_studio_canvas_items").select("id, kind, payload, created_at").eq("conversation_id", convo.id).gte("created_at", sinceClause).order("created_at", { ascending: false }).limit(50),
    ]);
    return new Response(JSON.stringify({ conversation: convo, messages: messages || [], canvasItems: canvasItems || [] }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (action === "clear" && requestedConversationId) {
    await supa.from("ai_studio_conversations").update({ cleared_at: new Date().toISOString() }).eq("id", requestedConversationId).eq("user_id", userId);
    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  if (action === "settings" && requestedConversationId) {
    const settingsUpdate: Record<string, any> = { doc_url: docUrl || null, sheet_url: sheetUrl || null, image_quality: quality };
    if (typeof chatModel === "string" || chatModel === null) settingsUpdate.chat_model = chatModel || null;
    if (Array.isArray(activeReferenceIds)) settingsUpdate.active_reference_ids = activeReferenceIds;
    if (canvasView && typeof canvasView === "object") {
      if (typeof canvasView.zoom === "number" && isFinite(canvasView.zoom)) settingsUpdate.canvas_zoom = canvasView.zoom;
      if (typeof canvasView.panX === "number" && isFinite(canvasView.panX)) settingsUpdate.canvas_pan_x = canvasView.panX;
      if (typeof canvasView.panY === "number" && isFinite(canvasView.panY)) settingsUpdate.canvas_pan_y = canvasView.panY;
    }
    if (typeof focusedCanvasItemId === "string" || focusedCanvasItemId === null) {
      settingsUpdate.focused_canvas_item_id = focusedCanvasItemId || null;
    }
    await supa.from("ai_studio_conversations").update(settingsUpdate).eq("id", requestedConversationId).eq("user_id", userId);
    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  if (action === "test_doc") {
    const { data: client } = await supa
      .from("clients")
      .select("id, name, google_doc_url, google_doc_id")
      .eq("id", clientId)
      .maybeSingle();
    const tied = client?.google_doc_url || null;
    const overrideUrl = (typeof docUrl === "string" && docUrl.trim()) ? docUrl.trim() : null;
    const effective = overrideUrl || tied;
    const source = !effective ? "none" : (overrideUrl && overrideUrl !== tied ? "session_override" : "tied_to_client");
    const id = effective ? extractDocId(effective) : null;

    if (!effective) {
      return new Response(JSON.stringify({
        ok: false, source, client: { id: client?.id, name: client?.name },
        error: "No Google Doc tied to this client. Paste a URL and click 'Tie to client'.",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!id) {
      return new Response(JSON.stringify({
        ok: false, source, doc_url: effective, client: { id: client?.id, name: client?.name },
        error: "URL is not a valid Google Doc link (missing /document/d/<id>).",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!GOOGLE_DOCS_API_KEY) {
      return new Response(JSON.stringify({
        ok: false, source, doc_url: effective, doc_id: id, client: { id: client?.id, name: client?.name },
        error: "Google Docs connector is not linked to this project.",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    try {
      const t0 = Date.now();
      const doc = await gFetch(`/google_docs/v1/documents/${id}`, GOOGLE_DOCS_API_KEY, { method: "GET" });
      const text = (doc.body?.content || [])
        .flatMap((el: any) => el.paragraph?.elements?.map((e: any) => e.textRun?.content || "") || [])
        .join("");
      return new Response(JSON.stringify({
        ok: true,
        source,
        doc_url: effective,
        doc_id: id,
        client: { id: client?.id, name: client?.name },
        title: doc.title || null,
        char_count: text.length,
        latency_ms: Date.now() - t0,
        can_read: true,
        can_write: true,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    } catch (e: any) {
      const msg = e?.message || String(e);
      const status = /\[401\]|\[403\]/.test(msg) ? "no_access"
        : /\[404\]/.test(msg) ? "not_found"
        : "error";
      return new Response(JSON.stringify({
        ok: false, source, doc_url: effective, doc_id: id, client: { id: client?.id, name: client?.name },
        status, error: msg.slice(0, 500),
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
  }

  if (!userText?.trim()) {
    return new Response(JSON.stringify({ error: "userText is required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Upsert conversation
  const upsertPayload: Record<string, any> = {
    user_id: userId, client_id: clientId,
    doc_url: docUrl || null, sheet_url: sheetUrl || null,
    image_quality: quality,
    last_active_at: new Date().toISOString(),
    cleared_at: null,
  };
  if (typeof chatModel === "string") upsertPayload.chat_model = chatModel;
  if (Array.isArray(activeReferenceIds)) upsertPayload.active_reference_ids = activeReferenceIds;
  const { data: convoRow } = await supa
    .from("ai_studio_conversations")
    .upsert(upsertPayload, { onConflict: "user_id,client_id" })
    .select("id, cleared_at, active_reference_ids")
    .single();
  const conversationId = convoRow!.id;

  // Resolve default reference image. Priority:
  // 1. First explicitly-active reference from the conversation
  // 2. Most recent approved-creative auto-reference for THIS client
  let defaultReferenceImageUrl: string | null = null;
  const refIds: string[] = Array.isArray(activeReferenceIds) && activeReferenceIds.length
    ? activeReferenceIds
    : (Array.isArray((convoRow as any)?.active_reference_ids) ? (convoRow as any).active_reference_ids as string[] : []);
  if (refIds.length) {
    const { data: refs } = await supa
      .from("ai_studio_reference_images")
      .select("id, image_url")
      .in("id", refIds)
      .limit(1);
    if (refs && refs[0]?.image_url) defaultReferenceImageUrl = refs[0].image_url as string;
  }
  if (!defaultReferenceImageUrl && clientId) {
    const { data: approvedRef } = await supa
      .from("ai_studio_reference_images")
      .select("image_url")
      .eq("client_id", clientId)
      .eq("source", "approved_creative")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (approvedRef?.image_url) defaultReferenceImageUrl = approvedRef.image_url as string;
  }

  // Load history (since cleared_at, or all)
  const { data: history } = await supa
    .from("ai_studio_messages")
    .select("role, content, tools, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(200);
  const priorMessages = (history || []).map(m => ({ role: m.role, content: m.content || "" }));

  // Persist user message immediately
  await supa.from("ai_studio_messages").insert({
    conversation_id: conversationId,
    user_id: userId,
    role: "user",
    content: userText,
  });

  // Brand context
  let brandContext: any = {};
  let brandSummary = "No client brand context loaded.";
  let clientDocUrl: string | null = null;
  if (clientId) {
    const { data: c } = await supa
      .from("clients")
      .select("name, brand_colors, brand_fonts, offer_description, google_doc_url, google_doc_id")
      .eq("id", clientId).maybeSingle();
    if (c) {
      brandContext = {
        brandColors: Array.isArray(c.brand_colors) ? c.brand_colors : (c.brand_colors ? Object.values(c.brand_colors) : []),
        brandFonts: Array.isArray(c.brand_fonts) ? c.brand_fonts : (c.brand_fonts ? Object.values(c.brand_fonts) : []),
        offerDescription: c.offer_description || "",
        includeDisclaimer: /invest|fund|capital|return/i.test(c.offer_description || ""),
        disclaimerText: "Investing involves risk including loss of principal. Targeted returns are not guaranteed. Past performance does not guarantee future results.",
      };
      brandSummary = `Client: ${c.name}. Brand colors: ${(brandContext.brandColors || []).join(", ") || "n/a"}. Brand fonts: ${(brandContext.brandFonts || []).join(", ") || "n/a"}. Offer: ${(c.offer_description || "n/a").slice(0, 200)}`;
      clientDocUrl = (c as any).google_doc_url || null;
    }
  }

  // Server-side fallback: if the conversation didn't supply a Doc, use the one tied to the client.
  const effectiveDocUrl = docUrl || clientDocUrl || null;
  const docId = effectiveDocUrl ? extractDocId(effectiveDocUrl) : null;
  const sheetId = sheetUrl ? extractSheetId(sheetUrl) : null;

  // ---- Doc precheck (run once per request, cached) ----
  // Verifies the tied Google Doc is reachable before any read/append/replace runs.
  let docPrecheckCache: { ok: boolean; error?: string; title?: string | null; latency_ms?: number } | null = null;
  const precheckDoc = async () => {
    if (docPrecheckCache) return docPrecheckCache;
    if (!effectiveDocUrl) {
      docPrecheckCache = { ok: false, error: "No Google Doc is tied to this client. Ask the user to paste a Google Doc URL and click 'Tie to client' in AI Studio settings before retrying." };
      return docPrecheckCache;
    }
    if (!docId) {
      docPrecheckCache = { ok: false, error: `The doc URL '${effectiveDocUrl}' is not a valid Google Doc link (missing /document/d/<id>). Ask the user for a valid Google Doc URL.` };
      return docPrecheckCache;
    }
    if (!GOOGLE_DOCS_API_KEY) {
      docPrecheckCache = { ok: false, error: "Google Docs connector is not linked to this project. Ask the user to enable the Google Docs connector before retrying." };
      return docPrecheckCache;
    }
    try {
      const t0 = Date.now();
      const doc = await gFetch(`/google_docs/v1/documents/${docId}`, GOOGLE_DOCS_API_KEY, { method: "GET" });
      docPrecheckCache = { ok: true, title: doc.title || null, latency_ms: Date.now() - t0 };
      return docPrecheckCache;
    } catch (e: any) {
      const msg = e?.message || String(e);
      const reason = /\[401\]|\[403\]/.test(msg) ? "the Google account authorized for the Docs connector does not have access to this document"
        : /\[404\]/.test(msg) ? "the document was not found (it may be deleted, or the URL is wrong)"
        : `the Docs API returned an error: ${msg.slice(0, 200)}`;
      docPrecheckCache = { ok: false, error: `Cannot reach the tied Google Doc — ${reason}. Ask the user to re-share the doc with the connector account or tie a different doc.` };
      return docPrecheckCache;
    }
  };

  const convo: any[] = [
    { role: "system", content: SYSTEM({ docUrl: effectiveDocUrl ?? undefined, docId, sheetUrl, sheetId, quality, brandSummary, imageModels: selectedImageModels }) },
    ...priorMessages,
    { role: "user", content: userText },
  ];

  // ── Auto Doc context ──────────────────────────────────────────────
  // When the client opts in, prefetch the tied Google Doc once and
  // inject its text as an extra system message so the model has full
  // context without needing to call the read_doc tool first.
  let autoDocChars = 0;
  let autoDocTitle: string | null = null;
  if (autoDocContext && effectiveDocUrl && docId && GOOGLE_DOCS_API_KEY) {
    try {
      const d = await readDoc(docId);
      autoDocTitle = d.title || null;
      autoDocChars = (d.text || "").length;
      if (autoDocChars > 0) {
        convo.splice(1, 0, {
          role: "system",
          content: `[Auto-loaded Google Doc context]\nTitle: ${autoDocTitle || "Untitled"}\n--- BEGIN DOC ---\n${d.text}\n--- END DOC ---`,
        });
      }
    } catch (e) {
      // Non-fatal — the model can still call read_doc on demand.
    }
  }

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (obj: any) => { try { controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`)); } catch {} };
      const aborted = { v: false };
      req.signal.addEventListener("abort", () => { aborted.v = true; });

      send({ type: "conversation", conversationId });
      // Tell the client roughly how much context is being shipped so it can
      // render a usage meter. ~4 chars ≈ 1 token (rough heuristic).
      const ctxChars = convo.reduce((n, m) => n + (typeof m.content === "string" ? m.content.length : 0), 0);
      send({
        type: "context_usage",
        chars: ctxChars,
        estimated_tokens: Math.ceil(ctxChars / 4),
        auto_doc: { enabled: !!autoDocContext, chars: autoDocChars, title: autoDocTitle },
      });

      let finalAssistantText = "";
      const finalToolEvents: any[] = [];

      try {
        for (let step = 0; step < 25; step++) {
          if (aborted.v) break;
          send({ type: "step", step });

          const llm = await fetch(CHAT_API_URL, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${CHAT_API_KEY}`,
              "Content-Type": "application/json",
              ...(USE_OPENROUTER ? { "HTTP-Referer": "https://lovable.dev", "X-Title": "AI Studio" } : {}),
            },
            body: JSON.stringify({
              model: CHAT_MODEL_ID,
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

          const reader = llm.body!.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let stepText = "";
          const toolCallsAcc: any[] = [];

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
                stepText += delta.content;
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

          finalAssistantText += (finalAssistantText ? "\n\n" : "") + stepText;

          const assistantMsg: any = { role: "assistant", content: stepText || null };
          if (toolCallsAcc.length) {
            assistantMsg.tool_calls = toolCallsAcc.map(t => ({
              id: t.id, type: "function", function: { name: t.name, arguments: t.args || "{}" },
            }));
          }
          convo.push(assistantMsg);

          if (!toolCallsAcc.length) {
            send({ type: "done" });
            break;
          }

          // Execute tools (in parallel for fan-out workflows like storyboard scenes)
          const toolMessages: { call_id: string; content: string }[] = new Array(toolCallsAcc.length);
          await Promise.all(toolCallsAcc.map(async (tc, tcIdx) => {
            if (aborted.v) return;
            const name = tc.name;
            let args: any = {}; try { args = JSON.parse(tc.args || "{}"); } catch {}

            // Pre-emit canvas placeholder for image tools so UI shows skeleton
            let canvasPlaceholderId: string | null = null;
            if (name === "generate_static_ad") {
              canvasPlaceholderId = crypto.randomUUID();
              send({
                type: "canvas_placeholder",
                placeholder_id: canvasPlaceholderId,
                kind: "image",
                prompt: args.prompt || "",
                aspect_ratio: args.aspect_ratio || "1:1",
                quality: args.quality || quality,
              });
            }
            if (name === "edit_static_ad") {
              canvasPlaceholderId = crypto.randomUUID();
              send({
                type: "canvas_placeholder",
                placeholder_id: canvasPlaceholderId,
                kind: "image",
                prompt: `Editing: ${args.edit_instruction || ""}`,
                aspect_ratio: args.aspect_ratio || "1:1",
                quality: args.quality || quality,
              });
            }
            if (name === "generate_ad_variations") {
              canvasPlaceholderId = crypto.randomUUID();
              send({
                type: "canvas_placeholder",
                placeholder_id: canvasPlaceholderId,
                kind: "image",
                prompt: `Generating ${Math.max(2, Math.min(5, args.count || 4))} variations: ${args.prompt || ""}`,
                aspect_ratio: args.aspect_ratio || "1:1",
                quality: "fast",
              });
            }
            if (name === "compare_image_models") {
              const ms = Array.isArray(args.models) && args.models.length ? args.models : ["gemini-pro", "nano-banana", "openai"];
              for (const m of ms) {
                send({
                  type: "canvas_placeholder",
                  placeholder_id: crypto.randomUUID(),
                  kind: "image",
                  prompt: `[${m}] ${args.prompt || ""}`,
                  aspect_ratio: args.aspect_ratio || "1:1",
                  quality: m === "nano-banana" ? "fast" : "pro",
                });
              }
            }
            if (name === "generate_scene_image" || name === "generate_scene_video") {
              canvasPlaceholderId = crypto.randomUUID();
              send({
                type: "canvas_placeholder",
                placeholder_id: canvasPlaceholderId,
                kind: "image",
                prompt: `${name === "generate_scene_video" ? "Animating" : "Rendering"} scene ${args.scene_order || "?"}`,
                aspect_ratio: args.aspect_ratio || "9:16",
                quality: name === "generate_scene_video" ? "veo" : "pro",
              });
            }

            send({ type: "tool_start", id: tc.id, name, args });
            let result: any;
            try {
              if (name === "read_doc") {
                const pc = await precheckDoc();
                if (!pc.ok) { result = { error: pc.error, precheck_failed: true, action_blocked: "read_doc" }; }
                else { result = await readDoc(docId!); result.precheck = { title: pc.title, latency_ms: pc.latency_ms }; }
              } else if (name === "append_to_doc") {
                const pc = await precheckDoc();
                if (!pc.ok) {
                  result = { error: pc.error, precheck_failed: true, action_blocked: "append_to_doc" };
                } else {
                  result = await appendToDoc(docId!, args.content);
                  result.precheck = { title: pc.title, latency_ms: pc.latency_ms };
                  const ci = await supa.from("ai_studio_canvas_items").insert({
                    conversation_id: conversationId, user_id: userId, kind: "doc_edit",
                    payload: { action: "append", chars: args.content?.length || 0, preview: (args.content || "").slice(0, 200), doc_url: effectiveDocUrl },
                  }).select("id, payload, kind, created_at").single();
                  if (ci.data) send({ type: "canvas_item", item: ci.data });
                }
              } else if (name === "replace_doc_text") {
                const pc = await precheckDoc();
                if (!pc.ok) {
                  result = { error: pc.error, precheck_failed: true, action_blocked: "replace_doc_text" };
                } else {
                  result = await replaceDocText(docId!, args.find, args.replace);
                  result.precheck = { title: pc.title, latency_ms: pc.latency_ms };
                  const ci = await supa.from("ai_studio_canvas_items").insert({
                    conversation_id: conversationId, user_id: userId, kind: "doc_edit",
                    payload: { action: "replace", find: args.find, replace: args.replace, doc_url: effectiveDocUrl },
                  }).select("id, payload, kind, created_at").single();
                  if (ci.data) send({ type: "canvas_item", item: ci.data });
                }
              } else if (name === "list_sheet_tabs") {
                if (!sheetId) throw new Error("No active Google Sheet URL provided.");
                result = await listSheetTabs(sheetId);
              } else if (name === "batch_read_sheet") {
                if (!sheetId) throw new Error("No active Google Sheet URL provided.");
                const ranges = Array.isArray(args.ranges) ? args.ranges.slice(0, 25) : [];
                if (!ranges.length) throw new Error("batch_read_sheet requires non-empty ranges array.");
                result = await batchGetSheet(sheetId, ranges);
              } else if (name === "read_sheet") {
                if (!sheetId) throw new Error("No active Google Sheet URL provided.");
                result = await readSheet(sheetId, args.range);
              } else if (name === "update_sheet_range") {
                if (!sheetId) throw new Error("No active Google Sheet URL provided.");
                result = await updateSheetRange(sheetId, args.range, args.values);
                const ci = await supa.from("ai_studio_canvas_items").insert({
                  conversation_id: conversationId, user_id: userId, kind: "sheet_edit",
                  payload: { action: "update", range: args.range, cells: (args.values || []).flat().length, sheet_url: sheetUrl },
                }).select("id, payload, kind, created_at").single();
                if (ci.data) send({ type: "canvas_item", item: ci.data });
              } else if (name === "append_sheet_row") {
                if (!sheetId) throw new Error("No active Google Sheet URL provided.");
                result = await appendSheetRow(sheetId, args.range, args.values);
                const ci = await supa.from("ai_studio_canvas_items").insert({
                  conversation_id: conversationId, user_id: userId, kind: "sheet_edit",
                  payload: { action: "append", range: args.range, rows: (args.values || []).length, sheet_url: sheetUrl },
                }).select("id, payload, kind, created_at").single();
                if (ci.data) send({ type: "canvas_item", item: ci.data });
              } else if (name === "check_lead_quality") {
                const windowDays = Math.min(365, Math.max(1, Number(args.window_days) || 30));
                const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();
                const { data: leads, error: lqErr } = await supa
                  .from("leads")
                  .select("name, email, phone, is_spam, created_at")
                  .eq("client_id", clientId)
                  .gte("created_at", since)
                  .limit(5000);
                if (lqErr) throw new Error(`leads query failed: ${lqErr.message}`);
                const SPAM_DOMAINS = ["armyspy.com","teleworm.us","mailinator.com","dayrep.com","einrot.com","jourrapide.com","fleckens.hu","rhyta.com","cuvox.de","gustr.com","superrito.com","guerrillamail.com","10minutemail.com","tempmail","trashmail","yopmail.com"];
                const isRandomLocal = (local: string) => {
                  if (!local) return false;
                  if (local.length >= 14 && /^[a-z0-9]+$/i.test(local) && !/[aeiou]{1}/i.test(local)) return true;
                  if (/\d{6,}/.test(local)) return true;
                  if (/([bcdfghjklmnpqrstvwxz]{6,})/i.test(local)) return true;
                  return false;
                };
                let spamCount = 0;
                let mismatchCount = 0;
                const samples: any[] = [];
                for (const l of leads || []) {
                  const email = String((l as any).email || "").toLowerCase().trim();
                  const name = String((l as any).name || "").trim();
                  if (!email) continue;
                  const [local, domain] = email.split("@");
                  let reason: string | null = null;
                  if (domain && SPAM_DOMAINS.some(d => domain.includes(d))) reason = "spam_domain";
                  else if (local && isRandomLocal(local)) reason = "random_email";
                  if (reason) {
                    spamCount++;
                    if (samples.length < 25) samples.push({ name, email, reason });
                    continue;
                  }
                  if (name && local) {
                    const tokens = name.toLowerCase().split(/\s+/).filter(t => t.length >= 2);
                    const lp = local.toLowerCase();
                    const matched = tokens.some(t => lp.includes(t.slice(0, Math.min(4, t.length))));
                    if (tokens.length > 0 && !matched) {
                      mismatchCount++;
                      if (samples.length < 25) samples.push({ name, email, reason: "name_email_mismatch" });
                    }
                  }
                }
                result = {
                  ok: true,
                  window_days: windowDays,
                  total_leads: (leads || []).length,
                  spam_count: spamCount,
                  email_name_mismatch: mismatchCount,
                  samples,
                };
              } else if (name === "generate_static_ad") {
                const img = await generateStaticAd({
                  prompt: args.prompt,
                  aspectRatio: args.aspect_ratio || "1:1",
                  referenceImageUrl: args.reference_image_url || defaultReferenceImageUrl || undefined,
                  clientId: clientId || null,
                  brandContext,
                  quality: (args.quality === "fast" ? "fast" : "pro"),
                  model: (args.model === "openai" || args.model === "nano-banana" || args.model === "gemini-pro") ? args.model : null,
                });
                result = { ok: true, model: img.model, aspect_ratio: img.aspect_ratio, url_for_internal_use_only: img.url };
                const ci = await supa.from("ai_studio_canvas_items").insert({
                  conversation_id: conversationId, user_id: userId, kind: "image",
                  payload: {
                    image_url: img.url,
                    storage_path: img.storage_path,
                    mime: img.mime,
                    model: img.model,
                    aspect_ratio: img.aspect_ratio,
                    prompt: args.prompt,
                  },
                }).select("id, payload, kind, created_at").single();
                if (ci.data) send({ type: "canvas_item", item: ci.data, replace_placeholder_id: canvasPlaceholderId });
              } else if (name === "compare_image_models") {
                const models: Array<"gemini-pro" | "nano-banana" | "openai"> = Array.isArray(args.models) && args.models.length
                  ? args.models.filter((m: any) => ["gemini-pro", "nano-banana", "openai"].includes(m))
                  : ["gemini-pro", "nano-banana", "openai"];
                const results = await Promise.all(models.map(async (mdl) => {
                  try {
                    const img = await generateStaticAd({
                      prompt: args.prompt,
                      aspectRatio: args.aspect_ratio || "1:1",
                      referenceImageUrl: args.reference_image_url || defaultReferenceImageUrl || undefined,
                      clientId: clientId || null,
                      brandContext,
                      quality: mdl === "nano-banana" ? "fast" : "pro",
                      model: mdl,
                    });
                    const ci = await supa.from("ai_studio_canvas_items").insert({
                      conversation_id: conversationId, user_id: userId, kind: "image",
                      payload: {
                        image_url: img.url, storage_path: img.storage_path, mime: img.mime,
                        model: img.model, aspect_ratio: img.aspect_ratio,
                        prompt: `[${mdl}] ${args.prompt}`,
                        comparison_model: mdl,
                      },
                    }).select("id, payload, kind, created_at").single();
                    if (ci.data) send({ type: "canvas_item", item: ci.data });
                    return { model: mdl, ok: true };
                  } catch (e: any) {
                    return { model: mdl, ok: false, error: e?.message || String(e) };
                  }
                }));
                result = { ok: true, comparison: results };
              } else if (name === "edit_static_ad") {
                const img = await editStaticAd({
                  sourceImageUrl: args.source_image_url,
                  editInstruction: args.edit_instruction,
                  newOffer: args.new_offer,
                  newHook: args.new_hook,
                  newColors: args.new_colors,
                  newDisclaimer: args.new_disclaimer,
                  aspectRatio: args.aspect_ratio || "1:1",
                  clientId: clientId || null,
                  brandContext,
                  quality: (args.quality === "fast" ? "fast" : "pro"),
                });
                result = { ok: true, model: img.model, aspect_ratio: img.aspect_ratio, url_for_internal_use_only: img.url, parent_image_url: img.parent_image_url };
                const ci = await supa.from("ai_studio_canvas_items").insert({
                  conversation_id: conversationId, user_id: userId, kind: "image",
                  payload: {
                    image_url: img.url,
                    storage_path: img.storage_path,
                    mime: img.mime,
                    model: img.model,
                    aspect_ratio: img.aspect_ratio,
                    prompt: `Edit: ${args.edit_instruction}`,
                    parent_image_url: img.parent_image_url,
                    edit_instruction: args.edit_instruction,
                    new_offer: args.new_offer || null,
                    new_hook: args.new_hook || null,
                    new_colors: args.new_colors || null,
                    new_disclaimer: args.new_disclaimer || null,
                  },
                }).select("id, payload, kind, created_at").single();
                if (ci.data) send({ type: "canvas_item", item: ci.data, replace_placeholder_id: canvasPlaceholderId });
              } else if (name === "generate_ad_variations") {
                const v = await generateAdVariations({
                  prompt: args.prompt,
                  aspectRatio: args.aspect_ratio || "1:1",
                  count: args.count,
                  sourceImageUrl: args.source_image_url,
                  clientId: clientId || null,
                  brandContext,
                });
                result = {
                  ok: true,
                  count: v.variants.length,
                  aspect_ratio: v.aspect_ratio,
                  variant_urls_internal: v.variants.map(x => x.url),
                  errors: v.errors,
                };
                const ci = await supa.from("ai_studio_canvas_items").insert({
                  conversation_id: conversationId, user_id: userId, kind: "variation_set",
                  payload: {
                    prompt: args.prompt,
                    aspect_ratio: v.aspect_ratio,
                    source_image_url: args.source_image_url || null,
                    saved_indices: [] as number[],
                    variants: v.variants.map(x => ({
                      image_url: x.url,
                      storage_path: x.storage_path,
                      mime: x.mime,
                      model: x.model,
                      aspect_ratio: x.aspect_ratio,
                      hint: x.hint,
                    })),
                  },
                }).select("id, payload, kind, created_at").single();
                if (ci.data) send({ type: "canvas_item", item: ci.data, replace_placeholder_id: canvasPlaceholderId });
              } else if (name === "plan_storyboard") {
                const sb = await planStoryboard({
                  brief: args.brief,
                  sceneCount: Math.max(3, Math.min(8, args.scene_count || 4)),
                  aspectRatio: args.aspect_ratio || "9:16",
                  styleNotes: args.style_notes,
                  brandContext,
                  conversationId,
                  userId: userId!,
                });
                result = { ok: true, storyboard_id: sb.storyboardId, aspect_ratio: sb.aspect_ratio, scenes: sb.scenes };
                if (sb.storyboardItem) send({ type: "canvas_item", item: sb.storyboardItem });
              } else if (name === "generate_scene_image") {
                const r = await generateSceneImage({
                  storyboardId: args.storyboard_id,
                  sceneId: args.scene_id,
                  sceneOrder: args.scene_order,
                  prompt: args.prompt,
                  aspectRatio: args.aspect_ratio,
                  clientId: clientId || null,
                  conversationId,
                  userId: userId!,
                });
                result = { ok: true, scene_id: args.scene_id, scene_order: args.scene_order, image_url: r.image_url, model: r.model };
                if (r.item) send({ type: "canvas_item", item: r.item, replace_placeholder_id: canvasPlaceholderId });
              } else if (name === "generate_scene_video") {
                const r = await generateSceneVideo({
                  storyboardId: args.storyboard_id,
                  sceneId: args.scene_id,
                  sceneOrder: args.scene_order,
                  imageUrl: args.image_url,
                  videoPrompt: args.video_prompt,
                  aspectRatio: args.aspect_ratio,
                  clientId: clientId || null,
                  conversationId,
                  userId: userId!,
                });
                result = { ok: true, scene_id: args.scene_id, scene_order: args.scene_order, video_url: r.video_url };
                if (r.item) send({ type: "canvas_item", item: r.item, replace_placeholder_id: canvasPlaceholderId });
              } else if (name === "create_text_artifact") {
                const title = String(args.title || "Untitled").slice(0, 200);
                const artifactType = String(args.artifact_type || "other");
                const content = String(args.content || "");
                const notes = args.notes ? String(args.notes).slice(0, 500) : null;
                let appendedToDoc = false;
                let appendError: string | null = null;
                if (args.append_to_doc) {
                  const pc = await precheckDoc();
                  if (!pc.ok) {
                    appendError = pc.error || "Doc precheck failed";
                  } else {
                    try {
                      await appendToDoc(docId!, `\n\n## ${title}\n\n${content}\n`);
                      appendedToDoc = true;
                    } catch (e: any) {
                      appendError = e?.message || String(e);
                    }
                  }
                }
                const ci = await supa.from("ai_studio_canvas_items").insert({
                  conversation_id: conversationId, user_id: userId, kind: "text_artifact",
                  payload: {
                    title,
                    artifact_type: artifactType,
                    content,
                    notes,
                    chars: content.length,
                    appended_to_doc: appendedToDoc,
                    doc_url: appendedToDoc ? effectiveDocUrl : null,
                  },
                }).select("id, payload, kind, created_at").single();
                if (ci.data) send({ type: "canvas_item", item: ci.data });
                result = { ok: true, title, artifact_type: artifactType, chars: content.length, appended_to_doc: appendedToDoc, append_error: appendError };
              } else {
                result = { error: `Unknown tool: ${name}` };
              }
            } catch (e: any) {
              result = { error: e?.message || String(e) };
              if (canvasPlaceholderId) send({ type: "canvas_placeholder_failed", placeholder_id: canvasPlaceholderId, error: result.error });
            }
            finalToolEvents.push({ name, args, result });
            send({ type: "tool_end", id: tc.id, name, args, result });
            toolMessages[tcIdx] = {
              call_id: tc.id,
              content: JSON.stringify(result).slice(0, 8000),
            };
          }));
          for (const tm of toolMessages) {
            if (!tm) continue;
            convo.push({ role: "tool", tool_call_id: tm.call_id, content: tm.content });
          }
        }
      } catch (e: any) {
        console.error("ai-studio stream error", e);
        send({ type: "error", message: e?.message || String(e) });
      } finally {
        // Persist final assistant message
        const cleaned = sanitizeAssistantText(finalAssistantText);
        try {
          await supa.from("ai_studio_messages").insert({
            conversation_id: conversationId,
            user_id: userId,
            role: "assistant",
            content: cleaned,
            tools: finalToolEvents,
          });
        } catch (e) { console.error("persist assistant", e); }
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
