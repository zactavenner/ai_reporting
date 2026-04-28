## Goal

Two ads-manager surfaces exist today:
- **`AdminAdsManagerTab`** (agency-wide, `Index.tsx` → `/ads-manager`) — feature-rich: KPI bar, on/off toggles, ad cards, create campaign/ad, drilldown.
- **`AdsManagerTab`** (per-client in `ClientDetail`) — older table view, auto-syncs on date change, has "create variation task" + brief generator, but lacks on/off toggles, no create-campaign, no Meta vs CRM split, no ad-card grid.

Result: managing campaigns and reviewing performance feels inconsistent depending on where you enter. The plan fixes the gaps that matter most for "works out of box."

## What's broken / missing today

1. **Create Campaign requires manually pasting Page ID + Pixel ID + Page IDs for every ad** — friction kills the "out of box" promise. We already sync ad accounts, so we can fetch the Pages/Pixels owned by the account.
2. **No inline budget edit** — to change a $50/day ad set you must leave the app. We have a `toggle-meta-status` function but no `update-meta-budget` equivalent.
3. **No duplicate / quick-relaunch** — common workflow when iterating winners.
4. **Per-client `AdsManagerTab` is a parallel codebase** — missing on/off toggles, missing create-campaign button, missing Meta-vs-CRM lead split. Users on a client page can't manage Meta from there.
5. **Performance review is hard:** no winner/loser highlighting beyond a single trophy icon, no "underperformers needing pause" signal, no quick filter for "spent > X with 0 funded".
6. **Auto-sync on every date change** in `AdsManagerTab` (line 228-238) re-hits Meta API constantly when scrubbing dates — should debounce or only sync stale data.
7. **CreateAdDialog** asks for Page ID again per ad — redundant if we cached it from the account.

## Plan

### 1. Auto-discover Page & Pixel per ad account (eliminates manual IDs)
- New edge function `fetch-meta-account-assets` — given a clientId, calls Meta Graph for `/{adAccount}/promote_pages`, `/{adAccount}/adspixels`, `/{adAccount}/instagram_accounts`. Caches into a new `meta_ad_accounts` columns: `pages jsonb`, `pixels jsonb`, `instagram_actors jsonb`.
- `CreateCampaignDialog` and `CreateAdDialog`: replace text Inputs for Page/Pixel/IG with `Select` populated from cached assets. Auto-pick first if only one. Fall back to manual entry if the account has none cached yet (shows "Refresh assets" button calling the fetch fn).

### 2. Inline budget editing
- New edge function `update-meta-budget` — body `{ clientId, level: 'campaign'|'adset', rowId, dailyBudgetCents?, lifetimeBudgetCents? }`. Calls Meta `POST /{id}` with the budget field; updates local row.
- Add an editable budget cell in the campaign/ad-set tables of `AdminAdsManagerTab` (click-to-edit input → save on blur/Enter, optimistic update with toast).

### 3. One-click duplicate
- New edge function `duplicate-meta-object` — body `{ clientId, level, rowId, newName }`. Uses Meta's `/{adset_id}/copies` and `/{ad_id}/copies` endpoints, then re-syncs that single object.
- Row-action menu (3-dot) in campaign/ad-set/ad rows with: Duplicate, Pause, Edit budget, Open in Meta Ads Manager (deep link).

### 4. Unify per-client view with admin view
- Replace `AdsManagerTab` body with the same table/grid + KPI bar from `AdminAdsManagerTab`, but pre-scoped to the single `clientId` (hide client column, hide client filter, keep New Campaign + Sync visible).
- Extract shared pieces into `src/components/ads-manager/shared/`:
  - `MetricsKpiBar.tsx`, `CampaignsTable.tsx`, `AdSetsTable.tsx`, `AdsGrid.tsx`, `useAdsManagerData.ts` (hook taking `{ clientId? }`).
- Both `AdminAdsManagerTab` and `AdsManagerTab` become thin wrappers that pass scope.
- Keep `AdsManagerTab`-only features (Generate Brief, Variation Task) as additional toolbar buttons in the per-client wrapper.

### 5. Performance review signals
- Add a "Health" column / chip per row computed client-side:
  - 🏆 **Winner** — ROAS > 3 OR (spend > $1k AND CTR > 1%) with funded > 0
  - ⚠️ **Underperforming** — spend > $500 AND attributed_funded = 0 AND age > 7 days
  - 🆕 **Learning** — spend < $50 OR age < 3 days
- Quick-filter chips above the table: All / Winners / Underperforming / Learning.
- Sortable by `roas` (computed) and `cost_per_funded`.

### 6. Smarter sync
- Debounce auto-sync in `AdsManagerTab` to only fire when user *settles* on a range for >3s, AND skip if `meta_ads_last_sync` is < 15 min old for that range.
- Add a small "Stale (synced 2h ago) — refresh?" pill instead of silent re-sync.

### 7. Polish
- `CreateAdDialog`: drop the Page ID input (auto from account), add multi-file upload (queue 2–10 ads at once, all into the same ad set).
- `AdHDPreviewDialog`: add `Open in Meta Ads Manager` link, `Duplicate this ad`, `Pause this ad` buttons in footer.
- Empty state on per-client view: "No Meta ad account connected — open Settings" with a deep link.

## Files

**New**
- `supabase/functions/fetch-meta-account-assets/index.ts`
- `supabase/functions/update-meta-budget/index.ts`
- `supabase/functions/duplicate-meta-object/index.ts`
- `src/components/ads-manager/shared/useAdsManagerData.ts`
- `src/components/ads-manager/shared/MetricsKpiBar.tsx`
- `src/components/ads-manager/shared/CampaignsTable.tsx`
- `src/components/ads-manager/shared/AdSetsTable.tsx`
- `src/components/ads-manager/shared/AdsGrid.tsx`
- `src/components/ads-manager/shared/RowActionsMenu.tsx`
- `src/components/ads-manager/shared/HealthChip.tsx`
- `src/components/ads-manager/shared/EditableBudgetCell.tsx`

**Edited**
- `src/components/ads-manager/AdminAdsManagerTab.tsx` (becomes wrapper, ~250 lines)
- `src/components/ads-manager/AdsManagerTab.tsx` (becomes wrapper, ~150 lines)
- `src/components/ads-manager/CreateCampaignDialog.tsx` (Select-based Page/Pixel)
- `src/components/ads-manager/CreateAdDialog.tsx` (auto Page, multi-file)
- `src/components/ads-manager/AdHDPreviewDialog.tsx` (action buttons)

**Migrations**
- `meta_ad_accounts`: add `pages jsonb`, `pixels jsonb`, `instagram_actors jsonb`, `assets_synced_at timestamptz`.

## Out of scope (this pass)
- Audience builder (interests/lookalikes/saved audiences) — keep linking to Meta for now
- A/B test framework
- Google Ads parity (admin tab is `platform="all"` but only Meta wired)

Approve and I'll build it in default mode.