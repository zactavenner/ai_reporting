/**
 * Sends the shadow-invite email (an .ics METHOD:REQUEST / METHOD:CANCEL) to the
 * MeetGeek notetaker mailbox. Pluggable sender, resolved fail-closed:
 *
 *   1. RESEND_API_KEY (+ SHADOW_INVITE_FROM on a Resend-verified domain).
 *   2. Plain SMTP: SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASSWORD
 *      (e.g. smtp.gmail.com:587 with a Gmail app password — never expires).
 *   3. A connected Gmail account (gmail.send OAuth) — non-production fallback:
 *      consent screens in Testing mode expire refresh tokens every 7 days.
 *
 * When neither is configured nothing is sent and the caller parks the job as
 * pending, so no invite is silently lost.
 */
import { getValidAccessToken, type GmailAccountRow } from './gmail.ts';

// Raw SMTP client — replaces denomailer because its STARTTLS path is unstable
// under Deno Deploy. Supports both plain-TLS (465) and STARTTLS (587).
const SMTP_TIMEOUT_MS = 30_000;

function encodeBase64(s: string): string {
  return btoa(s);
}

function encodeBase64Bytes(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function encodeText(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function decodeText(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

async function smtpReadLine(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) throw new Error('SMTP connection closed unexpectedly');
    buffer += decodeText(value);
    const idx = buffer.indexOf('\r\n');
    if (idx !== -1) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      return line;
    }
  }
}

async function smtpReadResponse(reader: ReadableStreamDefaultReader<Uint8Array>, expectedPrefix: string): Promise<string> {
  let last = '';
  while (true) {
    const line = await smtpReadLine(reader);
    last = line;
    if (line.length < 3) continue;
    const code = line.slice(0, 3);
    const separator = line[3];
    if (code !== expectedPrefix) {
      throw new Error(`SMTP command failed: ${line}`);
    }
    if (separator === ' ') return last;
    // separator === '-' means more lines follow
  }
}

async function smtpWriteLine(writer: WritableStreamDefaultWriter<Uint8Array>, line: string) {
  await writer.write(encodeText(line + '\r\n'));
}

async function sendRawSmtp(args: {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
  to: string;
  subject: string;
  bodyText: string;
  ics: string;
  method: 'REQUEST' | 'CANCEL';
}): Promise<{ ok: true; messageId: string } | { ok: false; error: string }> {
  const timeout = AbortSignal.timeout(SMTP_TIMEOUT_MS);
  let conn: Deno.Conn | null = null;

  try {
    if (timeout.aborted) throw new Error('SMTP connect timeout');

    const isStartTls = args.port === 587;
    const useTls = args.port === 465 || isStartTls;

    if (useTls && !isStartTls) {
      conn = await Deno.connectTls({ hostname: args.host, port: args.port });
    } else {
      conn = await Deno.connect({ hostname: args.host, port: args.port });
    }

    // Attach timeout via reader/writer with the AbortSignal is complex; instead
    // wrap the connection with a TransformStream so we can use standard streams.
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    let pipe: Promise<void> = conn.readable.pipeTo(writable);
    let reader = readable.getReader();
    let writer = conn.writable.getWriter();

    try {
      await smtpReadResponse(reader, '220');

      await smtpWriteLine(writer, `EHLO hpa-reporting`);
      await smtpReadResponse(reader, '250');

      if (isStartTls) {
        await smtpWriteLine(writer, 'STARTTLS');
        await smtpReadResponse(reader, '220');
        // Upgrade the connection
        await writer.release();
        await reader.cancel();
        await pipe.catch(() => {});
        conn = await Deno.startTls(conn, { hostname: args.host });
        const after = new TransformStream<Uint8Array, Uint8Array>();
        pipe = conn.readable.pipeTo(after.writable);
        reader = after.readable.getReader();
        writer = conn.writable.getWriter();

        await smtpWriteLine(writer, `EHLO hpa-reporting`);
        await smtpReadResponse(reader, '250');
      }

      await smtpWriteLine(writer, 'AUTH LOGIN');
      await smtpReadResponse(reader, '334');
      await smtpWriteLine(writer, encodeBase64(args.user));
      await smtpReadResponse(reader, '334');
      await smtpWriteLine(writer, encodeBase64(args.password));
      await smtpReadResponse(reader, '235');

      await smtpWriteLine(writer, `MAIL FROM:<${args.from}>`);
      await smtpReadResponse(reader, '250');
      await smtpWriteLine(writer, `RCPT TO:<${args.to}>`);
      await smtpReadResponse(reader, '250');
      await smtpWriteLine(writer, 'DATA');
      await smtpReadResponse(reader, '354');

      const messageId = `<${crypto.randomUUID()}@hpa-reporting>`;
      const mime = buildMime({
        from: args.from,
        to: args.to,
        subject: args.subject,
        bodyText: args.bodyText,
        ics: args.ics,
        method: args.method,
      }).replace(/\n/g, '\r\n');

      await smtpWriteLine(writer, `${mime}\r\n.`);
      await smtpReadResponse(reader, '250');
      await smtpWriteLine(writer, 'QUIT');
      await smtpReadResponse(reader, '221');

      return { ok: true, messageId };
    } finally {
      try { writer.release(); } catch { /* ignore */ }
      try { reader.cancel(); } catch { /* ignore */ }
      try { await (pipe as any).catch(() => {}); } catch { /* ignore */ }
    }
  } catch (e) {
    return { ok: false, error: String((e as Error).message).slice(0, 300) };
  } finally {
    try { conn?.close(); } catch { /* ignore */ }
  }
}


export interface SenderInfo {
  configured: boolean;
  provider: 'gmail' | 'resend' | 'smtp' | null;
  from_email: string | null;
  detail: string;
}

const FALLBACK_FROM_NAME = 'HPA Reporting';

function smtpConfig() {
  const host = Deno.env.get('SMTP_HOST');
  const user = Deno.env.get('SMTP_USER');
  const password = Deno.env.get('SMTP_PASSWORD');
  if (!host || !user || !password) return null;
  const port = Number(Deno.env.get('SMTP_PORT') || '587');
  const from = Deno.env.get('SHADOW_INVITE_FROM') || user;
  return { host, port, user, password, from };
}

export async function resolveInviteSender(supabase: any): Promise<SenderInfo> {
  const resendKey = Deno.env.get('RESEND_API_KEY');
  const resendFrom = Deno.env.get('SHADOW_INVITE_FROM');
  if (resendKey && resendFrom) {
    return { configured: true, provider: 'resend', from_email: resendFrom, detail: `Resend sender ${resendFrom}` };
  }

  const smtp = smtpConfig();
  if (smtp) {
    return {
      configured: true,
      provider: 'smtp',
      from_email: smtp.from,
      detail: `SMTP sender ${smtp.from} via ${smtp.host}:${smtp.port}`,
    };
  }

  const { data: accounts } = await supabase
    .from('gmail_accounts')
    .select('id, email, refresh_token')
    .not('refresh_token', 'is', null)
    .order('created_at', { ascending: true })
    .limit(1);
  const gmail = (accounts || [])[0];
  if (gmail?.email) {
    return {
      configured: true,
      provider: 'gmail',
      from_email: gmail.email,
      detail: `Connected Gmail account ${gmail.email} (OAuth — token may expire weekly in Testing mode)`,
    };
  }

  return {
    configured: false,
    provider: null,
    from_email: null,
    detail: resendKey
      ? 'RESEND_API_KEY is set but SHADOW_INVITE_FROM (an address on a Resend-verified domain) is missing.'
      : 'No email sender configured. Add RESEND_API_KEY + SHADOW_INVITE_FROM, or SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASSWORD (e.g. smtp.gmail.com:587 with a Gmail app password) in Project Settings → Secrets.',
  };
}

function b64url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export interface SendInviteArgs {
  supabase: any;
  to: string;
  subject: string;
  bodyText: string;
  ics: string;
  method: 'REQUEST' | 'CANCEL';
}

export interface SendInviteResult {
  ok: boolean;
  provider: 'gmail' | 'resend' | 'smtp' | null;
  message_id: string | null;
  from_email: string | null;
  /** false ⇒ no sender configured; the job must stay pending. */
  configured: boolean;
  error?: string;
}

function buildMime(args: { from: string; to: string; subject: string; bodyText: string; ics: string; method: string }) {
  const boundary = `hpa-${crypto.randomUUID()}`;
  const encoded = b64(new TextEncoder().encode(args.ics));
  return [
    `From: ${FALLBACK_FROM_NAME} <${args.from}>`,
    `To: ${args.to}`,
    `Subject: ${args.subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    args.bodyText,
    '',
    `--${boundary}`,
    `Content-Type: text/calendar; charset="UTF-8"; method=${args.method}; name="invite.ics"`,
    'Content-Transfer-Encoding: base64',
    'Content-Disposition: attachment; filename="invite.ics"',
    '',
    encoded.replace(/(.{76})/g, '$1\r\n'),
    '',
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

export async function sendShadowInvite(args: SendInviteArgs): Promise<SendInviteResult> {
  const sender = await resolveInviteSender(args.supabase);
  if (!sender.configured) {
    return { ok: false, provider: null, message_id: null, from_email: null, configured: false, error: sender.detail };
  }

  if (sender.provider === 'gmail') {
    // (OAuth path — kept as a non-production fallback.)
    const { data: account } = await args.supabase
      .from('gmail_accounts')
      .select('id, email, refresh_token, access_token, access_token_expires_at')
      .eq('email', sender.from_email)
      .maybeSingle();
    if (!account) {
      return { ok: false, provider: 'gmail', message_id: null, from_email: sender.from_email, configured: true, error: 'gmail_account_missing' };
    }
    try {
      const token = await getValidAccessToken(account as GmailAccountRow, args.supabase);
      const raw = b64url(
        new TextEncoder().encode(
          buildMime({ from: account.email, to: args.to, subject: args.subject, bodyText: args.bodyText, ics: args.ics, method: args.method }),
        ),
      );
      const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`gmail_send_${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
      return { ok: true, provider: 'gmail', message_id: data?.id || null, from_email: account.email, configured: true };
    } catch (e) {
      return {
        ok: false, provider: 'gmail', message_id: null, from_email: sender.from_email, configured: true,
        error: String((e as Error).message).slice(0, 300),
      };
    }
  }

  if (sender.provider === 'smtp') {
    const smtp = smtpConfig();
    if (!smtp) {
      return { ok: false, provider: 'smtp', message_id: null, from_email: null, configured: false, error: 'smtp_not_configured' };
    }
    try {
      const result = await sendRawSmtp({
        host: smtp.host,
        port: smtp.port,
        user: smtp.user,
        password: smtp.password,
        from: smtp.from,
        to: args.to,
        subject: args.subject,
        bodyText: args.bodyText,
        ics: args.ics,
        method: args.method,
      });
      if (!result.ok) {
        return {
          ok: false, provider: 'smtp', message_id: null, from_email: smtp.from, configured: true,
          error: result.error,
        };
      }
      return { ok: true, provider: 'smtp', message_id: result.messageId, from_email: smtp.from, configured: true };
    } catch (e) {
      return {
        ok: false, provider: 'smtp', message_id: null, from_email: smtp.from, configured: true,
        error: String((e as Error).message).slice(0, 300),
      };
    }
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: `${FALLBACK_FROM_NAME} <${sender.from_email}>`,
        to: [args.to],
        subject: args.subject,
        text: args.bodyText,
        attachments: [
          {
            filename: 'invite.ics',
            content: b64(new TextEncoder().encode(args.ics)),
            content_type: `text/calendar; charset=utf-8; method=${args.method}`,
          },
        ],
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`resend_${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
    return { ok: true, provider: 'resend', message_id: data?.id || null, from_email: sender.from_email, configured: true };
  } catch (e) {
    return {
      ok: false, provider: 'resend', message_id: null, from_email: sender.from_email, configured: true,
      error: String((e as Error).message).slice(0, 300),
    };
  }
}
