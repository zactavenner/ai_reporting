# Trainable Video Style Studio

Today video styles live in `localStorage` with a hand-written `prompt` per style. You can attach reference videos but nothing happens with them — they're just URLs. This plan turns each style into a trainable preset: upload example clips, auto-transcribe + analyze them, and let the AI re-write the style's prompt so future generations match the examples.

## What you get

**6 built-in presets** (all editable, all trainable):

1. **Podcast** — two-host studio Q&A, quick cuts (already exists, refined)
2. **Street Interview** — handheld man-on-the-street, mic in frame, candid reactions
3. **Cartoon** — 2D animated explainer (renamed from "Animated Cartoon")
4. **Mini VSL** — 30–60s sales letter, b-roll + voiceover, problem→agitate→solve→CTA
5. **Capital Raising** — investor-grade tone, SEC-safe language ("targeted returns" not "guaranteed"), professional B-roll
6. **Low Ticket Offer** — direct-response punchy hook, $7–$97 mindset, urgency CTAs

**Per-style training workflow:**
- Upload up to 10 reference videos (drag-drop or paste URL)
- Hit **"Auto-transcribe & analyze"** → backend pulls audio, transcribes via Lovable AI, runs vision analysis for camera/pacing/composition notes
- Hit **"Train style from references"** → AI reads every transcript + analysis and rewrites the style's master prompt to match the patterns it sees
- Manual prompt editing still available; "Reset to AI-trained" and "Reset to built-in" both one click

**New dedicated Styles page** at `/ai-studio/styles` — full-screen manager replacing the cramped popover for editing, with side-by-side reference gallery, transcript viewer, and prompt diff before/after training.

The existing compact pill picker in the composer keeps working — just gains a "Manage…" link.

## How it works (technical)

### Data model
- New table `public.video_style_presets` (cloud-synced, replaces localStorage as source of truth; localStorage becomes cache).
  - `id`, `user_id`, `name`, `slug`, `prompt`, `builtin_key` (nullable), `ai_trained_prompt` (nullable), `created_at`, `updated_at`
  - RLS: user can only see/edit their own; built-ins seeded per-user on first load.
- New table `public.video_style_references`
  - `id`, `style_id` (FK), `user_id`, `video_url`, `name`, `transcript`, `analysis_json` (camera/pacing/audio notes), `transcribed_at`, `created_at`
- Both tables: standard `GRANT` block + RLS scoped to `auth.uid()`.

### Edge functions
1. **`style-transcribe-reference`** — takes `{ reference_id }`. Reads the row, calls `https://ai.gateway.lovable.dev/v1/audio/transcriptions` with `openai/gpt-4o-mini-transcribe` (streams, then buffered to text), then calls `/v1/chat/completions` with `google/gemini-3-flash-preview` passing the video URL for vision analysis (camera moves, cuts/sec, on-screen text, lighting, audio bed). Writes `transcript` + `analysis_json` back.
2. **`style-train-from-references`** — takes `{ style_id }`. Loads every reference's transcript + analysis, calls `openrouter/owl-alpha` with a synthesis prompt: "Here are N example videos in this style. Write a STYLE/RULES prompt block that, when prepended to a video generation request, will make the output match these examples." Writes result to `ai_trained_prompt` and sets `prompt = ai_trained_prompt` (user can still edit).

### UI changes
- `src/pages/AIStudioStylesPage.tsx` (new) — full manager.
- `src/components/ai/VideoStylesManager.tsx` — add new presets, add training buttons in `StyleEditor`, swap localStorage hook for a cloud-sync hook `useVideoStyles()` backed by the new tables (keeps localStorage as offline cache).
- `src/components/ai/AIStudioTab.tsx` — popover gains "Open full manager →" link to the new page; no other changes (style block injection unchanged).
- `src/App.tsx` — register `/ai-studio/styles` route.

### Migration safety
- Seeder runs once per user on first style fetch: inserts the 6 built-ins with stable `builtin_key`s. Subsequent loads merge new built-ins by `builtin_key` without overwriting user edits.
- Existing localStorage styles auto-migrate into the new table on first cloud load.

## Out of scope (call out if you want them next)
- LoRA/fine-tuning the actual video models (Seedance/HappyHorse don't expose that). "Training" here means prompt synthesis from your examples — which is what actually moves the needle on these models.
- Sharing styles across teammates (per-user only for now).
- Bulk reference upload via folder import.
