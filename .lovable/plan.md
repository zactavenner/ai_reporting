# Sheet QA Agents + WhatsApp Reports

## Goal

Let AI agents (existing workforce: OPS, Data QA, ANALYST) read each client's KPI Google Sheet **and** the agency Master Sheet, run spam/quality/accuracy checks, and deliver findings via WhatsApp (in addition to Slack).

## Scope

### 1. Sheet review capability (new edge function: `agent-sheet-audit`)

Reusable function the agents call. Input: `client_id` (or `master`), optional `tab_gid`. Steps:

- Pull sheet values via existing `fetch-sheet-metrics` (extend with a `raw_grid` action that returns headers + rows, not just parsed metrics).
- Run deterministic checks first (cheap, no LLM):
  - **Spam signals**: duplicate emails/phones, disposable-email domains, obvious test names ("asdf", "test"), >N leads from same IP/UTM in <1h, role emails (info@, admin@), invalid phone formats.
  - **Quality**: missing email AND phone (project rule: both required to count), blank funnel-stage cells, negative/zero spend with leads, future-dated rows, duplicate row keys.
  - **Accuracy vs DB**: compare sheet totals (leads, calls booked, shows, funded, spend) against `v_client_performance_*` views and `daily_metrics` for the same date window. Flag deltas >5%.
- Pass the reduced findings to Gemini 2.5 Flash for a short narrative summary + prioritized action list (JSON output).
- Persist a row in new `sheet_audit_runs` table (client_id, scope, score, findings jsonb, summary, run_at).

### 2. Agent integration

- Add a new `connector` key `google_sheets` to `AVAILABLE_CONNECTORS` in `useAgents.ts`. When an agent has it enabled, `run-agent` injects sheet audit results into the prompt context via `agent-sheet-audit`.
- Add a new template **"Sheet QA Agent (AUDITOR)"** in `AGENT_TEMPLATES`: cron `0 7 * * *`, model `gemini-2.5-flash`, connectors `[database, google_sheets, whatsapp]`. Returns JSON with `quality_score`, `spam_flags[]`, `accuracy_deltas[]`, `whatsapp_message`.
- Existing OPS / Data QA / ANALYST templates get the `google_sheets` connector added so they can cross-check.

### 4. UI changes

- **Agent editor** (existing AI Workforce dashboard): multi-select "Notify channels" + textarea for WhatsApp numbers (E.164). Toggle to enable Sheet QA connector.
- **Agency Settings → Integrations**: new "WhatsApp (Twilio)" card showing connection status, default sender number input, test-send button.
- **Sheet Audit results panel** on Client Detail → "Reporting Sheet" tab: latest run score, spam flags, accuracy deltas, "Run audit now" button.

### 5. Compliance & safety

- Investment-marketing rule: WhatsApp messages must not use "guaranteed"; reuse existing compliance lint before send.
- Rate limit `send-whatsapp-report` to 1 msg / recipient / minute.

## Files

**New**

- `supabase/functions/agent-sheet-audit/index.ts`
- `supabase/functions/send-whatsapp-report/index.ts`
- `supabase/migrations/<ts>_sheet_audits_and_whatsapp.sql` — `sheet_audit_runs` table; add `whatsapp_recipients`, `notify_channels` to `agents`; add `whatsapp_notify_numbers` to `clients`; RLS.
- `src/components/dashboard/SheetAuditPanel.tsx`
- `src/components/settings/WhatsAppSettingsCard.tsx`
- `src/hooks/useSheetAudits.ts`

**Edited**

- `supabase/functions/fetch-sheet-metrics/index.ts` — add `raw_grid` action.
- `supabase/functions/run-agent/index.ts` — inject sheet-audit context when `google_sheets` connector enabled; dispatch to WhatsApp when `notify_channels` includes it.
- `src/hooks/useAgents.ts` — add `google_sheets` + `whatsapp` connectors, AUDITOR template, `notify_channels`/`whatsapp_recipients` fields.
- `src/components/agents/AgentEditor.tsx` (or equivalent) — channel + recipients UI.
- `src/components/settings/AgencySettingsModal.tsx` — Twilio/WhatsApp section.
- `src/pages/ClientDetail.tsx` — mount `SheetAuditPanel` in Reporting Sheet tab.

## Out of scope

- Auto-fixing sheet data (read-only audit).
- &nbsp;
- Master Sheet audit can also DM you a daily digest (1 message rolling up all clients) — easy add once channel plumbing is in.