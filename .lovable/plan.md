
# AI Studio v3 — Multi-Script Batch (reuse existing OpenRouter pipeline)

## What's already working (don't rebuild)
`supabase/functions/ai-studio/index.ts` already runs Seedance + Kling + Veo via **OpenRouter** (`OPENROUTER_API_KEY` is set). It handles submit → poll → rehost to the `creatives` bucket → insert `client_assets`. There is also a `generate_seedance_video` tool exposed to the studio chat.

So the OpenRouter provider layer is done. What's missing is the **multi-script batch fan-out** + a UI to drop N scripts.

## Locked model lineup (per-job picker)

| Label | OpenRouter model id | Duration options | Default | Max res |
|---|---|---|---|---|
| **Seedance Fast** | `bytedance/seedance-2.0-fast` | 4, 5, 8, 10, 12, **15** s | 5s | 720p |
| **Seedance Pro**  | `bytedance/seedance-2.0-pro`  | 4, 5, 8, 10, 12, **15** s | 10s | 1080p |
| **Kling Standard** | `kwaivgi/kling-v3.0-std`      | 5, 10 s | 5s | 1080p |
| **Kling Pro** *(new)* | `kwaivgi/kling-v2.1-master` | 5, 10 s | 10s | 1080p |
| **Veo 3.1** | `google/veo-3.1-fast` | 4, 6, 8 s | 8s | 1080p |

**Auto-segmentation:** for script of length `T`, split into `ceil(T / D_max)` scenes of `D_max`. 30s on Seedance = 2×15s, on Kling = 3×10s, on Veo = 4×8s. User can override per-batch.

## Build plan (small — reuse the helpers in `ai-studio/index.ts`)

### 1. Add Kling Pro to existing model list
- Add `"kwaivgi/kling-v2.1-master"` to the allow-list in `generateSeedanceVideo()`, the `generate_seedance_video` tool enum, and the model capabilities map (lines 945, 1438, 1572, 1834).

### 2. Job tracker tables (migration)
- `video_batch_jobs` (id, user_id, client_id, model, aspect, default_duration, status, totals, timestamps)
- `video_batch_scripts` (id, batch_id, order, title, content)
- `video_batch_scenes` (id, batch_id, script_id, order, prompt, duration, status, polling_url, video_url, error, asset_id)
- RLS scoped to `auth.uid()`. GRANT to authenticated + service_role.

### 3. Edge function `video-batch-dispatch`
- Input: `{ scripts:[{title,content}], model, aspect, duration?, clientId, characterDescription?, offerDescription? }`
- For each script: call existing `breakdown-script` (or local segmentation when the model maxes out at 15s), insert `video_batch_scripts` + `video_batch_scenes` rows, then fan out OpenRouter submit calls (concurrency cap 8) to get `polling_url` per scene.
- Returns `batchId` immediately.

### 4. Edge function `video-batch-poll` (pg_cron, 30s)
- For each `processing` scene: GET `polling_url`. On `succeeded`: download MP4 → upload to `creatives/ai-studio/{clientId}/batch/{batchId}/{sceneId}.mp4` → insert `client_assets` row → mark scene `done`. On `failed`: store error.
- Update parent `video_batch_jobs.status` when all scenes resolve.

### 5. UI — `MultiScriptBatchPanel` (new AI Studio tab)
- Paste up to 10 titled scripts.
- Per-batch controls: model picker (5 above), aspect (9:16 / 1:1 / 16:9), scene duration (model's allowed values).
- **Generate All** → `video-batch-dispatch`.
- Live grid (Realtime on `video_batch_scenes`): script rows × scene cards with status pills, thumbnail when done, per-scene retry button.
- Finished scenes land on the AI Studio canvas + `client_assets`.

### 6. Image gen quick wins (small)
- Per-prompt aspect picker (9:16/1:1/16:9) on the existing image flow.
- "Use as reference" button on canvas images.
- Paste N prompts → batch image gen in parallel.

## Files
- New: `supabase/functions/video-batch-dispatch/index.ts`, `supabase/functions/video-batch-poll/index.ts`, migration for 3 tables + cron.
- New: `src/components/ai/MultiScriptBatchPanel.tsx`, `src/hooks/useVideoBatch.ts`.
- Edit: `supabase/functions/ai-studio/index.ts` (add Kling Pro to enum + capabilities), `src/components/ai/AIStudioTab.tsx` (add tab).

No new secrets. No new connectors.
