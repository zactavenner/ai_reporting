// Tracks per-lead "last viewed at" timestamps so we can render an unread badge
// when a new inbound event arrives after the setter last opened the lead.
// Stored in localStorage — device-local; no DB roundtrip needed.

const KEY = 'setter.lastViewed.v1';
const MAX_ENTRIES = 5000; // cap growth

type Map = Record<string, number>; // leadId -> epoch ms

function read(): Map {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}

function write(m: Map) {
  try {
    // Trim if oversized: drop the oldest half.
    const entries = Object.entries(m);
    if (entries.length > MAX_ENTRIES) {
      entries.sort((a, b) => b[1] - a[1]);
      m = Object.fromEntries(entries.slice(0, Math.floor(MAX_ENTRIES / 2)));
    }
    localStorage.setItem(KEY, JSON.stringify(m));
  } catch {}
}

export function getLastViewed(leadId: string): number {
  return read()[leadId] || 0;
}

export function markViewed(leadId: string, at: number = Date.now()) {
  const m = read();
  m[leadId] = at;
  write(m);
  // Notify same-tab listeners (storage event only fires cross-tab)
  try { window.dispatchEvent(new CustomEvent('setter:viewed', { detail: { leadId, at } })); } catch {}
}

export function getAllLastViewed(): Map {
  return read();
}

/** Subscribe to changes (same-tab + cross-tab). Returns cleanup. */
export function subscribeViewed(cb: () => void): () => void {
  const s = (e: StorageEvent) => { if (e.key === KEY) cb(); };
  const c = () => cb();
  window.addEventListener('storage', s);
  window.addEventListener('setter:viewed', c as EventListener);
  return () => {
    window.removeEventListener('storage', s);
    window.removeEventListener('setter:viewed', c as EventListener);
  };
}