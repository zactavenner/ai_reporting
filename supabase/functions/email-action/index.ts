import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  corsHeaders,
  getValidAccessToken,
  gmailFetch,
  makeRawMessage,
} from "../_shared/gmail.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const body = await req.json().catch(() => ({}));
  const { action, email_id, draft_id, edited_body } = body;
  if (!action || !email_id) return json({ error: "action and email_id required" }, 400);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: email } = await supabase.from("emails").select("*").eq("id", email_id).single();
  if (!email) return json({ error: "email not found" }, 404);
  const { data: acc } = await supabase.from("gmail_accounts").select("*").eq("id", email.account_id).single();
  if (!acc) return json({ error: "account not found" }, 404);

  const token = await getValidAccessToken(acc, supabase);

  try {
    if (action === "archive") {
      await gmailFetch(token, `/users/me/messages/${email.gmail_id}/modify`, {
        method: "POST", body: JSON.stringify({ removeLabelIds: ["INBOX"] }),
      });
      await supabase.from("emails").update({ is_archived: true }).eq("id", email_id);
    } else if (action === "unarchive") {
      await gmailFetch(token, `/users/me/messages/${email.gmail_id}/modify`, {
        method: "POST", body: JSON.stringify({ addLabelIds: ["INBOX"] }),
      });
      await supabase.from("emails").update({ is_archived: false }).eq("id", email_id);
    } else if (action === "mark_read") {
      await gmailFetch(token, `/users/me/messages/${email.gmail_id}/modify`, {
        method: "POST", body: JSON.stringify({ removeLabelIds: ["UNREAD"] }),
      });
      await supabase.from("emails").update({ is_unread: false }).eq("id", email_id);
    } else if (action === "mark_unread") {
      await gmailFetch(token, `/users/me/messages/${email.gmail_id}/modify`, {
        method: "POST", body: JSON.stringify({ addLabelIds: ["UNREAD"] }),
      });
      await supabase.from("emails").update({ is_unread: true }).eq("id", email_id);
    } else if (action === "trash") {
      await gmailFetch(token, `/users/me/messages/${email.gmail_id}/trash`, { method: "POST" });
      await supabase.from("emails").update({ is_archived: true }).eq("id", email_id);
    } else if (action === "send_draft") {
      if (!draft_id) return json({ error: "draft_id required" }, 400);
      const { data: draft } = await supabase.from("email_drafts").select("*").eq("id", draft_id).single();
      if (!draft) return json({ error: "draft not found" }, 404);
      const replyBody = edited_body || draft.body;
      const raw = makeRawMessage({
        from: acc.email,
        to: email.from_email,
        subject: email.subject?.toLowerCase().startsWith("re:") ? email.subject : `Re: ${email.subject}`,
        body: replyBody,
        inReplyTo: `<${email.gmail_id}>`,
      });
      await gmailFetch(token, `/users/me/messages/send`, {
        method: "POST",
        body: JSON.stringify({ raw, threadId: email.thread_id }),
      });
      await supabase.from("email_drafts").update({
        status: "sent",
        sent_at: new Date().toISOString(),
        edited_body: edited_body || null,
      }).eq("id", draft_id);
      await supabase.from("emails").update({
        responded_at: new Date().toISOString(),
        requires_response: false,
      }).eq("id", email_id);
    } else {
      return json({ error: "unknown action" }, 400);
    }

    return json({ ok: true });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}