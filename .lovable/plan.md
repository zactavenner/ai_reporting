
## Goal

Add a one-click **Captions** button to every video card on the AI Studio canvas. Clicking it opens the existing Hyperframes editor, auto-transcribes the video, and pre-populates it with a **viral-pop** caption style (word-by-word, big bold, yellow active-word highlight). The user can tweak text/timing live in the editor, then export — at which point captions are burned into a new MP4 saved as a child `client_video`.

## User flow

1. Video finishes rendering in AI Studio → card shows `Download | Edit | Captions`.
2. Click **Captions** → Hyperframes opens with the video loaded.
3. Editor auto-runs transcription (existing `transcribe-video` edge function) and converts each word into a Hyperframes `subtitle` layer using the viral-pop preset.
4. User can drag, retime, edit text, change color/size like any other layer.
5. Click **Export** → server-side render bakes captions into MP4, saves to `creatives` bucket as a new `client_videos` row (parent = original), appears back in the canvas.

## What to build

### 1. Caption style preset (frontend)
`src/components/ai/hyperframes/captionPresets.ts` (new)
- `buildViralPopLayers(words, composition)` → returns Hyperframes layers:
  - One `subtitle` layer per word with `start`/`end` from transcript
  - `fontSize` ~9% of height, `fontWeight: 800`, white text, no bg
  - `color: '#FFEB3B'` (yellow) for active word; achieved by stacking one full-line "context" layer (low opacity) + the active word layer popping in with a `spring` scale 0.6→1.1→1 over ~120ms
  - Positioned at `y: 0.78`, `anchor: 'center'`
  - Entrance animation: opacity 0→1 + scale 0.6→1 (`spring`, ~0.2s)
  - Group all caption layers with `id` prefix `cap_` so they're easy to identify, clear, or restyle

### 2. Hyperframes editor entry point
`src/components/ai/hyperframes/HyperframesEditor.tsx` (edit)
- Accept new prop `autoCaptions?: boolean` and `captionStyle?: 'viral-pop'`
- On mount, if `autoCaptions` and no `cap_*` layers exist:
  - Call `transcribe-video` edge function with the video URL
  - Convert returned word-level timings via `buildViralPopLayers`
  - Merge into composition.layers; toast "Captions generated"
- Add a toolbar control "Captions ▾" with: Regenerate · Style: Viral pop / Karaoke (stub) / None · Clear

### 3. Video card button
`src/components/ai/AIStudioCanvas.tsx` (edit)
- Add `<Button>Captions</Button>` next to Download/Edit (uses `Captions` icon from lucide-react)
- Calls a new `onAddCaptions(videoUrl, fallbackVideo)` prop
- Plumb through `AIStudioTab.tsx` to open `VideoEditDialog` with `autoCaptions: true`

### 4. VideoEditDialog
`src/components/ai/VideoEditDialog.tsx` (edit)
- Accept and forward `autoCaptions` to `HyperframesEditor`

### 5. Server-side burn-in on export
`supabase/functions/hyperframes-render/index.ts` (new — or extend existing render fn if present)
- Already-rendered composition path: most Hyperframes layers render in-browser. For burn-in export we need ffmpeg-style overlays.
- Implementation: render frames via existing browser export pipeline (if Hyperframes already has client-side MediaRecorder export, captions are already baked in — confirm during build). If not, add server fn that:
  1. Downloads source MP4
  2. Builds an ASS subtitle file from `cap_*` layers (viral-pop styled via `\fad`, `\t` scale tags)
  3. Runs ffmpeg `-vf "ass=captions.ass"` (requires ffmpeg in edge — fallback to Remotion-style render if not available)
  4. Uploads result to `creatives`, inserts child `client_videos` row
- Decision during build: inspect existing Hyperframes export path first; only add server fn if needed.

### 6. Transcription reuse
- Use existing `supabase/functions/transcribe-video/index.ts` (referenced by `useVideoCaptions`) — returns `{ captions: [{ text, startTime, endTime, words: [{word, startTime, endTime}] }] }`. No backend changes needed.

## Anti-mix-clients safeguard
- Caption layers are scoped to the composition belonging to a single `client_video.id`; they are saved on that video's `composition` JSON only. No cross-client cache key. (Mirrors the safeguard added earlier for video AI Studio prompts.)

## Out of scope
- Karaoke / other caption styles (button stubs only, viral-pop only working preset)
- Auto-generating captions on every new render (per user choice: button-triggered only)
- Multi-language translation of captions

## Files touched

| File | Change |
|---|---|
| `src/components/ai/hyperframes/captionPresets.ts` | new — viral-pop layer builder |
| `src/components/ai/hyperframes/HyperframesEditor.tsx` | auto-transcribe + caption toolbar |
| `src/components/ai/AIStudioCanvas.tsx` | add Captions button on video cards |
| `src/components/ai/AIStudioTab.tsx` | wire `onAddCaptions` → dialog with `autoCaptions` |
| `src/components/ai/VideoEditDialog.tsx` | forward `autoCaptions` prop |
| `supabase/functions/hyperframes-render/index.ts` | new (only if existing export doesn't bake overlays) |

Send the example video + style reference whenever ready — I'll mirror the exact font/spacing/highlight color in `buildViralPopLayers` before shipping.
