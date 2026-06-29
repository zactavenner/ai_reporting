# Agency Billing & Revenue Dashboard

Internal-only billing operations console for High Performance Ads. Replaces the current `AgencyBillingTab` with a multi-section dashboard layered on Stripe + our existing client/AM data. No client-facing notifications anywhere.

This is a large build. I'll ship it in 3 waves so you can use each stage immediately. Confirm the plan and I'll start Wave 1.

---

## Wave 1 — Foundation + Dashboard shell (ship first)

**Schema (new tables, all RLS-locked to internal team):**
- `billing_agreements` — contract terms per client (base_fee, setup_fee, included_ad_spend, variable_fee_%, performance_fee_%, billing_day, auto_charge, contract dates, approval_required)
- `billing_invoices` — internal invoice ledger (mirrors Stripe + manual invoices, with status, due/paid dates, period)
- `billing_line_items` — breakdown per invoice (base/setup/variable/performance/credit)
- `billing_payments` — payments + attempts (mirrors Stripe charges/PIs, failure_reason, next_retry_date)
- `billing_actions` — internal action queue (issue, priority, due_date, assigned AM, status)
- `billing_notifications` — internal alert log (channel, delivery_status, dedup_key, retry_count)
- `stripe_webhook_events` — raw event log + processing status + dedup
- `billing_audit_log` — who/what/when on every financial action
- Extend `client_team_members` already has notify_prefs; reuse for AM alerts (email/SMS/whatsapp).

All tables: `GRANT` to `authenticated` + `service_role`, RLS = team members only.

**Top of dashboard:**
- 13 KPI cards in a responsive grid (Collected YTD, Collected MTD, Active MRR, Projected MRR, ARPU, Outstanding, Overdue, Failed, Active clients, Active subs, No-sub clients, Target attainment, 30d forecast). Each: value, Δ vs prior period, sparkline, tooltip, click-to-filter.
- Clear visual separation between **collected** vs **forecast** (forecast cards get a dotted border + "Estimate" pill).

**Revenue & Forecast chart (rebuild of current chart):**
- Daily / Weekly / Monthly / Quarterly / Yearly toggles
- Series toggles: Cash collected, Invoices issued, Active MRR, One-time, Variable, Performance, Forecast, Target
- Solid bars = actual, dotted line = forecast, horizontal line = target
- Summary row below: Active MRR, Avg monthly, Actual (period), Forecast, New MRR, Expansion, Contraction, Churned, Net MRR growth
- Click datapoint → drilldown dialog (already partially built, extend to show invoices + payments)

**Billing Action Queue (new component, top of page below KPIs):**
- Tabs: All / Due soon / Invoice needed / Failed / Overdue / Missing PM / Stripe not linked / Fee review / Contract ending / Sub mismatch
- Auto-generated from rules over invoices/subs/agreements + manual entries
- Priority sort, AM avatar, action button per row

---

## Wave 2 — Client table, drawer, calendar

**Client Billing Table (rebuild):**
- Columns per spec including the prominent **Days Until Next Charge** badge (color rules: >7 neutral, 4–7 blue, 1–3 orange, today orange/red, overdue red, none gray)
- Quick filters: Charging today / 3d / 7d / 14d / this month / Overdue / Not scheduled
- Sticky header, search, sort, column filters
- Row actions menu: View, Generate invoice, Send, Charge now, Retry, Edit terms, Link Stripe, Add PM, Pause, Cancel, Apply credit, Mark paid, Add note — all gated by role with confirm modals

**Client Billing Drawer:**
- Summary, AM info, Contract terms, **transparent invoice calculation** (base + ad spend math + variable fee + credits), Invoice history, Payment history
- Pulls live ad spend from existing `meta_ads` / spend tables for %-of-spend math
- Approve / Edit / Generate draft / Charge actions with audit log entries

**Billing Calendar:**
- Month/Week/Agenda views (use existing calendar primitives)
- Events from subscription next_charge_date + scheduled invoices
- Summary cards: charges today/week/month, expected cash week/month

**Reconciliation page:**
- Side-by-side: contract fee vs Stripe sub vs invoice vs charged vs collected
- Auto-flags per spec (mismatch, missing sub, dup charges, unpaid setup, etc.)

---

## Wave 3 — Stripe webhooks + internal AM alerts + forecasting

**Stripe webhook handler (extend existing `stripe-webhook`):**
- Subscribe to: payment_intent.succeeded/failed, invoice.paid/payment_failed, charge.succeeded/failed, customer.subscription.updated/deleted
- Dedup by PI/charge/invoice ID into `stripe_webhook_events`
- On success: update payments/invoice, recompute next_charge, clear related actions, notify AM
- On failure: mark failed, add to action queue, flag client row, notify AM (+ optional billing admin CC)

**Internal AM notifications:**
- Email via Resend (templates per spec — Payment Successful / URGENT Failed)
- SMS via existing GHL agency SMS path (already wired in this project; Twilio optional later)
- In-app notification (reuse `task_notifications` infra)
- Per-client AM lookup via `client_team_members` with role=account_manager
- **Never** message the client. All copy is internal.
- Log every send to `billing_notifications` with delivery_status + retry button in UI

**Forecasting engine (RPC):**
- `get_billing_forecast(horizon_days)` → expected/best/conservative
- Inputs: active subs, scheduled invoices, setup installments, approved variable/performance fees, renewals; subtracts at-risk + expected churn
- Returns by-day rollup for chart + headline numbers for KPI cards

**Roles & permissions:**
- New `app_role` values: `billing_manager`, `account_manager`, `viewer` (admin already exists)
- `has_role()` checks gate charge/refund/cancel/edit-terms/approve/mark-paid

**Seed data:** sample agreements/invoices/payments/actions for LSCRE, Paradyme, Lansing, Legacy, Blue, Titan, InjuryPro, Icon American — covering every state in the spec (today/3d/7d/14d/30d charges, failed, overdue, no-Stripe, %-of-spend, setup installments, mismatches, missing PM, pending variable approval).

---

## Tech notes
- All new UI uses existing semantic tokens (no hardcoded colors); status colors mapped to `--success`, `--destructive`, `--warning`, `--primary` variants.
- Sticky table headers, skeletons, empty + error states everywhere.
- Drilldown dialog extended from existing one in `BillingForecastChart`.
- All financial mutations go through edge functions with audit-log writes; UI never touches Stripe directly.
- Realtime channels on `billing_invoices` / `billing_payments` / `billing_actions` so the dashboard updates the instant a webhook lands.

---

## What I need from you
1. Approve the 3-wave split (or tell me to compress / reorder).
2. Confirm Resend for AM email (already configured) and GHL agency SMS for AM SMS (already configured) — or say if you want Twilio instead.
3. Confirm the role names above are fine to add alongside the existing `admin` role.

Reply "go" and I start Wave 1 (schema + KPIs + action queue + chart rebuild) immediately.
