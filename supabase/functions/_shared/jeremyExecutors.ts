/**
 * Concrete provider executors for Jeremy — the only place the shared generation
 * and launch functions are actually invoked.
 *
 * Every call carries the service-role identity, so the hardened generation
 * endpoints accept it while remaining closed to public callers. Provider assets
 * are copied into durable project storage before anything is marked generated.
 */
import { DURABLE_BUCKET, type GenerationExecutors, type GenerationKind } from "./jeremyGeneration.ts";
import type { PublishExecutor } from "./jeremyLaunch.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

const SUPABASE_URL = () => Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = () => Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function invokeFunction(name: string, body: Record<string, unknown>, extraHeaders: Record<string, string> = {}) {
  const res = await fetch(`${SUPABASE_URL()}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SERVICE_KEY()}`,
      apikey: SERVICE_KEY(),
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload?.error) {
    throw new Error(`${name} failed [${res.status}]: ${String(payload?.error ?? JSON.stringify(payload)).slice(0, 400)}`);
  }
  return payload as Record<string, unknown>;
}

const extensionFor = (url: string, kind: GenerationKind) => {
  const match = /\.(png|jpe?g|webp|mp4|mov|webm)(\?|$)/i.exec(url);
  if (match) return match[1].toLowerCase();
  return kind === "video" ? "mp4" : "png";
};

/** True when the asset already lives in this project's own storage. */
export function isDurableProjectUrl(url: string): boolean {
  return url.startsWith(`${SUPABASE_URL()}/storage/v1/object/public/`);
}

export function makeGenerationExecutors(db: Db): GenerationExecutors {
  return {
    async generateImage(input) {
      const payload = await invokeFunction("generate-static-ad", {
        prompt: input.prompt,
        aspectRatio: input.aspectRatio,
        clientId: input.clientId,
        brandColors: input.brandColors,
        brandFonts: input.brandFonts,
        referenceImages: input.referenceImages,
        includeDisclaimer: Boolean(input.disclaimer),
        disclaimerText: input.disclaimer ?? undefined,
        styleName: "Capital Raising",
      });
      const url = String(payload.imageUrl ?? "");
      if (!url) throw new Error("generate-static-ad returned no imageUrl.");
      return { url, receipt: payload, provider_job_id: (payload.assetId as string) ?? null };
    },

    async generateVideo(input) {
      const payload = await invokeFunction("generate-video-from-image", {
        imageUrl: input.sourceFrameUrl ?? undefined,
        prompt: input.prompt,
        aspectRatio: input.aspectRatio,
        duration: input.durationSeconds,
        model: input.model.includes("seedance") ? "seedance-pro" : input.model,
      });
      const url = String(payload.videoUrl ?? payload.video_url ?? "");
      if (!url) throw new Error("generate-video-from-image returned no videoUrl.");
      return { url, receipt: payload, provider_job_id: (payload.operationId as string) ?? null };
    },

    async persistToDurableStorage({ url, clientId, candidateId, kind }) {
      if (isDurableProjectUrl(url)) return url;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Could not download the generated asset for durable storage (${res.status}).`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      const ext = extensionFor(url, kind);
      const path = `jeremy/${clientId}/${candidateId}-${Date.now()}.${ext}`;
      const { error } = await db.storage.from(DURABLE_BUCKET).upload(path, bytes, {
        contentType: kind === "video" ? `video/${ext === "mov" ? "quicktime" : ext}` : `image/${ext === "jpg" ? "jpeg" : ext}`,
        upsert: true,
      });
      if (error) throw new Error(`Durable storage upload failed: ${error.message}`);
      const { data } = db.storage.from(DURABLE_BUCKET).getPublicUrl(path);
      const publicUrl = String(data?.publicUrl ?? "");
      if (!publicUrl) throw new Error("Durable storage returned no public URL.");
      return publicUrl;
    },
  };
}

/**
 * Publishes through the EXISTING meta-launch-center function. It authenticates
 * with the dashboard session token of the approving operator, so the launch path
 * and its PAUSED invariant are untouched.
 */
export function makePublishExecutor(dashboardToken: string | null): PublishExecutor {
  return {
    async publish(launchId: string) {
      if (!dashboardToken) {
        throw new Error("Publishing requires the approving operator's dashboard session token.");
      }
      return await invokeFunction("meta-launch-center", { launch_id: launchId }, { "x-dashboard-token": dashboardToken });
    },
  };
}
