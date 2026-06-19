import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Palette, Type, Plus, X, Loader2, Save } from "lucide-react";
import { toast } from "sonner";

interface BrandTemplateEditorProps {
  clientId: string;
  initialColors?: string[] | null;
  initialFonts?: string[] | null;
}

/**
 * Edits brand_colors / brand_fonts on the clients row. Used inside the AI Studio Offers
 * tab so users can tune the brand template that drives every generated ad.
 */
export function BrandTemplateEditor({ clientId, initialColors, initialFonts }: BrandTemplateEditorProps) {
  const qc = useQueryClient();
  const [colors, setColors] = useState<string[]>(initialColors || []);
  const [fonts, setFonts] = useState<string[]>(initialFonts || []);
  const [newColor, setNewColor] = useState("#000000");
  const [newFont, setNewFont] = useState("");
  const [saving, setSaving] = useState(false);

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
        <div className="flex flex-wrap gap-1.5">
          {colors.map((c) => (
            <div key={c} className="group relative flex items-center gap-1.5 rounded-md border border-border/60 bg-background px-2 py-1">
              <div className="h-4 w-4 rounded border border-border/40" style={{ backgroundColor: c }} />
              <span className="text-[11px] font-mono">{c}</span>
              <button
                type="button"
                onClick={() => setColors(colors.filter((x) => x !== c))}
                className="ml-0.5 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition"
                aria-label={`Remove ${c}`}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
          {colors.length === 0 && (
            <span className="text-[11px] text-muted-foreground italic">No colors yet — add one →</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <input
            type="color"
            value={newColor}
            onChange={(e) => setNewColor(e.target.value)}
            className="h-8 w-10 rounded border border-border/60 bg-background cursor-pointer"
          />
          <Input
            value={newColor}
            onChange={(e) => setNewColor(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addColor(); } }}
            placeholder="#1A2B3C"
            className="h-8 w-32 text-xs font-mono"
          />
          <Button size="sm" variant="outline" className="h-8" onClick={addColor}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Add color
          </Button>
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