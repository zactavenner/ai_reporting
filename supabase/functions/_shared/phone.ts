// Shared phone helpers so GHL rows and platform rows collapse onto the same lead.
export function toE164(raw?: string | null): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/[^\d]/g, "");
  if (!digits) return null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (String(raw).trim().startsWith("+")) return `+${digits}`;
  return `+${digits}`;
}

export function last10(raw?: string | null): string | null {
  const digits = String(raw || "").replace(/[^\d]/g, "");
  return digits.length >= 10 ? digits.slice(-10) : null;
}