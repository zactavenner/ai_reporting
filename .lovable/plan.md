# Bulletproof Lead Sync — CRUD-like Reliability (Databox-style)

## Problem

Lead sync is unreliable: GHL contacts/leads sometimes don't appear, updates lag, and there's no clear audit trail of what synced, what failed, and why. Current flow mixes real-time webhooks, master syncs, and manual triggers without strong guarantees.

## Goal

Make every new lead and every update flow into our DB with **at-least-once delivery, idempotent writes, full observability, and automatic recovery** — the way Databox handles connector data.

---

## Architecture (4 layers)

### 1. Ingestion — multiple redundant entry points
Every lead can enter through any of these, and they all converge on the same writer:
- **Real-time webhook** (`webhook-ingest`) — GHL/Meta push events
- **Incremental cursor sync** (every 15 min) — pulls anything updated since `last_synced_at`
- **Daily master sync** (3 AM PST) — 30-day rolling window safety net
- **Manual single-contact sync** — user-triggered repair button

### 2. Queue — `sync_queue` table as single source of truth
Instead of edge functions calling each other directly, every sync request becomes a **queued job**:
- `pending` → `processing` → `completed` / `failed`
- Each job has `client_id`, `sync_type`, `external_id`, `payload`, `attempts`, `next_retry_at`
- Dispatcher (cron, every 1 min) picks pending jobs, respects rate limits, marks `processing`
- Failed jobs auto-retry with exponential backoff (1m → 5m → 30m → 2h → dead-letter)

### 3. Writer — single idempotent upsert function
One edge function (`process-lead-upsert`) is the **only** code path that writes to `leads`:
- Input validation with Zod (email/phone/external_id required shape)
- Upsert on `(client_id, external_id)` unique constraint — preserves original `created_at`
- Diff detection: only update changed fields, log the diff to `lead_change_log`
- Triggers downstream: attribution, enrichment, notifications

### 4. Reconciliation — daily integrity check
A `daily-accuracy-check` job (already exists, extend it):
- For each client, count GHL leads in last 7 days vs. our DB
- If delta > 2%, auto-queue a backfill for that window
- Write report to `sync_health` table; surface in admin dashboard

---

## Observability (the Databox part)

New `SyncHealthDashboard` admin tab showing per-client:
- Last successful sync time per source (GHL / Meta / webhook)
- Queue depth (pending / processing / failed)
- 24h success rate %
- Recent failures with error message + retry button
- Lead count delta vs. source-of-truth

Plus structured logs: every queue job logs `{job_id, client_id, source, outcome, duration_ms, error}` so we can grep historical failures.

---

## Recovery & safety

- **Stale job sweeper**: any `processing` job older than 10 min → reset to `pending`
- **Dead-letter inspection**: failed-after-5-attempts jobs visible in admin, one-click requeue
- **Backfill button**: per-client, "resync last N days" enqueues batched jobs (90-day chunks)
- **Webhook deduplication**: `webhook_events` table stores `provider_event_id`, reject duplicates

---

## Build order

1. **Schema**: extend `sync_queue` (add `external_id`, `payload`, `next_retry_at`, `dead_letter`); create `lead_change_log` and `webhook_events` tables; add unique index on `leads(client_id, external_id)` if missing.
2. **Writer**: build `process-lead-upsert` edge function — single idempotent entry point.
3. **Dispatcher**: build `sync-queue-dispatcher` cron (1 min) + stale sweeper (10 min).
4. **Refactor ingestion**: `webhook-ingest`, `sync-ghl-contacts`, `daily-master-sync` all stop writing directly — they enqueue jobs instead.
5. **Reconciliation**: extend `daily-accuracy-check` to enqueue backfills on delta.
6. **Dashboard**: new `SyncHealthDashboard` component under admin → Sync Health tab.

Each step ships independently and is backwards-compatible (old direct-write paths stay live until the queued path is proven).

---

## Technical details

- **Idempotency key**: `sha256(client_id + external_id + source)` on every queue job; duplicate enqueues are no-ops
- **Rate limits**: dispatcher reads `api_usage` table (already exists), throttles per-provider
- **Retry policy**: `attempts < 5`, backoff `min(2^attempts * 60, 7200)` seconds
- **Realtime**: enable Supabase realtime on `sync_queue` so the dashboard updates live
- **Cron**: pg_cron for dispatcher + sweeper; existing daily cron triggers untouched

---

## What this fixes

- Webhook drops → caught by 15-min cursor sync
- Cursor sync misses → caught by daily 30-day window
- Daily sync misses → caught by reconciliation delta check
- Edge timeouts → jobs resume from queue, not lost
- Duplicate writes → upsert on unique constraint, no-op
- Silent failures → visible in dashboard with one-click retry

Ready to start with **Step 1 (schema)** on your approval.