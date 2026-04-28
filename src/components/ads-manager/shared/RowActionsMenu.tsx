import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { MoreHorizontal, Copy, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "sonner";

interface Props {
  clientId: string;
  level: "campaign" | "adset" | "ad";
  row: any; // expects id, name, meta_*_id, ad_account_id (best-effort)
  metaAdAccountId?: string | null;
}

function metaUrl(level: string, row: any, accountId?: string | null) {
  if (!accountId) return null;
  const acc = String(accountId).replace(/^act_/, "");
  const idMap: Record<string, string> = {
    campaign: row.meta_campaign_id,
    adset: row.meta_adset_id,
    ad: row.meta_ad_id,
  };
  const metaId = idMap[level];
  if (!metaId) return null;
  // Meta Ads Manager deep link
  const colMap: Record<string, string> = { campaign: "selected_campaign_ids", adset: "selected_adset_ids", ad: "selected_ad_ids" };
  return `https://business.facebook.com/adsmanager/manage/${level === "ad" ? "ads" : level === "adset" ? "adsets" : "campaigns"}?act=${acc}&${colMap[level]}=${metaId}`;
}

export function RowActionsMenu({ clientId, level, row, metaAdAccountId }: Props) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const duplicate = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("duplicate-meta-object", {
        body: { clientId, level, rowId: row.id, statusOption: "PAUSED" },
      });
      if (error || !data?.success) throw new Error(data?.error || error?.message || "Duplicate failed");
      return data;
    },
    onSuccess: () => {
      toast.success("Duplicated on Meta · sync to pull the copy");
      qc.invalidateQueries({ queryKey: ["admin-meta-campaigns"] });
      qc.invalidateQueries({ queryKey: ["admin-meta-adsets"] });
      qc.invalidateQueries({ queryKey: ["admin-meta-ads"] });
      qc.invalidateQueries({ queryKey: ["meta-campaigns"] });
      qc.invalidateQueries({ queryKey: ["meta-ad-sets"] });
      qc.invalidateQueries({ queryKey: ["meta-ads"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const url = metaUrl(level, row, metaAdAccountId);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={(e) => e.stopPropagation()}
        >
          {duplicate.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MoreHorizontal className="h-3.5 w-3.5" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onClick={() => duplicate.mutate()} disabled={duplicate.isPending}>
          <Copy className="h-3.5 w-3.5 mr-2" />
          Duplicate (paused)
        </DropdownMenuItem>
        {url && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <a href={url} target="_blank" rel="noreferrer">
                <ExternalLink className="h-3.5 w-3.5 mr-2" />
                Open in Meta Ads Manager
              </a>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}