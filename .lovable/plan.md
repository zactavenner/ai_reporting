## AI Studio v3 — Plan to maximize ad conversion + speed

Goal: turn AI Studio from a freeform "chat + canvas" into an **ad-production line** that reliably outputs scroll-stopping static + video ads, with the shortest path from idea → reviewed asset → live ad.

---

### Current state (audit)

- **Tools**: `generate_static_ad` (GPT Image 2 / Nano Banana 2), `edit_static_ad`, `generate_ad_variations`, `plan_storyboard` + `generate_scene_image` + `generate_scene_video` (Veo 3.1), `generate_seedance_video` (Bytedance Seedance / Kling), `create_text_artifact`.
- **Canvas** auto-aligns new images sequentially; "Send to Creatives" button exists.
- **Gaps for ads conversion**:
  1. No **ad-format presets** (Meta 1:1/9:16 placement-safe, story-safe-zones, native vs. UGC look).
  2. No **hook library / proven framework** baked into prompts (PAS, AIDA, Hook-Promise-Proof-CTA, scroll-stoppers, pattern interrupts).
  3. Storyboard scene-by-scene is slow & sequential; no **batch parallel generation** with progress, and no auto-stitch.
  4. No **image→full ad pipeline** (one click: keyframe → static ad variants → 9:16 video → captioned reel).
  5. No **A/B variant explosion** (one brief → 6 hooks × 3 visuals × 2 CTAs auto-laid-out).
  6. No **captions/subtitles** burned into video (huge conversion lever on Meta).
  7. No **brand guard** check on output (logo/colors/disclaimers) — relies only on prompt injection.
  8. No **direct handoff to Ads Manager** (upload to Meta as draft ad with copy + UTM-tagged URL).
  9. No **performance feedback loop** — Studio doesn't know which past creatives won; can't say "make more like winner X".

---

### Phase 1 — Conversion fundamentals (1–2 days, highest ROI)

1. **Ad Format Presets** in composer
    - Buttons: `Meta Feed 1:1`, `Meta Reel 9:16`, `Story 9:16`, `YouTube 16:9`, `TikTok 9:16`.
    - Each preset injects: exact dims, safe zones, text-overlay placement rules, platform-native style hints, file-size targets.
2. **Hook Framework Picker**
    - Dropdown: PAS / AIDA / Hook-Promise-Proof-CTA / Pattern Interrupt / Testimonial / Curiosity Gap / "Stop scrolling because…".
    - System prompt expands chosen framework into the script + on-image text rules.
3. **Brand Guard pass** (new tool `brand_guard_check`)
    - After every static ad render, Gemini-2.5-flash sanity-checks: logo present, colors match brand, no banned words, disclaimer present for capital-raising clients (re-uses existing compliance memory).
    - Auto-regenerates with a corrective prompt if it fails (max 1 retry).
4. **Captioned video** — extend `generate_scene_video` + `generate_seedance_video`:
    - After mp4 returns, run existing `transcribe-audio` + ffmpeg edge step to burn-in styled subtitles (Inter bold, white + black stroke, bottom-third safe).
    - Toggle in composer: "Burn captions ✅".

### Phase 2 — Speed & batch (2–3 days)

5. **Parallel storyboard execution**
    - Replace sequential `generate_scene_image` loop with one fanned-out call that runs N scenes in parallel with a live progress strip on canvas (already supports `canvas_placeholder` events).
6. **Variant Explosion** (new tool `explode_ad_variants`)
    - Input: 1 brief. Output: a grid on canvas — 6 hooks (text overlays) × N visuals × M CTAs, auto-laid in rows. Uses Nano Banana 2 for speed, GPT Image 2 only for the user-picked winner.
7. **Image → Full Ad in one click** (new canvas action)
    - Right-click any image on canvas → "Turn into ad" → runs static-ad pass (adds headline/CTA), then "Turn into reel" → runs Seedance 9:16 with motion prompt auto-derived from image caption.

### Phase 3 — Conversion intelligence (2–3 days)

8. **Winner-aware generation**
    - Pull top performers via existing `get_top_performers` RPC; include their thumbnails + copy in the system context for the active client.
    - New shortcut chip: **"Make 5 more like our top performer"** → Studio uses the winner as a reference image to `generate_ad_variations`.
9. **Compliance & disclaimer auto-insert** for capital-raising clients (memory rule already exists; enforce in `generate_static_ad` server-side, not prompt).

### Phase 4 — Deploy (1–2 days)

10. **One-click "Push to Meta Draft Ad"** from canvas
    - New button on every image/video card. Calls existing `create-meta-ad` with: client's ad account, chosen campaign/adset (or "create new draft adset"), creative file, primary text + headline + description (Studio auto-fills from the artifact), URL with auto-built UTMs (per Phase 1 UTM builder in the prior Ads Manager plan).
11. **"Send to Creatives for Approval"** already exists — extend it to attach the burned-caption mp4 + all variants from Variant Explosion as a single approval bundle, and notify the client via existing `send-client-notification` (SMS+email).

---

### Technical implementation notes

- **No new tables required** for Phases 1–2. Phase 3 reuses `meta_ads` (top-performers RPC). Phase 4 reuses `creatives`, `client_assets`, `meta_ads` and existing edge fns.
- **New edge functions**: `burn-captions` (ffmpeg via remotion-style render or just ffmpeg in deno-compatible container — likely simplest: small Node service called from edge), `brand-guard-check`, `explode-ad-variants` (thin wrapper around existing image gen).
- **Modified edge fns**: `ai-studio` (new tools + system prompt updates), `generate-static-ad` (server-side brand+compliance enforcement), `generate-scene-video` (caption burn step), `create-meta-ad` (accept Studio asset URLs).
- **UI changes (frontend only for most)**: `AIStudioTab.tsx` composer chips (format presets, framework picker, captions toggle, "more like winner"), `AIStudioCanvas.tsx` (variant-grid layout, right-click → "Turn into ad/reel", "Push to Meta" button per card).
- **AI gateway**: continue using existing models per memory — Nano Banana 2 fast path, GPT Image 2 for finals, Veo 3.1 + Seedance for video, Gemini 2.5 flash for brand guard. No new keys.

---

### Suggested execution order (incremental, shippable)

1. Phase 1 (presets + framework + brand guard + captions) — biggest conversion lift, lowest risk.
2. Phase 2 (parallel + variant explosion + one-click pipeline) — biggest speed lift.
3. Phase 4 (Meta draft push) — biggest deploy-time lift.
4. Phase 3 (winner-aware) — biggest long-term compounding.

Ship Phase 1 first?
