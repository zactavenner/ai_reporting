import { useMemo, useRef, useState } from 'react';
import { format, subDays, startOfMonth, endOfMonth, subMonths, startOfYear, endOfYear, subYears, differenceInDays, parseISO } from 'date-fns';
import {
  Calendar as CalendarIcon,
  ExternalLink,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Minus,
  Users,
  PhoneCall,
  CalendarCheck,
  DollarSign,
  Target,
  Activity,
  Handshake,
  Briefcase,
  Banknote,
  Percent,
  Clock,
  Wallet,
  ShieldAlert,
  CheckCircle2,
  Timer,
  Mail,
  FileDown,
  Loader2,
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  BarChart,
  Bar,
  Cell,
  LineChart,
  Line,
} from 'recharts';
import { useClientSettings } from '@/hooks/useClientSettings';
import { useSheetMetrics } from '@/hooks/useSheetMetrics';
import { TabBreakdownDrilldown } from './TabBreakdownDrilldown';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { SheetStatsReportDialog, type StatHighlight } from './SheetStatsReportDialog';
import { useToast } from '@/hooks/use-toast';

function parseSheetUrl(url?: string | null): { sheet_id: string; gid?: string } | null {
  if (!url) return null;
  const idMatch = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!idMatch) return null;
  const gidMatch = url.match(/[#?&]gid=(\d+)/);
  return { sheet_id: idMatch[1], gid: gidMatch?.[1] };
}

type Preset = 'y' | '3d' | '7d' | '30d' | '90d' | 'tm' | 'lm' | 'ty' | 'launch' | 'custom';

function presetRange(p: Preset, launchDate?: Date): { from: Date; to: Date } {
  const today = new Date();
  switch (p) {
    case 'y': { const y = subDays(today, 1); return { from: y, to: y }; }
    case '3d': return { from: subDays(today, 2), to: today };
    case '7d': return { from: subDays(today, 6), to: today };
    case '30d': return { from: subDays(today, 29), to: today };
    case '90d': return { from: subDays(today, 89), to: today };
    case 'tm': return { from: startOfMonth(today), to: today };
    case 'lm': {
      const prev = subMonths(today, 1);
      return { from: startOfMonth(prev), to: endOfMonth(prev) };
    }
    case 'ty': return { from: startOfYear(today), to: today };
    case 'launch': return { from: launchDate ?? subYears(today, 1), to: today };
    default: return { from: subDays(today, 29), to: today };
  }
}

function fmtMoney(n: number) {
  if (!isFinite(n) || isNaN(n)) return '—';
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}
function fmtMoneyFull(n: number) {
  if (!isFinite(n) || isNaN(n)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}
function fmtInt(n: number) {
  if (!isFinite(n) || isNaN(n)) return '—';
  return new Intl.NumberFormat().format(Math.round(n));
}
function fmtPct(n: number, digits = 1) {
  if (!isFinite(n) || isNaN(n)) return '—';
  return `${n.toFixed(digits)}%`;
}
function pctDelta(curr: number, prev: number): number | null {
  if (!prev) return null;
  return ((curr - prev) / Math.abs(prev)) * 100;
}

/** Parse the lowest dollar amount mentioned in a string like "$50k-$100k" or "$1M+". */
function parseLowestDollar(answer: string): number {
  if (!answer) return 0;
  const matches = answer.match(/\$?\s*([\d][\d,.]*)\s*([kKmM])?/g) || [];
  const nums: number[] = [];
  for (const m of matches) {
    const p = m.match(/([\d][\d,.]*)\s*([kKmM])?/);
    if (!p) continue;
    let v = parseFloat(p[1].replace(/,/g, ''));
    if (!isFinite(v) || v <= 0) continue;
    const suf = (p[2] || '').toLowerCase();
    if (suf === 'k') v *= 1_000;
    if (suf === 'm') v *= 1_000_000;
    // Filter implausible standalone small numbers like years/days
    if (v < 1000) continue;
    nums.push(v);
  }
  return nums.length ? Math.min(...nums) : 0;
}

interface KpiTileProps {
  label: string;
  value: string;
  sub?: string;
  delta: number | null;
  /** if true, decreased value (negative delta) is good (green) */
  invert?: boolean;
  icon?: React.ComponentType<{ className?: string }>;
  hero?: boolean;
  accent?: 'default' | 'gold' | 'emerald';
}
function KpiTile({ label, value, sub, delta, invert, icon: Icon, hero, accent = 'default' }: KpiTileProps) {
  const isPositive = delta !== null && delta > 0;
  const isNegative = delta !== null && delta < 0;
  const isGood = (invert ? isNegative : isPositive);
  const isBad = (invert ? isPositive : isNegative);
  const TrendIcon = isPositive ? TrendingUp : isNegative ? TrendingDown : Minus;
  const accentRing =
    accent === 'gold' ? 'ring-1 ring-[hsl(40_45%_55%/0.35)]'
    : accent === 'emerald' ? 'ring-1 ring-emerald-500/25'
    : 'ring-1 ring-border/60';
  const accentText =
    accent === 'gold' ? 'text-[hsl(40_45%_55%)]'
    : accent === 'emerald' ? 'text-emerald-600'
    : 'text-primary';
  return (
    <Card
      className={cn(
        'relative overflow-hidden rounded-2xl border-border/60 bg-gradient-to-b from-card to-card/40 backdrop-blur p-5 transition-shadow hover:shadow-lg',
        accentRing,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">{label}</p>
          <p
            className={cn(
              'mt-2 font-semibold tracking-tight text-foreground tabular-nums break-words leading-tight',
              hero ? 'text-2xl xl:text-3xl' : 'text-2xl',
            )}
            style={hero ? { fontFamily: 'Playfair Display, Georgia, serif' } : undefined}
          >
            {value}
          </p>
          {sub && <p className="text-[11px] text-muted-foreground mt-1">{sub}</p>}
        </div>
        {Icon && (
          <div className={cn('shrink-0 rounded-xl p-2 bg-muted/60', accentText)}>
            <Icon className="h-4 w-4" />
          </div>
        )}
      </div>
      {delta !== null && (
        <div className="mt-3 flex items-center gap-2">
          <div className={cn(
            'inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full',
            isGood && 'bg-emerald-500/10 text-emerald-600',
            isBad && 'bg-destructive/10 text-destructive',
            !isGood && !isBad && 'bg-muted text-muted-foreground'
          )}>
            <TrendIcon className="h-3 w-3" />
            {Math.abs(delta).toFixed(1)}%
          </div>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">vs prior period</span>
        </div>
      )}
      {/* subtle corner shine */}
      <div className="pointer-events-none absolute -top-12 -right-12 h-32 w-32 rounded-full bg-primary/5 blur-2xl" />
    </Card>
  );
}

function RatioPill({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex-1 min-w-[140px] px-4 py-3 rounded-xl bg-muted/40 border border-border/50">
      <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">{label}</p>
      <p className="text-xl font-semibold tabular-nums mt-0.5">{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

interface DualTrendCardProps {
  title: string;
  data: any[];
  volKey: string;
  costKey: string;
  costLabel: string;
  volColor: string;
  costColor: string;
  volIsMoney?: boolean;
  costIsMoney?: boolean;
  singleSeries?: boolean;
}
function DualTrendCard({ title, data, volKey, costKey, costLabel, volColor, costColor, volIsMoney, costIsMoney, singleSeries }: DualTrendCardProps) {
  const empty = !data || data.length === 0;
  return (
    <Card className="p-4 rounded-2xl border-border/60 bg-card/60 backdrop-blur">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold tracking-tight">{title}</p>
        <div className="flex items-center gap-3 text-[10px]">
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: volColor }} />{title}</span>
          {!singleSeries && costLabel && (
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: costColor }} />{costLabel}</span>
          )}
        </div>
      </div>
      <div className="h-44">
        {empty ? (
          <div className="h-full flex items-center justify-center text-xs text-muted-foreground">No daily rows</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="2 4" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} stroke="hsl(var(--border))" tickLine={false} axisLine={false} />
              <YAxis
                yAxisId="left"
                tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                stroke="hsl(var(--border))"
                tickLine={false}
                axisLine={false}
                width={36}
                tickFormatter={(v: number) => (volIsMoney ? fmtMoney(v) : fmtInt(v))}
              />
              {!singleSeries && (
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                  stroke="hsl(var(--border))"
                  tickLine={false}
                  axisLine={false}
                  width={40}
                  tickFormatter={(v: number) => (costIsMoney ? fmtMoney(v) : fmtInt(v))}
                />
              )}
              <Tooltip
                contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 12, fontSize: 12 }}
                formatter={(value: any, name: any) => {
                  const isMoney = name === costLabel ? !!costIsMoney : !!volIsMoney;
                  return [isMoney ? fmtMoneyFull(Number(value)) : fmtInt(Number(value)), name];
                }}
              />
              <Line yAxisId="left" type="monotone" dataKey={volKey} name={title} stroke={volColor} strokeWidth={2.25} dot={false} />
              {!singleSeries && (
                <Line yAxisId="right" type="monotone" dataKey={costKey} name={costLabel} stroke={costColor} strokeWidth={1.75} strokeDasharray="4 3" dot={false} />
              )}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
}

function ProfileBuckets({ title, icon: Icon, entries, total }: { title: string; icon: React.ComponentType<{ className?: string }>; entries: [string, number][]; total: number }) {
  if (!entries || entries.length === 0) {
    return (
      <div>
        <div className="flex items-center gap-2 mb-1.5">
          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
          <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">{title}</p>
        </div>
        <p className="text-[11px] text-muted-foreground">No survey responses in this range.</p>
      </div>
    );
  }
  const max = Math.max(...entries.map((e) => e[1]));
  return (
    <div>
      <div className="flex items-center gap-2 mb-1.5">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">{title}</p>
      </div>
      <div className="space-y-1.5">
        {entries.map(([label, count]) => {
          const pctOfTotal = total > 0 ? (count / total) * 100 : 0;
          const widthPct = max > 0 ? (count / max) * 100 : 0;
          return (
            <div key={label} className="text-[11px]">
              <div className="flex items-center justify-between gap-2 mb-0.5">
                <span className="truncate text-foreground/90" title={label}>{label}</span>
                <span className="tabular-nums text-muted-foreground shrink-0">{fmtInt(count)} · {fmtPct(pctOfTotal, 0)}</span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div className="h-full rounded-full bg-primary/70" style={{ width: `${widthPct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface Props {
  clientId: string;
  isPublicView?: boolean;
}

export function SheetStatsTab({ clientId, isPublicView }: Props) {
  const { data: settings } = useClientSettings(clientId);
  const sheetUrl = (settings as any)?.kpi_google_sheet_url as string | undefined;
  const parsed = parseSheetUrl(sheetUrl);

  const [preset, setPreset] = useState<Preset>('7d');
  const [customRange, setCustomRange] = useState<{ from?: Date; to?: Date }>({});

  const { toast } = useToast();
  const reportRef = useRef<HTMLDivElement | null>(null);
  const [reportDialogOpen, setReportDialogOpen] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  // Launch date = client created_at
  const { data: clientMeta } = useQuery({
    queryKey: ['client-launch-date', clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('created_at')
        .eq('id', clientId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!clientId,
    staleTime: 60 * 60 * 1000,
  });
  const launchDate = clientMeta?.created_at ? new Date(clientMeta.created_at) : undefined;

  // Client display name for emails / PDF filename
  const { data: clientNameRow } = useQuery({
    queryKey: ['client-name', clientId],
    queryFn: async () => {
      const { data } = await supabase.from('clients').select('name').eq('id', clientId).maybeSingle();
      return data?.name as string | undefined;
    },
    enabled: !!clientId,
    staleTime: 60 * 60 * 1000,
  });
  const clientName = clientNameRow || 'Client';

  async function capturePdf(): Promise<{ base64: string; filename: string } | null> {
    const node = reportRef.current;
    if (!node) return null;
    const [{ default: html2canvas }, jsPDFMod] = await Promise.all([
      import('html2canvas'),
      import('jspdf'),
    ]);
    const jsPDF = (jsPDFMod as any).jsPDF || (jsPDFMod as any).default;
    // Landscape A3 — wide canvas keeps KPI numbers large and readable.
    const pdf = new jsPDF({ orientation: 'l', unit: 'pt', format: 'a3' });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const margin = 36;
    const dateRangeLabel = `${format(range.from, 'MMM d, yyyy')} – ${format(range.to, 'MMM d, yyyy')}`;
    const title = `${clientName} — ${dateRangeLabel}`;
    const generatedAt = `Generated ${format(new Date(), 'MMM d, yyyy h:mm a')}`;

    // --- Cover header (drawn on every page) ---
    const drawHeader = (pageIdx: number) => {
      pdf.setFillColor(11, 43, 38); // deep green
      pdf.rect(0, 0, pageW, 8, 'F');
      pdf.setTextColor(11, 43, 38);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(22);
      pdf.text(title, margin, 44);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(13);
      pdf.setTextColor(90, 90, 90);
      pdf.text('Executive Scorecard', margin, 66);
      pdf.setFontSize(10);
      pdf.setTextColor(140, 140, 140);
      pdf.text(generatedAt, pageW - margin, 44, { align: 'right' });
      pdf.text(`Page ${pageIdx}`, pageW - margin, 66, { align: 'right' });
      pdf.setDrawColor(220, 220, 220);
      pdf.setLineWidth(0.5);
      pdf.line(margin, 80, pageW - margin, 80);
    };
    const drawFooter = () => {
      pdf.setFontSize(8);
      pdf.setTextColor(160, 160, 160);
      pdf.text(`${clientName} · ${dateRangeLabel}`, margin, pageH - 14);
      pdf.text('High Performance Ads', pageW - margin, pageH - 14, { align: 'right' });
    };

    const headerH = 96;
    const footerH = 28;
    const usableW = pageW - margin * 2;
    const usableH = pageH - headerH - footerH;
    // Treat each direct child of the report container as an atomic section
    // so we never split a KPI grid or a chart across pages (which previously
    // sliced labels away from their numbers).
    const sections = Array.from(node.children).filter(
      (el): el is HTMLElement => el instanceof HTMLElement && el.offsetHeight > 0,
    );

    const CAPTURE_SCALE = 2.5;
    const SECTION_GAP = 14;
    let pageIdx = 1;
    let cursorY = headerH;
    drawHeader(pageIdx);

    for (const section of sections) {
      const sectionCanvas = await html2canvas(section, {
        backgroundColor: '#ffffff',
        scale: CAPTURE_SCALE,
        useCORS: true,
        logging: false,
      });
      const scale = usableW / sectionCanvas.width;
      const renderH = sectionCanvas.height * scale;

      // If the section itself is taller than a full page, fall back to
      // slicing JUST this section (rare — only oversized chart grids).
      if (renderH > usableH) {
        if (cursorY > headerH) {
          drawFooter();
          pdf.addPage();
          pageIdx += 1;
          drawHeader(pageIdx);
          cursorY = headerH;
        }
        const sliceHpx = usableH / scale;
        let yPx = 0;
        while (yPx < sectionCanvas.height) {
          const sliceH = Math.min(sliceHpx, sectionCanvas.height - yPx);
          const slice = document.createElement('canvas');
          slice.width = sectionCanvas.width;
          slice.height = sliceH;
          const sctx = slice.getContext('2d');
          if (!sctx) break;
          sctx.fillStyle = '#ffffff';
          sctx.fillRect(0, 0, slice.width, slice.height);
          sctx.drawImage(sectionCanvas, 0, -yPx);
          pdf.addImage(slice.toDataURL('image/png'), 'PNG', margin, headerH, usableW, sliceH * scale);
          yPx += sliceH;
          if (yPx < sectionCanvas.height) {
            drawFooter();
            pdf.addPage();
            pageIdx += 1;
            drawHeader(pageIdx);
          }
        }
        cursorY = headerH + Math.min(renderH, usableH);
        continue;
      }

      // Start a new page if the whole block won't fit in remaining space.
      if (cursorY + renderH > pageH - footerH) {
        drawFooter();
        pdf.addPage();
        pageIdx += 1;
        drawHeader(pageIdx);
        cursorY = headerH;
      }

      pdf.addImage(sectionCanvas.toDataURL('image/png'), 'PNG', margin, cursorY, usableW, renderH);
      cursorY += renderH + SECTION_GAP;
    }
    drawFooter();

    const base64 = pdf.output('datauristring').split(',')[1] || '';
    const safeName = (clientName || 'client').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const filename = `${safeName}-${format(range.from, 'yyyyMMdd')}-${format(range.to, 'yyyyMMdd')}.pdf`;
    return { base64, filename };
  }

  async function handleDownloadPdf() {
    if (downloadingPdf) return;
    setDownloadingPdf(true);
    try {
      const result = await capturePdf();
      if (!result) throw new Error('Nothing to capture');
      const link = document.createElement('a');
      link.href = `data:application/pdf;base64,${result.base64}`;
      link.download = result.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'PDF failed', description: e?.message || String(e) });
    } finally {
      setDownloadingPdf(false);
    }
  }

  const range = preset === 'custom'
    ? { from: customRange.from ?? subDays(new Date(), 29), to: customRange.to ?? new Date() }
    : presetRange(preset, launchDate);

  const from = format(range.from, 'yyyy-MM-dd');
  const to = format(range.to, 'yyyy-MM-dd');

  // Prior period of equal length
  const days = Math.max(1, differenceInDays(range.to, range.from) + 1);
  const priorTo = format(subDays(range.from, 1), 'yyyy-MM-dd');
  const priorFrom = format(subDays(range.from, days), 'yyyy-MM-dd');

  const current = useSheetMetrics(clientId, parsed?.sheet_id, parsed?.gid, from, to);
  const prior = useSheetMetrics(clientId, parsed?.sheet_id, parsed?.gid, priorFrom, priorTo);

  const agg = current.data?.aggregated;
  const aggPrior = prior.data?.aggregated;
  const daily = current.data?.daily ?? [];

  const chartData = useMemo(() => {
    return [...daily]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((d) => {
        const leads = d.leads || 0;
        const spend = Number(d.ad_spend || 0);
        const booked = d.calls || 0;
        const funded = d.funded_investors || 0;
        return {
          date: format(parseISO(d.date), 'MMM d'),
          leads,
          spend,
          booked,
          funded,
          cpl: leads > 0 ? spend / leads : 0,
          cpBooked: booked > 0 ? spend / booked : 0,
          cpFunded: funded > 0 ? spend / funded : 0,
        };
      });
  }, [daily]);

  // Fetch lead questions in range for investor profile + pipeline value
  const { data: leadProfiles = [] } = useQuery({
    queryKey: ['lead-profiles', clientId, from, to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('leads')
        .select('id, questions, created_at, is_spam, email, phone')
        .eq('client_id', clientId)
        .gte('created_at', `${from}T00:00:00.000Z`)
        .lte('created_at', `${to}T23:59:59.999Z`)
        .limit(5000);
      if (error) throw error;
      return data || [];
    },
    enabled: !!clientId,
    staleTime: 5 * 60 * 1000,
  });

  const investorProfile = useMemo(() => {
    // Pipeline value uses ALL leads (per spec), but disposition rollups use valid only.
    const all = leadProfiles as any[];
    const valid = all.filter(
      (l) => !l.is_spam && l.email && l.phone && Array.isArray(l.questions)
    );
    const rangeBuckets: Record<string, number> = {};
    const timelineBuckets: Record<string, number> = {};
    let pipelineSum = 0;
    let pipelineCount = 0;

    const isRangeQ = (q: string) =>
      /investment range|amount.*invest|ready to invest|how much.*invest/i.test(q);
    const isTimelineQ = (q: string) =>
      /how soon|when.*plan|deploy.*capital|timeline|ready.*three months/i.test(q);

    // Pipeline sum across ALL leads with parseable answers
    for (const lead of all) {
      if (!Array.isArray(lead.questions)) continue;
      let leadLow = 0;
      for (const q of lead.questions as any[]) {
        const answer = String(q?.answer || '').trim();
        if (!answer) continue;
        const question = String(q?.question || '');
        if (isRangeQ(question)) {
          const low = parseLowestDollar(answer);
          if (low > 0 && (leadLow === 0 || low < leadLow)) leadLow = low;
        }
      }
      if (leadLow > 0) {
        pipelineSum += leadLow;
        pipelineCount += 1;
      }
    }

    for (const lead of valid) {
      let leadLow = 0;
      for (const q of lead.questions as any[]) {
        const question = String(q?.question || '');
        const answer = String(q?.answer || '').trim();
        if (!answer) continue;
        if (isRangeQ(question)) {
          rangeBuckets[answer] = (rangeBuckets[answer] || 0) + 1;
        } else if (isTimelineQ(question)) {
          timelineBuckets[answer] = (timelineBuckets[answer] || 0) + 1;
        }
      }
    }

    const topRange = Object.entries(rangeBuckets).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const topTimeline = Object.entries(timelineBuckets).sort((a, b) => b[1] - a[1]).slice(0, 6);

    // Lead disposition rollup across ALL leads in range
    const dispositionBuckets: Record<string, number> = {
      Qualified: 0,
      Spam: 0,
      'Missing Contact': 0,
    };
    for (const l of all) {
      if (l.is_spam) dispositionBuckets.Spam += 1;
      else if (l.email && l.phone) dispositionBuckets.Qualified += 1;
      else dispositionBuckets['Missing Contact'] += 1;
    }
    const dispositionEntries = Object.entries(dispositionBuckets)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1]);

    return {
      pipelineSum,
      pipelineCount,
      totalValid: valid.length,
      totalLeads: all.length,
      dispositionEntries,
      topRange,
      topTimeline,
    };
  }, [leadProfiles]);

  // Sheet-derived investor buckets fallback. Populated by fetch-sheet-metrics
  // by row-scanning the Leads + Lead Disposition tabs. Used when the DB has
  // no per-lead question rows (sheet-only clients like InjuryPro Capital).
  const sheetBuckets: any = (current.data as any)?.investorBuckets || (agg as any)?.investorBuckets || null;
  const effectiveProfile = useMemo(() => {
    const topRange = investorProfile.topRange.length > 0
      ? investorProfile.topRange
      : (sheetBuckets?.range || []).slice(0, 6).map((b: any) => [b.label, b.count] as [string, number]);
    const topTimeline = investorProfile.topTimeline.length > 0
      ? investorProfile.topTimeline
      : (sheetBuckets?.timeline || []).slice(0, 6).map((b: any) => [b.label, b.count] as [string, number]);
    const dispositionEntries = investorProfile.dispositionEntries.length > 0
      ? investorProfile.dispositionEntries
      : (sheetBuckets?.disposition || []).slice(0, 8).map((b: any) => [b.label, b.count] as [string, number]);
    const totalValid = investorProfile.totalValid > 0
      ? investorProfile.totalValid
      : ((sheetBuckets?.range || []) as any[]).reduce((s, b: any) => s + (b.count || 0), 0);
    const totalLeads = investorProfile.totalLeads > 0
      ? investorProfile.totalLeads
      : Number(sheetBuckets?.totalRows || 0) || (agg?.totalLeads || 0);
    return { topRange, topTimeline, dispositionEntries, totalValid, totalLeads };
  }, [investorProfile, sheetBuckets, agg?.totalLeads]);

  // Effective pipeline value — falls back to the Google Sheet's "Capital to
  // Deploy" per-lead lowest * leads-in-range when the DB has no per-lead
  // questions data (typical for sheet-only clients like InjuryPro Capital).
  const sheetPerLeadLow = Number((current.data as any)?.pipelineValue || (agg as any)?.pipelineValue || 0);
  const effectivePipeline = useMemo(() => {
    if (investorProfile.pipelineSum > 0) {
      return {
        value: investorProfile.pipelineSum,
        sub: `${fmtInt(investorProfile.pipelineCount)} of ${fmtInt(investorProfile.totalLeads)} leads · lowest stated range`,
      };
    }
    const leadsInRange = agg?.totalLeads || 0;
    if (sheetPerLeadLow > 0 && leadsInRange > 0) {
      return {
        value: sheetPerLeadLow * leadsInRange,
        sub: `${fmtInt(leadsInRange)} leads × ${fmtMoneyFull(sheetPerLeadLow)} lowest stated range`,
      };
    }
    return {
      value: 0,
      sub: `${fmtInt(leadsInRange)} leads · no stated range yet`,
    };
  }, [investorProfile, sheetPerLeadLow, agg?.totalLeads]);

  // Time to Funded: avg days from discovery call booked → funded, per investor
  const { data: timeToFund } = useQuery({
    queryKey: ['time-to-fund', clientId, from, to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('funded_investors')
        .select('time_to_fund_days, funded_at, first_contact_at, calls_to_fund')
        .eq('client_id', clientId)
        .gte('funded_at', `${from}T00:00:00.000Z`)
        .lte('funded_at', `${to}T23:59:59.999Z`)
        .limit(5000);
      if (error) throw error;
      const rows = (data || []) as any[];
      const days = rows
        .map((r) => {
          if (r.time_to_fund_days != null) return Number(r.time_to_fund_days);
          if (r.funded_at && r.first_contact_at) {
            return differenceInDays(new Date(r.funded_at), new Date(r.first_contact_at));
          }
          return null;
        })
        .filter((v): v is number => v != null && isFinite(v) && v >= 0);
      const calls = rows.map((r) => Number(r.calls_to_fund || 0)).filter((v) => v > 0);
      const avg = days.length ? days.reduce((a, b) => a + b, 0) / days.length : 0;
      const median = days.length ? [...days].sort((a, b) => a - b)[Math.floor(days.length / 2)] : 0;
      const avgCalls = calls.length ? calls.reduce((a, b) => a + b, 0) / calls.length : 0;
      return { avg, median, avgCalls, count: days.length };
    },
    enabled: !!clientId,
    staleTime: 5 * 60 * 1000,
  });

  const funnelData = useMemo(() => {
    if (!agg) return [];
    const leads = agg.totalLeads || 0;
    const pct = (v: number) => (leads > 0 ? (v / leads) * 100 : 0);
    return [
      { stage: 'Leads', value: leads, pct: 100 },
      { stage: 'Booked', value: agg.totalCalls || 0, pct: pct(agg.totalCalls || 0) },
      { stage: 'Showed', value: agg.showedCalls || 0, pct: pct(agg.showedCalls || 0) },
      { stage: 'Committed', value: agg.totalCommitments || 0, pct: pct(agg.totalCommitments || 0) },
      { stage: 'Funded', value: agg.fundedInvestors || 0, pct: pct(agg.fundedInvestors || 0) },
    ];
  }, [agg]);

  // Conversion ratios
  const ratios = useMemo(() => {
    if (!agg) return null;
    const leadToBook = agg.totalLeads ? (agg.totalCalls / agg.totalLeads) * 100 : 0;
    const bookToShow = agg.totalCalls ? (agg.showedCalls / agg.totalCalls) * 100 : 0;
    const showToFund = agg.showedCalls ? (agg.fundedInvestors / agg.showedCalls) * 100 : 0;
    const leadToFund = agg.totalLeads ? (agg.fundedInvestors / agg.totalLeads) * 100 : 0;
    return { leadToBook, bookToShow, showToFund, leadToFund };
  }, [agg]);

  if (!parsed) {
    return (
      <div className="border-2 border-dashed border-border bg-card rounded-2xl p-12 text-center">
        <p className="text-sm text-muted-foreground">
          No reporting Google Sheet configured for this client yet.
        </p>
        {!isPublicView && (
          <p className="text-xs text-muted-foreground mt-2">
            Add a sheet URL in Settings → Reporting Sheet to enable the dashboard.
          </p>
        )}
      </div>
    );
  }

  const presets: { id: Preset; label: string }[] = [
    { id: 'y', label: 'Yesterday' },
    { id: '3d', label: 'Last 3d' },
    { id: '7d', label: 'Last 7d' },
    { id: '30d', label: 'Last 30d' },
    { id: '90d', label: 'Last 90d' },
    { id: 'tm', label: 'This month' },
    { id: 'lm', label: 'Last month' },
    { id: 'ty', label: 'This year' },
    { id: 'launch', label: 'Since launch' },
  ];

  return (
    <div className="space-y-6">
      {/* Executive header */}
      <div className="relative overflow-hidden rounded-3xl border border-border/60 bg-gradient-to-br from-primary/[0.06] via-card to-card p-6">
        <div className="absolute inset-0 opacity-[0.04] pointer-events-none" style={{
          backgroundImage: 'radial-gradient(circle at 20% 20%, hsl(var(--primary)) 0%, transparent 40%), radial-gradient(circle at 80% 0%, hsl(40 45% 55%) 0%, transparent 40%)'
        }} />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-semibold">Performance Overview</p>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight" style={{ fontFamily: 'Playfair Display, Georgia, serif' }}>
              Executive Scorecard
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              {format(range.from, 'MMM d, yyyy')} – {format(range.to, 'MMM d, yyyy')} · {days} day{days === 1 ? '' : 's'}
            </p>
          </div>
          {/* Filter bar */}
          <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-1 p-1 rounded-full bg-muted">
          {presets.map((p) => (
            <button
              key={p.id}
              onClick={() => setPreset(p.id)}
              className={cn(
                'px-3 py-1.5 text-xs font-medium rounded-full transition-colors',
                preset === p.id ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {p.label}
            </button>
          ))}
          <Popover>
            <PopoverTrigger asChild>
              <button
                className={cn(
                  'px-3 py-1.5 text-xs font-medium rounded-full inline-flex items-center gap-1 transition-colors',
                  preset === 'custom' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <CalendarIcon className="h-3 w-3" />
                Custom
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="range"
                selected={{ from: customRange.from, to: customRange.to }}
                onSelect={(r: any) => {
                  setCustomRange({ from: r?.from, to: r?.to });
                  if (r?.from && r?.to) setPreset('custom');
                }}
                numberOfMonths={2}
                className={cn('p-3 pointer-events-auto')}
              />
            </PopoverContent>
          </Popover>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Button size="sm" variant="outline" onClick={() => setReportDialogOpen(true)} className="gap-1.5">
            <Mail className="h-3.5 w-3.5" /> Email report
          </Button>
          <Button size="sm" variant="outline" onClick={() => handleDownloadPdf()} disabled={downloadingPdf} className="gap-1.5">
            {downloadingPdf ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />}
            Download PDF
          </Button>
          <Button size="sm" variant="ghost" onClick={() => { current.refetch(); prior.refetch(); }} disabled={current.isFetching}>
            <RefreshCw className={cn('h-3 w-3', current.isFetching && 'animate-spin')} />
          </Button>
          {sheetUrl && (
            <a href={sheetUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-foreground">
              <ExternalLink className="h-3 w-3" /> Open sheet
            </a>
          )}
        </div>
      </div>
        </div>
      </div>

      <div ref={reportRef} className="space-y-6 bg-background p-1">
      {/* Hero KPIs */}
      {current.isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
        </div>
      ) : current.error ? (
        <Card className="p-6 border-destructive/40 bg-destructive/5 rounded-2xl">
          <p className="text-sm text-destructive font-medium">Could not load sheet data</p>
          <p className="text-xs text-muted-foreground mt-1">{(current.error as any)?.message}</p>
        </Card>
      ) : agg ? (
        <>
          {/* Hero row — what a CEO cares about */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
            <KpiTile
              label="Pipeline Value"
              value={fmtMoneyFull(effectivePipeline.value)}
              sub={effectivePipeline.sub}
              delta={null}
              icon={Briefcase}
              hero
              accent="gold"
            />
            <KpiTile
              label="Committed Capital"
              value={fmtMoneyFull(agg.commitmentDollars)}
              sub={`${fmtInt(agg.totalCommitments)} committed investors`}
              delta={pctDelta(agg.commitmentDollars, aggPrior?.commitmentDollars ?? 0)}
              icon={Handshake}
              hero
              accent="gold"
            />
            <KpiTile
              label="Funded Capital"
              value={fmtMoneyFull(agg.fundedDollars)}
              sub={`${fmtInt(agg.fundedInvestors)} funded investors`}
              delta={pctDelta(agg.fundedDollars, aggPrior?.fundedDollars ?? 0)}
              icon={Banknote}
              hero
              accent="emerald"
            />
            <KpiTile
              label="Cost of Capital"
              value={fmtPct(agg.costOfCapital, 2)}
              sub="Ad spend ÷ funded capital"
              delta={pctDelta(agg.costOfCapital, aggPrior?.costOfCapital ?? 0)}
              icon={Percent}
              hero
              invert
            />
            <KpiTile
              label="Total Ad Spend"
              value={fmtMoneyFull(agg.totalAdSpend)}
              sub="In selected range"
              delta={pctDelta(agg.totalAdSpend, aggPrior?.totalAdSpend ?? 0)}
              icon={DollarSign}
              hero
              invert
            />
          </div>

          {/* Conversion ribbon */}
          {ratios && (
            <Card className="p-4 rounded-2xl border-border/60 bg-card/60 backdrop-blur">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">Conversion Funnel Rates</p>
                <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Stage → Stage</p>
              </div>
              <div className="flex flex-wrap gap-3">
                <RatioPill label="Lead → Booked" value={fmtPct(ratios.leadToBook)} sub={`${fmtInt(agg.totalCalls)} of ${fmtInt(agg.totalLeads)}`} />
                <RatioPill label="Booked → Showed" value={fmtPct(ratios.bookToShow)} sub={`${fmtInt(agg.showedCalls)} of ${fmtInt(agg.totalCalls)}`} />
                <RatioPill label="Showed → Funded" value={fmtPct(ratios.showToFund)} sub={`${fmtInt(agg.fundedInvestors)} of ${fmtInt(agg.showedCalls)}`} />
                <RatioPill label="Lead → Funded" value={fmtPct(ratios.leadToFund, 2)} sub="End-to-end conversion" />
              </div>
            </Card>
          )}

          {/* Secondary KPI grid — counts row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <KpiTile label="Leads" value={fmtInt(agg.totalLeads)} delta={pctDelta(agg.totalLeads, aggPrior?.totalLeads ?? 0)} icon={Users} />
            <KpiTile label="Calls Booked" value={fmtInt(agg.totalCalls)} delta={pctDelta(agg.totalCalls, aggPrior?.totalCalls ?? 0)} icon={PhoneCall} />
            <KpiTile label="Shows" value={fmtInt(agg.showedCalls)} delta={pctDelta(agg.showedCalls, aggPrior?.showedCalls ?? 0)} icon={CalendarCheck} />
            <KpiTile label="Committed Investors" value={fmtInt(agg.totalCommitments)} delta={pctDelta(agg.totalCommitments, aggPrior?.totalCommitments ?? 0)} icon={Handshake} />
            <KpiTile label="Funded Investors" value={fmtInt(agg.fundedInvestors)} delta={pctDelta(agg.fundedInvestors, aggPrior?.fundedInvestors ?? 0)} icon={Banknote} />
          </div>

          {/* Secondary KPI grid — cost row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <KpiTile label="Cost / Lead" value={fmtMoney(agg.costPerLead)} delta={pctDelta(agg.costPerLead, aggPrior?.costPerLead ?? 0)} invert />
            <KpiTile label="Cost / Booked" value={fmtMoney(agg.costPerCall)} delta={pctDelta(agg.costPerCall, aggPrior?.costPerCall ?? 0)} invert />
            <KpiTile label="Cost / Show" value={fmtMoney(agg.costPerShow)} delta={pctDelta(agg.costPerShow, aggPrior?.costPerShow ?? 0)} invert />
            <KpiTile
              label="Cost / Committed"
              value={fmtMoney(agg.totalCommitments > 0 ? agg.totalAdSpend / agg.totalCommitments : 0)}
              delta={pctDelta(
                agg.totalCommitments > 0 ? agg.totalAdSpend / agg.totalCommitments : 0,
                aggPrior && aggPrior.totalCommitments > 0 ? aggPrior.totalAdSpend / aggPrior.totalCommitments : 0,
              )}
              invert
            />
            <KpiTile label="Cost / Funded" value={fmtMoney(agg.costPerInvestor)} delta={pctDelta(agg.costPerInvestor, aggPrior?.costPerInvestor ?? 0)} invert />
          </div>
        </>
      ) : (
        <Card className="p-6 rounded-2xl">
          <p className="text-sm text-muted-foreground">No data in the selected range.</p>
        </Card>
      )}

      {/* Time to Funded — single number: first booked call → funded */}
      <Card className="p-5 rounded-2xl border-border/60 bg-card/60 backdrop-blur">
        <div className="flex items-end justify-between mb-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">Investor Velocity</p>
            <h3 className="text-base font-semibold mt-0.5" style={{ fontFamily: 'Playfair Display, Georgia, serif' }}>Time to Funded</h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">Average days from first booked call to funded</p>
          </div>
          <Timer className="h-5 w-5 text-[hsl(40_45%_55%)]" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <RatioPill
            label="First Booked Call → Funded"
            value={timeToFund && timeToFund.count > 0 ? `${timeToFund.avg.toFixed(1)} d` : '—'}
            sub={timeToFund && timeToFund.count > 0 ? `Average across ${fmtInt(timeToFund.count)} funded investor${timeToFund.count === 1 ? '' : 's'}` : 'No funded investors in range'}
          />
          <RatioPill
            label="Funded Investors"
            value={fmtInt(agg?.fundedInvestors || 0)}
            sub="In selected range"
          />
        </div>
      </Card>

      <div>
        <div className="mb-3 flex items-end justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">Daily Performance</p>
            <h3 className="text-base font-semibold mt-0.5" style={{ fontFamily: 'Playfair Display, Georgia, serif' }}>Trend Analysis</h3>
          </div>
          <p className="text-[11px] text-muted-foreground">Volume (solid) vs. cost (dashed) per day</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <DualTrendCard title="Leads" volKey="leads" costKey="cpl" costLabel="Cost / Lead" data={chartData} volColor="hsl(var(--primary))" costColor="hsl(40 45% 55%)" costIsMoney />
          <DualTrendCard title="Booked Calls" volKey="booked" costKey="cpBooked" costLabel="Cost / Booked" data={chartData} volColor="hsl(217 91% 60%)" costColor="hsl(40 45% 55%)" costIsMoney />
          <DualTrendCard title="Funded Investors" volKey="funded" costKey="cpFunded" costLabel="Cost / Funded" data={chartData} volColor="hsl(142 71% 45%)" costColor="hsl(40 45% 55%)" costIsMoney />
          <DualTrendCard title="Ad Spend" volKey="spend" costKey="spend" costLabel="" data={chartData} volColor="hsl(40 45% 55%)" costColor="hsl(40 45% 55%)" volIsMoney singleSeries />
        </div>
      </div>

      {/* Funnel + Investor profile */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <Card className="p-5 lg:col-span-2 rounded-2xl border-border/60 bg-card/60 backdrop-blur">
          <div className="mb-4">
            <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">Pipeline</p>
            <h3 className="text-base font-semibold mt-0.5" style={{ fontFamily: 'Playfair Display, Georgia, serif' }}>Conversion Funnel</h3>
          </div>
          <div className="h-80">
            {funnelData.length === 0 || funnelData.every((f) => !f.value) ? (
              <div className="h-full flex items-center justify-center text-xs text-muted-foreground">No data</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={funnelData} layout="vertical" margin={{ top: 5, right: 90, left: 0, bottom: 0 }}>
                  <XAxis type="number" hide />
                  <YAxis dataKey="stage" type="category" width={70} tick={{ fontSize: 12, fill: 'hsl(var(--foreground))', fontWeight: 500 }} stroke="hsl(var(--border))" tickLine={false} axisLine={false} />
                  <Tooltip
                    contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 12, fontSize: 12 }}
                    cursor={{ fill: 'hsl(var(--muted) / 0.4)' }}
                    formatter={(value: any, _name: any, item: any) => [`${fmtInt(value as number)}  ·  ${fmtPct(item?.payload?.pct ?? 0, 1)}`, 'Volume']}
                  />
                  <Bar
                    dataKey="value"
                    radius={[0, 8, 8, 0]}
                    label={(props: any) => {
                      const { x = 0, y = 0, width = 0, height = 0, value, index } = props;
                      const row = funnelData[index];
                      if (!row) return null;
                      return (
                        <text x={Number(x) + Number(width) + 8} y={Number(y) + Number(height) / 2} dy={4} fill="hsl(var(--foreground))" fontSize={11} fontWeight={600}>
                          {fmtInt(value as number)} · {fmtPct(row.pct, 1)}
                        </text>
                      );
                    }}
                  >
                    {funnelData.map((_, i) => (
                      <Cell key={i} fill={`hsl(var(--primary) / ${1 - i * 0.18})`} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        <Card className="p-5 rounded-2xl border-border/60 bg-card/60 backdrop-blur">
          <div className="mb-3">
            <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">Investor Profile</p>
            <h3 className="text-base font-semibold mt-0.5" style={{ fontFamily: 'Playfair Display, Georgia, serif' }}>Who's raising their hand</h3>
          </div>
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-xl bg-muted/40 border border-border/50 px-3 py-2.5">
              <Wallet className="h-4 w-4 text-[hsl(40_45%_55%)]" />
              <div className="flex-1 min-w-0">
                <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">Stated Pipeline</p>
                <p className="text-lg font-semibold tabular-nums">{fmtMoneyFull(effectivePipeline.value)}</p>
                <p className="text-[10px] text-muted-foreground">{effectivePipeline.sub}</p>
              </div>
            </div>

            <ProfileBuckets title="Ideal Investment Range" icon={Wallet} entries={effectiveProfile.topRange} total={effectiveProfile.totalValid} />
            <ProfileBuckets title="Deployment Timeline" icon={Clock} entries={effectiveProfile.topTimeline} total={effectiveProfile.totalValid} />
          </div>
        </Card>

        <Card className="p-5 rounded-2xl border-border/60 bg-card/60 backdrop-blur">
          <div className="mb-3">
            <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">Lead Disposition</p>
            <h3 className="text-base font-semibold mt-0.5" style={{ fontFamily: 'Playfair Display, Georgia, serif' }}>Outcome Mix</h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">{fmtInt(effectiveProfile.totalLeads)} leads in range</p>
          </div>
          <div className="space-y-4">
            <ProfileBuckets
              title="Disposition"
              icon={CheckCircle2}
              entries={effectiveProfile.dispositionEntries}
              total={effectiveProfile.totalLeads}
            />
          </div>
        </Card>
      </div>

      {/* Footer meta */}
      {current.data?.tabsBreakdown && current.data.tabsBreakdown.length > 0 && (
        <TabBreakdownDrilldown
          tabs={current.data.tabsBreakdown}
          skipped={current.data.tabsSkipped}
        />
      )}

      {(current.data?.sheetTitle || current.data?.fetchedAt) && (
        <div className="flex items-center justify-between text-[11px] text-muted-foreground px-1 pt-2 border-t border-border/40">
          <span>
            {current.data?.sheetTitle ? `Source: ${current.data.sheetTitle}` : ''}
            {current.data?.rowCount ? ` · ${current.data.rowCount} days` : ''}
          </span>
          {current.data?.fetchedAt && (
            <span>Last fetched {format(new Date(current.data.fetchedAt), 'MMM d, yyyy HH:mm')}</span>
          )}
        </div>
      )}
      </div>

      <SheetStatsReportDialog
        open={reportDialogOpen}
        onOpenChange={setReportDialogOpen}
        clientId={clientId}
        clientName={clientName}
        rangeLabel={`${format(range.from, 'MMM d, yyyy')} – ${format(range.to, 'MMM d, yyyy')}`}
        highlights={agg ? [
          { label: 'Pipeline Value', value: fmtMoneyFull(effectivePipeline.value), sub: effectivePipeline.sub },
          { label: 'Committed Capital', value: fmtMoneyFull(agg.commitmentDollars), sub: `${fmtInt(agg.totalCommitments)} committed` },
          { label: 'Funded Capital', value: fmtMoneyFull(agg.fundedDollars), sub: `${fmtInt(agg.fundedInvestors)} funded` },
          { label: 'Total Ad Spend', value: fmtMoneyFull(agg.totalAdSpend) },
          { label: 'Cost of Capital', value: fmtPct(agg.costOfCapital, 2) },
          { label: 'Cost / Funded', value: fmtMoney(agg.costPerInvestor) },
          { label: 'Leads', value: fmtInt(agg.totalLeads) },
          { label: 'Calls Booked', value: fmtInt(agg.totalCalls) },
          { label: 'Shows', value: fmtInt(agg.showedCalls) },
        ] : []}
        initialRecipients={(settings as any)?.stats_report_recipients ?? []}
        initialWeeklyEnabled={!!(settings as any)?.stats_report_weekly_enabled}
        capturePdf={capturePdf}
      />
    </div>
  );
}

export default SheetStatsTab;