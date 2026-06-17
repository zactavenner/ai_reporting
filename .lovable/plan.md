## Goal
Let the team add a creative to the approval flow by pasting a **Canva share link** instead of uploading a file. The card shows a live Canva preview (iframe), supports approval/revision comments like any other creative, and an "Edit in Canva" button opens the design directly for editing — no upload/delete/re-upload churn.

## How Canva embedding works
Canva supports public embeds on shared designs:

```text
Share link:   https://canva.link/wo4sn4zhx5crkvm
Resolved to:  https://www.canva.com/design/DAG.../view?utm_content=...
Embed URL:    https://www.canva.com/design/DAG.../view?embed
```

Short `canva.link/*` URLs 302 to the full `canva.com/design/<id>/view` URL. We resolve once (edge function follows the redirect), store the canonical design URL, and render `<iframe src="<designUrl>?embed">` for the preview. "Edit in Canva" opens `https://www.canva.com/design/<id>/edit` in a new tab.

## Changes

### 1. DB — extend `creatives` table
Add nullable columns (no breaking changes to existing rows):
- `canva_url text` — canonical `canva.com/design/<id>/view` URL
- `canva_design_id text` — extracted design id (for the `/edit` deep link)
- `source_type text` — `'upload' | 'canva'` (default `'upload'`)

### 2. Edge function — `resolve-canva-link`
- Input: `{ url }` (accepts `canva.link/*` or full `canva.com/design/...`).
- Follows redirects with `fetch(url, { redirect: 'manual' })` loop, returns `{ canvaUrl, designId }`.
- Rejects non-Canva hosts.

### 3. UI — "Add Canva creative" in `CreativeApproval`
New button next to the existing upload action opens a small dialog:
- Paste Canva share link
- Name (optional, defaults to "Canva design")
- Platform / aspect ratio selectors (same as upload flow)
- On submit → call `resolve-canva-link` → insert row into `creatives` with `source_type='canva'`, `canva_url`, `canva_design_id`, `type='image'`.

### 4. Creative card rendering
In the existing creative card component, when `source_type === 'canva'`:
- Replace the image/video preview with `<iframe src="${canva_url}?embed" loading="lazy" allow="fullscreen" />` inside an `AspectRatio` wrapper matching the selected ratio.
- Show a Canva badge in the corner.
- Add an **"Edit in Canva"** button (alongside Approve / Request revision) that opens `https://www.canva.com/design/<designId>/edit` in a new tab.
- Approval, comments, revision-request flow stays identical — they operate on the `creatives` row, not the asset file.

### 5. No changes to ad-launch flow
Canva creatives are for **approval only**. When the team is ready to push to Meta, they still export from Canva and use the existing upload flow — Meta's API needs an actual image/video file. (Happy to add a "Mark as exported / attach final file" step in a follow-up if you want that loop tightened.)

## Out of scope
- Pushing Canva designs directly to Meta (Canva Connect API + OAuth — separate effort).
- Auto-syncing edits from Canva (no webhook — the embed always shows the latest published version automatically).

## Open question
Edit links: do you want **"Edit in Canva"** to open the team's shared Canva workspace edit URL (`/design/<id>/edit`, requires team membership), or keep it as **"Open in Canva"** (view link, anyone with the link)? Default plan = edit link.
