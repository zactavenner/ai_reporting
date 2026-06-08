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

  {
    // All edits use Nano Banana 2 (image+text) via Lovable AI Gateway.
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
  model?: "nano-banana" | "openai" | null;
}) {
  const supa = createClient(SUPABASE_URL, SERVICE_KEY);
  const fullPrompt = `Create a single cinematic keyframe image for a video scene.\n\n${opts.prompt}\n\nAspect ratio: ${opts.aspectRatio}. Photoreal cinematic look. No text overlays or watermarks.`;

  let base64Image = "", mime = "image/png", modelUsed = "";
  const useOpenAI = opts.model === "openai";

  if (useOpenAI) {
    let agencyOpenAi: string | null = null;
    try {
      const { data: a } = await supa.from("agency_settings").select("openai_api_key").limit(1).maybeSingle();
      const v = (a as any)?.openai_api_key;
      if (typeof v === "string" && v.trim()) agencyOpenAi = v.trim();
    } catch (_) { /* ignore */ }
    const openaiKey = agencyOpenAi || OPENAI_API_KEY_ENV || null;
    const sizeMap: Record<string, string> = { "1:1": "1024x1024", "16:9": "1536x1024", "9:16": "1024x1536" };
    const sz = sizeMap[opts.aspectRatio] || "1024x1024";
    if (!openaiKey && !OPENROUTER_API_KEY) {
      throw new Error("GPT Image 2 requires an OpenAI API key (Agency Settings → API Keys).");
    }
    modelUsed = openaiKey ? "openai/gpt-image-2 (direct)" : "openai/gpt-image-2 (via openrouter)";
    const res = openaiKey
      ? await fetch("https://api.openai.com/v1/images/generations", {
          method: "POST",
          headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: "gpt-image-2", prompt: fullPrompt, size: sz, n: 1 }),
        })
      : await fetch("https://openrouter.ai/api/v1/images/generations", {
          method: "POST",
          headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}`, "Content-Type": "application/json", "HTTP-Referer": "https://lovable.dev", "X-Title": "AI Studio" },
          body: JSON.stringify({ model: "openai/gpt-image-2", prompt: fullPrompt, size: sz, n: 1, response_format: "b64_json" }),
        });
    if (!res.ok) throw new Error(`Scene image [${res.status}]: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    const b64 = data?.data?.[0]?.b64_json;
    const url = data?.data?.[0]?.url;
    if (b64) { base64Image = b64; mime = "image/png"; }
    else if (url) {
      const r = await fetch(url); base64Image = arrayBufferToBase64(await r.arrayBuffer());
      mime = r.headers.get("content-type") || "image/png";
    } else throw new Error("OpenAI returned no scene image data");
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

// ---------- Seedance 2.0 (OpenRouter) — 15s 1080p text-to-video / image-to-video ----------
async function generateSeedanceVideo(opts: {
  prompt: string;
  aspectRatio: string;         // "16:9" | "9:16" | "1:1"
  duration: number;            // 5..15
  resolution: string;          // "720p" | "1080p"
  imageUrl?: string | null;    // optional first-frame for image-to-video
  lastFrameUrl?: string | null;
  fast?: boolean;              // use seedance-2.0-fast
  model?: string | null;       // explicit OpenRouter model id (overrides `fast`)
  clientId: string | null;
  conversationId: string;
  userId: string;
}) {
  if (!OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY not configured");
  const supa = createClient(SUPABASE_URL, SERVICE_KEY);

  const ALLOWED = [
    "bytedance/seedance-2.0-fast",
    "bytedance/seedance-2.0",
    "moonshotai/kling-v2.1",
    "moonshotai/kling-v2.1-pro",
  ];
  const model = (opts.model && ALLOWED.includes(opts.model))
    ? opts.model
    : (opts.fast ? "bytedance/seedance-2.0-fast" : "bytedance/seedance-2.0");
  const body: Record<string, unknown> = {
    model,
    prompt: opts.prompt,
    resolution: opts.resolution,
    aspect_ratio: opts.aspectRatio,
    duration: Math.max(3, Math.min(15, Math.round(opts.duration || 15))),
  };
  const frames: any[] = [];
  if (opts.imageUrl) frames.push({ type: "image_url", image_url: { url: opts.imageUrl }, frame_type: "first_frame" });
  if (opts.lastFrameUrl) frames.push({ type: "image_url", image_url: { url: opts.lastFrameUrl }, frame_type: "last_frame" });
  if (frames.length) body.frame_images = frames;

  const submit = await fetch("https://openrouter.ai/api/v1/videos", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://reporting.highperformanceads.com",
      "X-Title": "AI Studio",
    },
    body: JSON.stringify(body),
  });
  if (!submit.ok) {
    const t = await submit.text();
    throw new Error(`Seedance submit [${submit.status}]: ${t.slice(0, 400)}`);
  }
  const sj = await submit.json();
  const pollingUrl: string | undefined = sj.polling_url;
  const jobId: string = sj.id || crypto.randomUUID();
  if (!pollingUrl) throw new Error(`Seedance returned no polling_url: ${JSON.stringify(sj).slice(0, 300)}`);

  // Poll up to ~5 minutes
  let videoUrl: string | null = null;
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const p = await fetch(pollingUrl, { headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}` } });
    if (!p.ok) continue;
    const pj = await p.json();
    if (pj.status === "completed") {
      const urls: string[] = pj.unsigned_urls || pj.urls || (pj.video?.url ? [pj.video.url] : []);
      videoUrl = urls[0] || null;
      break;
    }
    if (pj.status === "failed") throw new Error(`Seedance failed: ${pj.error || "unknown"}`);
  }
  if (!videoUrl) throw new Error("Seedance timed out after 5 minutes");

  // Download and store in 'creatives' bucket so URL is permanent (unsigned_urls may expire)
  let storedUrl = videoUrl;
  let storagePath: string | null = null;
  try {
    const dl = await fetch(videoUrl);
    if (dl.ok) {
      const bytes = new Uint8Array(await dl.arrayBuffer());
      const path = `ai-studio/${opts.clientId || "shared"}/seedance/${jobId}-${Date.now()}.mp4`;
      const up = await supa.storage.from("creatives").upload(path, bytes, { contentType: "video/mp4", upsert: false });
      if (!up.error) {
        const { data: pub } = supa.storage.from("creatives").getPublicUrl(path);
        storedUrl = pub.publicUrl;
        storagePath = path;
      }
    }
  } catch (e) { console.warn("Seedance rehost failed, using unsigned url", e); }

  const ci = await supa.from("ai_studio_canvas_items").insert({
    conversation_id: opts.conversationId,
    user_id: opts.userId,
    kind: "scene_video",
    payload: {
      video_url: storedUrl,
      storage_path: storagePath,
      keyframe_url: opts.imageUrl || null,
      aspect_ratio: opts.aspectRatio,
      video_prompt: opts.prompt,
      model,
      provider: "openrouter",
      duration: body.duration,
      resolution: opts.resolution,
      scene_order: 1,
      mode: opts.imageUrl ? "image_to_video" : "text_to_video",
      job_id: jobId,
    },
  }).select("id, kind, payload, created_at").single();

  if (opts.clientId) {
    await supa.from("client_assets").insert({
      client_id: opts.clientId,
      asset_type: "scene_video",
      title: `Seedance ${opts.imageUrl ? "image→video" : "text→video"}`,
      status: "completed",
      content: {
        video_url: storedUrl, storage_path: storagePath, keyframe_url: opts.imageUrl || null,
        aspect_ratio: opts.aspectRatio, prompt: opts.prompt, source: "ai_studio", model,
        duration: body.duration, resolution: opts.resolution,
      },
    });
  }

  return { item: ci.data, video_url: storedUrl, model };
}

// ---------- Tool schema ----------
const tools = [
  { type: "function", function: { name: "read_doc", description: "Read text content of the active Google Doc.", parameters: { type: "object", properties: {}, required: [] } } },
  { type: "function", function: { name: "web_search", description: "Search the live web for real-time information (news, stock prices, recent events, competitor info, fact-checks, ad benchmarks, etc). Returns a short summary plus the top source URLs and snippets. Call this whenever the user asks about anything that requires current/real-time info, anything you don't know, or anything that needs sources/citations. Always cite the source URLs in your reply.", parameters: { type: "object", properties: { query: { type: "string", description: "Search query (be specific)." }, freshness: { type: "string", enum: ["day", "week", "month", "year", "any"], description: "How fresh results should be. Default 'any'." } }, required: ["query"] } } },
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
      description: "Generate a high-quality static ad creative on the canvas using the client's brand context. Default tool for any ad image request. Pick a model: 'openai' (GPT Image 2, highest-quality finals, default for quality=pro) or 'nano-banana' (Nano Banana 2, fast iteration, default for quality=fast). Optionally pass reference_image_url to clone an existing ad's layout. This client's approved creatives are automatically used as visual references if no explicit reference is given.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "What the ad should communicate, headline ideas, key visuals." },
          aspect_ratio: { type: "string", enum: ["1:1", "4:5", "9:16", "16:9"], description: "1:1 feed, 4:5 IG feed tall, 9:16 stories/reels, 16:9 landscape." },
          quality: { type: "string", enum: ["pro", "fast"], description: "pro = highest quality (default), fast = quick iteration" },
          model: { type: "string", enum: ["nano-banana", "openai"], description: "Which image model to use. 'openai' = GPT Image 2, 'nano-banana' = Nano Banana 2. If omitted, derived from quality." },
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
      description: "Generate the SAME ad prompt across multiple image models in parallel so the user can compare and pick a favorite. Use when the user asks to 'compare models', 'try both', 'see Nano Banana vs GPT Image 2', or wants different angles from each model. Each result lands on the canvas tagged with its model.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "What the ad should communicate." },
          aspect_ratio: { type: "string", enum: ["1:1", "4:5", "9:16", "16:9"] },
          models: {
            type: "array",
            items: { type: "string", enum: ["nano-banana", "openai"] },
            description: "Which models to compare. Default: ['nano-banana', 'openai'].",
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
      description: "Generate the keyframe image for a planned scene from plan_storyboard. Call this for EVERY scene in the storyboard, in parallel. Pick a model: 'openai' (GPT Image 2) or 'nano-banana' (Nano Banana 2). If the user selected MULTIPLE image models, emit one generate_scene_image call PER model PER scene so the user can compare keyframes side-by-side before videos render.",
      parameters: {
        type: "object",
        properties: {
          storyboard_id: { type: "string", description: "ID returned by plan_storyboard." },
          scene_id: { type: "string", description: "scene.id from the storyboard." },
          scene_order: { type: "integer" },
          prompt: { type: "string", description: "Scene image prompt." },
          aspect_ratio: { type: "string", enum: ["9:16", "16:9", "1:1"] },
          model: { type: "string", enum: ["nano-banana", "openai"], description: "Which image model to use for this keyframe. Default = nano-banana (fast). Use openai for highest quality." },
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
      name: "generate_seedance_video",
      description: "Generate a single high-quality short video clip (3–15s, up to 1080p) using ByteDance Seedance 2.0 via OpenRouter. Use this for STANDALONE one-shot videos: short product clips, hero loops, reels, single-cut ads, or animating an existing image. Two modes: (1) text-to-video — leave image_url empty; (2) image-to-video — pass image_url (and optionally last_frame_url) to animate a reference frame. Strong at character consistency, camera motion, and brand-style preservation. Prefer this over the multi-scene Veo storyboard pipeline whenever the user wants ONE clip, an animated image, or asks for 'a 15 second video / reel / ad clip'. Use 'fast: true' for cheap iteration drafts.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "What should happen in the clip — subject, action, environment, camera move, lighting, mood." },
          aspect_ratio: { type: "string", enum: ["16:9", "9:16", "1:1"], description: "Default 9:16 for reels/stories." },
          duration: { type: "integer", minimum: 3, maximum: 15, description: "Clip length in seconds. Default 15." },
          resolution: { type: "string", enum: ["720p", "1080p"], description: "Default 1080p (highest supported on Seedance 2.0)." },
          image_url: { type: "string", description: "Optional URL of the FIRST FRAME for image-to-video. Pass a canvas image URL to animate an existing keyframe / static ad." },
          last_frame_url: { type: "string", description: "Optional URL of the LAST FRAME (Seedance supports first+last frame control for precise motion endpoints)." },
          fast: { type: "boolean", description: "If true, use seedance-2.0-fast (cheaper, faster, slightly lower quality). Default false." },
          model: { type: "string", enum: ["bytedance/seedance-2.0-fast", "bytedance/seedance-2.0", "moonshotai/kling-v2.1", "moonshotai/kling-v2.1-pro"], description: "Explicit OpenRouter video model id. If provided, overrides `fast`. Honor the user's VIDEO MODEL PREFERENCE from the system prompt." },
        },
        required: ["prompt"],
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
  {
    type: "function",
    function: {
      name: "explode_ad_variants",
      description: "VARIANT EXPLOSION (Phase 2): from ONE creative brief, generate a matrix of static ad variants in parallel — cross-product of HOOKS × VISUAL STYLES. Use whenever the user asks to 'explode variants', 'give me a matrix', 'test multiple hooks', 'A/B 6 ideas', or wants a batch of ad ideas at once. All variants render in parallel and land on the canvas as a variation_set card. Cap at 12 total (e.g. 3 hooks × 4 styles, 6 hooks × 2 styles). Use 'fast' quality (nano-banana) by default for speed.",
      parameters: {
        type: "object",
        properties: {
          brief: { type: "string", description: "Core offer / value prop the ad must communicate (the constant across all variants)." },
          hooks: { type: "array", items: { type: "string" }, description: "Distinct headline / hook lines to test (2–6). Each becomes one row of the matrix." },
          visual_styles: { type: "array", items: { type: "string" }, description: "Distinct visual treatments to test (1–4). e.g. 'UGC selfie phone shot', 'editorial dark studio', 'bold typographic flat', 'magazine cover gold + green'." },
          aspect_ratio: { type: "string", enum: ["1:1", "4:5", "9:16", "16:9"], description: "Default 1:1." },
          reference_image_url: { type: "string", description: "Optional reference image (winning ad to riff on)." },
          quality: { type: "string", enum: ["fast", "pro"], description: "Default 'fast' (Nano Banana 2) for batch speed. Use 'pro' (GPT Image 2) only for final picks." },
        },
        required: ["brief", "hooks", "visual_styles"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "image_to_reel",
      description: "ONE-CLICK PIPELINE (Phase 2): take a brief OR an existing image URL and produce a finished short-form REEL end-to-end. Step 1: if no image_url is provided, generate a 9:16 static ad keyframe with generate_static_ad logic. Step 2: animate that keyframe with Seedance 2.0 (image-to-video) into a 5–15s reel. Returns the static ad AND the final mp4 on the canvas. Use whenever the user says 'image to reel', 'make this image into an ad video', 'one-click reel', 'static + reel', or 'animate this ad'.",
      parameters: {
        type: "object",
        properties: {
          brief: { type: "string", description: "What the reel should communicate. Required if no image_url is passed." },
          image_url: { type: "string", description: "Optional existing canvas keyframe / static ad URL. If provided, skips static generation." },
          motion_prompt: { type: "string", description: "Optional explicit camera/motion description for Seedance. If omitted, one will be auto-derived from the brief." },
          aspect_ratio: { type: "string", enum: ["9:16", "1:1", "16:9"], description: "Default 9:16." },
          duration: { type: "integer", minimum: 5, maximum: 15, description: "Reel length in seconds. Default 8." },
          resolution: { type: "string", enum: ["720p", "1080p"], description: "Default 1080p." },
          fast: { type: "boolean", description: "If true, uses seedance-2.0-fast for cheaper draft. Default false." },
        },
        required: [],
      },
    },
  },
];

const AD_FORMAT_RULES: Record<string, string> = {
  meta_feed_1x1: "AD FORMAT: Meta Feed 1:1 (1080×1080). Headline in the top third, single CTA pill bottom-center, generous safe padding (~80px) on all sides. Sound-off-friendly — use bold on-image text. Aspect ratio MUST be '1:1'.",
  meta_reel_9x16: "AD FORMAT: Meta Reel 9:16 (1080×1920). Keep ALL text/logos in the middle 60% safe zone — top ~250px is covered by the profile UI, bottom ~400px by caption + CTA. Lead with a 1-second pattern-interrupt hook in the first frame. Aspect ratio MUST be '9:16'.",
  story_9x16: "AD FORMAT: Story 9:16 (1080×1920). Top 250px and bottom 250px are RESERVED for platform UI — keep them clean. Vertical center stack: hook → visual → CTA. Aspect ratio MUST be '9:16'.",
  youtube_16x9: "AD FORMAT: YouTube 16:9 (1920×1080). Cinematic framing, headline as left-aligned lower-third, brand mark top-right. Aspect ratio MUST be '16:9'.",
  tiktok_9x16: "AD FORMAT: TikTok 9:16 (1080×1920). UGC / native look — handheld feel, no agency polish, baked-in captions. Hook in first 0.8s. Aspect ratio MUST be '9:16'.",
};

const HOOK_FRAMEWORK_RULES: Record<string, string> = {
  pas: "COPY FRAMEWORK: PAS — Problem → Agitate → Solution. The on-image headline (and any script) must name the specific pain in line 1, twist the knife in line 2, present the solution in line 3, end with one CTA.",
  aida: "COPY FRAMEWORK: AIDA — Attention → Interest → Desire → Action. Hook line grabs attention with a number or contrarian claim, body sparks interest, builds desire with a specific outcome, single CTA.",
  hppc: "COPY FRAMEWORK: Hook → Promise → Proof → CTA. 1-second scroll-stopper hook, one bold quantified promise, one proof point (number/testimonial/credential), one CTA. Cut every word that is not one of those four.",
  pattern_interrupt: "COPY FRAMEWORK: Pattern Interrupt. Lead with a contrarian or unexpected visual + claim that breaks the user's scroll rhythm. Headline must contradict a common belief in the niche.",
  testimonial: "COPY FRAMEWORK: Testimonial. Lead with a real-voice quote in quotation marks, attribute to a name + role, anchor with one specific number (e.g. 'closed $1.4M in 90 days'), single CTA.",
  curiosity_gap: "COPY FRAMEWORK: Curiosity Gap. Open an information loop in the hook ('The 1 thing 90% of investors miss…'), tease the payoff visually, withhold the full answer — CTA promises to deliver it.",
};

const SYSTEM = (ctx: { docUrl?: string; docId?: string | null; sheetUrl?: string; sheetId?: string | null; quality: string; brandSummary: string; imageModels?: string[]; videoModel?: string; adFormat?: string | null; hookFramework?: string | null; burnCaptions?: boolean }) => [
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
  "- Use generate_static_ad for ANY request to build, design, or create an ad creative. Default quality = 'pro' (GPT Image 2). Pass `model: 'openai'` for GPT Image 2 (highest quality finals), or `model: 'nano-banana'` for Nano Banana 2 (quick iteration). Those are the ONLY two supported image models.",
  "- Use web_search whenever the user asks about real-time info, current events, news, prices, benchmarks, competitor data, or anything you might not know. Always cite source URLs from the result in your reply.",
  "- Use compare_image_models when the user asks to 'compare', 'try both', 'see both models', or wants the same prompt across both image models side-by-side. Default models = ['nano-banana', 'openai'].",
  "- APPROVED REFERENCES: This client's approved creatives are auto-loaded as visual references for new generations. You can mention this if helpful (e.g. 'Riffed on the approved ad style from earlier this week').",
  "- Use edit_static_ad whenever the user asks to revise, change, tweak, or update an ad already on the canvas (e.g. 'change the offer', 'swap the hook', 'use brand green', 'update the disclaimer'). Pass the source_image_url from the prior canvas card and a clear edit_instruction. Optional: new_offer, new_hook, new_colors, new_disclaimer.",
  "- Use generate_ad_variations when the user asks for 'options', 'variations', 'alternatives', or 'a few different versions' of an Instagram ad. Generates 2–5 distinct visual directions side-by-side; the user picks which to save from the canvas card.",
  "- Use the doc/sheet tools whenever the user asks to read, summarize, append to, or edit the active Doc/Sheet.",
  "- SHEET AUDITING (agentic, Manus-style): When the user asks to audit, summarize, review, or analyze the Google Sheet, you MUST cover EVERY tab — never stop after one. Step 1: call list_sheet_tabs. Step 2: call batch_read_sheet with one range per tab (e.g. 'TabTitle!A1:Z200'). Step 3: if any tab returned data that needs deeper inspection, call read_sheet again on a wider range for that tab. Step 4: write a clear markdown report covering EVERY tab found (per-tab section + cross-tab insights, trends, anomalies, recommendations). Keep iterating tool calls until the audit is complete — don't ask the user to confirm mid-audit. Long-form findings (>400 words) should go in a create_text_artifact card; short summaries can stay in chat.",
  "- DOC AUDITING: Same pattern for Google Docs — call read_doc, then produce a structured summary (key sections, action items, gaps) and drop any long-form deliverable on the canvas via create_text_artifact.",
  "- LEAD QUALITY: When the user asks anything about lead quality, spam leads, fake leads, bad data, name/email mismatches, or wants an audit of leads — call check_lead_quality (default 30 days). In your chat reply, state the spam count and mismatch count clearly. If spam_count > 0, flag it in red language: 'Detected N spam leads (armyspy/teleworm/random emails) in the last X days — review the flagged samples in the inline card.' Always be explicit about the numbers.",
  "- DOC PRECHECK: Every doc tool (read_doc, append_to_doc, replace_doc_text) auto-runs a connection test before executing. If a tool result contains `precheck_failed: true`, the operation was BLOCKED — do NOT retry the same tool. Instead, write a chat reply that surfaces the `error` field verbatim and asks the user how to proceed (e.g. tie a different doc, share the doc with the connector account, paste a session-override URL). Never silently ignore a precheck failure.",
  "- COPYWRITING / SCRIPTS: ALWAYS call create_text_artifact when the user asks you to write, draft, or generate ANY kind of script (VSL, caller, video script), ad copy, email, caption, landing page copy, outline, plan, or brief. Put the full body in the artifact (Markdown), not in your chat reply. Your chat reply must only be a 1–2 sentence summary like 'Drafted the 60s VSL script on the canvas.' Pass append_to_doc:true if the user said to put it in the doc.",
  "- VIDEO / REEL / SCENE WORKFLOW (storyboard review gate):",
  "- SEEDANCE 2.0 (single-clip video, OpenRouter):",
  "  • Use generate_seedance_video when the user wants ONE standalone clip (3–15s, up to 1080p): a single hero shot, animated still, product loop, short reel, or 'turn this image into a video'.",
  "  • Text-to-video: just pass `prompt` (+ aspect_ratio, duration, resolution).",
  "  • Image-to-video: pass `image_url` (a canvas keyframe / static ad URL) — Seedance preserves character, style, and brand from the reference. Optionally pass `last_frame_url` for precise motion endpoints.",
  "  • Default to duration=15, resolution=1080p, aspect_ratio=9:16 unless the user says otherwise. Use fast=true only when the user explicitly asks for a quick/cheap draft.",
  "  • Prefer Seedance for SINGLE clips and image-animation. Use the multi-scene Veo storyboard pipeline (plan_storyboard → keyframes → generate_scene_video) only when the user explicitly wants a multi-scene cut, storyboard, or video longer than 15s that needs scene-level control.",
  "  • IMAGE→VIDEO SHORTCUT: If the user says 'animate this ad', 'turn this image into a video', 'make this move', or references a canvas image card, call generate_seedance_video with image_url = that card's image URL. Do NOT first call plan_storyboard.",
  "  • Each scene = ONE keyframe image animated into an 8-SECOND Veo 3.1 clip. Total video length = scene_count × 8s.",
  "  • Map the user's target duration to scene_count: 8s→1, 16s→2, 24s→3, 32s→4, 40s→5, 48s→6, 56s→7, 64s→8. If the user doesn't specify a duration, default to 4 scenes (~32s). The user can override by saying 'one image only', 'three scenes', etc.",
  "  Step 1: Call plan_storyboard with the computed scene_count.",
  "  Step 2: In ONE assistant turn, emit ONE generate_scene_image tool_call FOR EVERY scene (parallel), passing the user's selected image model. If the user selected MULTIPLE image models, emit ONE generate_scene_image call PER MODEL PER scene (so each scene shows side-by-side keyframes from both models).",
  "  Step 3: STOP and wait. Do NOT call generate_scene_video on your own. The user reviews the storyboard timeline card on the canvas (reorder scenes, edit prompts, regenerate keyframes) and clicks 'Generate videos' when ready — that click sends a follow-up message that explicitly lists the finalized scene order and prompts. Only THEN emit one generate_scene_video tool_call per scene in parallel using each scene's image_url.",
  "  Step 4: After Step 2, write a short note like: 'Keyframes are on the canvas — reorder, tweak any prompts, or regenerate a frame, then click Generate videos in the storyboard card.' After Step 3 (videos), write a 1–2 line completion summary.",
  "  ONLY skip the review gate and go straight from Step 2 to Step 3 if the user explicitly said 'skip review', 'go straight to video', 'don't wait', or similar.",
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
  ctx.videoModel
    ? `VIDEO MODEL PREFERENCE: The user selected video model "${ctx.videoModel}". ALWAYS pass model: "${ctx.videoModel}" to generate_seedance_video for any single-clip video request. This routes through OpenRouter (Seedance or Kling, depending on the chosen model id).`
    : null,
  ctx.adFormat && AD_FORMAT_RULES[ctx.adFormat] ? AD_FORMAT_RULES[ctx.adFormat] : null,
  ctx.hookFramework && HOOK_FRAMEWORK_RULES[ctx.hookFramework] ? HOOK_FRAMEWORK_RULES[ctx.hookFramework] : null,
  ctx.burnCaptions
    ? "CAPTIONS: The user wants captions burned into any generated video. When you generate any reel/clip (generate_seedance_video or generate_scene_video), include in the prompt: 'Burn-in styled subtitles for every spoken line — Inter Bold ~64px, white fill with 4px black stroke, anchored in the bottom-third safe zone, one short line at a time, no overlap with logos or CTAs.' Also note this in your chat status."
    : null,
  "BRAND GUARD (CRITICAL): Every generated ad must (a) use ONLY brand colors and fonts from the Company Info above, (b) include the client logo unless the user explicitly says no-logo, (c) include the required compliance disclaimer for investment / capital-raising clients ('Past performance is not indicative of future results. All investments carry risk.'), (d) never use the word 'guaranteed'. After generating, do a silent self-check; if any rule is violated, immediately call edit_static_ad with a corrective edit_instruction (max 1 retry).",
  ctx.brandSummary,
  "BRAND LOCK: Always respect the client's brand colors and fonts from Company Info. Do NOT invent new palettes or fonts. When calling generate_static_ad / edit_static_ad / generate_scene_image, the server already injects strict brand adherence from the client record — never override brand colors with arbitrary hexes unless the user explicitly says so.",
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

  const { action, clientId, userText, docUrl, sheetUrl, quality = "pro", conversationId: requestedConversationId, chatModel, imageModels, videoModel, adFormat, hookFramework, burnCaptions, activeReferenceIds, activeVideoReferenceIds, canvasView, focusedCanvasItemId, autoDocContext, threadTitle, threadUpdate, agentMode, attachments } = body as {
    action?: "history" | "clear" | "settings" | "test_doc" | "list_threads" | "new_thread" | "update_thread";
    clientId: string; userText?: string; docUrl?: string | null; sheetUrl?: string | null; quality?: "pro" | "fast"; conversationId?: string;
    chatModel?: string | null;
    imageModels?: Array<"nano-banana" | "openai"> | null;
    videoModel?: string | null;
    adFormat?: string | null;
    hookFramework?: string | null;
    burnCaptions?: boolean;
    activeReferenceIds?: string[] | null;
    activeVideoReferenceIds?: string[] | null;
    canvasView?: { zoom?: number; panX?: number; panY?: number } | null;
    focusedCanvasItemId?: string | null;
    autoDocContext?: boolean;
    threadTitle?: string | null;
    threadUpdate?: { title?: string | null; pinned?: boolean; archived?: boolean } | null;
    agentMode?: boolean;
    attachments?: Array<{ url: string; name?: string; mime?: string; text?: string }> | null;
  };

  const selectedImageModels = Array.isArray(imageModels)
    ? imageModels.filter((m) => m === "nano-banana" || m === "openai")
    : [];

  const ALLOWED_VIDEO_MODELS = [
    "bytedance/seedance-2.0-fast",
    "bytedance/seedance-2.0",
    "moonshotai/kling-v2.1",
    "moonshotai/kling-v2.1-pro",
  ];
  const selectedVideoModel = (typeof videoModel === "string" && ALLOWED_VIDEO_MODELS.includes(videoModel))
    ? videoModel
    : "bytedance/seedance-2.0-fast";

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
    let convo: any = null;
    if (requestedConversationId) {
      const { data } = await supa
        .from("ai_studio_conversations")
        .select("*")
        .eq("id", requestedConversationId)
        .eq("user_id", userId)
        .maybeSingle();
      convo = data;
    } else {
      const { data } = await supa
        .from("ai_studio_conversations")
        .select("*")
        .eq("client_id", clientId)
        .eq("user_id", userId)
        .is("archived_at", null)
        .order("last_active_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      convo = data;
    }
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

  if (action === "list_threads") {
    const { data: threads } = await supa
      .from("ai_studio_conversations")
      .select("id, title, pinned, archived_at, last_active_at, created_at, chat_model")
      .eq("client_id", clientId)
      .eq("user_id", userId)
      .is("archived_at", null)
      .order("pinned", { ascending: false })
      .order("last_active_at", { ascending: false })
      .limit(100);
    return new Response(JSON.stringify({ threads: threads || [] }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (action === "new_thread") {
    const { data: created, error } = await supa
      .from("ai_studio_conversations")
      .insert({
        user_id: userId,
        client_id: clientId,
        title: (typeof threadTitle === "string" && threadTitle.trim()) ? threadTitle.trim().slice(0, 120) : "New chat",
        image_quality: quality,
        chat_model: typeof chatModel === "string" ? chatModel : null,
        last_active_at: new Date().toISOString(),
      })
      .select("*")
      .single();
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ conversation: created }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (action === "update_thread" && requestedConversationId) {
    const upd: Record<string, any> = {};
    if (threadUpdate) {
      if (typeof threadUpdate.title === "string") upd.title = threadUpdate.title.trim().slice(0, 120) || null;
      if (typeof threadUpdate.pinned === "boolean") upd.pinned = threadUpdate.pinned;
      if (typeof threadUpdate.archived === "boolean") upd.archived_at = threadUpdate.archived ? new Date().toISOString() : null;
    }
    if (Object.keys(upd).length === 0) {
      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    await supa.from("ai_studio_conversations").update(upd).eq("id", requestedConversationId).eq("user_id", userId);
    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  if (action === "clear" && requestedConversationId) {
    await supa.from("ai_studio_conversations").update({ cleared_at: new Date().toISOString() }).eq("id", requestedConversationId).eq("user_id", userId);
    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  if (action === "settings" && requestedConversationId) {
    const settingsUpdate: Record<string, any> = { doc_url: docUrl || null, sheet_url: sheetUrl || null, image_quality: quality };
    if (typeof chatModel === "string" || chatModel === null) settingsUpdate.chat_model = chatModel || null;
    if (Array.isArray(activeReferenceIds)) settingsUpdate.active_reference_ids = activeReferenceIds;
    if (Array.isArray(activeVideoReferenceIds)) settingsUpdate.active_video_reference_ids = activeVideoReferenceIds;
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

  // Resolve / create conversation thread
  const baseUpdate: Record<string, any> = {
    doc_url: docUrl || null,
    sheet_url: sheetUrl || null,
    image_quality: quality,
    last_active_at: new Date().toISOString(),
    cleared_at: null,
  };
  if (typeof chatModel === "string") baseUpdate.chat_model = chatModel;
  if (Array.isArray(activeReferenceIds)) baseUpdate.active_reference_ids = activeReferenceIds;
  if (Array.isArray(activeVideoReferenceIds)) baseUpdate.active_video_reference_ids = activeVideoReferenceIds;

  let convoRow: any = null;
  if (requestedConversationId) {
    const { data } = await supa
      .from("ai_studio_conversations")
      .update(baseUpdate)
      .eq("id", requestedConversationId)
      .eq("user_id", userId)
      .select("id, cleared_at, active_reference_ids, active_video_reference_ids, title")
      .maybeSingle();
    convoRow = data;
  }
  if (!convoRow) {
    // Fallback: latest non-archived thread, or insert a new one
    const { data: existing } = await supa
      .from("ai_studio_conversations")
      .select("id, cleared_at, active_reference_ids, active_video_reference_ids, title")
      .eq("client_id", clientId)
      .eq("user_id", userId)
      .is("archived_at", null)
      .order("last_active_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing) {
      await supa.from("ai_studio_conversations").update(baseUpdate).eq("id", existing.id);
      convoRow = existing;
    } else {
      const insertPayload: Record<string, any> = {
        user_id: userId,
        client_id: clientId,
        title: userText.slice(0, 60),
        ...baseUpdate,
      };
      const { data: created } = await supa
        .from("ai_studio_conversations")
        .insert(insertPayload)
        .select("id, cleared_at, active_reference_ids, active_video_reference_ids, title")
        .single();
      convoRow = created;
    }
  }
  const conversationId = convoRow!.id;

  // Auto-title new threads from the first user message
  if (!convoRow.title || convoRow.title === "New chat") {
    await supa.from("ai_studio_conversations").update({ title: userText.slice(0, 60) }).eq("id", conversationId);
  }

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

  // Resolve active VIDEO references — used as style/pacing inspiration
  // for plan_storyboard and generate_scene_video.
  let activeVideoRefs: Array<{ name: string; tags: string[]; video_url: string; aspect_ratio: string | null }> = [];
  const vidRefIds: string[] = Array.isArray(activeVideoReferenceIds) && activeVideoReferenceIds.length
    ? activeVideoReferenceIds
    : (Array.isArray((convoRow as any)?.active_video_reference_ids) ? (convoRow as any).active_video_reference_ids as string[] : []);
  if (vidRefIds.length) {
    const { data: vrefs } = await supa
      .from("ai_studio_reference_videos")
      .select("name, tags, video_url, aspect_ratio")
      .in("id", vidRefIds)
      .limit(6);
    activeVideoRefs = (vrefs || []) as any[];
  }
  const videoRefStyleNotes = activeVideoRefs.length
    ? `\n\nSTYLE INSPIRATION — match the pacing, framing, and energy of these reference videos (do NOT copy them, but emulate their look/feel):\n${activeVideoRefs.map((v, i) => `  ${i + 1}. "${v.name}"${v.aspect_ratio ? ` [${v.aspect_ratio}]` : ""}${v.tags?.length ? ` — tags: ${v.tags.join(", ")}` : ""} → ${v.video_url}`).join("\n")}`
    : "";

  // Load history (since cleared_at, or all)
  const { data: history } = await supa
    .from("ai_studio_messages")
    .select("role, content, tools, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(200);
  const priorMessages = (history || []).map(m => ({ role: m.role, content: m.content || "" }));

  // Persist user message immediately
  const attachmentNote = Array.isArray(attachments) && attachments.length
    ? "\n\n[Attachments provided by user — treat as authoritative context]\n" + attachments.map((a, i) => {
        const lines: string[] = [`#${i + 1} ${a.name || "file"}${a.mime ? ` (${a.mime})` : ""} → ${a.url}`];
        if (a.text && a.text.trim()) {
          lines.push("--- BEGIN EXTRACTED TEXT ---");
          lines.push(a.text.slice(0, 30000));
          lines.push("--- END EXTRACTED TEXT ---");
        }
        return lines.join("\n");
      }).join("\n\n")
    : "";
  const persistedUserText = userText + attachmentNote;
  await supa.from("ai_studio_messages").insert({
    conversation_id: conversationId,
    user_id: userId,
    role: "user",
    content: persistedUserText,
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
      // Default to STRICT brand adherence whenever the client has brand colors saved.
      // The Company Info tab is the source of truth — generations must default to it.
      brandContext.strictBrandAdherence = (brandContext.brandColors?.length || 0) > 0;
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
    { role: "system", content: SYSTEM({ docUrl: effectiveDocUrl ?? undefined, docId, sheetUrl, sheetId, quality, brandSummary, imageModels: selectedImageModels, videoModel: selectedVideoModel, adFormat: adFormat ?? null, hookFramework: hookFramework ?? null, burnCaptions: !!burnCaptions }) },
    ...priorMessages,
    { role: "user", content: persistedUserText },
  ];
  if (agentMode) {
    convo.splice(1, 0, {
      role: "system",
      content: `[AGENT MODE]\nYou are operating autonomously. For every user goal:\n1. Restate the goal in one line.\n2. Lay out a numbered plan (3–7 steps) before any tool call.\n3. Execute the plan step-by-step using available tools, narrating progress concisely.\n4. After every tool call, briefly note what you learned and what's next.\n5. End with a clear "Done" summary listing every artifact produced (doc edits, sheet writes, images, files) with links.\nDo not stop early — chain tool calls until the goal is fully complete or you genuinely need user input.`,
    });
  }
  // Vision: attach image attachments to the final user message for multimodal models
  const imageAttachments = (attachments || []).filter(a => /^image\//i.test(a.mime || "") || /\.(png|jpe?g|webp|gif)$/i.test(a.url));
  if (imageAttachments.length) {
    const lastIdx = convo.length - 1;
    const text = typeof convo[lastIdx].content === "string" ? convo[lastIdx].content : userText;
    convo[lastIdx] = {
      role: "user",
      content: [
        { type: "text", text },
        ...imageAttachments.map(a => ({ type: "image_url", image_url: { url: a.url } })),
      ],
    };
  }

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
              const ms = Array.isArray(args.models) && args.models.length ? args.models : ["nano-banana", "openai"];
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
            if (name === "generate_seedance_video") {
              canvasPlaceholderId = crypto.randomUUID();
              send({
                type: "canvas_placeholder",
                placeholder_id: canvasPlaceholderId,
                kind: "image",
                prompt: `Seedance 2.0 ${args.image_url ? "image→video" : "text→video"} • ${args.duration || 15}s ${args.resolution || "1080p"}: ${String(args.prompt || "").slice(0, 120)}`,
                aspect_ratio: args.aspect_ratio || "9:16",
                quality: "seedance",
              });
            }

            send({ type: "tool_start", id: tc.id, name, args });
            let result: any;
            try {
              if (name === "read_doc") {
                const pc = await precheckDoc();
                if (!pc.ok) { result = { error: pc.error, precheck_failed: true, action_blocked: "read_doc" }; }
                else { result = await readDoc(docId!); result.precheck = { title: pc.title, latency_ms: pc.latency_ms }; }
              } else if (name === "web_search") {
                try {
                  const q = String(args.query || "").trim();
                  if (!q) throw new Error("query is required");
                  const fresh = args.freshness && args.freshness !== "any" ? ` (last ${args.freshness})` : "";
                  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not configured — cannot run web search.");
                  const r = await fetch(
                    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
                    {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        contents: [{ parts: [{ text: `Search the web for: ${q}${fresh}.\n\nReturn a 4–6 sentence answer with concrete facts and numbers. Then list the top 5 sources as: TITLE — URL.` }] }],
                        tools: [{ google_search: {} }],
                        generationConfig: { temperature: 0.2, maxOutputTokens: 1200 },
                      }),
                    },
                  );
                  if (!r.ok) throw new Error(`Search failed: ${r.status} ${await r.text().catch(() => "")}`);
                  const j = await r.json();
                  const text = j?.candidates?.[0]?.content?.parts?.map((p: any) => p.text || "").join("\n").trim() || "";
                  const grounding = j?.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
                  const sources = grounding.slice(0, 8).map((g: any) => ({ title: g?.web?.title, url: g?.web?.uri })).filter((s: any) => s.url);
                  result = { ok: true, query: q, summary: text, sources };
                } catch (e: any) {
                  result = { error: e?.message || String(e) };
                }
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
                  model: (args.model === "openai" || args.model === "nano-banana") ? args.model : null,
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
                const models: Array<"nano-banana" | "openai"> = Array.isArray(args.models) && args.models.length
                  ? args.models.filter((m: any) => ["nano-banana", "openai"].includes(m))
                  : ["nano-banana", "openai"];
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
                  styleNotes: (args.style_notes || "") + videoRefStyleNotes,
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
                  model: (args.model === "openai" || args.model === "nano-banana") ? args.model : null,
                });
                result = { ok: true, scene_id: args.scene_id, scene_order: args.scene_order, image_url: r.image_url, model: r.model };
                if (r.item) send({ type: "canvas_item", item: r.item, replace_placeholder_id: canvasPlaceholderId });
              } else if (name === "generate_scene_video") {
                const r = await generateSceneVideo({
                  storyboardId: args.storyboard_id,
                  sceneId: args.scene_id,
                  sceneOrder: args.scene_order,
                  imageUrl: args.image_url,
                  videoPrompt: args.video_prompt + (videoRefStyleNotes ? `\n\nPacing/style inspiration (emulate, do not copy):${videoRefStyleNotes}` : ""),
                  aspectRatio: args.aspect_ratio,
                  clientId: clientId || null,
                  conversationId,
                  userId: userId!,
                });
                result = { ok: true, scene_id: args.scene_id, scene_order: args.scene_order, video_url: r.video_url };
                if (r.item) send({ type: "canvas_item", item: r.item, replace_placeholder_id: canvasPlaceholderId });
              } else if (name === "generate_seedance_video") {
                const r = await generateSeedanceVideo({
                  prompt: String(args.prompt || "") + (videoRefStyleNotes ? `\n\nPacing/style inspiration (emulate, do not copy):${videoRefStyleNotes}` : ""),
                  aspectRatio: args.aspect_ratio || "9:16",
                  duration: typeof args.duration === "number" ? args.duration : 15,
                  resolution: args.resolution === "720p" ? "720p" : "1080p",
                  imageUrl: args.image_url || null,
                  lastFrameUrl: args.last_frame_url || null,
                  fast: !!args.fast,
                  model: (typeof args.model === "string" && args.model) ? args.model : selectedVideoModel,
                  clientId: clientId || null,
                  conversationId,
                  userId: userId!,
                });
                result = { ok: true, video_url: r.video_url, model: r.model, aspect_ratio: args.aspect_ratio || "9:16", duration: typeof args.duration === "number" ? args.duration : 15, resolution: args.resolution === "720p" ? "720p" : "1080p", mode: args.image_url ? "image_to_video" : "text_to_video" };
                if (r.item) send({ type: "canvas_item", item: r.item, replace_placeholder_id: canvasPlaceholderId });
              } else if (name === "explode_ad_variants") {
                const hooks: string[] = Array.isArray(args.hooks) ? args.hooks.filter(Boolean).map(String).slice(0, 6) : [];
                const styles: string[] = Array.isArray(args.visual_styles) ? args.visual_styles.filter(Boolean).map(String).slice(0, 4) : [];
                if (!hooks.length || !styles.length) {
                  result = { error: "explode_ad_variants requires non-empty hooks[] and visual_styles[]" };
                } else {
                  const aspect = args.aspect_ratio || "1:1";
                  const quality: "pro" | "fast" = args.quality === "pro" ? "pro" : "fast";
                  const combos: Array<{ hook: string; style: string }> = [];
                  for (const h of hooks) for (const s of styles) {
                    if (combos.length < 12) combos.push({ hook: h, style: s });
                  }
                  const settled = await Promise.all(combos.map(async (c) => {
                    try {
                      const fullPrompt = `${args.brief}\n\nHEADLINE / HOOK: ${c.hook}\n\nVISUAL STYLE: ${c.style}`;
                      const img = await generateStaticAd({
                        prompt: fullPrompt,
                        aspectRatio: aspect,
                        referenceImageUrl: args.reference_image_url || defaultReferenceImageUrl || undefined,
                        clientId: clientId || null,
                        brandContext,
                        quality,
                        model: quality === "pro" ? "openai" : "nano-banana",
                      });
                      return { ok: true, url: img.url, storage_path: img.storage_path, mime: img.mime, model: img.model, aspect_ratio: img.aspect_ratio, hook: c.hook, style: c.style };
                    } catch (e: any) {
                      return { ok: false, error: e?.message || String(e), hook: c.hook, style: c.style };
                    }
                  }));
                  const variants = settled.filter((x: any) => x.ok);
                  const errors = settled.filter((x: any) => !x.ok);
                  const ci = await supa.from("ai_studio_canvas_items").insert({
                    conversation_id: conversationId, user_id: userId, kind: "variation_set",
                    payload: {
                      prompt: `Variant matrix: ${hooks.length} hooks × ${styles.length} styles`,
                      aspect_ratio: aspect,
                      source_image_url: args.reference_image_url || null,
                      saved_indices: [] as number[],
                      matrix: { hooks, styles },
                      variants: variants.map((x: any) => ({
                        image_url: x.url, storage_path: x.storage_path, mime: x.mime,
                        model: x.model, aspect_ratio: x.aspect_ratio,
                        hint: `${x.hook} — ${x.style}`,
                        hook: x.hook, style: x.style,
                      })),
                    },
                  }).select("id, payload, kind, created_at").single();
                  if (ci.data) send({ type: "canvas_item", item: ci.data, replace_placeholder_id: canvasPlaceholderId });
                  result = { ok: true, generated: variants.length, failed: errors.length, errors: errors.slice(0, 5), aspect_ratio: aspect };
                }
              } else if (name === "image_to_reel") {
                const aspect = args.aspect_ratio || "9:16";
                const duration = typeof args.duration === "number" ? Math.max(5, Math.min(15, args.duration)) : 8;
                const resolution = args.resolution === "720p" ? "720p" : "1080p";
                let imageUrl: string | null = args.image_url || null;
                let staticImg: any = null;
                if (!imageUrl) {
                  if (!args.brief) { result = { error: "image_to_reel needs either image_url or brief" }; }
                  else {
                    staticImg = await generateStaticAd({
                      prompt: args.brief,
                      aspectRatio: aspect,
                      referenceImageUrl: defaultReferenceImageUrl || undefined,
                      clientId: clientId || null,
                      brandContext,
                      quality: "pro",
                      model: "openai",
                    });
                    imageUrl = staticImg.url;
                    const ciStatic = await supa.from("ai_studio_canvas_items").insert({
                      conversation_id: conversationId, user_id: userId, kind: "image",
                      payload: {
                        image_url: staticImg.url, storage_path: staticImg.storage_path, mime: staticImg.mime,
                        model: staticImg.model, aspect_ratio: staticImg.aspect_ratio,
                        prompt: `[image→reel keyframe] ${String(args.brief).slice(0, 200)}`,
                        pipeline: "image_to_reel:keyframe",
                      },
                    }).select("id, payload, kind, created_at").single();
                    if (ciStatic.data) send({ type: "canvas_item", item: ciStatic.data });
                  }
                }
                if (imageUrl && !result?.error) {
                  const motion = String(args.motion_prompt || `Subtle cinematic motion bringing this ad to life: gentle camera push-in, soft parallax on the subject, brand colors holding steady, on-screen text remains crisp and readable, end frame matches start frame for a clean loop. Hook concept: ${String(args.brief || "").slice(0, 280)}`);
                  const r = await generateSeedanceVideo({
                    prompt: motion + (videoRefStyleNotes ? `\n\nPacing/style inspiration (emulate, do not copy):${videoRefStyleNotes}` : ""),
                    aspectRatio: aspect,
                    duration,
                    resolution,
                    imageUrl,
                    lastFrameUrl: null,
                    fast: !!args.fast,
                    model: selectedVideoModel,
                    clientId: clientId || null,
                    conversationId,
                    userId: userId!,
                  });
                  if (r.item) send({ type: "canvas_item", item: r.item, replace_placeholder_id: canvasPlaceholderId });
                  result = { ok: true, keyframe_url_internal: imageUrl, video_url_internal: r.video_url, model: r.model, duration, resolution, aspect_ratio: aspect };
                }
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
        // Suggested follow-ups — quick lightweight call
        try {
          if (cleaned && cleaned.length > 20) {
            const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
              method: "POST",
              headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
              body: JSON.stringify({
                model: "google/gemini-3-flash-preview",
                messages: [
                  { role: "system", content: "Given the user's last request and the assistant's reply, propose 3 short, concrete next-step prompts the user is most likely to want next. Reply with ONLY a JSON array of 3 strings, max 70 chars each. No prose." },
                  { role: "user", content: `USER: ${(userText || "").slice(0, 800)}\n\nASSISTANT: ${cleaned.slice(0, 1500)}` },
                ],
                temperature: 0.6,
                max_tokens: 200,
              }),
            });
            if (r.ok) {
              const j = await r.json();
              const txt = j?.choices?.[0]?.message?.content || "";
              const m = txt.match(/\[[\s\S]*\]/);
              if (m) {
                const arr = JSON.parse(m[0]);
                if (Array.isArray(arr) && arr.length) {
                  send({ type: "suggested_followups", suggestions: arr.slice(0, 3).map((s: any) => String(s)) });
                }
              }
            }
          }
        } catch (e) { console.error("followups failed", e); }
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
