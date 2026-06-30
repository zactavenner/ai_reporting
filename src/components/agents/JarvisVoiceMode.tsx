import { useEffect, useRef, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Mic, MicOff, X, Loader2, Volume2, VolumeX } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Phase = "idle" | "listening" | "thinking" | "speaking";

interface JarvisVoiceModeProps {
  open: boolean;
  onClose: () => void;
  conversationId: string | null;
  onConversationCreated?: (id: string) => void;
}

/**
 * Fullscreen Iron-Man-style JARVIS voice console.
 * - Web Speech API for STT (continuous push-to-talk-ish loop)
 * - jarvis-chat edge function for reasoning + Hermes consult
 * - SpeechSynthesis for TTS reply
 * - Animated arc-reactor that reacts to phase + mic input level
 */
export function JarvisVoiceMode({ open, onClose, conversationId, onConversationCreated }: JarvisVoiceModeProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [transcript, setTranscript] = useState("");
  const [reply, setReply] = useState("");
  const [muted, setMuted] = useState(false);
  const [level, setLevel] = useState(0);
  const [autoLoop, setAutoLoop] = useState(true);
  const convIdRef = useRef<string | null>(conversationId);
  const recRef = useRef<any>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const phaseRef = useRef<Phase>("idle");

  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { convIdRef.current = conversationId; }, [conversationId]);

  // ESC closes
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") cleanup(true); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const speak = useCallback((text: string) => {
    if (muted || !text || typeof window === "undefined" || !("speechSynthesis" in window)) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.05;
      u.pitch = 1.0;
      u.volume = 1.0;
      // Prefer a British/American male voice if available (Jarvis vibe)
      const voices = window.speechSynthesis.getVoices();
      const pick =
        voices.find((v) => /Daniel|Google UK English Male|Microsoft.*Ryan|Alex/i.test(v.name)) ||
        voices.find((v) => /en[-_](GB|US)/i.test(v.lang)) ||
        voices[0];
      if (pick) u.voice = pick;
      setPhase("speaking");
      u.onend = () => {
        if (phaseRef.current === "speaking") {
          setPhase("idle");
          if (autoLoop) setTimeout(() => startListening(), 250);
        }
      };
      u.onerror = () => setPhase("idle");
      window.speechSynthesis.speak(u);
    } catch (e) { console.error("[jarvis-voice] tts", e); }
  }, [muted, autoLoop]); // eslint-disable-line

  const sendToJarvis = useCallback(async (text: string) => {
    setPhase("thinking");
    setReply("");
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token;
      if (!token) throw new Error("Not signed in");
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/jarvis-chat`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string,
        },
        body: JSON.stringify({ conversation_id: convIdRef.current, message: text }),
      });
      if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
      const data = await res.json();
      if (data.conversation_id && data.conversation_id !== convIdRef.current) {
        convIdRef.current = data.conversation_id;
        onConversationCreated?.(data.conversation_id);
      }
      const txt: string = data.reply || "";
      setReply(txt);
      if (txt) speak(txt); else setPhase("idle");
    } catch (e: any) {
      console.error("[jarvis-voice]", e);
      toast.error(e?.message || "Jarvis failed");
      setPhase("idle");
    }
  }, [speak, onConversationCreated]);

  const startListening = useCallback(async () => {
    const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      toast.error("Voice recognition not supported in this browser. Try Chrome or Edge.");
      return;
    }
    if (phaseRef.current === "listening") return;
    try {
      // Mic level meter
      if (!streamRef.current) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = stream;
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        audioCtxRef.current = ctx;
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        src.connect(analyser);
        analyserRef.current = analyser;
        const data = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          if (!analyserRef.current) return;
          analyserRef.current.getByteFrequencyData(data);
          let sum = 0; for (let i = 0; i < data.length; i++) sum += data[i];
          setLevel(Math.min(1, sum / (data.length * 180)));
          rafRef.current = requestAnimationFrame(tick);
        };
        tick();
      }

      const r = new SR();
      r.lang = "en-US";
      r.interimResults = true;
      r.continuous = false;
      r.maxAlternatives = 1;
      let finalText = "";
      r.onresult = (e: any) => {
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const t = e.results[i][0].transcript;
          if (e.results[i].isFinal) finalText += t;
          else interim += t;
        }
        setTranscript((finalText + " " + interim).trim());
      };
      r.onerror = (e: any) => {
        if (e.error !== "no-speech" && e.error !== "aborted") {
          toast.error(`Mic: ${e.error}`);
        }
        setPhase("idle");
      };
      r.onend = () => {
        const t = finalText.trim();
        if (t) { setTranscript(t); sendToJarvis(t); }
        else if (phaseRef.current === "listening") setPhase("idle");
      };
      recRef.current = r;
      setTranscript("");
      setPhase("listening");
      r.start();
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Mic permission denied");
      setPhase("idle");
    }
  }, [sendToJarvis]);

  const stopListening = useCallback(() => {
    try { recRef.current?.stop(); } catch {}
  }, []);

  const cleanup = useCallback((closeAfter: boolean) => {
    try { recRef.current?.abort?.(); } catch {}
    try { window.speechSynthesis?.cancel(); } catch {}
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    analyserRef.current = null;
    if (audioCtxRef.current) { try { audioCtxRef.current.close(); } catch {} audioCtxRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
    setPhase("idle"); setLevel(0); setTranscript(""); setReply("");
    if (closeAfter) onClose();
  }, [onClose]);

  // Auto-start listening when opening
  useEffect(() => {
    if (open) {
      // Pre-load voices
      try { window.speechSynthesis?.getVoices(); } catch {}
      const t = setTimeout(() => startListening(), 400);
      return () => clearTimeout(t);
    } else {
      cleanup(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const ringScale = 1 + (phase === "listening" ? level * 0.35 : phase === "speaking" ? 0.18 : 0.04);
  const phaseLabel = phase === "listening" ? "LISTENING" : phase === "thinking" ? "PROCESSING" : phase === "speaking" ? "RESPONDING" : "STANDBY";
  const phaseColor = phase === "listening" ? "text-cyan-300" : phase === "thinking" ? "text-amber-300" : phase === "speaking" ? "text-emerald-300" : "text-cyan-400/70";

  return (
    <div className="fixed inset-0 z-[100] bg-[#020617] text-cyan-100 flex flex-col overflow-hidden">
      {/* Background grid + glow */}
      <div
        className="absolute inset-0 opacity-30 pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(rgba(34,211,238,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(34,211,238,0.08) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(34,211,238,0.18),transparent_60%)] pointer-events-none" />

      {/* Top bar */}
      <div className="relative z-10 flex items-center justify-between px-6 py-4 border-b border-cyan-500/20">
        <div className="flex items-center gap-3">
          <div className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_12px_rgba(34,211,238,0.9)]" />
          <div>
            <div className="text-xs tracking-[0.3em] text-cyan-300/80 font-mono">J.A.R.V.I.S.</div>
            <div className="text-[10px] tracking-widest text-cyan-500/70 font-mono">HIGH PERFORMANCE ADS · COMMAND</div>
          </div>
        </div>
        <div className="flex items-center gap-2 font-mono text-[10px] tracking-widest">
          <span className={cn("px-2 py-1 rounded border border-cyan-500/30 bg-cyan-500/5", phaseColor)}>{phaseLabel}</span>
          <Button variant="ghost" size="sm" className="text-cyan-200 hover:text-cyan-50 hover:bg-cyan-500/10" onClick={() => setMuted((m) => !m)}>
            {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </Button>
          <Button variant="ghost" size="sm" className="text-cyan-200 hover:text-cyan-50 hover:bg-cyan-500/10" onClick={() => cleanup(true)}>
            <X className="h-4 w-4 mr-1" /> EXIT
          </Button>
        </div>
      </div>

      {/* Center stage */}
      <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-6">
        {/* Arc reactor */}
        <div className="relative h-[340px] w-[340px] flex items-center justify-center">
          <div className="absolute inset-0 rounded-full border border-cyan-400/20" style={{ animation: "spin 24s linear infinite" }} />
          <div className="absolute inset-6 rounded-full border border-cyan-400/30" style={{ animation: "spin 16s linear infinite reverse" }} />
          <div className="absolute inset-12 rounded-full border-2 border-dashed border-cyan-400/40" style={{ animation: "spin 9s linear infinite" }} />
          <div
            className="absolute inset-20 rounded-full bg-gradient-to-br from-cyan-300 via-cyan-500 to-blue-700 transition-transform duration-100 ease-out"
            style={{
              transform: `scale(${ringScale})`,
              boxShadow:
                "0 0 60px rgba(34,211,238,0.6), 0 0 120px rgba(34,211,238,0.35), inset 0 0 40px rgba(255,255,255,0.4)",
            }}
          />
          <div className="absolute inset-28 rounded-full bg-white/90 backdrop-blur" style={{ boxShadow: "0 0 30px rgba(255,255,255,0.9)" }} />
          {phase === "thinking" && (
            <Loader2 className="absolute h-16 w-16 text-cyan-900 animate-spin" />
          )}
        </div>

        {/* Transcript / reply */}
        <div className="mt-10 max-w-3xl w-full text-center min-h-[120px] space-y-3">
          {transcript && (
            <div className="text-cyan-200/90 text-lg font-light italic">"{transcript}"</div>
          )}
          {reply && (
            <div className="text-cyan-50 text-xl leading-relaxed whitespace-pre-wrap">{reply}</div>
          )}
          {!transcript && !reply && phase === "idle" && (
            <div className="text-cyan-400/60 text-sm font-mono tracking-wider">
              TAP MIC OR SPEAK · ASK ABOUT ANY CLIENT, METRIC, OR JOB
            </div>
          )}
        </div>
      </div>

      {/* Bottom controls */}
      <div className="relative z-10 px-6 pb-8 pt-4 flex items-center justify-center gap-4">
        <Button
          size="lg"
          onClick={phase === "listening" ? stopListening : startListening}
          disabled={phase === "thinking" || phase === "speaking"}
          className={cn(
            "h-16 w-16 rounded-full p-0 border-2 transition-all",
            phase === "listening"
              ? "bg-cyan-400 hover:bg-cyan-300 border-cyan-200 text-slate-900 shadow-[0_0_30px_rgba(34,211,238,0.8)]"
              : "bg-slate-900 hover:bg-slate-800 border-cyan-500/60 text-cyan-300",
          )}
        >
          {phase === "listening" ? <MicOff className="h-7 w-7" /> : <Mic className="h-7 w-7" />}
        </Button>
        <label className="flex items-center gap-2 text-xs font-mono text-cyan-300/70 cursor-pointer select-none">
          <input type="checkbox" checked={autoLoop} onChange={(e) => setAutoLoop(e.target.checked)} className="accent-cyan-400" />
          AUTO-LOOP
        </label>
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}