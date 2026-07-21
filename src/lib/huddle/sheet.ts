function parseSheetUrl(url: string): { sheetId: string; gid?: string } | null {
  if (!url) return null;
  const m = url.match(/\/spreadsheets\/d\/([\w-]+)/);
  if (!m) return null;
  const gid = url.match(/[?#&]gid=(\d+)/)?.[1];
  return { sheetId: m[1], gid };
}

export function embedSheetUrl(url: string): string {
  if (!url) return '';
  const parsed = parseSheetUrl(url);
  if (parsed) return `https://docs.google.com/spreadsheets/d/${parsed.sheetId}/preview${parsed.gid ? `?gid=${parsed.gid}` : ''}`;
  return url.includes('/pubhtml') || url.includes('output=') || url.includes('widget=')
    ? url
    : url.replace(/\/edit.*$/, '/preview').replace(/\/view.*$/, '/preview');
}