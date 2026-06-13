// Shared OpenRouter client with automatic model fallback.
// All AI inquiries (text, vision, audio transcription, image gen) route through here.

const OPENROUTER_URL = "https://openrouter.ai/api/v1";

export type ORMessage = {
  role: "system" | "user" | "assistant";
  content: string | Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
    | { type: "input_audio"; input_audio: { data: string; format: string } }
  >;
};

// Default fallback chains. Listed best-quality first; auto-falls back on 429/402/5xx/timeouts.
export const TEXT_MODELS = [
  "openrouter/owl-alpha",
  "google/gemini-2.0-flash-001",
  "openai/gpt-4o-mini",
];

export const VISION_MODELS = [
  "openrouter/owl-alpha",
  "google/gemini-2.0-flash-001",
  "openai/gpt-4o-mini",
];

// Audio-capable (multimodal) models — used for transcription via inline audio/video data.
export const AUDIO_MODELS = [
  "openrouter/owl-alpha",
  "google/gemini-2.0-flash-001",
];

// Image generation — "Nano Banana Pro 2" + GPT-image-1 as auto fallback.
export const IMAGE_MODELS = [
  "google/gemini-3-pro-image-preview",
  "google/gemini-2.5-flash-image-preview",
  "openai/gpt-image-1",
];

function getKey() {
  const k = Deno.env.get("OPENROUTER_API_KEY");
  if (!k) throw new Error("OPENROUTER_API_KEY not configured");
  return k;
}

function shouldFallback(status: number) {
  // Retryable: rate limited, payment required, server errors, model unavailable.
  return status === 429 || status === 402 || status === 404 || status >= 500;
}

export interface CallOpts {
  models?: string[];
  temperature?: number;
  max_tokens?: number;
  response_format?: { type: "json_object" } | { type: "text" };
  signal?: AbortSignal;
}

export interface CallResult {
  text: string;
  model: string;
  raw: any;
}

/**
 * Call OpenRouter chat completions with automatic model fallback.
 * Tries each model in order until one succeeds.
 */
export async function callOpenRouter(
  messages: ORMessage[],
  opts: CallOpts = {},
): Promise<CallResult> {
  const key = getKey();
  const models = opts.models?.length ? opts.models : TEXT_MODELS;
  let lastErr = "";
  let lastStatus = 0;

  for (const model of models) {
    try {
      const res = await fetch(`${OPENROUTER_URL}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://reporting.highperformanceads.com",
          "X-Title": "HPA Reporting",
        },
        signal: opts.signal,
        body: JSON.stringify({
          model,
          messages,
          ...(opts.temperature !== undefined && { temperature: opts.temperature }),
          ...(opts.max_tokens !== undefined && { max_tokens: opts.max_tokens }),
          ...(opts.response_format && { response_format: opts.response_format }),
        }),
      });

      if (!res.ok) {
        lastStatus = res.status;
        lastErr = await res.text();
        console.warn(`[openrouter] ${model} -> ${res.status}: ${lastErr.slice(0, 200)}`);
        if (shouldFallback(res.status)) continue;
        throw new Error(`OpenRouter ${res.status}: ${lastErr}`);
      }

      const data = await res.json();
      const text = data.choices?.[0]?.message?.content ?? "";
      if (!text && data.choices?.[0]?.finish_reason !== "stop") {
        console.warn(`[openrouter] ${model} returned empty content`);
      }
      return { text, model, raw: data };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      lastErr = msg;
      console.warn(`[openrouter] ${model} threw: ${msg}`);
      // Network / abort errors: try next model
      continue;
    }
  }

  throw new Error(
    `All OpenRouter models failed (last status ${lastStatus}): ${lastErr.slice(0, 500)}`,
  );
}

/**
 * Convenience: ask for JSON output. Strips markdown fences and parses.
 */
export async function callOpenRouterJSON<T = any>(
  messages: ORMessage[],
  opts: CallOpts = {},
): Promise<{ data: T; model: string }> {
  const res = await callOpenRouter(messages, {
    ...opts,
    response_format: { type: "json_object" },
  });
  const cleaned = res.text.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
  try {
    return { data: JSON.parse(cleaned) as T, model: res.model };
  } catch {
    throw new Error(`Model ${res.model} returned non-JSON: ${cleaned.slice(0, 300)}`);
  }
}

/**
 * Image generation via OpenRouter. Returns base64-encoded PNG.
 * Tries Gemini 3 Pro Image (Nano Banana Pro 2) first, then GPT-image-1.
 */
export async function generateImage(
  prompt: string,
  opts: { models?: string[]; size?: string } = {},
): Promise<{ b64: string; model: string }> {
  const key = getKey();
  const models = opts.models?.length ? opts.models : IMAGE_MODELS;
  let lastErr = "";

  for (const model of models) {
    try {
      // Gemini image models use chat completions w/ modalities; OpenAI uses /images/generations.
      const isOpenAI = model.startsWith("openai/");
      const url = isOpenAI
        ? `${OPENROUTER_URL}/images/generations`
        : `${OPENROUTER_URL}/chat/completions`;
      const body = isOpenAI
        ? { model, prompt, size: opts.size || "1024x1024", response_format: "b64_json" }
        : {
            model,
            messages: [{ role: "user", content: prompt }],
            modalities: ["image", "text"],
          };

      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://reporting.highperformanceads.com",
          "X-Title": "HPA Reporting",
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        lastErr = await res.text();
        console.warn(`[openrouter:image] ${model} -> ${res.status}: ${lastErr.slice(0, 200)}`);
        if (shouldFallback(res.status)) continue;
        throw new Error(`OpenRouter image ${res.status}: ${lastErr}`);
      }

      const data = await res.json();
      let b64 = "";
      if (isOpenAI) {
        b64 = data.data?.[0]?.b64_json || "";
      } else {
        // Gemini returns images in message.images[].image_url.url as data URLs
        const imgs = data.choices?.[0]?.message?.images;
        const url = imgs?.[0]?.image_url?.url || "";
        b64 = url.startsWith("data:") ? url.split(",")[1] || "" : url;
      }
      if (!b64) {
        console.warn(`[openrouter:image] ${model} returned no image`);
        continue;
      }
      return { b64, model };
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      console.warn(`[openrouter:image] ${model} threw: ${lastErr}`);
      continue;
    }
  }

  throw new Error(`All OpenRouter image models failed: ${lastErr.slice(0, 500)}`);
}