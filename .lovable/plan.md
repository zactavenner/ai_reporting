# Plan: Google Sheets as primary data source for ALL clients

The current DB-driven metrics are unreliable. We make the Google Sheet the system of record. Each client's dashboard, public report, and Lovable AI all read directly from that client's sheet. The DB stays in place as a backup/comparison only.

The master template is the sheet you shared:
`https://docs.google.com/spreadsheets/d/1tm-qpPRzv38JtIL9-KvZVThqTk4OJcWv3duw8H2KHhY/edit`
with tabs: `SCORECARD-26`, `Media Buying Updates`, `FB Spend`, `Leads`, `Bad Leads`, `Discovery Call`, `Discovery Call Outcomes`, `Reconnect Call`, `Committed Investors`, `Funded Investors`, `Reconnect Call Show`, plus any others.

## What you'll see

### 1. Per-client sheet binding (Settings)
On every client's Settings tab, a new "Data Source – Google Sheet" section:
```text
Master template: [Open template]
Client sheet URL: [ paste sheet link               ] [ Test ]
                  ✓ Connected · 11 tabs detected · synced 12s ago
Default source:  ( ● Sheet   ○ Database )
```
- One field: paste the client's sheet URL (we extract `sheet_id`).
- "Test" button verifies access and lists detected tabs.
- "Default source" defaults to **Sheet** for every client going forward.

### 2. Dashboard (ClientDetail + PublicReport)
The existing `MetricsSourceToggle` already exists; we make **Sheet the default** when a sheet is bound, and surface it on every tab — not just KPIs.

Every tab in the client view becomes sheet-driven when source = Sheet:

| Dashboard tab        | Source tab(s) in the sheet                                  |
|----------------------|-------------------------------------------------------------|
| Performance / KPIs   | `SCORECARD-26` (monthly + daily totals, all KPI rows)       |
| Attribution & Records → Leads | `Leads` + `Bad Leads`                              |
| Attribution & Records → Calls | `Discovery Call` + `Discovery Call Outcomes` + `Reconnect Call` + `Reconnect Call Show` |
| Attribution & Records → Funded | `Committed Investors` + `Funded Investors`        |
| Ads Manager (spend)  | `FB Spend`                                                  |
| Weekly Sync notes    | `Media Buying Updates`                                      |

Each table view shows a small badge "Source: Google Sheet · {tab name} · 245 rows · synced 2m ago" with a Refresh button.

### 3. New "Sheets Health" page (agency-wide)
A small admin page at `/sheets-health` listing every client × sheet status:
```
Client                 Sheet bound  Last sync   Tabs OK   Errors
Blue Capital           ✓            45s         11/11     —
Granite Towers         ✓            2m          10/11     "Funded Investors" empty
Nationwide Paving USA  ✗ not bound  —           —         needs URL
```
Lets you spot which clients still need a sheet and which sheets have schema drift.

### 4. Lovable AI sees the sheet
The AI-context edge function (`ai-agent-full-context`) is updated so when source = Sheet, it pulls the same normalized sheet data and feeds it into the AI prompts. Analysis and chat answers reflect what's in the sheet, not the DB.

## How it works

1. **One master template, copied per client.** You (or we, on request) "Make a copy" of the master sheet for each client and share it with the connector's Google account so it has read access. Paste the URL into Settings.
2. **`fetch-sheet-metrics` (existing)** is extended to handle the full SCORECARD layout (monthly columns + per-month daily breakdown) so KPI cards, trend charts, and the funnel render from the sheet.
3. **`fetch-sheet-records` (new)** reads the record-style tabs (`Leads`, `Bad Leads`, `Discovery Call`, etc.), normalizes them into our standard `Lead` / `Call` / `Funded` shapes, and returns paginated results with a date filter.
4. **`useActiveLeads`, `useActiveCalls`, `useActiveFunded`** wrappers pick Sheet vs DB so existing tables/components don't change.
5. **Caching:** 2-min React Query stale time + an explicit Refresh button on every tab. A 30-min background poll keeps "synced X ago" warm without hammering the API.
6. **Default flip:** every existing client's `metrics_source_default` is set to `'sheet'` once a `metrics_sheet_id` is saved. Database mode is still selectable from the toggle for side-by-side debugging.

## Tab → field mapping (defaults, overridable per client)

The existing column/row alias detector covers most of the master template. We add aliases for the new record tabs:

```text
Leads / Bad Leads tab:
  date     ← "Date" / "Created" / "Lead Date"
  name     ← "Name" / "Full Name"
  email    ← "Email"
  phone    ← "Phone" / "Phone Number"
  source   ← "Source" / "UTM Source" / "Campaign"
  spam?    ← presence in `Bad Leads` tab OR a "Spam" Y/N column

Discovery Call / Reconnect Call tabs:
  date     ← "Booked" / "Call Date"
  contact  ← "Name" / "Email"
  showed?  ← "Showed" Y/N or presence in `Discovery Call Outcomes` "Showed" column
  outcome  ← "Outcome" / "Disposition"

Committed / Funded Investors tabs:
  date     ← "Committed Date" / "Funded Date"
  name     ← "Investor"
  amount   ← "Amount" / "Committed $" / "Funded $"
```

If a client's sheet diverges, the existing "Edit mapping" modal extends to cover record tabs too (saved per-client in `client_settings.metrics_sheet_mapping`).

## Technical details

- **DB migration**: no new columns needed (the four `metrics_sheet_*` columns already exist on `client_settings`). We just need to flip `metrics_source_default = 'sheet'` once a sheet is bound, via a trigger.
- **`fetch-sheet-metrics`**: extend column-major parser to also emit per-day daily rows from the daily breakdowns inside `SCORECARD-26` (currently it handles the monthly totals well; daily expansion is partial). Also return the per-tab health (`{ tab, rows, lastNonEmptyDate, missingFields[] }`) used by the new Sheets Health page.
- **`fetch-sheet-records` (new edge function)**: same auth pattern (`LOVABLE_API_KEY` + `GOOGLE_SHEETS_API_KEY`), takes `{ sheet_id, tab, kind: 'lead'|'call'|'funded', start_date, end_date, mapping? }`, returns `{ rows, count, fetchedAt }`. Uses batchGet to pull multiple tabs in one round-trip when kind is composite (e.g. calls = Discovery + Reconnect).
- **New hooks**:
  - `useActiveMetrics(clientId, dateRange)` — existing sheet hook + DB fallback under one roof.
  - `useActiveLeads`, `useActiveCalls`, `useActiveFunded` — same pattern for record tables.
  - `useSheetsHealth()` — agency-wide list, queries each bound sheet's metadata via batchGet.
- **Settings UI**: new `<ClientSheetBindingCard />` in `ClientSettings.tsx` (paste URL, Test, default-source radio).
- **Toggle defaulting**: `useMetricsSourcePreference` gets `defaultSource = 'sheet'` whenever `client_settings.metrics_sheet_id` is set; user can still override in localStorage.
- **Public report (`/public/:token`)**: same toggle, but defaults locked to Sheet (no toggle shown unless `?debug=1`).
- **AI context**: `ai-agent-full-context` accepts `source: 'sheet' | 'database'` and, when sheet, fetches the sheet aggregates instead of querying `daily_metrics`.
- **New page**: `src/pages/SheetsHealthPage.tsx` at `/sheets-health`, linked from the Settings cog menu (agency role only). Uses `useSheetsHealth()`.
- **Connector**: relies on the existing `google_sheets` Lovable connector (already linked; `GOOGLE_SHEETS_API_KEY` is in env). Each client sheet must be shared with the connector account — we add a one-time "How to share your sheet" inline help text in the binding card.
- **Rate limits**: Google Sheets API allows 300 read req/min/project; we batch by tab and cache aggressively (2 min stale, 30 min background refresh, manual refresh on demand). Plenty of headroom for ~30 clients.
- **Backfill DB option (out of scope for now, flagged)**: optional nightly job to mirror sheet → `daily_metrics` so historical DB queries still work for non-sheet features. Not built in this pass.

## Rollout

1. Bind the master template URL on **Blue Capital** first (smoke test) — KPIs, records, Ads tabs, Public report, AI chat all reading from sheet.
2. Once green, send you a checklist of the other 30 clients with a one-click "Copy master template & bind" helper button per client (creates a Drive copy via `google_drive` connector and saves the URL).
3. Flip `metrics_source_default = 'sheet'` for any client with a bound sheet.
4. Monitor `/sheets-health` for 48h before deprecating any DB-driven views.

## Out of scope (flag for later)

- Writing back from the dashboard into the sheet (read-only for now).
- Sheet → DB mirroring job.
- Per-row record drilldowns that need fields not present in the sheet (e.g. enrichment data, call recordings) — those still come from DB until you decide whether to add them to the sheet schema.

---

Approve and I'll implement, starting with the binding UI + extended `fetch-sheet-metrics` + `fetch-sheet-records`, then wire the dashboard tabs and the Sheets Health page.