
# AI Studio v3 — Multi-Script Batch + Premium Video Models

## Scope (locked to your ask)
1. Audit AI Studio image + video generation, ship the highest-ROI improvements
2. Wire **only** these video models, exposed as a per-job picker:
   - Seedance Fast
   - Seedance Pro
   - Kling Standard
   - Kling Pro
   - Veo 3.1
3. Multi-script batch mode: drop 1–N scripts (e.g. 4 × 30s) → auto-segment into 8s chunks → fire all video jobs **in parallel** with progress per scene per script

Out of scope this pass: voice cloning swaps, brand-new image models, audio mixing.

---

## What's in AI Studio today (audit)

**Image gen** — `generate-static-ad` edge fn, Gemini 3 Pro Image Preview (`pro`) + Nano Banana 2 (`fast`), good. Gaps: no batch, no aspect picker per asset, no style-reference reuse from canvas, no regen-with-edit.

**Video gen** — fragmented across:
- `generate-broll` (Veo3 only, single 8s scene)
- `generate-video-from-image` (Veo3 image-to-video)
- `breakdown-script` (script → ~8s scenes via Owl Alpha)
- `useBatchVideo` hook + `BatchVideoWorkflow` (single script only)
- `useVideoGeneration` (one scene at a time, sequential polling)

**Real gaps:**
- Hardcoded to Veo3 — no model choice
- One script at a time — can't queue 4 scripts
- Sequential polling per scene — slow even within one script
- No unified job tracker — refresh = lose state
- Polling lives only in the browser tab — close tab, jobs die

---

## Build plan

### 1. Provider abstraction (edge)
New `supabase/functions/_shared/video-providers.ts` with a single interface:
```
generate({ provider, prompt, aspect, duration, startFrame? }) → { providerJobId }
poll({ provider, providerJobId }) → { status, videoUrl?, error? }
```
Adapters:
- **seedance-fast** / **seedance-pro** → Replicate `bytedance/seedance-1-lite` and `bytedance/seedance-1-pro` (5s default, 10s max, 480p / 1080p split)
- **kling-standard** / **kling-pro** → Replicate `kwaivgi/kling-v2.1-standard` and `kwaivgi/kling-v2.1-master` (5s + 10s)
- **veo-3.1** → Gemini API `veo-3.1-generate-preview` (8s, 720p/1080p, native audio)

Needs new secret: `REPLICATE_API_TOKEN` (I'll request it when we get to wiring Seedance/Kling). Veo 3.1 reuses existing `GEMINI_API_KEY`.

### 2. Persistent job tracker
New tables:
- `video_batch_jobs` — one row per "submit" (holds clientId, model, aspect, status, totals)
- `video_batch_scripts` — one row per script in the batch
- `video_batch_scenes` — one row per 8s scene (prompt, scene order, provider, providerJobId, status, videoUrl, error)

RLS: `auth.uid() = user_id`. GRANTs to authenticated + service_role.

### 3. Dispatcher + poller (edge)
- `video-batch-dispatch` — accepts `{ scripts: [{title, content}], model, aspect, clientId, characterDescription?, offerDescription? }`. For each script: calls existing `breakdown-script`, inserts scenes, then fans out `generate()` calls **in parallel** (Promise.all with concurrency cap of 8). Stores `providerJobId` on each scene row. Returns `batchId` immediately.
- `video-batch-poll` — invoked by pg_cron every 30s. Picks scenes with status `processing`, polls provider, updates row. Idempotent.

### 4. UI — Batch Video Studio
Replace `BatchVideoWorkflow` single-script flow with a new `MultiScriptBatchPanel` under AI Studio:
- Drag-drop / paste up to 10 scripts (titled)
- Per-batch model picker (5 models above) + aspect (9:16, 1:1, 16:9)
- "Generate All" → calls `video-batch-dispatch`
- Live grid: script rows × scene cards with status pills (`queued | generating | done | failed`), thumbnail when ready, per-scene retry button
- Real-time subscription to `video_batch_scenes` so progress updates without refresh
- Finished scenes auto-land on the existing AI Studio canvas + `client_assets`

### 5. Image gen improvements (small wins, same pass)
- Per-prompt aspect ratio picker (9:16 / 1:1 / 16:9) in the studio composer
- "Use as reference" button on any canvas image → seeds next gen with that image
- Batch image gen: paste N prompts → one image each in parallel

---

## Technical notes
- Concurrency cap of 8 simultaneous provider calls per batch (Replicate + Gemini both rate-limit; this stays under both).
- Veo 3.1 = 8s scenes; Seedance/Kling = 5s or 10s. The segmenter will be told the target scene length per-model so a 30s script splits into 6×5s, 3×10s, or ~4×8s depending on choice.
- All polling moves server-side via pg_cron — closing the browser no longer kills jobs.
- Existing `useBatchVideo` / single-script `BatchVideoWorkflow` stays for now (used by `/batch-video` page); the new multi-script flow is additive inside AI Studio.

## Files I'll touch
- New: `supabase/functions/_shared/video-providers.ts`, `supabase/functions/video-batch-dispatch/index.ts`, `supabase/functions/video-batch-poll/index.ts`, migration for the 3 tables + cron job
- New: `src/components/ai/MultiScriptBatchPanel.tsx`, `src/hooks/useVideoBatch.ts`
- Edit: `src/components/ai/AIStudioTab.tsx` (add tab), `src/components/ai/StudioAssistantChat.tsx` (add `generate_video_batch` tool so the chat agent can trigger it too)

## Confirmations needed before I start
1. OK to add `REPLICATE_API_TOKEN` (covers Seedance + Kling) — I'll prompt you for it when we hit that step.
2. Default scene length per model OK? Seedance/Kling = 5s, Veo 3.1 = 8s.
3. Concurrency cap of 8 parallel video jobs per batch OK, or push to 16?
