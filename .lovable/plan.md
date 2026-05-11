## Goal

Use the shared master spreadsheet (`docs.google.com/spreadsheets/d/1vuD4QA45XuVgRw1SKgq2nlRWJTIjwj4X6avyED5DpKU`) as the agency-wide overview embedded directly on the main client summary page. Each client row in the table continues to drill into its own `ClientDetail`, where the per-client KPI sheet stays the source of truth.

## Behavior

- New "Master Spreadsheet" panel on `/` (above or as a collapsible section next to the client table) showing the master sheet as a live, scrollable iframe with a tab switcher for the most-used tabs (Master Dashboard, Current Clients, HPA SCORECARD 2025, All Funded Investors, Capital Raising Clients, FB Spend - *).
- Each client row in the existing `DraggableClientTable` keeps current behavior: row stats come from that client's `kpi_google_sheet_url`, clicking the row opens `ClientDetail` → "Reporting Sheet" tab.
- Header has "Open in Google Sheets ↗" and a tab dropdown so an admin can jump to any tab without leaving the app.
- Edits made inside the embedded master sheet save in Google Sheets directly (no two-way write needed from our app).

## Settings

- New row in `agency_settings`:
  - `master_google_sheet_url text`
  - `master_default_gid text` (which tab to show first)
  - `master_pinned_gids jsonb` (array of `{gid, title}` for the tab switcher)
- Edit UI lives in **Agency Settings → Integrations → Master Spreadsheet** (admin only via existing `has_role('admin')`).
- Includes "Discover tabs" button that calls `fetch-sheet-metrics` with `action: list_tabs` to populate the pin picker.

## Drill-through

- Master sheet panel is read-only embed for non-admins.
- For admins, a small "Match clients" helper renders below the embed: parses the "Current Clients" tab and shows any client name in that tab that doesn't match a `clients.name` in our DB, with a one-click "Link to existing client" picker. Stored in a new `client_sheet_aliases (client_id, alias)` table so future syncs can resolve aliases.
- This avoids changing how the main client table currently looks or behaves.

## Files to add / change

- DB migration: extend `agency_settings`, add `client_sheet_aliases`.
- Edge function: reuse `fetch-sheet-metrics` (`action: list_tabs`) — no changes needed.
- Hook: `useAgencyMasterSheet()` reading `agency_settings`.
- Components:
  - `src/components/dashboard/MasterSheetPanel.tsx` — collapsible card with tab switcher + iframe.
  - `src/components/settings/MasterSheetSettings.tsx` — admin form (URL + pinned tabs picker).
- Page: `src/pages/Index.tsx` — mount `MasterSheetPanel` above the client table.
- Settings page: insert `MasterSheetSettings` card.

## Out of scope (per your answers)

- Replacing per-client row stats with master-sheet stats.
- Parser/audit fixes to `fetch-sheet-metrics` column-major detection (will track as separate follow-up).
- Public link exposure of the master sheet (admin-only).

## Open follow-ups (not built now)

- Tighten the column-major date parser in `fetch-sheet-metrics` (currently picks up `0250-01-01` style false dates on the Master Dashboard tab).
- Optional later: parse "All Funded Investors" / "Capital Raising Clients" tabs into structured agency views.
