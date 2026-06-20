
# AI Studio v3 — Multi-Script Batch + Premium Video Models

## Scope (locked)
1. Audit AI Studio image + video generation, ship the highest-ROI improvements
2. Wire **only** these video models, exposed as a per-job picker:
   - Seedance Fast (Seedance 1 Lite)
   - Seedance Pro
   - Kling Standard (Kling v2.1)
   - Kling Pro (Kling v2.1 Master)
   - Veo 3.1
3. Multi-script batch: drop 1–N scripts → auto-segment based on chosen model's scene length → fire all video jobs in parallel with live progress per scene per script

---

## Model spec matrix (per-model scene length & resolution)

| Model | Duration options | Default | Resolutions | Aspect | Notes |
|---|---|---|---|---|---|
| **Seedance Fast** (bytedance/seedance-1-lite) | 3, 5, 10, 12, **15** s | 5s | 480p, 720p, 1080p | 16:9, 9:16, 1:1 | Cheapest; max 15s confirmed |
| **Seedance Pro** (bytedance/seedance-1-pro) | 3, 5, 10, 12, **15** s | 10s | 480p, 720p, 1080p | 16:9, 9:16, 1:1 | Higher fidelity; max 15s |
| **Kling Standard** (kwaivgi/kling-v2.1) | 5, 10 s | 5s | 720p, 1080p | 16:9, 9:16, 1:1 | Two-tier only |
| **Kling Pro** (kwaivgi/kling-v2.1-master) | 5, 10 s | 10s | 1080p | 16:9, 9:16, 1:1 | Highest cinematic quality |
| **Veo 3.1** (Gemini `veo-3.1-generate-preview`) | 4, 6, **8** s | 8s | 720p, 1080p | 16:9, 9:16 | Native audio generation |

**Auto-segmentation rule** for a script of length `T` seconds:
- Pick the model's largest duration `D` that ≤ `T`
- Split into `ceil(T / D)` scenes of length `D` (last scene may be shorter, rounded up to the next valid step)
- Examples for a 30s script:
  - Seedance Fast/Pro → 2 × 15s
  - Kling Std/Pro → 3 × 10s
  - Veo 3.1 → 4 × 8s (rounded; ~32s output)
- User can override duration per-batch in the UI (any value from the model's allowed list).

---

## What's in AI Studio today (audit)

**Image gen** — `generate-static-ad`, Gemini 3 Pro Image Preview + Nano Banana 2. Solid. Gaps: no batch, no per-asset aspect picker, no canvas image-as-reference, no regen-with-edit.

**Video gen** — fragmented:
- `generate-broll` (Veo3 only, single 8s scene)
- `generate-video-from-image` (Veo3 image-to-video)
- `breakdown-script` (script → ~8s scenes via Owl Alpha)
- `useBatchVideo` + `BatchVideoWorkflow` (single script only)
- `useVideoGeneration` (one scene at a time, browser-side polling)

**Real gaps:** hardcoded to Veo3 · one script at a time · sequential polling · no unified job tracker · polling dies when tab closes.

---

## Build plan

### 1. Provider abstraction (edge)
`supabase/functions/_shared/video-providers.ts`:
```
generate({ provider, prompt, aspect, duration, resolution, startFrame? }) → { providerJobId }
poll({ provider, providerJobId }) → { status, videoUrl?, error? }
```
Adapters call Replicate (Seedance + Kling) and Gemini (Veo 3.1). Each adapter validates `duration` against its allowed list above and rejects out-of-range values.

### 2. Persistent job tracker (DB)
- `video_batch_jobs` — one per submit (clientId, model, aspect, default_duration, status, totals)
- `video_batch_scripts` — one per script
- `video_batch_scenes` — one per scene (prompt, order, duration, provider, providerJobId, status, videoUrl, error)

RLS scoped by `auth.uid()`. GRANTs for authenticated + service_role.

### 3. Dispatcher + poller (edge)
- `video-batch-dispatch` — input `{ scripts:[{title,content}], model, aspect, duration?, clientId, characterDescription?, offerDescription? }`. For each script: segment using rule above → insert scenes → fan out `generate()` calls in parallel (concurrency cap **8**). Returns `batchId` immediately.
- `video-batch-poll` — pg_cron every 30s. Polls scenes with status `processing`, updates rows, downloads finished MP4s to `creatives/ai-studio/{clientId}/...`, inserts `client_assets` rows.

### 4. UI — Multi-Script Batch Panel (AI Studio tab)
- Drag-drop / paste up to 10 scripts (titled)
- Per-batch: model picker (5 models), aspect (9:16 / 1:1 / 16:9), scene duration (dropdown of model's allowed values, defaults shown above)
- "Generate All" → `video-batch-dispatch`
- Live grid: script rows × scene cards with status pills (queued · generating · done · failed), thumbnail when ready, per-scene retry
- Realtime subscription on `video_batch_scenes` so progress updates without refresh
- Finished scenes land on AI Studio canvas + `client_assets`

### 5. Image gen quick wins
- Per-prompt aspect picker (9:16 / 1:1 / 16:9)
- "Use as reference" on any canvas image
- Batch image gen: paste N prompts → one image each in parallel

---

## Required setup
- **Replicate connector** — needed for Seedance + Kling. I'll trigger the connect flow next.
- **Veo 3.1** reuses existing `GEMINI_API_KEY`.

## Files
- New: `supabase/functions/_shared/video-providers.ts`, `supabase/functions/video-batch-dispatch/index.ts`, `supabase/functions/video-batch-poll/index.ts`, migration for the 3 tables + cron
- New: `src/components/ai/MultiScriptBatchPanel.tsx`, `src/hooks/useVideoBatch.ts`
- Edit: `src/components/ai/AIStudioTab.tsx` (add panel), `src/components/ai/StudioAssistantChat.tsx` (add `generate_video_batch` tool)

Approve and I'll start with the Replicate connection, then ship the migration, edge functions, and UI.
