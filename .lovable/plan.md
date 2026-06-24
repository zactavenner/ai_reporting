## Goal
Add a stable "Multi-Script Batch" capability to AI Studio so the user can paste 1–N scripts in one message, pick a model, and get back fully rendered videos that auto-split when a script exceeds the model's per-clip cap (Seedance ≤15s, Veo 3.1 ≤8s). Fix the Seedance-avatar rejection by routing avatar work to Veo and locking Seedance to non-human / b-roll-style clips when an avatar is selected.

## Behavior

1. **New chat tool `generate_script_batch`** (server-side, registered in `ai-studio/index.ts`):
   - Input: `scripts: [{ title, voiceover, avatar_id?, environment?, target_duration_s? }]`, `model`, `aspect_ratio`, `resolution`, `client_id`.
   - For each script:
     - Estimate duration from word count (≈2.4 wps) if `target_duration_s` not given.
     - Choose per-clip cap from model registry (Seedance Pro 15s, Veo 3.1 8s).
     - Call existing `splitVideoPromptForModel` to break the VO into N segments preserving sentence boundaries; carry environment + avatar description into every segment's prompt.
     - Dispatch all segments in parallel (existing `Promise.allSettled` path).
     - After all segments succeed, persist a `script_group_id` so the canvas can show "Script 1 · Clip 1/2, Clip 2/2" grouped.
   - Streams the same `tool_start` / `tool_progress` / `tool_end` / `clip_avatar_mapping` SSE events already used, plus a new `script_group` event so the UI can render grouped cards.

2. **Avatar routing rule (fixes Seedance "real people" rejection)**:
   - When `avatar_id` is set on a script (or globally on the conversation) the dispatcher forces `model = google/veo-3.1-fast` for that script regardless of the user-picked model, and shows a one-line toast/SSE notice: "Avatar locked to Veo 3.1 — Seedance rejects synthetic faces."
   - Seedance stays available for: no-avatar scripts, b-roll, product, environment-only clips, and image-to-video where the source image is not a person.
   - User can override with an explicit `force_model: "seedance"` flag (surfaced as a small "Use Seedance anyway" toggle on the avatar chip) — same call path, no auto-rerouting.
   - Update the system prompt section that currently tells the LLM to "pass avatar image to Seedance" to instead route avatar clips through Veo and pass the avatar image as Veo's reference frame.

3. **Background persistence (already shipped earlier in this thread)**:
   - The batch tool inherits the existing fire-and-forget pattern: tool runs server-side, writes results to `ai_studio_messages.tools`, client reconnects via realtime. Closing the tab does not cancel.

4. **UI in `AIStudioTab.tsx`**:
   - Add a "Batch scripts" chip to the composer that opens a lightweight textarea-per-script editor (paste N scripts, optionally tag avatar + environment per script, pick model + resolution + aspect).
   - On submit it sends a single user message containing all scripts as JSON in a fenced block, plus a short natural-language instruction, so the LLM emits one `generate_script_batch` tool call.
   - Canvas grouping: when a `script_group` SSE event arrives, render the script's clips as a single grouped card (title + N clip thumbnails + "stitch" affordance — stitch itself is out of scope for this plan, just the grouping).
   - Per-script status badges (queued / rendering 2 of 4 / done / failed).

5. **Verification + logging** (extends what's already there):
   - Every clip logs `script_index`, `script_title`, `clip_index`, `clip_count`, `model_used`, `avatar_id`, `routing_reason` ("user_choice" | "auto_veo_for_avatar" | "force_override").
   - Surfaces in the existing job-history side panel so we can audit which clips reused which avatar.

## Technical Notes

- Files touched:
  - `supabase/functions/ai-studio/index.ts` — register new `generate_script_batch` tool, add avatar→Veo routing helper, extend `splitVideoPromptForModel` only if we need word-count fallback (already supports duration splitting). Emit `script_group` SSE event.
  - `src/components/ai/AIStudioTab.tsx` — composer chip + multi-script editor modal, SSE handler for `script_group`, grouped canvas card.
  - `src/lib/modelRegistry.ts` — add `supportsRealisticAvatars: boolean` flag (true for Veo, false for Seedance) to drive routing.
  - No DB migration required (results continue to live in `ai_studio_messages.tools`).
- Veo 3.1's 8s cap means a 30s VO becomes 4 clips; Seedance Pro at 15s → 2 clips. Both paths reuse the existing per-segment `generate_seedance_video` / Veo dispatchers — no new renderers.
- Stability levers:
  - Per-segment retry (1 retry on 5xx / timeout) before marking the script failed.
  - If any clip in a script fails after retry, the other clips still publish and the failed clip shows a "Retry clip 3" button (single-clip rerun reuses existing tool).
  - 4K stays opt-in and only on Seedance Pro; avatar→Veo runs are capped at 1080p (Veo's max) with a UI note.

## Out of Scope (call out if you want it added)
- Automatic ffmpeg stitching of the N clips into one continuous mp4.
- Voice synth / lip-sync over the rendered clips (separate ElevenLabs + lip-sync pass).
- A dedicated `script_batches` table — current `ai_studio_messages.tools` JSON is sufficient for v1.
