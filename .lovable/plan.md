## Goal

Turn the existing AI Studio tab into a Manus-style autonomous agent. The user types one brief ("make me a 30s ad about X"), the agent plans a storyboard, generates a keyframe image per scene, animates each into video, and streams everything onto a redesigned canvas — fully automatic, no checkpoints. Final scenes land separately on the canvas (no auto-stitch).

Building on what already exists: `ai-studio` edge fn (SSE streaming + tool loop), `generate_static_ad` tool, `generate-broll` (Veo3 text→video), `generate-video-from-image` (image→video), `poll-video-status`, `ai_studio_canvas_items` table, and `AIStudioCanvas` component.

---

## 1. New agent tools (server)

Add to `supabase/functions/ai-studio/index.ts` tool registry:

- **`plan_storyboard`** — input: `{ brief, scene_count?, aspect_ratio, style_notes? }`. Calls Gemini for structured JSON: `{ scenes: [{ order, title, image_prompt, video_prompt, duration }] }`. Streams a `storyboard` SSE event so the canvas can render skeleton scene cards immediately.
- **`generate_scene_image`** — input: `{ scene_id, prompt, aspect_ratio, reference_image_url? }`. Uses Gemini 3 Pro Image (same path as `generate_static_ad`), saves to `creatives/ai-studio/{clientId}/scene-{id}.jpg`, inserts `client_assets` row, emits `canvas_item` (kind: `scene_image`, scene_id).
- **`animate_scene`** — input: `{ scene_id, image_url, video_prompt, aspect_ratio }`. Invokes `generate-video-from-image`, returns `{ operationId }`. Emits `canvas_placeholder` (kind: `scene_video`, scene_id) so a loading tile appears.
- **`poll_scene_video`** — input: `{ scene_id, operation_id }`. Wraps `poll-video-status`. The agent loop calls this in a small `await` cycle (sleep 5s, max 60 attempts). On success: upload MP4 to `creatives` bucket, insert `client_assets` (asset_type=`scene_video`), emit `canvas_item`.

Tool-loop limits: bump max steps to 50 (`stepCountIs(50)` equivalent). System prompt updated to: "You are an autonomous creative agent. When asked to make a video/ad/scene, ALWAYS run plan_storyboard first, then for each scene in parallel call generate_scene_image → animate_scene → poll_scene_video. Stream a one-line status between batches. Never ask the user for approval."

Parallelism: agent fans out scenes via parallel tool calls (OpenAI tool-calling already supports multi-call per turn). The edge fn already iterates `toolCallsAcc` — wrap the body in `Promise.all` for parallelism.

## 2. Schema additions

Migration:
- Add columns to `ai_studio_canvas_items`: `kind text` (`static_ad` | `scene_image` | `scene_video` | `storyboard`), `scene_id text` nullable, `scene_order int` nullable, `parent_storyboard_id uuid` nullable, `metadata jsonb`.
- New table `ai_studio_storyboards`: `id`, `conversation_id`, `client_id`, `user_id`, `brief`, `aspect_ratio`, `scenes jsonb`, `status` (`planning`|`generating`|`complete`|`failed`), timestamps. RLS scoped to `auth.uid() = user_id`.

## 3. Canvas redesign (`AIStudioCanvas.tsx`)

Restructure into a Manus-style 3-pane layout inside the existing AI Studio tab:

```text
┌────────────┬───────────────────────────┬──────────────┐
│ Chat (left)│ Canvas (center)           │ Task panel   │
│            │                           │ (right)      │
│ messages   │ Storyboard strip          │              │
│ + input    │ ┌──┬──┬──┬──┐             │ ▸ Plan       │
│            │ │S1│S2│S3│S4│ scenes      │ ▸ Scene 1    │
│            │ └──┴──┴──┴──┘             │   img ✓ vid⏳│
│            │ Selected scene: image+vid │ ▸ Scene 2 …  │
│            │ + prompts (read-only)     │              │
└────────────┴───────────────────────────┴──────────────┘
```

Components:
- `StoryboardStrip` — horizontal scroll of scene cards. Each card shows status badges (planned / image-ready / rendering / done) and click-to-select.
- `SceneDetail` — selected scene shows keyframe image + video player + the prompts used.
- `AgentTaskPanel` — live tree of agent steps (driven by SSE `tool_start`/`tool_end` events), collapsible per scene. Mirrors Manus's "step list".
- Existing chat composer stays; remove the standalone "Generate ad" affordances since the agent now handles intent.

Realtime: subscribe to `ai_studio_canvas_items` via Supabase realtime (already partially wired) and group by `parent_storyboard_id`/`scene_id`.

## 4. SSE event additions

New event types streamed from edge fn → consumed by the client:
- `storyboard` — `{ id, scenes: [...] }` rendered as initial skeletons.
- `scene_status` — `{ scene_id, phase: 'image'|'video', state: 'started'|'ready'|'failed' }` drives task panel + card badges.
- (existing) `canvas_item` reused for scene assets, with new `kind` field.

## 5. Out of scope (per user answers)

- No checkpoint/approval gates (fully auto).
- No stitched final MP4 (scenes stay separate; user can use existing video editor).
- No new top-level page (lives inside AI Studio tab).
- No MCP/Higgsfield wiring (separate request).

## 6. Files to touch

- `supabase/migrations/<new>.sql` — canvas_items columns + storyboards table.
- `supabase/functions/ai-studio/index.ts` — 4 new tools, parallel tool execution, system prompt, new SSE events.
- `src/components/ai/AIStudioCanvas.tsx` — split into `StoryboardStrip`, `SceneDetail`, `AgentTaskPanel` subcomponents.
- `src/components/ai/AIStudioTab.tsx` — 3-pane layout wiring + new SSE event handlers.
- `src/types/ai-studio.ts` (new) — shared types for storyboard / scene events.

## 7. Risks

- Veo3 video gen takes ~30–90s/scene; for a 5-scene ad that's parallel ~90s wall time. Need progress UI to keep user engaged — task panel handles this.
- Edge function CPU time: keep `poll_scene_video` inside the tool loop bounded; if Veo job exceeds 5min, mark scene `failed` and continue (don't block other scenes).
- Cost per run is non-trivial (5 Pro Image calls + 5 Veo3 calls). No throttle in scope; rely on existing rate limiter table if needed later.