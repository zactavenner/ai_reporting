import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { CheckCircle2, Loader2, AlertTriangle, FileSearch, Pencil } from 'lucide-react';
import { toast } from 'sonner';

/** The offer fields the whole onboarding build is generated from. */
const FIELDS: { key: string; label: string; long?: boolean }[] = [
  { key: 'fund_name', label: 'Fund / offer name' },
  { key: 'fund_type', label: 'Fund type' },
  { key: 'industry_focus', label: 'Industry focus' },
  { key: 'raise_amount', label: 'Raise amount' },
  { key: 'min_investment', label: 'Minimum investment' },
  { key: 'targeted_returns', label: 'Targeted returns' },
  { key: 'hold_period', label: 'Hold period' },
  { key: 'distribution_schedule', label: 'Distributions' },
  { key: 'tax_advantages', label: 'Tax advantages' },
  { key: 'target_investor', label: 'Target investor' },
  { key: 'speaker_name', label: 'Spokesperson' },
  { key: 'website_url', label: 'Website' },
  { key: 'description', label: 'Offer description', long: true },
  { key: 'credibility', label: 'Credibility / track record', long: true },
  { key: 'brand_notes', label: 'Brand notes', long: true },
];

/** Fields the build genuinely cannot produce good creative without. */
const REQUIRED = ['fund_name', 'description', 'target_investor'];

export interface OfferReviewState {
  offerId: string | null;
  reviewed: boolean;
}

interface Props {
  clientId: string;
  onChange?: (state: OfferReviewState) => void;
}

export function OfferReviewGate({ clientId, onChange }: Props) {
  const [offer, setOffer] = useState<any>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState('');
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    const { data } = await supabase
      .from('client_offers')
      .select('*')
      .eq('client_id', clientId)
      .order('updated_at', { ascending: false })
      .limit(1);
    const found: any = data?.[0] || null;
    setOffer(found);
    setNotes(found?.offer_review_notes || '');
    setDraft(
      FIELDS.reduce((acc, f) => {
        acc[f.key] = found?.[f.key] == null ? '' : String(found[f.key]);
        return acc;
      }, {} as Record<string, string>),
    );
    setLoading(false);
    onChange?.({ offerId: found?.id || null, reviewed: !!found?.offer_reviewed_at });
  }, [clientId, onChange]);

  useEffect(() => { refresh(); }, [refresh]);

  const missing = useMemo(
    () => REQUIRED.filter(k => !String(draft[k] || '').trim()),
    [draft],
  );
  const reviewed = !!offer?.offer_reviewed_at;

  async function saveFields() {
    if (!offer) return;
    setSaving(true);
    try {
      const patch = FIELDS.reduce((acc, f) => {
        acc[f.key] = draft[f.key]?.trim() ? draft[f.key].trim() : null;
        return acc;
      }, {} as Record<string, string | null>);
      const { error } = await supabase.from('client_offers').update(patch).eq('id', offer.id);
      if (error) throw error;
      toast.success('Offer updated');
      setEditing(false);
      await refresh();
    } catch (e: any) {
      toast.error(e?.message || 'Could not save the offer');
    } finally {
      setSaving(false);
    }
  }

  async function setReviewed(next: boolean) {
    if (!offer) return;
    if (next && missing.length) {
      toast.error(`Fill in ${missing.join(', ')} before approving the offer`);
      return;
    }
    setSaving(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const { error } = await supabase.from('client_offers').update({
        offer_reviewed_at: next ? new Date().toISOString() : null,
        offer_reviewed_by: next ? auth?.user?.id || null : null,
        offer_review_notes: notes.trim() || null,
      }).eq('id', offer.id);
      if (error) throw error;
      toast.success(next ? 'Offer approved — the build can start' : 'Approval withdrawn');
      await refresh();
    } catch (e: any) {
      toast.error(e?.message || 'Could not update the review');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="flex justify-center py-6"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>;
  }

  if (!offer) {
    return (
      <Card className="p-3 flex items-start gap-2 border-amber-500/40 bg-amber-500/5">
        <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
        <div className="text-xs">
          <div className="font-medium">No offer on file</div>
          <p className="text-muted-foreground mt-0.5">
            Add the client's offer first. The onboarding build generates every asset from it, so it cannot start without one.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-3 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <FileSearch className="h-4 w-4 text-primary shrink-0" />
          <span className="text-sm font-medium">Step 1 · Review the offer</span>
          <Badge variant={reviewed ? 'default' : 'secondary'} className="text-[10px]">
            {reviewed ? 'Approved' : 'Needs review'}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEditing(v => !v)}>
            <Pencil className="h-3 w-3 mr-1" />{editing ? 'Cancel' : 'Edit'}
          </Button>
          {editing && (
            <Button size="sm" className="h-7 text-xs" onClick={saveFields} disabled={saving}>
              {saving && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}Save
            </Button>
          )}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Everything the automation writes and generates comes from these fields. Confirm they're right — nothing is produced until you approve.
      </p>

      <div className="grid gap-2 sm:grid-cols-2">
        {FIELDS.map(f => {
          const value = draft[f.key] || '';
          const isMissing = REQUIRED.includes(f.key) && !value.trim();
          return (
            <div key={f.key} className={f.long ? 'sm:col-span-2' : undefined}>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                {f.label}{REQUIRED.includes(f.key) && ' *'}
              </div>
              {editing ? (
                f.long ? (
                  <Textarea
                    className="text-xs min-h-[64px]"
                    value={value}
                    onChange={e => setDraft(d => ({ ...d, [f.key]: e.target.value }))}
                  />
                ) : (
                  <Input
                    className="h-8 text-xs"
                    value={value}
                    onChange={e => setDraft(d => ({ ...d, [f.key]: e.target.value }))}
                  />
                )
              ) : (
                <div className={`text-xs rounded-md border px-2 py-1.5 break-words ${isMissing ? 'border-amber-500/50 bg-amber-500/5 text-amber-600' : 'text-foreground'}`}>
                  {value.trim() || (isMissing ? 'Required — not on file' : '—')}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Review notes (passed to the team, not the model)</div>
        <Textarea
          className="text-xs min-h-[52px]"
          placeholder="Anything the team should know about this offer before assets get built…"
          value={notes}
          onChange={e => setNotes(e.target.value)}
        />
      </div>

      {missing.length > 0 && (
        <div className="flex items-start gap-2 text-xs text-amber-600">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>Missing required detail: {missing.join(', ')}. Fill these in before approving.</span>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t">
        <div className="text-[11px] text-muted-foreground">
          {reviewed
            ? `Approved ${new Date(offer.offer_reviewed_at).toLocaleString()}`
            : 'The build stays locked until this offer is approved.'}
        </div>
        {reviewed ? (
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setReviewed(false)} disabled={saving}>
            Withdraw approval
          </Button>
        ) : (
          <Button size="sm" className="h-7 text-xs" onClick={() => setReviewed(true)} disabled={saving || missing.length > 0}>
            {saving ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <CheckCircle2 className="h-3 w-3 mr-1" />}
            Offer is correct — unlock build
          </Button>
        )}
      </div>
    </Card>
  );
}