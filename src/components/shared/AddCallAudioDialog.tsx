import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, Volume2, Check, AlertTriangle, Chrome } from 'lucide-react';

interface AddCallAudioDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Should open getDisplayMedia and wire the audio into the recorder. Throws on failure. */
  onRequest: () => Promise<void>;
}

/** Miniature of the Chrome share picker with the tab-audio toggle highlighted. */
function SharePickerIllustration() {
  return (
    <div className="rounded-xl border border-border bg-muted/30 p-3">
      <div className="rounded-lg border border-border bg-card shadow-sm overflow-hidden">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Chrome className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-[11px] font-medium">Choose what to share</span>
        </div>
        <div className="flex gap-2 px-3 pt-2 text-[10px]">
          <span className="rounded-md bg-primary/15 px-2 py-1 font-semibold text-primary ring-1 ring-primary/40">
            Chrome Tab
          </span>
          <span className="rounded-md px-2 py-1 text-muted-foreground">Window</span>
          <span className="rounded-md px-2 py-1 text-muted-foreground">Entire Screen</span>
        </div>
        <div className="space-y-1 px-3 py-2">
          <div className="flex items-center gap-2 rounded-md bg-primary/10 px-2 py-1.5 ring-1 ring-primary/30">
            <span className="h-2 w-2 rounded-full bg-primary" />
            <span className="text-[11px] font-medium">meet.google.com — your call</span>
          </div>
          <div className="flex items-center gap-2 px-2 py-1.5 opacity-50">
            <span className="h-2 w-2 rounded-full bg-muted-foreground/50" />
            <span className="text-[11px]">Other tab</span>
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-border px-3 py-2">
          <span className="relative flex items-center gap-2">
            <span className="absolute -inset-1.5 animate-ping rounded-md bg-primary/20" />
            <span className="relative flex h-3.5 w-3.5 items-center justify-center rounded-[3px] bg-primary text-primary-foreground">
              <Check className="h-2.5 w-2.5" />
            </span>
            <span className="relative text-[11px] font-semibold">Also share tab audio</span>
          </span>
          <span className="rounded-md bg-primary px-2.5 py-1 text-[10px] font-semibold text-primary-foreground">Share</span>
        </div>
      </div>
      <p className="mt-2 text-center text-[11px] text-muted-foreground">
        Tick the toggle bottom-left, then press <span className="font-semibold text-foreground">Share</span>.
      </p>
    </div>
  );
}

export function AddCallAudioDialog({ open, onOpenChange, onRequest }: AddCallAudioDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await onRequest();
      onOpenChange(false);
    } catch (e: any) {
      setError(e?.message || 'Could not add call audio.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Volume2 className="h-4 w-4" /> Add call audio
          </DialogTitle>
          <DialogDescription>
            Capture the other participants alongside your mic. Takes one click and one checkbox.
          </DialogDescription>
        </DialogHeader>

        <ol className="space-y-1.5 text-sm">
          {[
            'Press the button below — Chrome opens on the “Chrome Tab” list.',
            'Pick the tab running your meeting (Meet, Zoom web, Teams).',
            'Tick “Also share tab audio”, then press Share.',
          ].map((step, i) => (
            <li key={i} className="flex gap-2">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                {i + 1}
              </span>
              <span className="text-muted-foreground">{step}</span>
            </li>
          ))}
        </ol>

        <SharePickerIllustration />

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={run} disabled={busy}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Volume2 className="mr-2 h-4 w-4" />}
            {error ? 'Try again' : 'Open share dialog'}
          </Button>
        </div>

        <p className="text-[11px] text-muted-foreground">
          macOS captures tab audio only (not full system audio). Keep the meeting playing — audio is taken at the source, so there is no echo.
        </p>
      </DialogContent>
    </Dialog>
  );
}