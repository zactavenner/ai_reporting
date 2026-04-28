import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface MetaAccountAsset {
  ad_account_id: string;
  account_name: string | null;
  pages: { id: string; name: string; picture: string | null }[];
  pixels: { id: string; name: string; last_fired_time: string | null }[];
  instagram_actors: { id: string; username: string | null }[];
  assets_synced_at: string | null;
}

/**
 * Returns cached pages/pixels/IG actors for ALL ad accounts a client owns,
 * plus a `refresh` mutation that calls `fetch-meta-account-assets` to
 * (re)pull them from Meta.
 */
export function useMetaAccountAssets(clientId: string | undefined) {
  const qc = useQueryClient();

  // 1. Find all ad accounts for this client
  const { data: clientRow } = useQuery({
    queryKey: ["client-ad-accounts", clientId],
    queryFn: async () => {
      if (!clientId) return null;
      const { data } = await supabase
        .from("clients")
        .select("meta_ad_account_id, meta_ad_account_ids")
        .eq("id", clientId)
        .maybeSingle();
      return data;
    },
    enabled: !!clientId,
  });

  const accountIds: string[] = (() => {
    const out = new Set<string>();
    const primary = (clientRow as any)?.meta_ad_account_id;
    if (primary) out.add(String(primary).replace(/^act_/, ""));
    const extras: string[] = (clientRow as any)?.meta_ad_account_ids || [];
    extras.forEach((a) => a && out.add(String(a).replace(/^act_/, "")));
    return Array.from(out);
  })();

  // 2. Pull cached assets
  const { data: assets = [], isLoading } = useQuery({
    queryKey: ["meta-account-assets", accountIds.join(",")],
    queryFn: async () => {
      if (accountIds.length === 0) return [];
      const { data } = await supabase
        .from("meta_ad_accounts")
        .select("ad_account_id, account_name, pages, pixels, instagram_actors, assets_synced_at")
        .in("ad_account_id", accountIds);
      return (data || []) as MetaAccountAsset[];
    },
    enabled: accountIds.length > 0,
  });

  const refresh = useMutation({
    mutationFn: async () => {
      if (!clientId) throw new Error("No client");
      const { data, error } = await supabase.functions.invoke("fetch-meta-account-assets", {
        body: { clientId },
      });
      if (error || !data?.success) throw new Error(data?.error || error?.message || "Refresh failed");
      return data;
    },
    onSuccess: () => {
      toast.success("Pages, pixels & IG accounts refreshed");
      qc.invalidateQueries({ queryKey: ["meta-account-assets"] });
    },
    onError: (e: any) => toast.error(e.message || "Failed to refresh assets"),
  });

  // Flatten across accounts (deduped by id)
  const allPages = dedupe(assets.flatMap((a) => a.pages || []), "id");
  const allPixels = dedupe(assets.flatMap((a) => a.pixels || []), "id");
  const allIg = dedupe(assets.flatMap((a) => a.instagram_actors || []), "id");

  return { assets, allPages, allPixels, allIg, isLoading, refresh, accountIds };
}

function dedupe<T extends Record<string, any>>(arr: T[], key: keyof T): T[] {
  const seen = new Set();
  const out: T[] = [];
  for (const item of arr) {
    const k = item[key];
    if (!seen.has(k)) { seen.add(k); out.push(item); }
  }
  return out;
}