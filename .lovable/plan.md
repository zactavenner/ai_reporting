## Goal
Rebuild AI Studio with a Manus-style chat UX: in-chat previews for every generation, Download + Recreate (loads prompt back into composer with all params), and an "Add to Canvas" action that pins outputs into a side Canvas panel. All generation routed through OpenRouter (images: `openai/gpt-image-2` + `google/gemini-3-flash-image-preview` (Nano Banana 2); video: `bytedance/seedance-2.0` / `seedance-2.0-fast` + `moonshotai/kling-v2.1` / `kling-v2.1-pro`). Full conversation + asset history persisted to DB.

## Pricing summary (delivered)
- **Video:** OpenRouter is the only path for Seedance/Kling (Lovable doesn't host them).
- **Images:** OpenRouter Gemini ~20% cheaper than Lovable. GPT-Image-2 is also on OpenRouter (`openai/gpt-image-2`), so we can drop Lovable entirely.
- **Net:** going 100% OpenRouter is ~10–25% cheaper across the board and gives one billing surface.

## Scope

### 1. Backend
- New edge function `ai-studio-generate` — single dispatcher that accepts `{ kind: 'image'|'video', model, prompt, params, ref_images?, conversation_id }`, hits OpenRouter, rehosts result to `creatives` storage bucket, returns `{ asset_url, asset_id }`.
- Reuse Seedance polling pattern from `fundad-render`. Add Kling support (same `/v1/videos` endpoint, different model id).
- Images use OpenRouter `/v1/images/generations`.
- New edge function `ai-studio-chat` — streams text responses via Lovable AI Gateway (gemini-3-flash-preview) when user is just chatting; falls back to generation dispatch when tool-call detects an image/video request. Uses AI SDK `streamText` + tools (`generate_image`, `generate_video`).

### 2. DB (one migration)
- `ai_studio_conversations` — id, user_id, client_id (nullable), title, created_at, updated_at
- `ai_studio_messages` — id, conversation_id, role (user|assistant|tool), parts JSONB (UIMessage parts), created_at
- `ai_studio_assets` — id, conversation_id, message_id, kind (image|video), model, prompt TEXT, params JSONB, asset_url, thumbnail_url, on_canvas BOOL DEFAULT false, canvas_order INT, created_at
- RLS scoped to `user_id` via conversation join. GRANTs to authenticated + service_role.

### 3. Frontend — `/ai-studio` rebuild
- **Three-pane layout** (Manus-style):
  - Left: conversation list (collapsible)
  - Center: chat transcript using AI Elements (`Conversation`, `Message`, `MessageContent`, `MessageResponse`, `PromptInput`, `Tool`, `Shimmer`)
  - Right: **Canvas panel** — vertical list of pinned assets, drag-to-reorder, "remove from canvas" button. Empty state shows hint.
- **Per-asset chat card** renders:
  - Inline preview (img or `<video controls>`)
  - Action row: `Download` (direct), `Recreate` (loads prompt + model + params into composer), `Add to Canvas` (toggles `on_canvas`), `Predict Virality` (placeholder, future), drag handle
  - Collapsed "Show prompt" details
- **Composer** (`PromptInput`): model selector (image/video models), aspect ratio, duration (video), reference image upload chip. Selected values persist per-conversation.
- **Recreate** = populate composer state from asset's `params` + `prompt` (does not auto-submit).

### 4. Routing & history
- `/ai-studio` redirects to `/ai-studio/:conversationId` (creates new if missing).
- Conversation list shows title (auto-generated from first prompt via Lovable AI), updated_at.
- Messages persist via `onFinish` after stream completes.

### 5. Migration of existing AI Studio
- Keep existing routes intact for legacy access (rename to `/ai-studio-legacy`). New `/ai-studio` is the chat UX.

## Technical details

**OpenRouter endpoints**
- Images: `POST https://openrouter.ai/api/v1/images/generations` with `{ model, prompt, size, n }`. Returns `data[].b64_json` or `data[].url`.
- Videos: `POST https://openrouter.ai/api/v1/videos` (already in use in `fundad-render`) — returns `{ id, polling_url }`; poll until `completed`.

**Models exposed in UI**
- Image: `openai/gpt-image-2` (default), `google/gemini-3-flash-image-preview` (Nano Banana 2)
- Video: `bytedance/seedance-2.0-fast` (default), `bytedance/seedance-2.0`, `moonshotai/kling-v2.1`, `moonshotai/kling-v2.1-pro`

**Secrets**
- `OPENROUTER_API_KEY` already configured (used by `fundad-render`).
- `LOVABLE_API_KEY` used only for the lightweight chat/intent layer.

**Storage**
- Rehost OpenRouter output to `creatives` bucket under `ai-studio/{user_id}/{asset_id}.{ext}` so links don't expire.

## Out of scope (this build)
- Reordering canvas by drag (will add basic up/down arrows; full DnD later).
- Virality prediction (button shown but disabled).
- Exporting canvas as a deck.
