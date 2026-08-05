// MiniMax H3 and most OpenRouter video models hard-reject prompts over
// ~7000 characters ("invalid params, content[0].text too long").
// Every video submit path should run its prompt through this condenser.

export const VIDEO_PROMPT_MAX_CHARS = 6500;

export function condenseVideoPrompt(raw: string, limit = VIDEO_PROMPT_MAX_CHARS): string {
  let p = String(raw || "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^[ \t]+|[ \t]+$/gm, "")
    .trim();
  if (p.length <= limit) return p;

  p = p
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\*\*/g, "")
    .replace(/^[-•*]\s+/gm, "- ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (p.length <= limit) return p;

  const headLen = Math.floor(limit * 0.72);
  const tailLen = limit - headLen - 24;
  const head = p.slice(0, headLen).replace(/\s+\S*$/, "");
  const tail = p.slice(p.length - tailLen).replace(/^\S*\s+/, "");
  return `${head}\n[...]\n${tail}`.slice(0, limit);
}
