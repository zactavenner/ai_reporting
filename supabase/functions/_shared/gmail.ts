// Shared Gmail helpers used by edge functions
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1";

export interface GmailAccountRow {
  id: string;
  email: string;
  refresh_token: string;
  access_token: string | null;
  access_token_expires_at: string | null;
}

export async function getValidAccessToken(
  account: GmailAccountRow,
  supabase: any,
): Promise<string> {
  const now = Date.now();
  const expiresAt = account.access_token_expires_at
    ? new Date(account.access_token_expires_at).getTime()
    : 0;
  if (account.access_token && expiresAt > now + 60_000) return account.access_token;

  const clientId = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID")!;
  const clientSecret = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET")!;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: account.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`token refresh failed: ${await res.text()}`);
  const data = await res.json();
  const access_token = data.access_token as string;
  const expires_in = (data.expires_in as number) ?? 3500;
  const newExp = new Date(Date.now() + expires_in * 1000).toISOString();
  await supabase.from("gmail_accounts").update({
    access_token,
    access_token_expires_at: newExp,
  }).eq("id", account.id);
  return access_token;
}

export async function gmailFetch(
  accessToken: string,
  path: string,
  init: RequestInit = {},
) {
  const res = await fetch(`${GMAIL_API}${path}`, {
    ...init,
    headers: {
      ...(init.headers || {}),
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`Gmail ${path} ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

export function decodeBase64Url(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    return "";
  }
}

export function extractBody(payload: any): { text: string; html: string } {
  let text = "";
  let html = "";
  const walk = (p: any) => {
    if (!p) return;
    if (p.mimeType === "text/plain" && p.body?.data) text += decodeBase64Url(p.body.data);
    if (p.mimeType === "text/html" && p.body?.data) html += decodeBase64Url(p.body.data);
    if (p.parts) p.parts.forEach(walk);
  };
  walk(payload);
  if (!text && payload?.body?.data) text = decodeBase64Url(payload.body.data);
  return { text, html };
}

export function parseFrom(value: string | undefined): { email: string; name: string } {
  if (!value) return { email: "", name: "" };
  const m = value.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim(), email: m[2].trim() };
  return { email: value.trim(), name: "" };
}

export function headersToMap(headers: Array<{ name: string; value: string }> = []) {
  const out: Record<string, string> = {};
  for (const h of headers) out[h.name.toLowerCase()] = h.value;
  return out;
}

export function makeRawMessage(opts: {
  from: string;
  to: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string;
}) {
  const lines = [
    `From: ${opts.from}`,
    `To: ${opts.to}`,
    `Subject: ${opts.subject}`,
    opts.inReplyTo ? `In-Reply-To: ${opts.inReplyTo}` : "",
    opts.references ? `References: ${opts.references}` : "",
    'Content-Type: text/plain; charset="UTF-8"',
    "",
    opts.body,
  ].filter(Boolean).join("\r\n");
  return btoa(unescape(encodeURIComponent(lines)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

export const SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "openid",
].join(" ");