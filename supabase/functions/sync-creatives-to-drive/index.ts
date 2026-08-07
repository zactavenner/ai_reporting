// Pushes approved creatives into each client's configured Google Drive folder.
// Runs on-demand (invoked right after a creative is approved) and on a cron sweep.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const UPLOAD_URL =
  "https://connector-gateway.lovable.dev/google_drive/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

function extFromMime(mime: string): string {
  const map: Record<string, string> = {
    "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif",
    "video/mp4": ".mp4", "video/quicktime": ".mov", "video/webm": ".webm", "application/pdf": ".pdf",
  };
  return map[mime] ?? "";
}

function safeName(title: string, urlPath: string, mime: string): string {
  const base = (title || "creative").replace(/[\\/:*?"<>|]+/g, "-").slice(0, 90).trim() || "creative";
  const urlExt = (urlPath.match(/\.(\w{2,5})(?:\?|$)/) || [])[1];
  const ext = urlExt ? `.${urlExt}` : extFromMime(mime);
  return base.toLowerCase().endsWith(ext.toLowerCase()) ? base : `${base}${ext}`;
}

async function uploadToDrive(
  headers: Record<string, string>,
  folderId: string,
  fileUrl: string,
  title: string,
) {
  const res = await fetch(fileUrl);
  if (!res.ok) throw new Error(`Download failed [${res.status}] for ${fileUrl}`);
  const mime = res.headers.get("content-type")?.split(";")[0] || "application/octet-stream";
  const blob = await res.blob();
  const name = safeName(title, fileUrl, mime);

  const form = new FormData();
  form.append(
    "metadata",
    new Blob([JSON.stringify({ name, parents: [folderId] })], { type: "application/json" }),
  );
  form.append("file", blob, name);

  const up = await fetch(`${UPLOAD_URL}&fields=id,name,webViewLink`, {
    method: "POST",
    headers,
    body: form,
  });
  const text = await up.text();
  if (!up.ok) throw new Error(`Drive upload failed [${up.status}]: ${text}`);
  const json = JSON.parse(text);
  return { id: json.id as string, name: (json.name as string) ?? name, link: (json.webViewLink as string) ?? null };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const GOOGLE_DRIVE_API_KEY = Deno.env.get("GOOGLE_DRIVE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");
    if (!GOOGLE_DRIVE_API_KEY) throw new Error("GOOGLE_DRIVE_API_KEY is not configured. Link the Google Drive connector.");
    const driveHeaders = {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "X-Connection-Api-Key": GOOGLE_DRIVE_API_KEY,
    };

    const body = await req.json().catch(() => ({}));
    const creativeId: string | null = body?.creative_id ?? null;
    const clientId: string | null = body?.client_id ?? null;
    const limit = Math.min(Math.max(Number(body?.limit) || 25, 1), 100);

    let cfgQ = sb.from("client_drive_folders").select("*").eq("enabled", true);
    if (clientId) cfgQ = cfgQ.eq("client_id", clientId);
    const { data: configs, error: cfgErr } = await cfgQ;
    if (cfgErr) throw new Error(cfgErr.message);
    if (!configs?.length) return json({ ok: true, skipped: "no enabled drive folders", results: [] });

    const results: any[] = [];

    for (const cfg of configs) {
      const statuses: string[] = Array.isArray(cfg.statuses) && cfg.statuses.length ? cfg.statuses : ["approved"];

      let q = sb
        .from("creatives")
        .select("id, title, file_url, status, client_id, created_at")
        .eq("client_id", cfg.client_id)
        .in("status", statuses)
        .not("file_url", "is", null)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (creativeId) q = q.eq("id", creativeId);
      const { data: creatives, error: crErr } = await q;
      if (crErr) throw new Error(crErr.message);
      if (!creatives?.length) continue;

      // Skip anything already uploaded to this folder.
      const { data: done } = await sb
        .from("creative_drive_uploads")
        .select("creative_id")
        .eq("client_id", cfg.client_id)
        .eq("folder_id", cfg.folder_id)
        .eq("status", "uploaded")
        .in("creative_id", creatives.map((c: any) => c.id));
      const alreadyDone = new Set((done || []).map((d: any) => d.creative_id));

      for (const c of creatives) {
        if (alreadyDone.has(c.id)) continue;
        try {
          const file = await uploadToDrive(driveHeaders, cfg.folder_id, c.file_url as string, c.title as string);
          await sb.from("creative_drive_uploads").insert({
            client_id: cfg.client_id,
            creative_id: c.id,
            folder_id: cfg.folder_id,
            status: "uploaded",
            drive_file_id: file.id,
            drive_file_name: file.name,
            drive_web_link: file.link,
            uploaded_at: new Date().toISOString(),
          });
          results.push({ creative_id: c.id, status: "uploaded", drive_file_id: file.id, drive_web_link: file.link });
        } catch (e) {
          const message = String((e as Error)?.message || e).slice(0, 500);
          console.error("drive upload failed", c.id, message);
          await sb.from("creative_drive_uploads").insert({
            client_id: cfg.client_id,
            creative_id: c.id,
            folder_id: cfg.folder_id,
            status: "error",
            error_message: message,
          });
          results.push({ creative_id: c.id, status: "error", error: message });
        }
      }

      await sb
        .from("client_drive_folders")
        .update({ last_synced_at: new Date().toISOString() })
        .eq("id", cfg.id);
    }

    return json({ ok: true, uploaded: results.filter((r) => r.status === "uploaded").length, results });
  } catch (e) {
    console.error("sync-creatives-to-drive error", e);
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
