import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from 'sonner';
import { Check, X, Pencil, ChevronDown, ChevronUp, ArrowLeft, ShieldCheck, ShieldAlert, ShieldX } from 'lucide-react';

type ApprovalRow = {
  id: string;
  created_at: string;
  audit_log_id: string | null;
  client_id: string | null;
  queue_type: string;
  title: string | null;
  summary: string | null;
  agent_reasoning: string | null;
  compliance_check_result: any;
  preview_payload: any;
  status: string;
  priority: number;
  rejection_reason: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  clients?: { id: string; name: string } | null;
  autonomous_audit_log?: { agent_name: string } | null;
};

const QUEUE_TYPES = ['creative', 'budget', 'launch', 'report', 'message', 'call_script', 'funnel_change', 'finance'];
const STATUSES = ['pending', 'approved', 'rejected', 'edited_approved', 'expired'];

function complianceStatus(cc: any): 'pass' | 'warn' | 'fail' | 'none' {
  if (!cc) return 'none';
  const s = String(cc.status ?? cc.result ?? '').toLowerCase();
  if (['fail', 'failed', 'red', 'blocked'].includes(s)) return 'fail';
  if (['warn', 'warning', 'yellow'].includes(s)) return 'warn';
  if (['pass', 'passed', 'green', 'ok'].includes(s)) return 'pass';
  return 'none';
}

function ComplianceBadge({ cc }: { cc: any }) {
  const s = complianceStatus(cc);
  const map = {
    pass: { cls: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30', Icon: ShieldCheck, label: 'Compliance pass' },
    warn: { cls: 'bg-amber-500/15 text-amber-600 border-amber-500/30', Icon: ShieldAlert, label: 'Compliance warn' },
    fail: { cls: 'bg-red-500/15 text-red-600 border-red-500/30', Icon: ShieldX, label: 'Compliance fail' },
    none: { cls: 'bg-muted text-muted-foreground border-border', Icon: ShieldCheck, label: 'No check' },
  }[s];
  const Icon = map.Icon;
  return (
    <Badge variant="outline" className={`gap-1 ${map.cls}`}>
      <Icon className="h-3 w-3" />
      <span className="text-[10px]">{map.label}</span>
    </Badge>
  );
}

function PreviewBody({ type, payload }: { type: string; payload: any }) {
  const p = payload || {};
  if (type === 'creative') {
    return (
      <div className="flex flex-col gap-2">
        {p.image_url && <img src={p.image_url} alt="" className="rounded-lg max-h-64 w-auto object-cover border border-border" />}
        {p.video_url && <video src={p.video_url} controls className="rounded-lg max-h-64 border border-border" />}
        {p.copy && <p className="text-sm text-foreground whitespace-pre-wrap">{p.copy}</p>}
      </div>
    );
  }
  if (type === 'budget') {
    const before = Number(p.before ?? 0);
    const after = Number(p.after ?? 0);
    const delta = before ? ((after - before) / before) * 100 : 0;
    return (
      <div className="flex items-center gap-4 text-sm">
        <div><span className="text-muted-foreground">Before:</span> <span className="font-semibold">${before.toLocaleString()}</span></div>
        <div className="text-muted-foreground">→</div>
        <div><span className="text-muted-foreground">After:</span> <span className="font-semibold">${after.toLocaleString()}</span></div>
        <Badge variant={delta >= 0 ? 'default' : 'destructive'}>{delta >= 0 ? '+' : ''}{delta.toFixed(1)}%</Badge>
      </div>
    );
  }
  if (type === 'message') {
    return (
      <div className="rounded-md bg-muted/50 border border-border p-3 text-sm whitespace-pre-wrap">
        <div className="text-[10px] uppercase text-muted-foreground mb-1">
          {p.channel ?? 'message'}{p.to ? ` → ${p.to}` : ''}
        </div>
        {p.body}
      </div>
    );
  }
  if (type === 'report') {
    return p.report_url ? (
      <a href={p.report_url} target="_blank" rel="noreferrer" className="text-primary underline text-sm">Open report preview →</a>
    ) : <div className="text-sm text-muted-foreground">Report id: {p.report_id ?? '—'}</div>;
  }
  if (type === 'funnel_change') {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
        <div><div className="text-[10px] uppercase text-muted-foreground mb-1">Before</div><div className="rounded-md bg-muted/50 border border-border p-2 whitespace-pre-wrap">{typeof p.before === 'string' ? p.before : JSON.stringify(p.before, null, 2)}</div></div>
        <div><div className="text-[10px] uppercase text-muted-foreground mb-1">After</div><div className="rounded-md bg-muted/50 border border-border p-2 whitespace-pre-wrap">{typeof p.after === 'string' ? p.after : JSON.stringify(p.after, null, 2)}</div></div>
      </div>
    );
  }
  return (
    <pre className="text-xs bg-muted/50 border border-border rounded-md p-2 overflow-x-auto max-h-64">{JSON.stringify(p, null, 2)}</pre>
  );
}

async function callResolveAudit(entryId: string | null, newStatus: 'approved' | 'rejected', userId: string | null) {
  if (!entryId || !userId) return { ok: true };
  const { error } = await supabase.rpc('resolve_audit_entry', {
    entry_id: entryId,
    new_status: newStatus,
    resolver: userId,
  });
  return { ok: !error, error };
}

export default function ApprovalsPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [rows, setRows] = useState<ApprovalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<string>('all');
  const [filterClient, setFilterClient] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('pending');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [rejectFor, setRejectFor] = useState<ApprovalRow | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [editFor, setEditFor] = useState<ApprovalRow | null>(null);
  const [editJson, setEditJson] = useState('');
  const [tab, setTab] = useState<'inbox' | 'history'>('inbox');
  const [historySearch, setHistorySearch] = useState('');
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('approval_queue')
      .select('*, clients:client_id(id,name), autonomous_audit_log:audit_log_id(agent_name)')
      .order('priority', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(500);
    if (error) toast.error(error.message);
    setRows((data as any as ApprovalRow[]) || []);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel('approval_queue_inbox')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'approval_queue' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const highlightId = params.get('id');
  useEffect(() => {
    if (highlightId) setExpanded((s) => ({ ...s, [highlightId]: true }));
  }, [highlightId]);

  const clientOptions = useMemo(() => {
    const m = new Map<string, string>();
    rows.forEach((r) => { if (r.clients) m.set(r.clients.id, r.clients.name); });
    return Array.from(m.entries()).map(([id, name]) => ({ id, name }));
  }, [rows]);

  const inboxRows = useMemo(() => {
    return rows.filter((r) => {
      if (tab === 'inbox' && r.status !== filterStatus) return false;
      if (tab === 'history' && r.status === 'pending') return false;
      if (filterType !== 'all' && r.queue_type !== filterType) return false;
      if (filterClient !== 'all' && r.client_id !== filterClient) return false;
      if (tab === 'history' && historySearch) {
        const q = historySearch.toLowerCase();
        const hay = `${r.title ?? ''} ${r.clients?.name ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, tab, filterStatus, filterType, filterClient, historySearch]);

  const grouped = useMemo(() => {
    const g = new Map<string, ApprovalRow[]>();
    inboxRows.forEach((r) => {
      const k = r.clients?.name ?? 'Unassigned';
      if (!g.has(k)) g.set(k, []);
      g.get(k)!.push(r);
    });
    return Array.from(g.entries());
  }, [inboxRows]);

  const approve = async (r: ApprovalRow, viaEdit = false, editedPayload?: any) => {
    if (complianceStatus(r.compliance_check_result) === 'fail') {
      toast.error('Cannot approve: compliance check failed');
      return;
    }
    const patch: any = {
      status: viaEdit ? 'edited_approved' : 'approved',
      resolved_by: userId,
      resolved_at: new Date().toISOString(),
    };
    if (viaEdit && editedPayload) patch.preview_payload = editedPayload;

    const { error } = await supabase.from('approval_queue').update(patch).eq('id', r.id);
    if (error) { toast.error(error.message); return; }

    const audit = await callResolveAudit(r.audit_log_id, 'approved', userId);
    if (!audit.ok) toast.warning(`Audit transition rejected: ${audit.error?.message ?? 'unknown'}`);

    try {
      await supabase.functions.invoke('execute-approved-action', { body: { approval_id: r.id } });
    } catch (e) {
      console.error('execute-approved-action invoke failed', e);
    }
    toast.success(viaEdit ? 'Edited & approved' : 'Approved');
  };

  const reject = async (r: ApprovalRow, reason: string) => {
    if (!reason.trim()) { toast.error('Rejection reason is required'); return; }
    const { error } = await supabase.from('approval_queue').update({
      status: 'rejected',
      rejection_reason: reason,
      resolved_by: userId,
      resolved_at: new Date().toISOString(),
    }).eq('id', r.id);
    if (error) { toast.error(error.message); return; }
    const audit = await callResolveAudit(r.audit_log_id, 'rejected', userId);
    if (!audit.ok) toast.warning(`Audit transition rejected: ${audit.error?.message ?? 'unknown'}`);
    toast.success('Rejected');
  };

  const selectedIds = Object.keys(selected).filter((k) => selected[k]);
  const selectedRows = rows.filter((r) => selectedIds.includes(r.id));
  const selectedTypes = new Set(selectedRows.map((r) => r.queue_type));
  const canBulkApprove = selectedRows.length > 1 && selectedTypes.size === 1 &&
    selectedRows.every((r) => complianceStatus(r.compliance_check_result) !== 'fail' && r.status === 'pending');

  const bulkApprove = async () => {
    for (const r of selectedRows) await approve(r);
    setSelected({});
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-3 sm:px-6 py-4 sm:py-8">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={() => navigate(-1)} className="min-h-[44px] min-w-[44px]">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">Approvals</h1>
              <p className="text-xs text-muted-foreground">Agent proposals awaiting your call</p>
            </div>
          </div>
          <Badge variant="outline" className="text-[10px]">{rows.filter(r => r.status === 'pending').length} pending</Badge>
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
          <TabsList>
            <TabsTrigger value="inbox">Inbox</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>

          <TabsContent value="inbox" className="mt-4">
            <div className="flex flex-wrap gap-2 mb-4">
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="w-[140px] h-9"><SelectValue /></SelectTrigger>
                <SelectContent>{STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={filterType} onValueChange={setFilterType}>
                <SelectTrigger className="w-[160px] h-9"><SelectValue placeholder="All types" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  {QUEUE_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={filterClient} onValueChange={setFilterClient}>
                <SelectTrigger className="w-[200px] h-9"><SelectValue placeholder="All clients" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All clients</SelectItem>
                  {clientOptions.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {canBulkApprove && (
                <Button size="sm" onClick={bulkApprove}>Bulk approve ({selectedRows.length})</Button>
              )}
            </div>

            {loading ? (
              <div className="text-sm text-muted-foreground">Loading…</div>
            ) : grouped.length === 0 ? (
              <Card className="p-8 text-center text-sm text-muted-foreground">No approvals match the filters.</Card>
            ) : (
              <div className="space-y-6">
                {grouped.map(([clientName, items]) => (
                  <div key={clientName}>
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">{clientName} · {items.length}</div>
                    <div className="space-y-2">
                      {items.map((r) => (
                        <ApprovalCard
                          key={r.id}
                          row={r}
                          expanded={!!expanded[r.id]}
                          onToggle={() => setExpanded((s) => ({ ...s, [r.id]: !s[r.id] }))}
                          selected={!!selected[r.id]}
                          onSelect={(v) => setSelected((s) => ({ ...s, [r.id]: v }))}
                          onApprove={() => approve(r)}
                          onReject={() => { setRejectFor(r); setRejectReason(''); }}
                          onEdit={() => { setEditFor(r); setEditJson(JSON.stringify(r.preview_payload ?? {}, null, 2)); }}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="history" className="mt-4">
            <div className="flex flex-wrap gap-2 mb-4">
              <Input placeholder="Search title or client…" value={historySearch} onChange={(e) => setHistorySearch(e.target.value)} className="max-w-xs h-9" />
              <Select value={filterType} onValueChange={setFilterType}>
                <SelectTrigger className="w-[160px] h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  {QUEUE_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              {inboxRows.map((r) => (
                <Card key={r.id} className="p-3">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{r.title ?? '(untitled)'}</span>
                        <Badge variant="outline" className="text-[10px]">{r.queue_type}</Badge>
                        <Badge variant={r.status === 'rejected' ? 'destructive' : 'default'} className="text-[10px]">{r.status}</Badge>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {r.clients?.name ?? '—'} · resolved {r.resolved_at ? new Date(r.resolved_at).toLocaleString() : '—'}
                      </div>
                      {r.rejection_reason && <div className="text-xs text-red-600 mt-1">Reason: {r.rejection_reason}</div>}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={!!rejectFor} onOpenChange={(o) => !o && setRejectFor(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reject approval</DialogTitle></DialogHeader>
          <div className="text-sm text-muted-foreground mb-2">{rejectFor?.title}</div>
          <Input placeholder="One-line reason (required)" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRejectFor(null)}>Cancel</Button>
            <Button variant="destructive" onClick={async () => {
              if (rejectFor) { await reject(rejectFor, rejectReason); setRejectFor(null); }
            }}>Reject</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editFor} onOpenChange={(o) => !o && setEditFor(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Edit &amp; approve</DialogTitle></DialogHeader>
          <div className="text-sm text-muted-foreground mb-2">{editFor?.title}</div>
          <Textarea value={editJson} onChange={(e) => setEditJson(e.target.value)} rows={16} className="font-mono text-xs" />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditFor(null)}>Cancel</Button>
            <Button onClick={async () => {
              if (!editFor) return;
              try {
                const parsed = JSON.parse(editJson);
                await approve(editFor, true, parsed);
                setEditFor(null);
              } catch (e) {
                toast.error('Invalid JSON');
              }
            }}>Save &amp; approve</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ApprovalCard({ row, expanded, onToggle, selected, onSelect, onApprove, onReject, onEdit }: {
  row: ApprovalRow;
  expanded: boolean;
  onToggle: () => void;
  selected: boolean;
  onSelect: (v: boolean) => void;
  onApprove: () => void;
  onReject: () => void;
  onEdit: () => void;
}) {
  const compFail = complianceStatus(row.compliance_check_result) === 'fail';
  const isPending = row.status === 'pending';

  return (
    <Card className="p-3">
      <div className="flex items-start gap-3">
        {isPending && (
          <Checkbox checked={selected} onCheckedChange={(v) => onSelect(!!v)} className="mt-1" />
        )}
        <div className="flex-1 min-w-0">
          <button type="button" onClick={onToggle} className="w-full text-left">
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm truncate">{row.title ?? '(untitled)'}</span>
                  <Badge variant="outline" className="text-[10px]">{row.queue_type}</Badge>
                  <Badge variant="outline" className="text-[10px]">P{row.priority}</Badge>
                  <ComplianceBadge cc={row.compliance_check_result} />
                </div>
                <div className="text-xs text-muted-foreground mt-0.5 truncate">
                  {row.autonomous_audit_log?.agent_name ?? 'agent'} · {new Date(row.created_at).toLocaleString()}
                </div>
              </div>
              {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
            </div>
          </button>

          {expanded && (
            <div className="mt-3 space-y-3">
              {row.agent_reasoning && (
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{row.agent_reasoning}</p>
              )}
              <PreviewBody type={row.queue_type} payload={row.preview_payload} />
            </div>
          )}

          {isPending && (
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              {compFail ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      <Button size="sm" disabled className="gap-1"><Check className="h-4 w-4" />Approve</Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>Compliance check failed — cannot approve</TooltipContent>
                </Tooltip>
              ) : (
                <Button size="sm" onClick={onApprove} className="gap-1 min-h-[40px]"><Check className="h-4 w-4" />Approve</Button>
              )}
              <Button size="sm" variant="outline" onClick={onEdit} className="gap-1 min-h-[40px]"><Pencil className="h-4 w-4" />Edit &amp; Approve</Button>
              <Button size="sm" variant="ghost" onClick={onReject} className="gap-1 min-h-[40px] text-red-600 hover:text-red-700"><X className="h-4 w-4" />Reject</Button>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}