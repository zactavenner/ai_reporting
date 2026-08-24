import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { ScrapedAd } from '@/hooks/useAdScraping';
import { toast } from 'sonner';
import { dashboardAuthHeaders } from '@/lib/dashboardAuthHeaders';

export interface RegenerationOptions {
  rewriteCopy: boolean;
  forceBrandColors: boolean;
  clientId?: string;
}

export function useDailyAdUsage() {
  return useQuery({
    queryKey: ['daily-ad-usage'],
    queryFn: async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const { count, error } = await supabase
        .from('ad_iterations')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', today.toISOString());
      if (error) throw error;
      return count || 0;
    },
    refetchInterval: 30000,
  });
}

export function useAdRegeneration() {
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState({ current: 0, total: 0 });

  const mutation = useMutation({
    mutationFn: async ({
      ads,
      options,
    }: {
      ads: ScrapedAd[];
      options: RegenerationOptions;
    }) => {
      setProgress({ current: 0, total: ads.length });
      const results: { adId: string; success: boolean; error?: string }[] = [];

      // Get client brand colors if needed
      let brandColors: string[] = [];
      if (options.forceBrandColors && options.clientId) {
        const { data: client } = await supabase
          .from('clients')
          .select('brand_colors')
          .eq('id', options.clientId)
          .maybeSingle();
        const raw = client?.brand_colors;
        brandColors = Array.isArray(raw) ? (raw as string[]) : [];
      }

      for (const ad of ads) {
        try {
          const baseText = options.rewriteCopy
            ? `Recreate this advertisement with fresh, compelling copy. Original context: ${ad.description || ad.headline}. Company: ${ad.company}.`
            : `Recreate this advertisement maintaining the original copy style. Description: ${ad.description || ad.headline}. Company: ${ad.company}.`;

          const prompt = `${baseText}\n\nCreate a professional, high-converting advertisement image that captures the essence and style of the original ad.`;

          const { data, error } = await supabase.functions.invoke('generate-static-ad', {
        headers: dashboardAuthHeaders(),
            body: {
              prompt,
              referenceImages: ad.image_url ? [ad.image_url] : [],
              brandColors: options.forceBrandColors ? brandColors : [],
              aspectRatio: '1:1',
              styleName: `Iteration of ${ad.company}`,
            },
          });

          if (error) throw error;
          if (!data?.success) throw new Error(data?.error || 'Generation failed');

          await supabase.from('ad_iterations').insert({
            source_ad_id: ad.id,
            asset_id: data.assetId || null,
            client_id: options.clientId || null,
            iteration_type: 'ai_generated',
            notes: `Generated from ${ad.company} ad`,
          });

          await supabase
            .from('scraped_ads')
            .update({ iterated: true })
            .eq('id', ad.id);

          results.push({ adId: ad.id, success: true });
        } catch (err: any) {
          console.error(`Failed to regenerate ad ${ad.id}:`, err);
          results.push({ adId: ad.id, success: false, error: err?.message });
        }

        setProgress((p) => ({ ...p, current: p.current + 1 }));
      }

      return results;
    },
    onSuccess: (results) => {
      const successes = results.filter((r) => r.success).length;
      const failures = results.filter((r) => !r.success).length;
      if (successes > 0) toast.success(`Generated ${successes} ad iteration${successes > 1 ? 's' : ''}`);
      if (failures > 0) toast.error(`${failures} generation${failures > 1 ? 's' : ''} failed`);
      queryClient.invalidateQueries({ queryKey: ['ad-iterations'] });
      queryClient.invalidateQueries({ queryKey: ['scraped-ads'] });
      queryClient.invalidateQueries({ queryKey: ['daily-ad-usage'] });
      setProgress({ current: 0, total: 0 });
    },
  });

  return { ...mutation, progress };
}
