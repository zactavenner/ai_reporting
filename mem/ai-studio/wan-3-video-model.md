---
name: Wan 3.0 video model + Video Ads chat/produce mode
description: Alibaba Wan 3.0 (OpenRouter) as an approved AI Studio video renderer, and the Video Ads agent's Chat-script vs Produce-video intent
type: feature
---
- Approved video renderers are now: `minimax/hailuo-3` (720p/2K, 5–15s), `bytedance/seedance-2.0` (720p, ≤15s), `bytedance/seedance-2.5` (480p/720p, 4–30s) and `alibaba/wan-3.0` (480p/720p/1080p, 2–30s in one clip, cheapest long-form). Grok/HappyHorse/Kling/Veo stay retired.
- Wan 3.0 body on `POST https://openrouter.ai/api/v1/videos`: `model`, `prompt`, `duration` 2–30, `resolution` lowercase `480p|720p|1080p`, `aspect_ratio` `16:9|4:3|1:1|3:4|9:16`, `generate_audio`, `frame_images` (first_frame ONLY), `input_references` (≤7). A last frame is demoted to a reference. Poll `GET /api/v1/videos/{id}`.
- Video Ads agent has an explicit intent toggle: **Chat script** (default — no video tools, no spend; the agent writes/refines the script, hooks, shot list) and **Produce video** (renders with locked model/res/length/format/frames). In chat intent, `videoModel`/frames are not sent at all.
- The composer hard-lock is model-generic: it locks whatever model is selected plus its supported resolution list, the exact composer length, aspect from ad format, and audio on — never a hardcoded H3/Seedance pair.
