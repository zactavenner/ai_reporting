## Goal

Turn the raw embedded reporting sheet into a polished, date-filterable dashboard view — available both on the agency-side client page and on the public client link.

## What you'll see

A new **Sheet Stats** tab in two places:

1. Client detail page (next to the existing *Reporting Sheet* iframe tab)
2. Public client link (same tab, read-only)

Each tab renders:

- A **date filter** scoped to the section (presets: Last 7 / 30 / 90 days, This Month, Last Month, Custom range). Filter state lives in URL (`?stats_from=…&stats_to=…`) so links are shareable and survive refresh.
- **KPI cards** (Leads, Calls Booked, Shows, Funded, Spend, Cost / Lead, Cost / Booked, Cost / Funded, ROAS) with prior-period comparison chips (green when volume up / cost down, red otherwise — matching the existing KPI memory rule).
- **Trend chart** (line/area) of Leads, Spend, Funded over the selected window.
- **Funnel chart** (Leads → Booked → Showed → Funded).
- **Breakdown table** (per-day rows from the sheet) with column visibility toggles and CSV export.
- **Source/footer strip** showing sheet title, last-synced timestamp, row count, and a small "Open sheet" link (agency view only).

All values come from the existing `fetch-sheet-metrics` edge function — no new backend work needed for data fetching.

## How it connects

```text
ClientDetail / PublicReport
        │
        ▼
<SheetStatsTab clientId sheetUrl isPublicView>
        │
        ├── DateFilterBar (URL-synced)
        ├── useSheetMetrics(sheetId, gid, from, to)
        ├── useSheetMetrics(sheetId, gid, priorFrom, priorTo)  // for comparison
        │
        ├── KpiGrid (with prior-period deltas)
        ├── TrendChart  (recharts)
        ├── FunnelChart (recharts)
        └── DailyBreakdownTable
```

## Files touched

- **New** `src/components/sheet-stats/SheetStatsTab.tsx` — orchestrator
- **New** `src/components/sheet-stats/SheetKpiGrid.tsx`
- **New** `src/components/sheet-stats/SheetTrendChart.tsx`
- **New** `src/components/sheet-stats/SheetFunnelChart.tsx`
- **New** `src/components/sheet-stats/SheetDailyTable.tsx`
- **New** `src/components/sheet-stats/SheetDateFilter.tsx` (thin wrapper around existing `DateFilterContext` patterns, scoped to this section via URL params instead of global context so it doesn't fight the page-level date filter)
- **Edit** `src/pages/ClientDetail.tsx` — add `<TabsTrigger value="sheet-stats">` + `<TabsContent>` mounting `SheetStatsTab`. Placed right after the existing *Reporting Sheet* iframe tab so reviewers can flip between raw sheet and dashboard.
- **Edit** `src/pages/PublicReport.tsx` — same, with `isPublicView={true}` so the "Open sheet" link is hidden.

No DB migration, no new edge function. Sheet URL is read from `client_settings.kpi_google_sheet_url` (already used by `useSheetClientMetrics`).

## Design

Apple-style cards consistent with existing dashboard: rounded-2xl glass surfaces, semantic tokens only (`bg-card`, `text-foreground`, `border-border`, `text-emerald-600` for positive deltas, `text-destructive` for negative). Charts use Recharts (already in the project) with the brand forest-green primary and a single accent. Mobile-responsive: KPI grid collapses 4 → 2 → 1.

## Open question (will ask after plan approval if needed)

The sheet may use custom column names per client — the existing `fetch-sheet-metrics` supports an optional `mapping` arg. I'll default to the auto-detected mapping the function already returns; if it misses, you'll see "—" in that KPI tile with a tooltip explaining which column it expected.