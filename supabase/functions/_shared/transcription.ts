const TRANSCRIPTION_URL = "https://ai.gateway.lovable.dev/v1/audio/transcriptions";
const TRANSCRIPTION_MODEL = "openai/gpt-4o-mini-transcribe";

export async function transcribeRecording(
  audio: Blob,
  opts: { prompt?: string; fileName?: string } = {},
): Promise<string> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");
  if (!audio || audio.size < 1024) return "";

  const contentType = audio.type || "audio/webm";
  const ext = contentType.includes("wav")
    ? "wav"
    : contentType.includes("mpeg") || contentType.includes("mp3")
      ? "mp3"
      : contentType.includes("mp4")
        ? "mp4"
        : "webm";

  const form = new FormData();
  form.append("model", TRANSCRIPTION_MODEL);
  form.append("file", audio, opts.fileName || `recording.${ext}`);
  if (opts.prompt) form.append("prompt", opts.prompt);

  const response = await fetch(TRANSCRIPTION_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!response.ok) {
    throw new Error(`Transcription failed ${response.status}: ${await response.text().catch(() => "")}`);
  }

  const data = await response.json();
  return String(data?.text || "").trim();
}