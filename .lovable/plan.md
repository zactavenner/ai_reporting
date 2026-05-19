
## Goal

Operationalize the "Fulfillment AI Capital Raising — Master Doc" inside the platform so Account Managers run the entire playbook (onboarding → kick-off → weekly reporting → constraint diagnosis → SOP checklists) without leaving the app. We already have onboarding pipeline, automation panel, lead manager, and weekly reporting agent — this layers the missing AM tooling on top.

---

## What the doc adds (mapped to features)

1. **Account Manager role + scorecard** → AM dashboard with portfolio KPIs, retention, CPL/CoC targets.
2. **Onboarding tasks + welcome message + access links** → structured client task list (CR Task List from doc).
3. **Kick-off meeting agenda + capital calculator** → guided kick-off flow.
4. **Weekly Performance Report template** → already partially built — extend with doc's exact prompt + section structure.
5. **Constraints & SOP playbook** (CPBC / Show rate / Close rate checklists) → interactive Constraint Diagnosis engine driven by funnel metrics we already have.
6. **Veo3 reusable video prompt templates** → template library wired into existing video generator.
7. **Decision log + Team directory + Project assignments** → lightweight collab tables per client.

---

## Modules to build

### 1. AM Workspace (new page `/account-manager`)
- Portfolio view: every client assigned to me, status, current CPL / CPLC / Cash ROAS / Revenue ROAS pulled from `v_client_performance_*`.
- Color-coded against doc thresholds: CPBC > $250 red, Show rate < 60% red, Close rate < 25% red.
- Filter: "Clients in constraint" surfaces only off-KPI clients.
- Sidebar entry in `AppSidebar.tsx`.

### 2. Constraint Diagnosis Engine (new component `ConstraintDiagnostics.tsx`)
- Per-client panel under the existing client detail page (new tab "Diagnostics").
- Pulls leading indicators (CPM, CTR, CPC, CPL, optin %, VSL view %, booking page view %, CPBC, show rate, close rate, CPA, Cash ROAS, Rev ROAS) from existing metrics views.
- Auto-classifies the constraint: `high_cpbc` | `low_show_rate` | `low_close_rate` | `low_quality`.
- Renders the matching checklist from the doc (CPBC, Funnel, Audience, Offer, Pre-Booking, Post-Booking) as toggleable items persisted to a new `client_constraint_checklists` table.
- AI assist button → invokes Lovable AI Gateway (gemini-2.5-flash) with the funnel snapshot + doc rules to suggest the top 3 fixes.

### 3. Weekly Report Builder (extend existing `WeeklyReportingAgent`)
- New "Generate Report" view per client using doc's exact prompt structure:
  - Progress Report (in progress / completed / review)
  - New Ads Pending Approval (link list)
  - Campaign Performance Overview (per-campaign: Spend / Leads / CPL / Calls / Showed)
  - Performance Summary & Insights
  - Specific Campaign Updates
  - Adjustments & Expected Outcomes
- Pre-fills metrics from DB; AI fills narrative sections. Output as polished email (copy-to-clipboard + Slack push).

### 4. Kick-Off Meeting Module (extend OnboardingTab — 6th sub-tab "Kick-Off")
- Agenda timer (Welcome 3m / Status 5m / Scorecard 3m / Assets 7m / Access 5m / Calculator 5m / Q&A 2m / Close 2m).
- Inline embeds for the doc's external links (deck, projects, calculator, scorecard).
- "Schedule weekly call" CTA → writes to existing meetings table.

### 5. Onboarding Task List (extend Automation panel)
- Seed every new `onboarding` client with the doc's 2-section task list:
  - "From Client: Access / Assets" (10 items)
  - "Account Set-Up" (~30 items grouped: NK Account, Assets, Funnel, Automations, Conversation AI, Launch)
- Uses existing `tasks` table with `client_id` + `category='onboarding_master'` + `phase`.
- Checklist UI inside Automation tab with phase grouping + progress bar.
- Templates stored in `src/lib/onboardingTaskTemplates.ts` (already exists — extend with doc content).

### 6. Veo3 Prompt Templates Library
- New file `src/lib/veo3PromptTemplates.ts` with the doc's reusable character / scene / 3-segment / 24-second Sora templates + placeholder map ([[SPOKESPERSON_DESC]], [[MARKET_CITY]], [[ASSET_CLASS]], [[PRIMARY_ASSET_DESC]], [[TARGET_RETURN]], [[TOTAL_DEALS_COMPLETED]], [[TOTAL_DISTRIBUTED]]).
- Wired into existing `BrollPage` / `BatchVideoPage` as "Capital Raising Templates" picker — fills placeholders from selected client's offer.

### 7. Welcome Message + Onboarding Links Snippet
- New "Send Welcome" action on a new client: generates the doc's welcome WhatsApp/Slack message with placeholders auto-filled (`{{contact.first_name}}`, `{{user.name}}`) and links to:
  - aicapitalraising.com/onboarding, /access, /review
- Pushes via existing Slack integration.

### 8. Decision Log + Team Directory (per-client lightweight)
- New `client_decisions` table (topic, decision, owner, status, notes, file_url).
- Renders inside existing client detail under "Notes" tab.
- Team directory pulls from existing team members context.

---

## Database changes

- `client_constraint_checklists` (id, client_id, checklist_type, item_key, checked, checked_by, checked_at) + RLS.
- `client_decisions` (id, client_id, topic, decision, owner_id, status, notes, file_url, updated_at) + RLS.
- Extend `clients.automation_checklist` jsonb to also store kick-off agenda completion + welcome-sent timestamp.

No destructive changes; all additive.

---

## Files to touch

```text
NEW:
  src/pages/AccountManagerPage.tsx
  src/components/account-manager/PortfolioKpiGrid.tsx
  src/components/diagnostics/ConstraintDiagnostics.tsx
  src/components/diagnostics/ChecklistRenderer.tsx
  src/components/onboarding/KickOffMeetingPanel.tsx
  src/components/onboarding/WelcomeMessageDialog.tsx
  src/components/reports/WeeklyReportBuilder.tsx
  src/components/clients/DecisionLog.tsx
  src/lib/constraintRules.ts          // doc thresholds + checklist data
  src/lib/veo3PromptTemplates.ts
  supabase/migrations/<ts>_am_workspace.sql

EXTEND:
  src/components/dashboard/OnboardingTab.tsx       // + Kick-Off tab + task seeding
  src/components/agents/WeeklyReportingAgent.tsx   // + builder modal
  src/components/layout/AppSidebar.tsx             // + Account Manager link
  src/pages/Index.tsx                              // route
  src/pages/ClientDetail.tsx                       // + Diagnostics & Decisions tabs
  src/lib/onboardingTaskTemplates.ts               // add doc's CR task list
```

---

## Sequencing (recommended ship order)

1. DB migration + checklist/decision tables.
2. Constraint Diagnostics engine (highest AM ROI).
3. Weekly Report Builder.
4. Onboarding task list seeding + Welcome Message.
5. Kick-Off Meeting panel.
6. AM Workspace portfolio page.
7. Veo3 template library.

---

## Out of scope

- Native phone-number purchase / A2P 10DLC submission (still happens in GHL/Nurture King; we link out).
- Calendar building inside the app (Calendly/native calendar stays external).
- Rebuilding the public marketing pages (aicapitalraising.com/*).
- Replacing existing fulfillment pipeline — this layers on top.

---

## Compliance reminder

All AI-generated copy (welcome messages, weekly reports, constraint suggestions, Veo3 scripts) must pass the existing capital-raising compliance rules — use "targeted returns" not "guaranteed", include SEC/FINRA disclaimers on emails. This is enforced via the existing `refine-asset` / `generate-asset` system prompts; no new compliance logic needed.
