# Campaign Canvas + Nurture Rows

Three changes, scoped to `src/components/funnel/*` and the funnel-steps table. No existing pages/tables renamed — extends only.

## 1. Public preview parity (iPhone dimensions)

`PublicReport.tsx` already renders `<FunnelPreviewTab isPublicView />`, so it inherits the exact same `IPhoneMockup` / `SmsMockup` / `EmailMockup` sizing (320×620 screen). I'll audit the render path to confirm nothing in the public wrapper (page padding, container widths) squashes the mockups, and lock the mockup wrapper to `flex-shrink-0` so parent flex containers can't scale it down.

## 2. Nested nurture rows under a step

Each step becomes a **column**. Below any step (e.g., FB Lead Form, Calendar), the user can attach nurture steps that stack vertically under that column — perfect for "SMS follow-up under lead form" or "appointment reminder SMS under calendar".

**Schema (extend only):**
- Add `parent_step_id UUID NULL REFERENCES client_funnel_steps(id) ON DELETE CASCADE` to `client_funnel_steps`
- Add index on `parent_step_id`
- Existing rows stay `NULL` (= top-level, unchanged behavior)

**UI:**
- Add Step modal gains an optional **"Attach under step"** dropdown listing current top-level steps in that campaign. When set, the new step is a child.
- Each top-level step card renders its children in a vertical stack directly beneath it, with a thin connector line and a "+ Add nurture" affordance under the last child.
- Children can be any step kind, but SMS/Email are the common case.
- Drag-reorder still works among siblings at the same level.

## 3. Zoomable canvas for campaigns

Wrap each `CampaignFlowSection`'s flow area in a pan/zoom canvas using `react-zoom-pan-pinch` (~15KB, actively maintained).

- Floating zoom controls: `-`, `%`, `+`, `Reset` in the top-right of the flow area
- Wheel = zoom, drag empty space = pan, pinch on trackpad = zoom
- Zoom range 40%–200%, default 100%
- Clean minimal styling — a subtle inner shadow to hint the canvas surface, no heavy grid

The campaign header, add-step button, and step editing dialogs stay outside the zoom transform (so buttons are always crisp and clickable at 1×).

## Files touched

- new: `supabase/migrations/<ts>_add_parent_step_id.sql`
- `src/hooks/useFunnelSteps.ts` — add `parent_step_id` to type + insert payload
- `src/integrations/supabase/types.ts` — regenerated field
- `src/components/funnel/FunnelPreviewTab.tsx` — parent picker in add/edit modals, pass parent through to `createStep`
- `src/components/funnel/CampaignFlowSection.tsx` — split steps into top-level + children map, render children column-stacked, wrap in zoom-pan-pinch, zoom toolbar
- `src/components/funnel/FunnelStepCard.tsx` — accept a compact-child variant (smaller header, tighter action bar) so nurture rows read as sub-steps
- `package.json` — add `react-zoom-pan-pinch`

No edge functions, RLS, or other tables touched. No renames.
