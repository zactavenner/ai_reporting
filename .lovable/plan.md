
# Swap to whatsmeow + WhatsApp Tab + Jarvis alerts to Zac

## 1. New Go bridge (`bridge/` rewrite)

Replace the Node/Baileys bridge with a whatsmeow Go service. Same HTTP contract so the existing edge functions (`whatsapp-inbound`, `whatsapp-send`, `whatsapp-status`) keep working unchanged.

- `bridge/main.go` — whatsmeow client with SQLite session store, QR endpoint, auto-reconnect
- Endpoints (identical to today):
  - `GET /health`
  - `GET /status` → `{ status, phone_number, qr, qr_at }`
  - `POST /send` → `{ jid, message }`
  - `POST /logout`
  - `POST /reset` (wipe session, force new QR)
- Event forwarder → posts to `LOVABLE_WEBHOOK_URL` with `x-bridge-secret`:
  - `qr`, `connection`, `message` (direct + group), `receipt` (delivered/read)
- Group monitoring: subscribe to all groups, forward `messages.upsert` for `@g.us` JIDs, mark `is_group=true` (already handled by inbound function).
- `bridge/Dockerfile` — multi-stage Go build, alpine runtime, `/data` volume for session DB
- `bridge/fly.toml` / `railway.json` — updated start command, same 8080 port, same env vars (`BRIDGE_TOKEN`, `LOVABLE_WEBHOOK_URL`, `WEBHOOK_SECRET`, `SESSION_LABEL`)
- Delete old Node files: `bridge/server.js`, `bridge/package.json`

**Deploy:** user re-deploys `bridge/` to Railway/Fly (same env vars, same URL). New QR scan required once — old Baileys session isn't compatible.

## 2. WhatsApp tab in main nav

New route `/whatsapp` with a tabbed workspace:

- **Chats** — contact list (from `whatsapp_contacts`) + thread view (from `whatsapp_messages`), send composer. Filter: All / Direct / Groups / Unread.
- **Groups** — dedicated group monitor: list of `@g.us` contacts, message volume, last activity, click through to thread.
- **Settings** — connection status card (calls `whatsapp-status`), QR display for pairing, phone number, logout/reset buttons, session label, **Jarvis Alerts** panel (toggle + recipient list, seeded with Zac `+19167097345`).
- **Logs** — recent inbound/outbound events, delivery status.

Nav: add "WhatsApp" entry (MessageCircle icon) to the main sidebar/menu.

## 3. Jarvis → Zac alerts

- New table `jarvis_alert_recipients` (id, name, phone_e164, active, alert_types[], created_at) with RLS + GRANTs. Seed row: Zac / `+19167097345` / all types.
- New helper edge function `jarvis-notify` → looks up active recipients, resolves phone → `<digits>@s.whatsapp.net`, calls existing `whatsapp-send` (service-role) for each. Accepts `{ message, alert_type?, recipients? }`.
- Wire existing Jarvis paths (agent runs completion, escalations, huddle summaries) to call `jarvis-notify` on notable events. Managed via toggles in the Settings tab.

## 4. Data / RLS

- `jarvis_alert_recipients` — admin-managed, authenticated read/write via `has_role('admin')`, service_role full.
- No schema changes to existing `whatsapp_*` tables (already support groups).

## Technical notes

- whatsmeow lib: `go.mau.fi/whatsmeow` with `mdp/qrterminal` for logs and native QR bytes → base64 PNG for `/status`.
- Session DB: SQLite at `/data/whatsmeow.db` (whatsmeow's built-in `sqlstore`).
- Contract with Lovable edge functions unchanged, so `WHATSAPP_BRIDGE_URL` / `WHATSAPP_BRIDGE_TOKEN` secrets stay the same. User just redeploys the bridge folder and re-scans QR once.
- No client-side secrets. All bridge calls go through the existing authenticated edge functions.

## Out of scope (ask if wanted)

- Media (image/video/doc) send in composer — inbound already captured, outbound stays text-only for v1.
- Multi-number support — schema supports it (`session_label`), UI stays single-session for v1.
