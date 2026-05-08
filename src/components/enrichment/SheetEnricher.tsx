import { useState } from 'react';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import { saveAs } from 'file-saver';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Upload, Download, FileSpreadsheet, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface Client { id: string; name: string }
interface Props { clients: Client[] }

type Row = Record<string, any>;

const ENRICHED_COLS = [
  'matched','match_method','identity_count',
  'matched_first_name','matched_last_name','matched_email','matched_phone',
  'address','city','state','zip','age','gender','income','net_worth',
  'credit_range','home_owner','home_value','accredited_investor','investor_type',
  'company','title','industry','linkedin',
];

function detectColumn(headers: string[], candidates: string[]): string | null {
  const lower = headers.map(h => h.toLowerCase().trim());
  for (const c of candidates) {
    const i = lower.indexOf(c);
    if (i !== -1) return headers[i];
  }
  for (const c of candidates) {
    const i = lower.findIndex(h => h.includes(c));
    if (i !== -1) return headers[i];
  }
  return null;
}

export function SheetEnricher({ clients }: Props) {
  const [clientId, setClientId] = useState<string>('');
  const [rows, setRows] = useState<Row[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [emailCol, setEmailCol] = useState<string>('');
  const [phoneCol, setPhoneCol] = useState<string>('');
  const [fileName, setFileName] = useState<string>('');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, matched: 0 });
  const [enrichedRows, setEnrichedRows] = useState<Row[] | null>(null);

  function onFile(file: File) {
    setFileName(file.name);
    setEnrichedRows(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const ext = file.name.toLowerCase().split('.').pop();
        let parsed: Row[] = [];
        if (ext === 'csv') {
          const text = e.target?.result as string;
          const r = Papa.parse<Row>(text, { header: true, skipEmptyLines: true });
          parsed = r.data;
        } else {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const wb = XLSX.read(data, { type: 'array' });
          const sheet = wb.Sheets[wb.SheetNames[0]];
          parsed = XLSX.utils.sheet_to_json<Row>(sheet, { defval: '' });
        }
        if (!parsed.length) { toast.error('No rows found'); return; }
        const hdrs = Object.keys(parsed[0]);
        setRows(parsed);
        setHeaders(hdrs);
        setEmailCol(detectColumn(hdrs, ['email','email address','e-mail']) || '');
        setPhoneCol(detectColumn(hdrs, ['phone','phone number','mobile','cell','telephone']) || '');
        toast.success(`Loaded ${parsed.length} rows`);
      } catch (err: any) {
        toast.error(`Parse failed: ${err.message}`);
      }
    };
    if (file.name.toLowerCase().endsWith('.csv')) reader.readAsText(file);
    else reader.readAsArrayBuffer(file);
  }

  async function runEnrichment() {
    if (!clientId) { toast.error('Select a client'); return; }
    if (!rows.length) { toast.error('Upload a file first'); return; }
    if (!emailCol && !phoneCol) { toast.error('Pick an email or phone column'); return; }

    setRunning(true);
    setProgress({ done: 0, total: rows.length, matched: 0 });
    const out: Row[] = [];
    let matched = 0;
    const CONCURRENCY = 5;

    let idx = 0;
    async function worker() {
      while (idx < rows.length) {
        const i = idx++;
        const row = rows[i];
        const email = emailCol ? String(row[emailCol] || '').trim() : '';
        const phone = phoneCol ? String(row[phoneCol] || '').trim() : '';
        const enriched: Row = { ...row };
        try {
          const { data, error } = await supabase.functions.invoke('enrich-contact-lookup', {
            body: { client_id: clientId, email, phone },
          });
          if (error) throw error;
          if (data?.matched) {
            matched++;
            enriched.matched = 'yes';
            enriched.match_method = data.method;
            enriched.identity_count = data.identity_count;
            for (const k of ENRICHED_COLS) {
              if (k in data) enriched[k] = data[k] ?? '';
            }
          } else {
            enriched.matched = 'no';
          }
        } catch (e: any) {
          enriched.matched = 'error';
          enriched.match_method = e.message?.slice(0, 80) || 'error';
        }
        out[i] = enriched;
        setProgress(p => ({ done: p.done + 1, total: rows.length, matched }));
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    setEnrichedRows(out);
    setRunning(false);
    toast.success(`Done — matched ${matched}/${rows.length}`);
  }

  function downloadResult(format: 'csv' | 'xlsx') {
    if (!enrichedRows) return;
    const base = fileName.replace(/\.(csv|xlsx?|xls)$/i, '') || 'enriched';
    if (format === 'csv') {
      const csv = Papa.unparse(enrichedRows);
      saveAs(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `${base}-enriched.csv`);
    } else {
      const ws = XLSX.utils.json_to_sheet(enrichedRows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Enriched');
      const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
      saveAs(new Blob([buf], { type: 'application/octet-stream' }), `${base}-enriched.xlsx`);
    }
  }

  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <FileSpreadsheet className="h-4 w-4" /> Enrich a Sheet (CSV / XLSX)
        </CardTitle>
        <CardDescription>
          Upload a contact list, RetargetIQ-enrich every row, then export the result.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Client (uses their RetargetIQ slug)</Label>
            <Select value={clientId} onValueChange={setClientId} disabled={running}>
              <SelectTrigger><SelectValue placeholder="Select client…" /></SelectTrigger>
              <SelectContent>
                {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Upload file</Label>
            <Input
              type="file"
              accept=".csv,.xlsx,.xls"
              disabled={running}
              onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); }}
            />
          </div>
        </div>

        {headers.length > 0 && (
          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Email column</Label>
              <Select value={emailCol} onValueChange={setEmailCol} disabled={running}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">(none)</SelectItem>
                  {headers.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Phone column</Label>
              <Select value={phoneCol} onValueChange={setPhoneCol} disabled={running}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">(none)</SelectItem>
                  {headers.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {rows.length > 0 && (
          <div className="text-xs text-muted-foreground">
            {fileName} — {rows.length.toLocaleString()} rows, {headers.length} columns
          </div>
        )}

        {(running || progress.done > 0) && (
          <div className="space-y-2">
            <Progress value={pct} />
            <div className="text-xs text-muted-foreground tabular-nums flex justify-between">
              <span>{progress.done.toLocaleString()} / {progress.total.toLocaleString()} ({pct}%)</span>
              <span>Matched: {progress.matched.toLocaleString()}</span>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            onClick={runEnrichment}
            disabled={running || !rows.length || !clientId}
          >
            {running ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
            {running ? 'Enriching…' : 'Enrich All Rows'}
          </Button>
          {enrichedRows && (
            <>
              <Button variant="outline" onClick={() => downloadResult('xlsx')}>
                <Download className="h-4 w-4 mr-2" /> Download XLSX
              </Button>
              <Button variant="outline" onClick={() => downloadResult('csv')}>
                <Download className="h-4 w-4 mr-2" /> Download CSV
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}