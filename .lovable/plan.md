## AI Studio Upgrades — 4 Features

### 1. Manus-style Canvas (zoom + click-to-edit)
**File:** `src/components/ai/AIStudioCanvas.tsx`
- Wrap the canvas in a **pan/zoom viewport** (CSS transform: scale + translate). Controls: zoom % readout, `+` / `−` buttons, "Fit", "100%", scroll-wheel zoom (Ctrl/⌘+wheel), drag-to-pan on empty space.
- When a user **clicks any image card**, open an **inline edit overlay** on that card: a small input "Describe the change…" + Send button. On submit, fire the same `edit_static_ad` flow that the chat already supports (call edge function with `source_image_url` + `edit_instruction`), and replace the card in-place with the new version.
- No new edge functions — reuse existing `edit_static_ad` tool. Add an `onInlineEdit(imageUrl, aspectRatio, instruction)` prop that `AIStudioTab` wires to `studioFetch`.

### 2. Cross-client Reference Image Library
**New table:** `ai_studio_reference_images` (id, name, tags text[], image_url, storage_path, created_by, created_at). Storage bucket: reuse `creatives` under `ai-studio/references/`. RLS: any signed-in user can read; insert/delete restricted to creator (or admin).
**Settings UI:** New section inside the AI Studio "Connections & quality" panel called **"Reference Library"** (collapsible). Lets the user:
  - Upload images (drag/drop, multi-file).
  - Tag/name them.
  - Pick 1–N as **"active references"** for the current conversation — stored in `ai_studio_conversations.active_reference_ids` (new jsonb column).
- The edge function will pass the first active reference as `referenceImageUrl` to `generate_static_ad` automatically when the user asks for an ad and no inline reference is given.
- Library is global across clients (no `client_id` filter).

### 3. Per-message Model Switcher
- Replace the single `quality` dropdown bound to the conversation with a **model selector right next to the Send button** (compact pill). Options:
  - **Gemini 3 Pro Image** (pro) — current default
  - **Nano Banana 2** (fast)
  - **Gemini 3 Flash** (text-only fastest)
  - **Gemini 2.5 Pro** (text reasoning)
- Selection persists in local state but is sent **per request** (`quality` field already supported; add `chatModel` for the conversation model used by the orchestrator). Server falls back to the existing default if `chatModel` is missing.
- Conversation history (all prior messages + tool calls) is still loaded from DB and sent as context every turn — already implemented. No regression.

### 4. Auto-connect Doc / Sheet (no re-tying)
- On `loadHistory`, if the conversation has no `doc_url` / `sheet_url`, auto-resolve in this priority and **silently persist** to the conversation:
  1. `clients.google_doc_url` / `clients.google_sheet_url`
  2. `client_settings.kpi_google_doc_url` / `kpi_google_sheet_url`
- Today the UI fills the inputs but doesn't write them back to the conversation row until the user toggles a field. Fix: when fallback resolves and `conversationId` exists, immediately call the existing `settings` action to persist — so the next session shows them as already tied with no manual "Tie to client" needed.
- Add a small green "Auto-connected" badge next to each input when it was auto-resolved.

### Database migration
- `ai_studio_reference_images` table + RLS + realtime optional.
- `ai_studio_conversations.active_reference_ids jsonb default '[]'::jsonb`.
- `ai_studio_conversations.chat_model text` (nullable, defaults handled server-side).

### Edge function changes (`supabase/functions/ai-studio/index.ts`)
- Accept `chatModel` and `active_reference_ids` in the request body; persist on `settings` and use during streaming.
- In `generate_static_ad` tool path, when no `reference_image_url` arg is provided but `active_reference_ids` exist, fetch first image URL and inject as `referenceImageUrl`.
- Pass `chatModel` into the orchestrator's `streamText`/chat completion call instead of the hardcoded `gemini-2.5-pro`.

### Out of scope
- No multi-image select on canvas (single click = single edit).
- No advanced annotation drawing tools (just zoom + click-to-edit).
- No replacing the existing chat-history persistence; it already works.
- No new top-level pages or sidebar entries.

### Files touched
- New: migration SQL
- Edit: `AIStudioCanvas.tsx`, `AIStudioTab.tsx`, `supabase/functions/ai-studio/index.ts`

Estimated: ~400 LOC across files; one migration. Building incrementally in the order: migration → edge fn → canvas → tab UI.