// Baileys ↔ Lovable bridge.
// Holds the WhatsApp Web session, exposes /send & /status, posts events to LOVABLE_WEBHOOK_URL.

import express from 'express';
import pino from 'pino';
import QRCode from 'qrcode';
import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';

const PORT = process.env.PORT || 8080;
const BRIDGE_TOKEN = process.env.BRIDGE_TOKEN;            // shared secret for /send & /status
const WEBHOOK_URL = process.env.LOVABLE_WEBHOOK_URL;      // e.g. https://<proj>.supabase.co/functions/v1/whatsapp-inbound
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;        // sent as x-bridge-secret
const AUTH_DIR = process.env.AUTH_DIR || './auth';
const SESSION_LABEL = process.env.SESSION_LABEL || 'default';

if (!BRIDGE_TOKEN) { console.error('BRIDGE_TOKEN env required'); process.exit(1); }
if (!WEBHOOK_URL || !WEBHOOK_SECRET) {
  console.warn('LOVABLE_WEBHOOK_URL / WEBHOOK_SECRET not set — webhooks will be skipped.');
}

const logger = pino({ level: 'info' });
const app = express();
app.use(express.json({ limit: '10mb' }));

const state = {
  status: 'disconnected', // disconnected | qr | connecting | connected | logged_out
  lastQrPng: null,        // data URL
  lastQrAt: null,
  phoneNumber: null,
  sock: null,
};

async function postWebhook(event, payload) {
  if (!WEBHOOK_URL || !WEBHOOK_SECRET) return;
  try {
    await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bridge-secret': WEBHOOK_SECRET },
      body: JSON.stringify({ event, session_label: SESSION_LABEL, payload }),
    });
  } catch (e) { logger.error({ err: e.message }, 'webhook post failed'); }
}

function extractMessage(m) {
  const msg = m.message;
  if (!msg) return { body: null, message_type: 'other' };
  if (msg.conversation) return { body: msg.conversation, message_type: 'text' };
  if (msg.extendedTextMessage?.text) return { body: msg.extendedTextMessage.text, message_type: 'text' };
  if (msg.imageMessage) return { body: msg.imageMessage.caption || null, message_type: 'image', media_mime: msg.imageMessage.mimetype };
  if (msg.videoMessage) return { body: msg.videoMessage.caption || null, message_type: 'video', media_mime: msg.videoMessage.mimetype };
  if (msg.audioMessage) return { body: null, message_type: 'audio', media_mime: msg.audioMessage.mimetype };
  if (msg.documentMessage) return { body: msg.documentMessage.fileName || null, message_type: 'document', media_mime: msg.documentMessage.mimetype };
  return { body: null, message_type: 'other' };
}

async function start() {
  const { state: authState, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();
  logger.info({ version }, 'starting baileys');

  const sock = makeWASocket({
    version,
    auth: authState,
    printQRInTerminal: false,
    logger: pino({ level: 'warn' }),
    browser: ['Lovable Bridge', 'Chrome', '1.0'],
  });
  state.sock = sock;

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (u) => {
    const { connection, lastDisconnect, qr } = u;
    if (qr) {
      state.status = 'qr';
      state.lastQrPng = await QRCode.toDataURL(qr);
      state.lastQrAt = new Date().toISOString();
      logger.info('QR ready — scan from your phone WhatsApp → Linked Devices');
      await postWebhook('qr', { qr: state.lastQrPng });
    }
    if (connection === 'open') {
      state.status = 'connected';
      state.lastQrPng = null;
      state.phoneNumber = sock.user?.id?.split(':')[0] || null;
      logger.info({ phone: state.phoneNumber }, 'connected');
      await postWebhook('connection', { status: 'connected', phone_number: state.phoneNumber });
    }
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;
      state.status = loggedOut ? 'logged_out' : 'disconnected';
      logger.warn({ code, loggedOut }, 'connection closed');
      await postWebhook('connection', { status: state.status, error: lastDisconnect?.error?.message });
      if (!loggedOut) setTimeout(start, 2000); // auto-reconnect
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const m of messages) {
      if (!m.message) continue;
      const jid = m.key.remoteJid;
      const isGroup = jid?.endsWith('@g.us') ?? false;
      const fromMe = !!m.key.fromMe;
      const { body, message_type, media_mime } = extractMessage(m);
      await postWebhook('message', {
        jid,
        wa_message_id: m.key.id,
        direction: fromMe ? 'outbound' : 'inbound',
        body,
        message_type,
        media_mime,
        sender_jid: m.key.participant || jid,
        push_name: m.pushName || null,
        is_group: isGroup,
        wa_timestamp: m.messageTimestamp ? new Date(Number(m.messageTimestamp) * 1000).toISOString() : new Date().toISOString(),
      });
    }
  });
}

// ----- HTTP -----
function auth(req, res, next) {
  const h = req.headers.authorization || '';
  if (h !== `Bearer ${BRIDGE_TOKEN}`) return res.status(401).json({ error: 'unauthorized' });
  next();
}

app.get('/health', (_req, res) => res.json({ ok: true, status: state.status }));

app.get('/status', auth, (_req, res) => {
  res.json({
    status: state.status,
    phone_number: state.phoneNumber,
    qr: state.lastQrPng,
    qr_at: state.lastQrAt,
  });
});

app.post('/send', auth, async (req, res) => {
  try {
    const { jid, message } = req.body || {};
    if (!jid || !message) return res.status(400).json({ error: 'jid and message required' });
    if (state.status !== 'connected' || !state.sock) return res.status(503).json({ error: 'not connected' });
    const target = jid.includes('@') ? jid : `${jid.replace(/\D/g, '')}@s.whatsapp.net`;
    const sent = await state.sock.sendMessage(target, { text: message });
    res.json({ ok: true, wa_message_id: sent?.key?.id });
  } catch (e) {
    logger.error({ err: e.message }, 'send failed');
    res.status(500).json({ error: e.message });
  }
});

app.post('/logout', auth, async (_req, res) => {
  try { await state.sock?.logout(); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.listen(PORT, () => logger.info({ port: PORT }, 'bridge listening'));
start().catch((e) => { logger.error({ err: e.message }, 'start failed'); process.exit(1); });