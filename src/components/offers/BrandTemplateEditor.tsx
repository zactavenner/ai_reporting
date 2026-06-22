import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Palette, Type, Plus, X, Loader2, Save, Pipette } from "lucide-react";
import { toast } from "sonner";

const PRESET_COLORS = [
  "#0B2B26", "#1A3C34", "#C5A55A", "#D4AF37", "#FFFFFF",
  "#000000", "#1E293B", "#334155", "#64748B", "#94A3B8",
  "#0F172A", "#1E1B4B", "#312E81", "#4338CA", "#6366F1",
  "#7C3AED", "#A855F7", "#C026D3", "#DB2777", "#E11D48",
  "#F43F5E", "#FB7185", "#F97316", "#FB923C", "#FBBF24",
  "#FACC15", "#A3E635", "#4ADE80", "#34D399", "#2DD4BF",
  "#38BDF8", "#60A5FA", "#818CF8", "#A78BFA", "#C084FC",
  "#F0ABFC", "#F9A8D4", "#FDA4AF", "#FECACA", "#FDE047",
];

interface BrandTemplateEditorProps {
  clientId: string;
  initialColors?: string[] | null;
  initialFonts?: string[] | null;
}

/**
 * Edits brand_colors / brand_fonts on the clients row. Used inside the AI Studio Offers
 * tab so users can tune the brand template that drives every generated ad.
 */
function ColorPickerPopover({
  color,
  onChange,
  children,
}: {
  color: string;
  onChange: (c: string) => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [local, setLocal] = useState(color);
  useEffect(() => { setLocal(color); }, [color]);

  const apply = () => {
    onChange(local);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-[280px] p-3 space-y-3" align="start">
        <div className="text-xs font-medium text-foreground">Pick a color</div>
        <div className="grid grid-cols-8 gap-1.5">
          {PRESET_COLORS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => { setLocal(preset); }}
              className="w-6 h-6 rounded-full border border-border/50 ring-2 ring-transparent focus:outline-none focus:ring-primary"
              style={{
                backgroundColor: preset,
                boxShadow: local.toLowerCase() === preset.toLowerCase() ? `0 0 0 2px hsl(var(--primary))` : undefined,
              }}
              aria-label={`Select ${preset}`}
            />
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <input
              type="color"
              value={local}
              onChange={(e) => setLocal(e.target.value)}
              className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
            />
            <div
              className="w-8 h-8 rounded-lg border border-border/60 cursor-pointer"
              style={{ backgroundColor: local }}
            />
          </div>
          <Input
            value={local}
            onChange={(e) => setLocal(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); apply(); } }}
            className="h-8 text-xs font-mono flex-1"
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setOpen(false)}>Cancel</Button>
          <Button size="sm" className="h-7 text-xs" onClick={apply}>Apply</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function BrandTemplateEditor({ clientId, initialColors, initialFonts }: BrandTemplateEditorProps) {
  const qc = useQueryClient();
  const [colors, setColors] = useState<string[]>(initialColors || []);
  const [fonts, setFonts] = useState<string[]>(initialFonts || []);
  const [newColor, setNewColor] = useState("#000000");
  const [newFont, setNewFont] = useState("");
  const [saving, setSaving] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => { setColors(initialColors || []); }, [initialColors]);
  useEffect(() => { setFonts(initialFonts || []); }, [initialFonts]);

  const dirty =
    JSON.stringify(colors) !== JSON.stringify(initialColors || []) ||
    JSON.stringify(fonts) !== JSON.stringify(initialFonts || []);

  const addColor = () => {
    const v = newColor.trim();
    if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) {
      toast.error("Use a hex color like #1A2B3C");
      return;
    }
    if (colors.includes(v)) return;
    setColors([...colors, v]);
  };

  const addFont = () => {
    const v = newFont.trim();
    if (!v) return;
    if (fonts.includes(v)) return;
    setFonts([...fonts, v]);
    setNewFont("");
  };

  const save = async () => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from("clients")
        .update({ brand_colors: colors as any, brand_fonts: fonts as any })
        .eq("id", clientId);
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["client", clientId] });
      qc.invalidateQueries({ queryKey: ["clients"] });
      toast.success("Brand template saved");
    } catch (e: any) {
      toast.error(e?.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-4 space-y-4 border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-1.5">
            <Palette className="h-4 w-4 text-primary" /> Brand Template
          </h3>
          <p className="text-xs text-muted-foreground">Drives every ad generation — colors and fonts the AI must lock to.</p>
        </div>
        {dirty && (
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Save className="h-3.5 w-3.5 mr-1" />}
            Save
          </Button>
        )}
      </div>

      <div className="space-y-2">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
          <Palette className="h-3 w-3" /> Brand colors
        </div>
        <div className="flex flex-wrap gap-2">
          {colors.map((c, idx) => (
            <ColorPickerPopover
              key={c + idx}
              color={c}
              onChange={(next) => {
                const nextColors = [...colors];
                nextColors[idx] = next;
                setColors(nextColors);
              }}
            >
              <button
                type="button"
                className="group relative flex items-center gap-1.5 rounded-md border border-border/60 bg-background px-2 py-1 cursor-pointer hover:border-primary/40 transition"
              >
                <div className="h-5 w-5 rounded border border-border/40" style={{ backgroundColor: c }} />
                <span className="text-[11px] font-mono">{c}</span>
                <span
                  className="ml-0.5 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition"
                  onClick={(e) => { e.stopPropagation(); setColors(colors.filter((_, i) => i !== idx)); }}
                  role="button"
                  aria-label={`Remove ${c}`}
                >
                  <X className="h-3 w-3" />
                </span>
              </button>
            </ColorPickerPopover>
          ))}
          {colors.length === 0 && (
            <span className="text-[11px] text-muted-foreground italic">No colors yet — add one →</span>
          )}

          <Popover open={addOpen} onOpenChange={setAddOpen}>
            <PopoverTrigger asChild>
              <Button size="sm" variant="outline" className="h-7 rounded-md">
                <Plus className="h-3.5 w-3.5 mr-1" /> Add color
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[280px] p-3 space-y-3" align="start">
              <div className="text-xs font-medium text-foreground">Add a brand color</div>
              <div className="grid grid-cols-8 gap-1.5">
                {PRESET_COLORS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => {
                      if (!colors.includes(preset)) {
                        setColors([...colors, preset]);
                      }
                      setAddOpen(false);
                    }}
                    className="w-6 h-6 rounded-full border border-border/50 focus:outline-none focus:ring-2 focus:ring-primary"
                    style={{ backgroundColor: preset }}
                    aria-label={`Add ${preset}`}
                  />
                ))}
              </div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <input
                    type="color"
                    value={newColor}
                    onChange={(e) => setNewColor(e.target.value)}
                    className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                  />
                  <div
                    className="w-8 h-8 rounded-lg border border-border/60 cursor-pointer"
                    style={{ backgroundColor: newColor }}
                  />
                </div>
                <Input
                  value={newColor}
                  onChange={(e) => setNewColor(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addColor(); setAddOpen(false); } }}
                  placeholder="#1A2B3C"
                  className="h-8 text-xs font-mono flex-1"
                />
                <Button size="sm" className="h-7 text-xs" onClick={() => { addColor(); setAddOpen(false); }}>
                  Add
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
          <Type className="h-3 w-3" /> Brand fonts
        </div>
        <div className="flex flex-wrap gap-1.5">
          {fonts.map((f) => (
            <Badge key={f} variant="secondary" className="gap-1.5 py-1 pl-2 pr-1 text-xs" style={{ fontFamily: f }}>
              {f}
              <button
                type="button"
                onClick={() => setFonts(fonts.filter((x) => x !== f))}
                className="ml-0.5 text-muted-foreground hover:text-destructive"
                aria-label={`Remove ${f}`}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          {fonts.length === 0 && (
            <span className="text-[11px] text-muted-foreground italic">No fonts yet — add one →</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <Input
            value={newFont}
            onChange={(e) => setNewFont(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addFont(); } }}
            placeholder="e.g. Inter, Playfair Display, Helvetica"
            className="h-8 text-xs flex-1 max-w-[280px]"
          />
          <Button size="sm" variant="outline" className="h-8" onClick={addFont}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Add font
          </Button>
        </div>
      </div>
    </Card>
  );
}