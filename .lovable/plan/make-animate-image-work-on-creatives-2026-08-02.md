# Make "Animate Image" work on Creatives

## What's broken today

The **Image → Video (Veo 3.1)** button on a creative runs a chain that cannot succeed reliably, and hides why it failed. Verified in the code and data:

- The button always calls Veo 3.1 only. There is no model choice and no fallback if Veo refuses the request.
- It goes through a proxy (`creative-ai-audit` → `generate-video-from-image`), and the proxy swallows the real provider error, returning a generic `Video kickoff failed` to the UI. So there has never been a readable error message.
- The UI only accepts a response containing a Veo `operationId`. The function's other branch (Seedance) returns a finished `videoUrl` instead — that shape is thrown away as a failure, so the existing Seedance path is unreachable from Creatives.
- Polling waits inside the request for up to 5 minutes on a nested function call, longer than the request budget allows.
- No creative in the database has ever had a video variation saved (0 rows) — the feature has never completed end to end.
- When Veo does return a video, the code saves Google's URL with the API key appended to it, into data the browser renders. That leaks the key and the link expires.

Meanwhile AI Studio already has a proven image-to-video path on OpenRouter (Seedance 2.0, Grok Imagine 1.5, HappyHorse) with the exact request body each model requires plus background job tracking. Creatives simply isn't using it.

## The fix

Point "Animate Image" at the pipeline that already works, give it real model choices, and make it honest about failures.

### 1. Model choice on the creative
Replace the single Veo button with an **Animate Image** button plus a small dialog:
- **Model**: Seedance 2.0 Pro (default — best at holding text/layout still), Grok Imagine 1.5, Veo 3.1 (kept as an option).
- **Length**: 5s / 10s / 15s. **Resolution**: 720p / 1080p where the model allows it.
- **Aspect**: pre-filled from the creative (9:16 / 1:1 / 16:9), changeable.
- **Motion prompt**: pre-filled with the existing "animate background only, keep all text pixel-identical" instruction; editable.
- Live cost estimate from the model registry, same as AI Studio shows.

### 2. One direct, honest call
The creative calls a single dedicated endpoint that reuses AI Studio's verified request builder per model — no proxy hop, no nested invoke. If the provider rejects the request, its own status and message is returned and shown in the toast, so failures are diagnosable instead of "Video conversion failed".

### 3. Background job, not a blocked request
Submitting returns a job id immediately and the dialog shows live progress (submitted → rendering → saving). Rendering continues if the panel is closed or the page reloads, and the finished clip appears in the creative's Variations list. Auto-fallback: if the chosen model rejects the job, the next capable model is tried once and the UI says which model produced the clip.

### 4. Store the video properly
Finished clips are downloaded and saved to the existing `creatives` storage bucket, then attached to the creative as a video variation with model, prompt, duration and cost. No provider URLs with embedded API keys, and links don't expire.

### 5. Verify before handing back
Run a real animation on the Nationwide Paving creative from the screenshot, confirm the MP4 plays, the text/typography stays static, and the variation is attached. Also confirm one deliberately bad request surfaces the provider's actual error text.

## Technical notes

- Frontend: `src/components/creative/CreativeAIActions.tsx` (replace `handleToVideo` and the button with the dialog + job subscription); new small `AnimateImageDialog`; model options from `VIDEO_MODELS` in `src/lib/modelRegistry.ts`.
- Backend: new `animate-creative` edge function reusing the per-model `/api/v1/videos` body construction already proven in `supabase/functions/ai-studio/index.ts` (Seedance `frame_images`/`resolution`, Grok `frame_images` + `generate_audio`, Veo `predictLongRunning`), plus a completion worker that downloads the MP4 into the `creatives` bucket and appends the variation.
- Job state persists in a small `creative_video_jobs` table (creative_id, client_id, model, params, status, provider polling url, error, output path) with RLS matching existing creative access, so progress survives reloads and a cron sweep can finish or expire stalled jobs.
- Retire the unreachable Veo-only path: `creative-ai-audit`'s `to_video` action and the key-appending URL handling in `poll-video-status` stop being used by Creatives.