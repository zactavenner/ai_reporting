## AI Studio Video Overhaul

### 1. Auto Model Routing
- **Default**: Seedance 2.0 **Fast** via OpenRouter (`bytedance/seedance-2.0-fast`), 15s chunks, 720p, 9:16
- **Auto rule**: script has spoken dialogue/lipsync → Veo 3.1 (8s chunks). Otherwise → Seedance Fast 15s.
- **Manual override dropdown** in UI: Auto / Seedance Fast 15s / Seedance Pro 15s / Veo 3.1 8s / Kling
- **Splitter**: 30s script → 2× Seedance OR 4× Veo (ceil(total/chunk))
- **Character consistency (Seedance multi-chunk)**: chunk 1 uses avatar/reference image as first frame; chunk N+1 uses extracted last frame of chunk N as first frame (server-side ffmpeg frame extract)

### 2. Canvas Grouping + Combine
- New `ai_studio_canvas_groups` table: groups multiple `canvas_items` under one "scene set"
- Generated chunks land grouped on canvas with a **Combine** button
- New edge fn `ai-studio-combine-video`: ffmpeg concat → single MP4 → uploaded to `creatives/` → new canvas_item

### 3. Native Captions Editor (kills Hyperframes iframe)
- New `VideoCaptionsEditor.tsx` component on canvas
- Auto-transcribe via Gemini (existing pattern): word-level timestamps
- Live HTML overlay preview with drag handles to move caption block up/down (Y%)
- Style controls: font, size, color, stroke, background
- **Two-stage export**:
  - Preview: client-side `<canvas>` + `MediaRecorder` (fast WebM)
  - Final: new edge fn `ai-studio-burn-captions` → ffmpeg `drawtext`/ASS subtitle burn → MP4 to canvas

### 4. Files
**New:**
- `supabase/functions/ai-studio-video-route/index.ts` — picks model, splits script, dispatches chunks
- `supabase/functions/ai-studio-combine-video/index.ts` — ffmpeg concat
- `supabase/functions/ai-studio-extract-last-frame/index.ts` — ffmpeg frame extract for Seedance chaining
- `supabase/functions/ai-studio-transcribe/index.ts` — Gemini word-timestamps
- `supabase/functions/ai-studio-burn-captions/index.ts` — ffmpeg burn-in
- `src/components/ai-studio/VideoModelPicker.tsx`
- `src/components/ai-studio/CanvasVideoGroup.tsx`
- `src/components/ai-studio/VideoCaptionsEditor.tsx`
- `src/lib/video-router.ts` — `pickModel(script, override)`, `splitScript(script, chunkSeconds)`

**Modified:**
- AI Studio chat edge fn — add `generate_video` tool that calls `ai-studio-video-route`
- AI Studio canvas component — render groups + Combine button + open captions editor

**DB migration:** `ai_studio_canvas_groups` (id, conversation_id, user_id, client_id, kind, status, combined_url, created_at) + add nullable `group_id` to `ai_studio_canvas_items`. RLS on user_id. Grants to authenticated + service_role.

### 5. ffmpeg in edge functions
Use `https://deno.land/x/[email protected]` (WASM ffmpeg) or shell out via `Deno.Command` with the bundled `ffmpeg-static` npm package. WASM path is portable on Supabase Edge runtime.

### Order of implementation
1. DB migration (groups table)
2. `video-router.ts` + `ai-studio-video-route` edge fn (Seedance Fast default, Veo for dialogue)
3. Canvas grouping UI + Combine button + `ai-studio-combine-video`
4. Last-frame chaining for Seedance multi-chunk
5. Native captions editor + transcribe + burn-in

Ship in that order; each step is independently usable.