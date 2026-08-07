import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GATEWAY = "https://connector-gateway.lovable.dev/google_drive";
const INTERNAL_PASSWORD = "HPA1234$";

function extToMime(url: string): { mime: string; ext: string } {
  const clean = url.split("?")[0].toLowerCase();
  if (clean.endsWith(".mp4")) return { mime: "video/mp4", ext: "mp4" };
  if (clean.endsWith(".mov")) return { mime: "video/quicktime", ext: "mov" };
  if (clean.endsWith(".webm")) return { mime: "video/webm", ext: "webm" };
  if (clean.endsWith(".png")) return { mime: "image/png", ext: "png" };
  if (clean.endsWith(".webp")) return { mime: "image/webp", ext: "webp" };
  if (clean.endsWith(".gif")) return { mime: "image/gif", ext: "gif" };
  return { mime: "image/jpeg", ext: "jpg" };
}

function safeName(title: string) {
  return (title || "creative").replace(/[^a-z0-9\-_ ]/gi, "").trim().slice(0, 80) || "creative";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const password = (body as any).password;
    const isCron = (body as any).source === "cron";
    if (!isCron && password !== INTERNAL_PASSWORD) {
      return json({ error: "Unauthorized" }, 401);
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const GOOGLE_DRIVE_API_KEY = Deno.env.get("GOOGLE_DRIVE_API_KEY");
    if (!LOVABLE_API_KEY || !GOOGLE_DRIVE_API_KEY) {
      return json({ error: "Google Drive connector is not configured" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const clientId = (body as any).client_id as string | undefined;

    let folderQuery = supabase.from("client_drive_folders").select("*").eq("enabled", true);
    if (clientId) folderQuery = folderQuery.eq("client_id", clientId);
    const { data: folders, error: folderErr } = await folderQuery;
    if (folderErr) throw folderErr;
    if (!folders?.length) return json({ success: true, uploaded: 0, note: "No Drive folders configured" });

    const results: any[] = [];

    for (const folder of folders) {
      const statuses: string[] = folder.statuses?.length ? folder.statuses : ["approved"];

      const { data: creatives, error: cErr } = await supabase
        .from("creatives")
        .select("id, title, type, file_url, status, created_at")
        .eq("client_id", folder.client_id)
        .in("status", statuses)
        .not("file_url", "is", null)
        .order("created_at", { ascending: true });
      if (cErr) throw cErr;

      const { data: existing } = await supabase
        .from("creative_drive_uploads")
        .select("creative_id, status")
        .eq("folder_id", folder.folder_id);
      const done = new Set(
        (existing || []).filter((r: any) => r.status === "uploaded").map((r: any) => r.creative_id),
      );

      let uploaded = 0;
      const failures: any[] = [];

      for (const creative of creatives || []) {
        if (done.has(creative.id)) continue;
        try {
          const fileRes = await fetch(creative.file_url as string);
          if (!fileRes.ok) throw new Error(`Download failed [${fileRes.status}]`);
          const bytes = new Uint8Array(await fileRes.arrayBuffer());
          const { mime, ext } = extToMime(creative.file_url as string);
          const name = `${safeName(creative.title)}-${String(creative.id).slice(0, 8)}.${ext}`;

          const form = new FormData();
          form.append(
            "metadata",
            new Blob([JSON.stringify({ name, parents: [folder.folder_id] })], {
              type: "application/json",
            }),
          );
          form.append("file", new Blob([bytes], { type: mime }), name);

          const upRes = await fetch(
            `${GATEWAY}/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,webViewLink`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${LOVABLE_API_KEY}`,
                "X-Connection-Api-Key": GOOGLE_DRIVE_API_KEY,
              },
              body: form,
            },
          );
          const upText = await upRes.text();
          if (!upRes.ok) throw new Error(`Drive upload failed [${upRes.status}]: ${upText}`);
          const uploadedFile = JSON.parse(upText);

          await supabase.from("creative_drive_uploads").upsert(
            {
              creative_id: creative.id,
              client_id: folder.client_id,
              folder_id: folder.folder_id,
              drive_file_id: uploadedFile.id,
              drive_file_name: uploadedFile.name,
              drive_web_link: uploadedFile.webViewLink ?? null,
              status: "uploaded",
              error_message: null,
              uploaded_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
            { onConflict: "creative_id,folder_id" },
          );
          uploaded++;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`Creative ${creative.id} upload failed:`, message);
          failures.push({ creative_id: creative.id, error: message });
          await supabase.from("creative_drive_uploads").upsert(
            {
              creative_id: creative.id,
              client_id: folder.client_id,
              folder_id: folder.folder_id,
              status: "failed",
              error_message: message.slice(0, 500),
              updated_at: new Date().toISOString(),
            },
            { onConflict: "creative_id,folder_id" },
          );
        }
      }

      await supabase
        .from("client_drive_folders")
        .update({ last_synced_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", folder.id);

      results.push({
        client_id: folder.client_id,
        folder_id: folder.folder_id,
        folder_name: folder.folder_name,
        candidates: creatives?.length ?? 0,
        uploaded,
        failures,
      });
    }

    return json({ success: true, results });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("drive-sync-approved-creatives error:", message);
    return json({ error: message }, 500);
  }
});
