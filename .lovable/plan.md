# AI Studio v2 — Persistence, Static Ad Quality, Manus Canvas

Three problems, one cohesive change:

1. History only lives in this browser → move to the backend.
2. Static images are generic (using fast Nano Banana via the gateway) → port the higher-fidelity pipeline from [Ads Generator 5.0](/projects/b57a79c0-3e59-4a78-be94-340c58fe824e).
3. Replies dump raw markdown like `![ad creative](https://…)` into the chat → split chat (human conversation) from canvas (AI's working surface).

---

## 1. Server-side chat history (cross-device)

One ongoing AI Studio conversation per (user, client). Loads on any device on refresh. A "Clear conversation" button starts fresh.

New tables:

- `ai_studio_conversations` — one row per (user_id, client_id). Stores `last_active_at`, `doc_url`, `sheet_url`, `image_model`.
- `ai_studio_messages` — `conversation_id`, `role` (`user`/`assistant`), `content`, `tools` (jsonb of tool calls + results), `created_at`.
- `ai_studio_canvas_items` — `conversation_id`, `kind` (`image`/`doc_edit`/`sheet_edit`), `payload` jsonb (url, prompt, mime, model, aspect, etc.), `created_at`. This is what powers the Canvas pane and survives refresh.

RLS: every table scoped to `user_id = auth.uid()` for select/insert/update/delete.

Frontend changes:
- On tab mount, load the conversation + last 200 messages + last 50 canvas items from Supabase (replace today's localStorage hydration).
- After each user send, insert the user message immediately. The edge function streams the assistant response and, on `done`/`tool_end`, persists assistant message + canvas items server-side (single source of truth — frontend just re-reads or appends optimistically). Avoids divergence between devices.
- "Clear conversation" button in the header soft-deletes (sets `cleared_at`) so canvas history isn't lost forever.

Today's localStorage code is removed.

---

## 2. Static-image quality (port from Ads Generator 5.0)

Replaces the current single-prompt Nano Banana call for ad creatives.

New edge function `ai-studio-generate-ad` (or a new tool inside `ai-studio`) that mirrors `generate-static-ad`:

- **Model:** `gemini-3-pro-image-preview` called directly with `GEMINI_API_KEY` (already in secrets) for higher quality, with `gemini-3.1-flash-image-preview` (Nano Banana 2) as a "fast" fallback the user can pick.
- **Structured prompt builder** with the same blocks as Ads Generator 5.0:
  - Aspect ratio → explicit dimensions (`1:1`, `4:5`, `9:16`, `16:9`).
  - 9:16 IG Stories/Reels safe-zone rule (no critical content in top 14% / bottom 20%).
  - Brand colors, brand fonts, optional `strictBrandAdherence`.
  - Reference image cloning (primary + supplementary) with chunked base64 upload — pixel-perfect template replication.
  - Disclaimer block (auto-on for investment offers per existing compliance memory).
  - "DO NOT include watermarks/logos/stock artifacts" hard rules.
- **Auto brand context:** when the tool runs, read the client row (brand colors/fonts, primary offer, disclaimer text) and inject automatically. Same pattern as Ads Generator 5.0's `api-gateway` `generateStaticAd`.
- **Storage:** upload to `creatives/ai-studio/{clientId}/…` and also insert a `client_assets` row so the image appears in existing asset views.
- **Tool surface in chat:**
  - `generate_static_ad` — high-quality (default, Gemini 3 Pro Image)
  - `generate_quick_image` — fast Nano Banana 2 for iteration / non-ad visuals
  - `edit_static_ad` — re-prompt an existing canvas image (mirrors Ads Generator 5.0's edit endpoint)

The image-model dropdown in the header becomes "Quality: Pro / Fast / Auto" and is passed as a hint; the agent picks the right tool.

---

## 3. Manus-style canvas (no more markdown image dumps)

Right-pane Canvas becomes the *only* place renders appear. The chat is purely conversational.

System prompt enforcement:
- Never emit markdown images, HTML, or raw URLs in the assistant text.
- After running an image/doc/sheet tool, reply with a short human-readable status only, e.g. "Built a 1:1 ad creative on the canvas — open it to review."
- Post-process: strip any `![…](http…)` and bare image URLs from streamed text before display, as a safety net.

Canvas pane:
- Each `canvas_items` row renders as a card with a thumbnail, prompt, model badge, aspect ratio, "Open / Copy URL / Edit / Variations" actions.
- While a generation is running, a skeleton card appears at the top of the canvas with the prompt and a spinner — this is the "building on canvas" feel from Manus.
- Doc/Sheet edits also drop a card on the canvas ("Appended 3 paragraphs to the strategy doc — view diff") and the existing Doc/Sheet iframe tabs stay.
- Canvas is scoped to the active conversation and persists across refresh and devices.

Result: the assistant's reply will read like

> Done — built a 1:1 creative for your offer. Open it on the Canvas to review.

instead of a markdown image dump.

---

## Technical notes

- New tables created via a migration (no edits to existing tables).
- Existing `ai-studio` edge function keeps the SSE streaming + abort behavior. New events: `canvas_item` (sent the moment a tool produces a render so the UI can drop a placeholder card immediately) in addition to today's `tool_start` / `tool_end`.
- `GEMINI_API_KEY` already exists. No new secrets.
- Prompt engineering is copied verbatim from `generate-static-ad/index.ts` in Ads Generator 5.0 (aspect-ratio map, safe zone, reference-image cloning rules, disclaimer block) and adapted to read brand context from the existing `clients` table.
- Frontend keeps the split layout but switches the right pane from "tabs" first to a Manus-style scrolling canvas with Doc/Sheet iframes available as collapsible side tabs.
- All Supabase calls go through `@/integrations/supabase/client` per project standard.

## Files

- New: `supabase/migrations/<timestamp>_ai_studio_persistence.sql`
- New: `supabase/functions/ai-studio-generate-ad/index.ts` (or new tool inside `ai-studio`)
- Edit: `supabase/functions/ai-studio/index.ts` — add canvas-item events, persist messages+canvas to DB, swap image tool implementations, tighten system prompt.
- Edit: `src/components/ai/AIStudioTab.tsx` — DB-backed hydration, canvas pane redesign, strip markdown images, "Clear conversation" button.
- New: `src/components/ai/AIStudioCanvas.tsx` — canvas card list with skeleton-while-building.
- New: `src/hooks/useAIStudioConversation.ts` — load/append/clear via Supabase.
