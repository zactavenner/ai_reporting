## Goal
Make Meta + GHL data flow into every client **on a schedule, with self-healing**, so the dashboards match Databox-level reliability without manual intervention.

## What's already built (good news)
- `sync-meta-ads` — pulls campaigns/adsets/ads + insights from Graph API
- `sync-ghl-contacts` — pulls leads, calls (booked/showed), appointments
- `sync-ghl-pipelines` — pulls opportunities (commitments, funded) from GHL pipelines
- `daily-master-sync` — fans out the three above per active client (fire-and-forget, staggered)
- `recalculate-daily-metrics` — rebuilds the `daily_metrics` table the dashboards read
- `daily-accuracy-check` — reconciles totals after sync and flags drift
- `ghl-daily-reconciliation` — re-pulls last 14 days to catch backdated edits
- `sync-watchdog` — clears stuck jobs and force-fires master sync if it hasn't run in 25h
- `sync-queue-dispatcher` (every minute) + `sync-queue-worker` — backfill queue
- `webhook-ingest` + `meetgeek-webhook` + `fathom-webhook` — real-time inbound

## What's broken / missing (the actual problem)
1. **No cron runs `daily-master-sync`.** Today it only fires when the watchdog notices nothing has run in 25h — so syncs slip by a full day before recovery. That's the #1 reliability gap.
2. **No cron runs `ghl-daily-reconciliation`** or `daily-accuracy-check` triggered from a guaranteed clock — only manual.
3. **No cron runs `sync-watchdog`** itself, so the self-healing layer relies on something else firing it.
4. **No hourly delta sync.** Meta + GHL only refresh once a day. Databox-feel needs hourly.
5. **No per-client failure alerting.** A client whose Meta token expires silently stops updating until someone notices.
6. **Sync runs are not idempotent at the dispatch level** — the watchdog can fire master sync while a manual one is mid-flight.

## Implementation

### 1. Schedule the master pipeline (the core fix)
Add 5 `pg_cron` jobs that hit existing edge functions via `net.http_post`:

```text
*/30 * * * *   sync-master-hourly        → daily-master-sync (last 3 days window)
0 9 * * *      sync-master-daily-9am-utc → daily-master-sync (last 30 days window)  ← 2am PST
30 9 * * *     ghl-reconcile-daily       → ghl-daily-reconciliation (last 14 days)
0 11 * * *     daily-accuracy-check      → daily-accuracy-check (already exists, but re-confirm)
*/15 * * * *   sync-watchdog             → sync-watchdog
```

The 30-minute hourly window gives near-real-time freshness; the daily 30-day pass catches backdated CRM edits; the watchdog cleans up.

### 2. Dispatch lock (idempotency)
Add a tiny `sync_dispatch_lock` row check at the top of `daily-master-sync`: if a master run started <10 min ago and is still `running`, return early. Prevents the watchdog and the new cron from double-firing.

### 3. Per-client failure surfacing
Create one edge function `sync-failure-digest` (already exists — wire it to a cron):

```text
0 16 * * *  sync-failure-digest-daily  → sync-failure-digest
```

It scans `sync_runs` from the last 24h, finds any client where Meta or GHL sync failed twice in a row, and:
- writes a row to `sync_warnings`
- (optionally) posts to the existing Slack integration

The frontend Sync Health page already reads `sync_warnings`, so the user sees red dots without us building new UI.

### 4. Token-expiry pre-check
`sync-meta-ads` already handles 60-day token expiry. Add one new column `clients.meta_token_expires_at` (already exists per memory) and have `sync-watchdog` flag any client whose token expires in <7 days into `sync_warnings`. No new function, just 15 lines added to the watchdog.

### 5. Verify-on-deploy
After the cron jobs are inserted, run one manual `daily-master-sync` against all active clients and tail `sync_runs` to confirm Meta + GHL + recalculate all completed green for each client. This is the proof the pipeline works end-to-end.

## Technical details

**Cron registration** uses `supabase--insert` (per Lovable rules — schedules contain the project URL + anon key, so they're not safe in migrations that get remixed). Each job calls the edge function with `Authorization: Bearer <anon_key>` and a JSON body.

**Files touched**
- `supabase/functions/daily-master-sync/index.ts` — add dispatch lock (early-return if running run <10 min old exists)
- `supabase/functions/sync-watchdog/index.ts` — add Meta-token-expiry scan that writes to `sync_warnings`
- No new edge functions — everything else exists already

**Files NOT touched** — `sync-meta-ads`, `sync-ghl-contacts`, `sync-ghl-pipelines`, `recalculate-daily-metrics`, `ghl-daily-reconciliation`, `daily-accuracy-check`, `sync-failure-digest` are already production-tested. Adding a cron entry is all they need.

## What this gets you
- **Data freshness**: ≤30 min for Meta + GHL leads/calls/pipelines
- **Self-healing**: stuck jobs auto-cleared every 15 min, missed master sync auto-fires within 30 min, backdated edits caught by daily 30-day pass + 14-day reconciliation
- **Visibility**: any client whose sync has been failing or whose token is expiring shows up in the existing Sync Health page automatically
- **No double-runs**: dispatch lock guarantees one master sync at a time

## Out of scope (call out if you want them next)
- Real-time Meta ads webhooks (Graph API doesn't push insights — polling is the only option, this is what Databox does too)
- HubSpot pipeline (separate cron already exists for HubSpot contacts)
- Custom per-client schedules (everyone gets the same 30-min cadence)