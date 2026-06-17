# Lovable ↔ WhatsApp Baileys Bridge

Tiny Node service that holds your WhatsApp Web session and bridges it to your Lovable app.

## What it does

- Logs into WhatsApp via QR pair (just like WhatsApp Web).
- Posts inbound messages + QR + connection events to your Lovable edge function (`whatsapp-inbound`).
- Exposes `POST /send` so the Lovable app can send messages.
- Auto-reconnects, persists session to disk.

## ⚠️ Read first

Using your **personal** WhatsApp number through Baileys violates WhatsApp's ToS. Bans are
possible, especially at high volume. For low-volume internal team comms it's generally fine,
but if this matters to your business use the official WhatsApp Business Cloud API instead.

## Environment variables

| Name | Required | Notes |
|---|---|---|
| `BRIDGE_TOKEN` | yes | Long random string. Also goes in Lovable as `WHATSAPP_BRIDGE_TOKEN`. |
| `LOVABLE_WEBHOOK_URL` | yes | `https://<project>.supabase.co/functions/v1/whatsapp-inbound` |
| `WEBHOOK_SECRET` | yes | Long random string. Also goes in Lovable as `WHATSAPP_WEBHOOK_SECRET`. |
| `SESSION_LABEL` | no | Defaults to `default`. |
| `PORT` | no | Defaults to 8080. |
| `AUTH_DIR` | no | Defaults to `./auth` — use a persistent volume in production. |

## Deploy

### Option A — Railway (easiest, ~$5/mo)

1. Push this `bridge/` folder to a new GitHub repo.
2. Railway → New Project → Deploy from GitHub → pick the repo.
3. Add env vars from the table above.
4. Add a Volume mounted at `/data/auth` (so session survives restarts).
5. Copy the public URL — that's `WHATSAPP_BRIDGE_URL` for Lovable.

### Option B — Fly.io (free tier works for one number)

```bash
fly launch --no-deploy            # edit fly.toml app name first
fly volumes create wa_auth --size 1 --region iad
fly secrets set BRIDGE_TOKEN=... LOVABLE_WEBHOOK_URL=... WEBHOOK_SECRET=...
fly deploy
```

### Option C — Your own VPS / Docker

```bash
cp .env.example .env   # fill in values
docker compose up -d
```

## Pair your phone

1. Once deployed, open the `/whatsapp` page in your Lovable app — it renders the QR live.
2. On your phone: WhatsApp → Settings → Linked Devices → Link a Device → scan.
3. Status flips to `connected`. Done.

## Logout / re-pair

Click "Disconnect & re-pair" in the Lovable app, or hit `POST /logout` with the bearer token.