## Goal

Make video generation in AI Studio work reliably for every client, give it a real player, let users attach avatars / products / PDFs as inputs, and add a first-class place to manage agents.

---

## 1. Fix the video pipeline end-to-end

**Symptoms (from screenshot):** two `<video>` cards rendered with no playable source (0:00, black). The current chat path posts a Seedance "result" before/without a valid rehosted URL.

**Backend (`supabase/functions/ai-studio/index.ts` — `generateSeedanceVideo` + caller):**
- Always rehost the final mp4 into the `creatives` bucket under `ai-studio/{client_id}/seedance/{jobId}.mp4`. Today rehost is a try/catch that silently falls back to the (often expired / signed) provider URL — make rehost mandatory; if it fails, surface a clear `failed` status to the canvas instead of returning a broken URL.
- Emit a placeholder canvas row at `submitting` and update it through `queued → polling → downloading → rehosting → completed/failed` (the placeholder type already exists for images — extend for video).
- HEAD-check the final URL before returning; if non-2xx, mark failed.
- Validate `image_url` is reachable when in image→video mode; if not, return a typed error the chat surfaces.

**Frontend:**
- In `ChatVideoPreview`, hide the `<video>` element if `video.url` is empty / failed and render a "Generating…" or "Failed — retry" state tied to the placeholder progress.
- After completion swap to the new player.

## 2. Upgrade the in-chat video player

Replace the bare `<video controls>` in `ChatVideoPreview` (and `AIStudioCanvas` `scene_video`) with a new `VideoPlayerCard` component:

- Play / pause, large play overlay on first frame
- Frame-accurate scrubber bar with elapsed / total time
- Speed selector: 0.5× · 0.75× · 1× · 1.5× · 2×
- Mute toggle + volume
- Fullscreen + Picture-in-Picture buttons
- Keeps existing Download / Recreate / + Canvas action bar

Shared component so canvas cards and chat cards look identical.

## 3. Avatar / Product / PDF picker for video generation

Two surfaces, same data source:

**A. Composer picker (inline)** — new "+ Reference" menu next to the composer in `AIStudioTab` with three tabs:
- **Avatars** — pulls from existing `avatars` table for the client (+ stock). Selecting one sets `avatar_image_url` on the next message.
- **Products** — pulls from `client_assets` where type is image/product, plus uploaded refs from `ai_studio_reference_images`.
- **PDFs** — pulls from `client_offer_files` + `client_file_uploads` where mime is `application/pdf`. Up to 3 PDFs attached; passed as `pdf_context_urls`.

Selected references become structured attachments on the user message and are appended to the system prompt as:
```
ATTACHED REFERENCES:
- Avatar: <url> (use this person's face/identity in the video)
- Product: <url>
- PDF context: <url>  (extract offer details, compliance, value props)
```

**B. Dedicated Video Studio panel** — a slide-over from the AI Studio header ("🎬 Video Studio") that gives a structured form:
- Avatar select · Product image select (multi) · PDF context (multi)
- Prompt + aspect ratio + duration + 720p/1080p + Fast/Standard
- Big "Generate" button → calls `ai-studio` edge function directly with `generate_seedance_video` tool args wired in, then streams the placeholder → video card back into the active conversation.

**Edge function changes:**
- Extend `generate_seedance_video` tool schema with optional `avatar_image_url`, `product_image_urls[]`, `pdf_context_urls[]`.
- When PDFs present, fetch text via existing offer-files context loader and merge into the Seedance prompt prefix (Seedance is image+text, no PDF input — context is folded into the prompt).
- When `avatar_image_url` is set and no `image_url`, use the avatar as the source frame (image-to-video).

## 4. Agents sub-tab in AI Studio

Add a new tab strip at the top of AI Studio: **Chat · Agents · Canvas** (Canvas tab already exists implicitly; this just makes Agents first-class).

**Agents tab** (new component `AIStudioAgentsTab.tsx`):
- Left column: list of this client's agents + "+ New agent" + a default seed (Creatives, Copy, Strategy)
- Right column: editor — name, handle, type, model, system prompt, knowledge base (markdown), reference files (uploader)
- Header sub-section: edit the client Agent Folder (profile_md, brand_kit, notes)
- Reuses existing `ClientAgentsManager` internals + `useClientAgents` hook

Keep the existing "Agents" header button as a quick-access shortcut that switches to this tab instead of opening a dialog.

## 5. End-to-end verification

For every AI Studio client (loop through `clients` where `status in (active, onboarding, paused)`):
- Call `ai-studio` with a fixed prompt: "Generate a 5s 9:16 720p Seedance fast test clip showing a brand-color gradient" using `fast: true`.
- Verify a placeholder is emitted, completes, and the final URL HEAD-checks 200.
- Write outcome to a small new table `ai_studio_video_smoke_runs(client_id, status, video_url, error, ran_at)` and surface a "Last smoke run" badge on each client in the AI Studio client picker.
- Provide a one-click "Run smoke test for all clients" button in the new Agents tab header for admins.

---

## Files touched

- **Edit** `supabase/functions/ai-studio/index.ts` — mandatory rehost, video placeholder progress, extended seedance tool schema, PDF/avatar/product context.
- **Edit** `src/components/ai/AIStudioTab.tsx` — composer reference picker, video player swap, tab strip, hook agents tab.
- **Edit** `src/components/ai/AIStudioCanvas.tsx` — use new player for `scene_video`, video placeholder rendering.
- **New** `src/components/ai/VideoPlayerCard.tsx` — full-featured player.
- **New** `src/components/ai/AIStudioReferencePicker.tsx` — composer popover with Avatars / Products / PDFs.
- **New** `src/components/ai/AIStudioVideoStudio.tsx` — slide-over generation panel.
- **New** `src/components/ai/AIStudioAgentsTab.tsx` — wraps `ClientAgentsManager` as a real tab.
- **Migration** — `ai_studio_video_smoke_runs` table + grants/RLS.

---

## Out of scope (call out)

- Veo storyboard pipeline (untouched — already separate path).
- Lipsync/voice synthesis to PDFs (no provider chain in place — PDFs only inform the prompt text).
- Per-end-user OAuth into HeyGen or other avatar providers — uses our existing `avatars` table only.
