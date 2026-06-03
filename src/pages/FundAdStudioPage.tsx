import { useEffect, useMemo, useState } from "react";
import { useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Loader2, Sparkles, Video, Copy, RefreshCw, Wand2, Film } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

type Creative = {
  id: string;
  batch_id: string;
  creative_type: string;
  creative_index: number;
  ad_title: string | null;
  hook: string | null;
  script: string | null;
  seedance_prompt: string | null;
  scene_breakdown: any;
  captions: any;
  cta: string | null;
  compliance_disclaimer: string | null;
  character_desc: string | null;
  scene_location: string | null;
  video_url: string | null;
  video_status: string | null;
  is_variation: boolean;
  fund_name: string;
  created_at: string;
};

const TYPE_LABEL: Record<string, string> = {
  pain_based: "Pain Based",
  curiosity: "Curiosity",
  social_proof: "Social Proof",
  future_trend: "Future Trend",
  founder_style: "Founder Style",
};

const EMPTY_FUND = {
  fundName: "",
  offerSummary: "",
  targetReturns: "",
  holdPeriod: "",
  distributionFrequency: "",
  minInvestment: "",
  targetInvestor: "Accredited investors",
  assetClass: "",
  geographicFocus: "",
  sponsorTrackRecord: "",
  differentiators: "",
};

function copy(text: string) {
  navigator.clipboard.writeText(text);
  toast({ title: "Copied" });
}

export default function FundAdStudioPage() {
  const [fund, setFund] = useState(EMPTY_FUND);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [creatives, setCreatives] = useState<Creative[]>([]);
  const [loading, setLoading] = useState(false);
  const [variating, setVariating] = useState(false);
  const [renderingId, setRenderingId] = useState<string | null>(null);
  const [batchRendering, setBatchRendering] = useState(false);

  // Load last batch on mount
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("fundad_creatives")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);
      if (data && data.length) {
        const top = data[0].batch_id;
        const rows = data.filter((r: any) => r.batch_id === top);
        setBatchId(top);
        setCreatives(rows.sort((a: any, b: any) => a.creative_index - b.creative_index) as any);
        try { setFund({ ...EMPTY_FUND, ...(rows[0] as any).fund_input }); } catch {}
      }
    })();
  }, []);

  // Realtime updates for video rendering
  useEffect(() => {
    if (!creatives.length) return;
    const channel = supabase
      .channel("fundad-creatives")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "fundad_creatives" },
        (payload) => {
          setCreatives((prev) =>
            prev.map((c) => (c.id === (payload.new as any).id ? { ...c, ...(payload.new as any) } : c)),
          );
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [creatives.length]);

  async function generate(mode: "initial" | "variations") {
    if (!fund.fundName.trim()) {
      toast({ title: "Fund name required", variant: "destructive" });
      return;
    }
    const setter = mode === "initial" ? setLoading : setVariating;
    setter(true);
    try {
      const existingHooks = creatives.map((c) => c.hook).filter(Boolean) as string[];
      const { data, error } = await supabase.functions.invoke("fundad-generate", {
        body: {
          mode,
          fund,
          batchId: mode === "variations" ? batchId : undefined,
          existingHooks,
        },
      });
      if (error) throw error;
      const next = (data?.creatives || []) as Creative[];
      if (mode === "initial") {
        setBatchId(data.batchId);
        setCreatives(next.sort((a, b) => a.creative_index - b.creative_index));
      } else {
        setCreatives((prev) => [...prev, ...next]);
      }
      toast({ title: mode === "initial" ? "5 creatives generated" : `${next.length} variations added` });
    } catch (e: any) {
      toast({ title: "Generation failed", description: e?.message, variant: "destructive" });
    } finally {
      setter(false);
    }
  }

  async function renderVideo(creativeId: string, fast: boolean) {
    setRenderingId(creativeId);
    setCreatives((prev) =>
      prev.map((c) => (c.id === creativeId ? { ...c, video_status: "generating" } : c)),
    );
    try {
      const { data, error } = await supabase.functions.invoke("fundad-render", {
        body: { creativeId, fast, resolution: "1080p" },
      });
      if (error) throw error;
      toast({ title: "Video ready" });
    } catch (e: any) {
      toast({ title: "Render failed", description: e?.message, variant: "destructive" });
      setCreatives((prev) =>
        prev.map((c) => (c.id === creativeId ? { ...c, video_status: "failed" } : c)),
      );
    } finally {
      setRenderingId(null);
    }
  }

  async function renderAll(fast: boolean) {
    const targets = creatives.filter((c) => !c.is_variation && !c.video_url);
    if (!targets.length) {
      toast({ title: "Nothing to render", description: "All core 5 already have videos." });
      return;
    }
    setBatchRendering(true);
    setCreatives((prev) =>
      prev.map((c) => (targets.find((t) => t.id === c.id) ? { ...c, video_status: "generating" } : c)),
    );
    toast({ title: `Rendering ${targets.length} videos in parallel...` });
    await Promise.allSettled(
      targets.map((t) =>
        supabase.functions.invoke("fundad-render", {
          body: { creativeId: t.id, fast, resolution: "1080p" },
        }),
      ),
    );
    setBatchRendering(false);
    toast({ title: "Batch render complete" });
  }

  const grouped = useMemo(() => {
    const initial = creatives.filter((c) => !c.is_variation);
    const variations = creatives.filter((c) => c.is_variation);
    return { initial, variations };
  }, [creatives]);

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        <header className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-2xl bg-primary/10 grid place-items-center">
            <Sparkles className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">FundAd AI Studio</h1>
            <p className="text-sm text-muted-foreground">
              Generate 5 compliant 15-second UGC investor ad concepts and render them with Seedance 2.0.
            </p>
          </div>
        </header>

        <div className="grid lg:grid-cols-[420px_1fr] gap-6">
          {/* INPUT FORM */}
          <Card className="p-5 space-y-4 h-fit sticky top-6">
            <h2 className="font-semibold text-sm">Fund Offer</h2>
            <div className="grid grid-cols-1 gap-3">
              <Field label="Fund Name *" value={fund.fundName} onChange={(v) => setFund({ ...fund, fundName: v })} placeholder="High Performance Multifamily Fund III" />
              <Field label="Asset Class" value={fund.assetClass} onChange={(v) => setFund({ ...fund, assetClass: v })} placeholder="Multifamily real estate" />
              <FieldArea label="Offer Summary" value={fund.offerSummary} onChange={(v) => setFund({ ...fund, offerSummary: v })} placeholder="Value-add workforce housing across the Sunbelt..." />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Target Returns" value={fund.targetReturns} onChange={(v) => setFund({ ...fund, targetReturns: v })} placeholder="14-18% IRR target" />
                <Field label="Hold Period" value={fund.holdPeriod} onChange={(v) => setFund({ ...fund, holdPeriod: v })} placeholder="5 years" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Distributions" value={fund.distributionFrequency} onChange={(v) => setFund({ ...fund, distributionFrequency: v })} placeholder="Quarterly" />
                <Field label="Minimum" value={fund.minInvestment} onChange={(v) => setFund({ ...fund, minInvestment: v })} placeholder="$50,000" />
              </div>
              <Field label="Target Investor" value={fund.targetInvestor} onChange={(v) => setFund({ ...fund, targetInvestor: v })} />
              <Field label="Geographic Focus" value={fund.geographicFocus} onChange={(v) => setFund({ ...fund, geographicFocus: v })} placeholder="Texas, Florida, Carolinas" />
              <FieldArea label="Sponsor Track Record" value={fund.sponsorTrackRecord} onChange={(v) => setFund({ ...fund, sponsorTrackRecord: v })} placeholder="$1.2B AUM, 3,000+ units, 12 yrs..." />
              <FieldArea label="Key Differentiators" value={fund.differentiators} onChange={(v) => setFund({ ...fund, differentiators: v })} placeholder="Vertically integrated, in-house construction..." />
            </div>

            <div className="flex flex-col gap-2 pt-2">
              <Button onClick={() => generate("initial")} disabled={loading} className="w-full">
                {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Wand2 className="h-4 w-4 mr-2" />}
                Generate 5 Creatives
              </Button>
              <Button
                variant="outline"
                onClick={() => generate("variations")}
                disabled={variating || !batchId}
                className="w-full"
              >
                {variating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                Generate More Variations
              </Button>
              <div className="border-t pt-2 mt-1 space-y-2">
                <Button
                  onClick={() => renderAll(false)}
                  disabled={batchRendering || !creatives.length}
                  className="w-full"
                  variant="default"
                >
                  {batchRendering ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Film className="h-4 w-4 mr-2" />}
                  Render All 5 (1080p)
                </Button>
                <Button
                  onClick={() => renderAll(true)}
                  disabled={batchRendering || !creatives.length}
                  className="w-full"
                  variant="outline"
                >
                  <Video className="h-4 w-4 mr-2" /> Render All — Fast Draft
                </Button>
              </div>
            </div>
          </Card>

          {/* RESULTS */}
          <div className="space-y-4">
            {creatives.length === 0 ? (
              <Card className="p-12 text-center text-sm text-muted-foreground">
                Enter a fund offer and click <b>Generate 5 Creatives</b> to start.
              </Card>
            ) : (
              <Tabs defaultValue="initial">
                <TabsList>
                  <TabsTrigger value="initial">Core 5 ({grouped.initial.length})</TabsTrigger>
                  <TabsTrigger value="variations" disabled={!grouped.variations.length}>
                    Variations ({grouped.variations.length})
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="initial" className="space-y-4 mt-4">
                  {grouped.initial.map((c) => (
                    <CreativeCard key={c.id} c={c} onRender={renderVideo} rendering={renderingId === c.id} />
                  ))}
                </TabsContent>
                <TabsContent value="variations" className="space-y-4 mt-4">
                  {grouped.variations.map((c) => (
                    <CreativeCard key={c.id} c={c} onRender={renderVideo} rendering={renderingId === c.id} />
                  ))}
                </TabsContent>
              </Tabs>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder }: any) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="h-9" />
    </div>
  );
}
function FieldArea({ label, value, onChange, placeholder }: any) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="min-h-[68px] text-sm" />
    </div>
  );
}

function CreativeCard({
  c,
  onRender,
  rendering,
}: {
  c: Creative;
  onRender: (id: string, fast: boolean) => void;
  rendering: boolean;
}) {
  const scenes: any[] = Array.isArray(c.scene_breakdown) ? c.scene_breakdown : [];
  const captions: any[] = Array.isArray(c.captions) ? c.captions : [];
  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Badge variant="secondary" className="rounded-md">{TYPE_LABEL[c.creative_type] || c.creative_type}</Badge>
            {c.is_variation && <Badge variant="outline" className="rounded-md">Variation</Badge>}
          </div>
          <h3 className="font-semibold text-base">{c.ad_title || "Untitled"}</h3>
          <p className="text-sm text-foreground/90 mt-1 leading-snug">{c.hook}</p>
        </div>
        <div className="flex flex-col gap-2 shrink-0">
          {c.video_url ? (
            <CaptionedVideo src={c.video_url} captions={captions} className="w-40 aspect-[9/16] rounded-md bg-black overflow-hidden" />
          ) : (
            <div className="w-32 aspect-[9/16] rounded-md bg-muted grid place-items-center text-xs text-muted-foreground">
              {c.video_status === "generating" ? (
                <span className="flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Rendering...</span>
              ) : c.video_status === "failed" ? "Failed" : "No video"}
            </div>
          )}
          <Button
            size="sm"
            onClick={() => onRender(c.id, false)}
            disabled={rendering || c.video_status === "generating"}
            className="text-xs"
          >
            <Film className="h-3 w-3 mr-1" /> {c.video_url ? "Re-render" : "Render 1080p"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onRender(c.id, true)}
            disabled={rendering || c.video_status === "generating"}
            className="text-xs"
          >
            <Video className="h-3 w-3 mr-1" /> Fast draft
          </Button>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4 text-sm">
        <Section title="Script" onCopy={() => copy(c.script || "")}>
          <p className="whitespace-pre-wrap leading-relaxed">{c.script}</p>
        </Section>
        <Section title="Seedance Prompt" onCopy={() => copy(c.seedance_prompt || "")}>
          <p className="whitespace-pre-wrap leading-relaxed text-xs text-muted-foreground">{c.seedance_prompt}</p>
        </Section>
        <Section title="Scene Breakdown">
          <ol className="space-y-1.5">
            {scenes.map((s, i) => (
              <li key={i} className="text-xs">
                <b>Scene {s.scene || i + 1}{s.duration_seconds ? ` (${s.duration_seconds}s)` : ""}:</b>{" "}
                <span className="text-muted-foreground">{s.visual || s.action}</span>
              </li>
            ))}
          </ol>
        </Section>
        <Section title="IG Captions">
          <ul className="space-y-1.5">
            {captions.map((cap, i) => (
              <li key={i} className="text-xs">
                <span className="text-muted-foreground">{cap.start_second ?? "?"}s →</span>{" "}
                <span className="font-medium">{cap.text}</span>
              </li>
            ))}
          </ul>
        </Section>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t">
        <div className="text-xs">
          <span className="text-muted-foreground">CTA:</span>{" "}
          <span className="font-semibold">{c.cta}</span>
        </div>
        <div className="text-[10px] text-muted-foreground italic flex-1 min-w-[220px] text-right">
          {c.compliance_disclaimer}
        </div>
      </div>
    </Card>
  );
}

function Section({ title, children, onCopy }: any) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h4>
        {onCopy && (
          <Button size="icon" variant="ghost" className="h-5 w-5" onClick={onCopy}>
            <Copy className="h-3 w-3" />
          </Button>
        )}
      </div>
      {children}
    </div>
  );
}

function CaptionedVideo({
  src,
  captions,
  className,
}: {
  src: string;
  captions: any[];
  className?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [t, setT] = useState(0);
  const sorted = useMemo(
    () => [...(captions || [])].sort((a, b) => (a.start_second ?? 0) - (b.start_second ?? 0)),
    [captions],
  );
  const active = useMemo(() => {
    let cur: any = null;
    for (const c of sorted) {
      if (t >= (c.start_second ?? 0)) cur = c;
      else break;
    }
    return cur;
  }, [sorted, t]);
  return (
    <div className={`relative ${className || ""}`}>
      <video
        ref={ref}
        src={src}
        controls
        playsInline
        onTimeUpdate={(e) => setT((e.target as HTMLVideoElement).currentTime)}
        className="w-full h-full object-cover"
      />
      {active?.text && (
        <div className="pointer-events-none absolute inset-x-2 bottom-10 flex justify-center">
          <span
            className="px-2 py-1 text-[13px] font-bold leading-tight text-white text-center"
            style={{
              fontFamily:
                'system-ui, -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif',
              textShadow:
                "0 1px 2px rgba(0,0,0,0.9), 0 0 6px rgba(0,0,0,0.6), 0 2px 4px rgba(0,0,0,0.8)",
              letterSpacing: "0.01em",
              maxWidth: "92%",
            }}
          >
            {active.text}
          </span>
        </div>
      )}
    </div>
  );
}