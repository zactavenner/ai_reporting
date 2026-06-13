# AI Platform Overhaul

Standardize all AI on OpenRouter, upgrade existing AI surfaces, and ship 4 new AI capabilities.

## Phase 1 — OpenRouter standardization

Audit every edge function and remove any remaining direct Gemini/Lovable AI Gateway/XAI calls in chat/reasoning paths. Keep image/video generation on Gemini/Veo (those aren't on OpenRouter).

**Shared helper:** `supabase/functions/_shared/openrouter.ts` with `callOpenRouter({ model, messages, tools?, stream?, json? })`, retry on 429/5xx, surfaces 402 cleanly. Default model `anthropic/claude-sonnet-4.5`, with `openai/gpt-5`, `google/gemini-2.5-pro` as alternates per task.

**Functions to convert:** `studio-assistant`, `hermes-task-executor`, `hermes-orchestrator`, `ai-analysis`, `ai-agent-full-context`, `ai-create-tasks`, `ai-auto-assign-task`, `video-edit-chat`, `refine-asset`, `generate-asset` (text portions), `weekly-recap`, `ai-contextual-analysis`. Anywhere we see `LOVABLE_API_KEY` for chat → swap to `OPENROUTER_API_KEY`.

## Phase 2 — Studio Assistant chat upgrades

- **Streaming responses** via SSE (today it waits then dumps); update `StudioAssistantChat.tsx` to read stream.
- **File/image uploads** in chat (drop PDFs, screenshots → vision model).
- **Voice input** using existing `VoiceRecordButton` → transcribe via Whisper on OpenRouter, then send.
- **Richer tool set** (existing 4 + new): `create_task`, `schedule_meeting`, `get_client_briefing`, `query_funded_investors`, `pause_campaign`, `regenerate_ad_copy`.
- **Per-user persistent threads** in `ai_studio_conversations` (already exists) with thread sidebar + URL routing (`/assistant/:threadId`).
- **Markdown + code + tables** rendering polish.

## Phase 3 — Hermes orchestrator upgrades

- **Scheduled daily review** (pg_cron 7am PST) → triages every active client's open tasks, flags stalled (>3d no activity), reassigns abandoned ones, posts Slack summary tagging owners.
- **Proactive suggestions:** after every webhook of significance (new funded investor, dropped CPL, missed meeting) Hermes emits a suggestion card to `agent_escalations` shown in dashboard.
- **Memory:** load last 7d of `hermes_tasks` results so it doesn't repeat suggestions.

## Phase 4 — Creative AI upgrades

- **Auto-variations:** for any approved winning ad, generate 5 variations (hook swap, CTA swap, aspect swap) via a single "Spin Winners" button.
- **Batch script generation:** select multiple offers → one click → N scripts each, parallelized.
- **Smarter prompts:** centralize prompt templates in `supabase/functions/_shared/creative-prompts.ts`, version them, log which version produced which asset.
- **Quality scorer:** post-generation pass that rates each asset 0-100 on hook/clarity/CTA/compliance and stores in `client_assets.meta`.

## Phase 5 — Reporting AI insights

- **Anomaly detector:** nightly job compares each client's last 7d vs prior 28d. Flags >30% CPL spike, >50% lead drop, funded rate decline. Writes to new `ai_insights` table.
- **Per-client AI commentary** card on dashboard: "What changed this week and why" (uses metrics + recent calls + recent ad changes).
- **Predictive CoC forecast:** lightweight 30-day projection (linear regression on weekly trends) shown next to current metrics.

## Phase 6 — New features

1. **Daily AI Briefing** — 7am PST cron, writes per-client briefing to `daily_ai_summaries` (table exists). Surfaces top wins, fires, suggested actions. Sends Slack DM to client lead + email digest to leadership. New `BriefingCard.tsx` on Dashboard.
2. **AI Meeting Prep** — On any upcoming meeting in `agency_meetings`, button "Generate prep doc" → pulls last 30d metrics, recent calls, open tasks, last meeting recap → produces 1-page brief in modal + optional Slack post.
3. **Predictive Alerts** — Extends Phase 5 anomaly detector with forward-looking signals (declining show rate × low spend velocity → risk score). Pushes to `alert_configs` channel + bell + Slack.
4. **Voice-to-Action** — Global mic button in `AppHeader`. Speak: "Assign Sajid the HRT script review by Friday and text Zac the daily report" → transcribe → route to Studio Assistant tool runner → confirm before executing destructive actions.

## Phase 7 — DB + cron

New tables: `ai_insights`, `ai_briefings_log`, `ai_voice_commands`. Migrations include GRANTs + RLS. New pg_cron jobs: daily briefing (7am PST), anomaly detector (2am PST), Hermes daily review (7am PST).

## Technical notes

- All chat models: `OPENROUTER_API_KEY` already in secrets — no new keys.
- Vision uploads: encode to base64 data URLs, pass as image_url parts to vision-capable OpenRouter models (`openai/gpt-5`, `anthropic/claude-sonnet-4.5`).
- Voice: OpenRouter doesn't host Whisper; use existing Gemini multimodal for STT (audio→text) since we keep Gemini for non-chat anyway. If user insists OpenRouter-only including STT, fall back to browser SpeechRecognition API.
- Streaming: SSE from edge fn via `ReadableStream`, client uses `EventSource`-style parser.
- All new edge fns use `HPA1234$` internal auth pattern where called server-to-server.
- Compliance memory enforced in prompt templates (no "guaranteed", targeted returns, disclaimers).
- Visual style: glass-card forest green; new cards inherit existing tokens.

## Scope and order

Will ship in this order: Phase 1 (foundation) → Phase 6.1 Daily Briefing → Phase 5 Anomaly+Commentary → Phase 6.2 Meeting Prep → Phase 2 Studio chat upgrades → Phase 3 Hermes scheduled → Phase 4 Creative upgrades → Phase 6.3 Predictive → Phase 6.4 Voice-to-Action.

Estimated: large multi-turn build. Each phase delivered as a coherent unit so you can review and ship incrementally.
