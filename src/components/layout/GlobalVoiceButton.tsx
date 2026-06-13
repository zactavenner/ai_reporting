import { useState, useRef } from 'react';
import { Mic, Square, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';

// Voice-to-Action: uses browser SpeechRecognition to transcribe, then
// navigates to the AI Studio tab with the transcript prefilled as a command.
export function GlobalVoiceButton() {
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const recRef = useRef<any>(null);
  const navigate = useNavigate();

  const start = () => {
    const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      toast.error('Voice not supported in this browser');
      return;
    }
    const r = new SR();
    r.lang = 'en-US';
    r.interimResults = false;
    r.maxAlternatives = 1;
    r.onresult = (e: any) => {
      const text = e.results?.[0]?.[0]?.transcript || '';
      setProcessing(false);
      setRecording(false);
      if (!text) {
        toast.error('Could not transcribe');
        return;
      }
      toast.success(`Heard: "${text}"`);
      // Pass transcript via URL to the assistant tab
      navigate(`/?tab=assistant&q=${encodeURIComponent(text)}`);
    };
    r.onerror = (e: any) => {
      setProcessing(false);
      setRecording(false);
      toast.error(`Voice error: ${e.error || 'unknown'}`);
    };
    r.onend = () => {
      setRecording(false);
    };
    r.start();
    recRef.current = r;
    setRecording(true);
  };

  const stop = () => {
    if (recRef.current) {
      setProcessing(true);
      try { recRef.current.stop(); } catch {}
    }
  };

  return (
    <Button
      variant={recording ? 'destructive' : 'ghost'}
      size="icon"
      onClick={recording ? stop : start}
      title={recording ? 'Stop voice command' : 'Voice command'}
      className="h-8 w-8"
    >
      {processing ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : recording ? (
        <Square className="h-4 w-4" />
      ) : (
        <Mic className="h-4 w-4" />
      )}
    </Button>
  );
}
