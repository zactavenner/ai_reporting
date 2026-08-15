# HPA WhatsApp Bridge (whatsmeow / Go)

Go/whatsmeow implementation of the WhatsApp Web bridge that Lovable's edge
functions talk to. Replaces the previous Node/Baileys bridge; the HTTP
contract is identical so the Lovable functions work unchanged.

## Endpoints

- `GET  /health`
- `GET  /status`  → `{ status, phone_number, qr, qr_at }` (Bearer BRIDGE_TOKEN)
- `GET  /groups`  → `{ groups: [{ jid, subject, participant_count, is_announce }] }`
  (Bearer BRIDGE_TOKEN) — authoritative joined-group subjects straight from the
  WhatsApp server. Required by the daily agency digest to resolve a group by its
  exact subject; chat display names in the DB are contaminated with sender names.
- `POST /send`    → `{ jid, message }` (Bearer BRIDGE_TOKEN)
- `POST /logout`
- `POST /reset`   — wipes local session, forces new QR pairing

## After redeploying (group digest routing)

`/groups` ships with this version. Once the redeploy is live, the backend can
sync group subjects and resolve the "High Performance Reporting Group" target.

## Env vars

Required:
- `BRIDGE_TOKEN` — shared secret for `/send` and `/status`
- `LOVABLE_WEBHOOK_URL` — e.g. `https://<proj>.supabase.co/functions/v1/whatsapp-inbound`
- `WEBHOOK_SECRET` — sent as `x-bridge-secret`, must equal `WHATSAPP_WEBHOOK_SECRET` in Lovable

Optional:
- `SESSION_LABEL` (default `default`)
- `AUTH_DIR` (default `./auth`) — SQLite DB at `$AUTH_DIR/whatsmeow.db`
- `PORT` (default `8080`)

## Deploy

Redeploy this folder to Railway / Fly using the existing `railway.json` /
`fly.toml`. After first deploy open the **WhatsApp** tab in Lovable, click
**Refresh**, and scan the QR from your phone (WhatsApp → Settings → Linked
Devices → Link a Device).
