# Email Management Module

Replaces the Feedback tab end-to-end. Multi-Gmail via your own Google OAuth app, 3-minute polling cron, AI classify + auto-archive, AI draft replies, daily executive briefing, analytics.

## What you need to provide

Before I can finish wiring auth, you'll need to create a Google Cloud OAuth 2.0 Web App (5 min) and give me:
- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`

I'll give you the exact redirect URI to paste into Google Cloud once the edge function is deployed. I'll request these via the secrets tool at the right step.

## Build steps

1. **Cleanup.** Delete `FeedbackTab.tsx`, remove the Feedback nav item, drop the `app_feedback` table.
2. **Schema migration.** New tables:
   - `gmail_accounts` — connected inboxes (email, refresh_token, access_token, expiry, history_id, owner team member, status)
   - `emails` — synced messages (gmail_id, thread_id, account_id, from/to/cc, subject, snippet, body_text, body_html, received_at, labels, classification, priority, requires_response, waiting_on_customer, archived, status)
   - `email_drafts` — AI drafts (email_id, body, confidence, urgency, status: pending/approved/sent/edited)
   - `email_assignments` — assign to team members
   - `email_notes` — internal notes / @mentions
   - `email_briefings` — daily executive briefing snapshots
   - `email_sync_log` — per-account sync runs
3. **Edge functions.**
   - `gmail-oauth-start` — returns Google auth URL with state
   - `gmail-oauth-callback` — exchanges code, stores refresh token, creates `gmail_accounts` row
   - `gmail-sync` — cron-triggered every 3 min: for each active account, refresh token if needed, pull new messages since last `history_id` (fallback to `q=newer_than:1d`), upsert into `emails`, fire `email-classify` per new message
   - `email-classify` — calls Lovable AI to assign classification + priority + requires_response; auto-archives newsletter/promo/cold/spam via Gmail `modify` (remove `INBOX` label) and updates row
   - `email-draft` — generates AI reply draft (tone matched, confidence, urgency)
   - `email-action` — archive/star/mark-read/send/assign via Gmail API
   - `email-briefing` — cron-triggered daily 7am: build executive briefing
4. **Cron jobs.** pg_cron entries for `gmail-sync` (every 3 min) and `email-briefing` (daily 7am PST).
5. **Frontend.** New `EmailManagementTab.tsx` with sub-routes:
   - **Inbox** — unified list, filters (inbox/owner/priority/unread/needs-response/waiting/archived), three-pane layout (folders | list | reader), keyboard shortcuts (j/k/e/r/a), AI draft panel inline (Approve & Send / Edit / Regenerate)
   - **Briefing** — today's executive summary, top emails, pending replies, urgent items, follow-ups
   - **Analytics** — received/archived/spam-removed/drafts/avg-response-time/inbox-zero rate
   - **Inboxes (Settings)** — connect Gmail button → OAuth flow, list of connected accounts, remove/reconnect
6. **Nav.** Swap Feedback → Email Management in `AppSidebar.tsx` and `Index.tsx` tab router. Position as a top-level operational module above Reporting.
7. **Polish.** Apple-style minimal UI matching the rest of the app, dark mode tokens, mobile responsive, real-time via Supabase Realtime on `emails` table.

## Technical notes

- Auth: standard Google OAuth 2.0 server-side flow. Scopes: `gmail.modify`, `gmail.send`, `gmail.readonly`, `userinfo.email`. Refresh tokens stored encrypted via Vault (or as restricted column with service-role-only RLS).
- Classification model: `google/gemini-2.5-flash` for cost. Drafts: same model with system prompt locked to your tone.
- Auto-archive = remove `INBOX` label via Gmail `messages.modify`, set `archived=true` locally.
- Inbox Zero % = `1 - (active_inbox_count / received_today)`.
- Cron password gate: existing `HPA1234$` pattern.

## Out of scope for v1 (can add later)

- Team collaboration (assign, notes, @mentions) — schema is created, UI deferred per your selection
- Push notifications via Gmail Pub/Sub — using polling per your selection
- SMS/Slack alerts on urgent emails

Confirm and I'll start with the migration + cleanup, then walk you through Google Cloud setup before requesting the OAuth secrets.
