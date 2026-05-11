import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, ExternalLink, RefreshCw, Sheet as SheetIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAgencySettings } from '@/hooks/useAgencySettings';
import { supabase } from '@/integrations/supabase/client';

interface PinnedTab {
  gid: string;
  title: string;
}

function parseSheetId(url: string): string | null {
  const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return m?.[1] ?? null;
}

function buildEmbedUrl(sheetId: string, gid?: string): string {
  const base = `https://docs.google.com/spreadsheets/d/${sheetId}/edit?rm=minimal&widget=true&headers=false`;
  return gid ? `${base}#gid=${gid}` : base;
}

export function MasterSheetPanel() {
  const { data: settings } = useAgencySettings();
  const url = (settings as any)?.master_google_sheet_url as string | null;
  const defaultGid = (settings as any)?.master_default_gid as string | null;
  const pinned = (((settings as any)?.master_pinned_gids as PinnedTab[] | null) || []).filter(t => t?.gid);

  const sheetId = useMemo(() => (url ? parseSheetId(url) : null), [url]);
  const [activeGid, setActiveGid] = useState<string | undefined>(undefined);
  const [collapsed, setCollapsed] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);
  const [allTabs, setAllTabs] = useState<PinnedTab[]>([]);

  useEffect(() => {
    setActiveGid(defaultGid || pinned[0]?.gid);
  }, [defaultGid, pinned.length]);

  useEffect(() => {
    if (!sheetId) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase.functions.invoke('fetch-sheet-metrics', {
          body: { sheet_id: sheetId, action: 'list_tabs' },
        });
        if (!cancelled && (data as any)?.tabs) {
          setAllTabs(((data as any).tabs as any[]).map(t => ({ gid: String(t.gid), title: t.title })));
        }
      } catch {
        // ignore
      }
    })();
    return () => { cancelled = true; };
  }, [sheetId]);

  if (!url || !sheetId) return null;

  const tabsForDropdown = allTabs.length > 0 ? allTabs : pinned;
  const activeTitle = tabsForDropdown.find(t => t.gid === activeGid)?.title;

  return (
    <section className="border-2 border-border bg-card">
      <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-border bg-muted/40">
        <div className="flex items-center gap-2 min-w-0">
          <SheetIcon className="h-4 w-4 text-primary" />
          <h3 className="font-bold text-sm truncate">Master Spreadsheet</h3>
          {activeTitle && (
            <span className="text-xs text-muted-foreground truncate">· {activeTitle}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {pinned.length > 0 && !collapsed && (
            <div className="hidden md:flex items-center gap-1">
              {pinned.map(t => (
                <Button
                  key={t.gid}
                  variant={activeGid === t.gid ? 'default' : 'outline'}
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setActiveGid(t.gid)}
                >
                  {t.title}
                </Button>
              ))}
            </div>
          )}
          {tabsForDropdown.length > 0 && !collapsed && (
            <Select value={activeGid} onValueChange={(v) => setActiveGid(v)}>
              <SelectTrigger className="h-7 w-[180px] text-xs">
                <SelectValue placeholder="All tabs" />
              </SelectTrigger>
              <SelectContent className="max-h-80">
                {tabsForDropdown.map(t => (
                  <SelectItem key={t.gid} value={t.gid} className="text-xs">{t.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setIframeKey(k => k + 1)} title="Refresh">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" asChild title="Open in Google Sheets">
            <a href={url} target="_blank" rel="noreferrer">
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setCollapsed(c => !c)} title={collapsed ? 'Expand' : 'Collapse'}>
            {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </Button>
        </div>
      </div>
      {!collapsed && (
        <div className="bg-background">
          <iframe
            key={iframeKey}
            title="Master Spreadsheet"
            src={buildEmbedUrl(sheetId, activeGid)}
            className="w-full"
            style={{ height: '720px', border: 0 }}
          />
        </div>
      )}
    </section>
  );
}