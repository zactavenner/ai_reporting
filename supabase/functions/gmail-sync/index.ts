import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  corsHeaders,
  extractBody,
  getValidAccessToken,
  gmailFetch,
  headersToMap,
  parseFrom,
} from "../_shared/gmail.ts";

const INTERNAL_PASSWORD = "HPA1234$";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Allow cron unauth invoke; if body has password, accept. Otherwise still run (function is verify_jwt=false).
  let accountIdFilter: string | null = null;
  try {
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      if (body?.account_id) accountIdFilter = body.account_id;
      if (body?.password && body.password !== INTERNAL_PASSWORD) {
        return json({ error: "unauthorized" }, 401);
      }
    }
  } catch { /* noop */ }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let q = supabase.from("gmail_accounts").select("*").eq("status", "active");
  if (accountIdFilter) q = q.eq("id", accountIdFilter);
  const { data: accounts, error: aErr } = await q;
  if (aErr) return json({ error: aErr.message }, 500);

  const summary: any[] = [];
  for (const acc of accounts ?? []) {
    const { data: logRow } = await supabase.from("email_sync_log").insert({
      account_id: acc.id, status: "running",
    }).select().single();
    try {
      const result = await syncAccount(supabase, acc);
      await supabase.from("email_sync_log").update({
        status: "completed",
        finished_at: new Date().toISOString(),
        ...result,
      }).eq("id", logRow!.id);
      summary.push({ account: acc.email, ...result });
    } catch (e) {
      const msg = (e as Error).message;
      await supabase.from("email_sync_log").update({
        status: "failed",
        finished_at: new Date().toISOString(),
        error_message: msg,
      }).eq("id", logRow!.id);
      summary.push({ account: acc.email, error: msg });
    }
  }

  return json({ ok: true, results: summary });
});

async function syncAccount(supabase: any, acc: any) {
  const token = await getValidAccessToken(acc, supabase);
  // Look back 2 days on first run or since last sync
  const since = acc.last_synced_at
    ? Math.floor((Date.now() - new Date(acc.last_synced_at).getTime()) / 1000) + 600
    : 2 * 24 * 3600;
  const days = Math.max(1, Math.ceil(since / 86400));
  const list = await gmailFetch(
    token,
    `/users/me/messages?maxResults=50&q=${encodeURIComponent(`newer_than:${days}d`)}`,
  );
  const messages = list.messages ?? [];
  let synced = 0, classified = 0, autoArchived = 0;

  for (const m of messages) {
    // skip if already in DB
    const { data: existing } = await supabase.from("emails").select("id").eq("account_id", acc.id).eq("gmail_id", m.id).maybeSingle();
    if (existing) continue;

    const full = await gmailFetch(token, `/users/me/messages/${m.id}?format=full`);
    const headers = headersToMap(full.payload?.headers);
    const from = parseFrom(headers["from"]);
    const to = (headers["to"] || "").split(",").map((s: string) => s.trim()).filter(Boolean);
    const cc = (headers["cc"] || "").split(",").map((s: string) => s.trim()).filter(Boolean);
    const dateMs = full.internalDate ? parseInt(full.internalDate) : Date.now();
    const { text, html } = extractBody(full.payload);
    const labels: string[] = full.labelIds ?? [];
    const unread = labels.includes("UNREAD");
    const archived = !labels.includes("INBOX");

    const { data: ins, error: insErr } = await supabase.from("emails").insert({
      account_id: acc.id,
      gmail_id: m.id,
      thread_id: full.threadId,
      from_email: from.email,
      from_name: from.name,
      to_emails: to,
      cc_emails: cc,
      subject: headers["subject"] || "(no subject)",
      snippet: full.snippet || "",
      body_text: text.slice(0, 50000),
      body_html: html.slice(0, 200000),
      received_at: new Date(dateMs).toISOString(),
      labels,
      is_unread: unread,
      is_archived: archived,
    }).select().single();
    if (insErr) continue;
    synced++;

    // Fire classification (await so we can auto-archive)
    try {
      const cls = await classifyAndArchive(supabase, ins, acc, token);
      classified++;
      if (cls.autoArchived) autoArchived++;
    } catch (e) {
      console.error("classify error", e);
    }
  }

  await supabase.from("gmail_accounts").update({
    last_synced_at: new Date().toISOString(),
  }).eq("id", acc.id);

  return {
    messages_synced: synced,
    messages_classified: classified,
    messages_auto_archived: autoArchived,
  };
}

async function classifyAndArchive(supabase: any, email: any, acc: any, token: string) {
  const openRouterKey = (Deno.env.get("OPENROUTER_API_KEY") || "").trim().replace(/^['"]|['"]$/g, "");
  if (!openRouterKey.startsWith("sk-or-")) throw new Error("OPENROUTER_API_KEY missing or invalid");
  const prompt = `Classify this email and return JSON only.
Categories: important_human, client, sales, partner_vendor, internal, newsletter, promotional, cold_outreach, spam
Priority: high (existing clients, prospects, revenue, escalations, contracts, urgent), medium (general inquiries, vendors), low (newsletters, marketing, cold outreach)

From: ${email.from_name} <${email.from_email}>
Subject: ${email.subject}
Body (first 2k chars):
${(email.body_text || email.snippet || "").slice(0, 2000)}

Return JSON: {"classification":"...","priority":"high|medium|low","requires_response":true|false,"reason":"short"}`;

  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openRouterKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://reporting.highperformanceads.com",
      "X-Title": "HPA Gmail Sync",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: "You are an email triage classifier. Output strict JSON only." },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
    }),
  });
  if (!r.ok) throw new Error(`ai: ${await r.text()}`);
  const data = await r.json();
  const content = data.choices?.[0]?.message?.content ?? "{}";
  let parsed: any = {};
  try { parsed = JSON.parse(content); } catch { parsed = {}; }
  const cls = parsed.classification || "unclassified";
  const pri = parsed.priority || "low";
  const requires = !!parsed.requires_response;

  const lowValue = ["newsletter", "promotional", "cold_outreach", "spam"].includes(cls);
  let autoArchived = false;
  if (lowValue && !email.is_archived) {
    try {
      await gmailFetch(token, `/users/me/messages/${email.gmail_id}/modify`, {
        method: "POST",
        body: JSON.stringify({ removeLabelIds: ["INBOX"] }),
      });
      autoArchived = true;
    } catch (e) { console.error("archive fail", e); }
  }

  await supabase.from("emails").update({
    classification: cls,
    priority: pri,
    requires_response: requires,
    auto_archived: autoArchived,
    is_archived: autoArchived ? true : email.is_archived,
    classified_at: new Date().toISOString(),
  }).eq("id", email.id);

  return { autoArchived };
}

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}