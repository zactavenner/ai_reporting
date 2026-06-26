import { useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { StaticBatchConfig, GeneratedAd, AdStyle, Client } from '@/types';
import { toast } from 'sonner';

interface UseStaticBatchGenerationOptions {
  projectId: string;
  clientId: string;
  config: StaticBatchConfig;
  styles: AdStyle[];
  client?: Client | null;
  projectOfferDescription?: string | null;
  setGeneratedAds: React.Dispatch<React.SetStateAction<GeneratedAd[]>>;
  setIsGenerating: (value: boolean) => void;
}

export function useStaticBatchGeneration({
  projectId,
  clientId,
  config,
  styles,
  client,
  projectOfferDescription,
  setGeneratedAds,
  setIsGenerating,
}: UseStaticBatchGenerationOptions) {
  const generateAds = useCallback(async () => {
    const styleVariations = config.styleVariations || {};
    const totalAds = config.selectedStyles.reduce((sum, styleId) => {
      const variations = styleVariations[styleId] ?? config.variationsPerStyle;
      return sum + config.aspectRatios.length * variations;
    }, 0);
    if (totalAds === 0) return;

    setIsGenerating(true);

    // Create placeholder ads
    const placeholderAds: GeneratedAd[] = [];

    for (const styleId of config.selectedStyles) {
      const style = styles.find((s) => s.id === styleId);
      if (!style) continue;

      const manualVariations = styleVariations[styleId] ?? config.variationsPerStyle;

      const allRefs = [
        ...(style.reference_images || []),
        ...(style.example_image_url ? [style.example_image_url] : []),
      ].filter(Boolean);

      // Use at least one variation per reference image so ALL references get used
      const variations = allRefs.length > 0
        ? Math.max(manualVariations, allRefs.length)
        : manualVariations;

      for (const aspectRatio of config.aspectRatios) {
        for (let i = 0; i < variations; i++) {
          // Each variation gets a unique primary reference (cycling if variations > refs)
          const referenceImageUrl = allRefs.length > 0
            ? allRefs[i % allRefs.length]
            : undefined;

          placeholderAds.push({
            id: `${styleId}-${aspectRatio}-${i}`,
            styleId,
            styleName: style.name,
            aspectRatio,
            imageUrl: '',
            referenceImageUrl,
            status: 'pending',
            createdAt: new Date().toISOString(),
          });
        }
      }
    }

    setGeneratedAds(placeholderAds);

    // Generate each ad
    let completedCount = 0;
    let failedCount = 0;

    for (let i = 0; i < placeholderAds.length; i++) {
      const ad = placeholderAds[i];
      const style = styles.find((s) => s.id === ad.styleId);

      if (!style) {
        failedCount++;
        continue;
      }

      // Update status to generating
      setGeneratedAds((prev) =>
        prev.map((a, idx) =>
          idx === i ? { ...a, status: 'generating' as const } : a
        )
      );

      try {
        // Call the edge function with Nano Banana Pro
        const { data, error } = await supabase.functions.invoke('generate-static-ad', {
          body: {
            prompt: style.prompt_template,
            stylePrompt: style.prompt_template,
            styleName: style.name,
            aspectRatio: ad.aspectRatio,
            productDescription: config.productDescription || projectOfferDescription || client?.offer_description || client?.description,
            productUrl: config.productUrl || client?.product_url,
            brandColors: config.brandColors.length > 0 ? config.brandColors : client?.brand_colors,
            projectId,
            clientId,
            referenceImages: style.reference_images || [],
            primaryReferenceImage: ad.referenceImageUrl || undefined,
            characterImageUrl: config.characterImageUrl || undefined,
            offerDescription: projectOfferDescription || client?.offer_description,
            includeDisclaimer: config.includeDisclaimer,
            disclaimerText: config.disclaimerText,
            strictBrandAdherence: config.strictBrandAdherence,
            brandFonts: config.brandFonts.length > 0 ? config.brandFonts : client?.brand_fonts,
            adImageUrls: config.adImageUrls,
            imageModel: config.imageModel || 'openai/gpt-image-2',
          },
        });

        if (error) throw error;

        // Update with generated image
        setGeneratedAds((prev) =>
          prev.map((a, idx) =>
            idx === i
              ? {
                  ...a,
                  status: 'completed' as const,
                  imageUrl: data.imageUrl,
                }
              : a
          )
        );
        completedCount++;
      } catch (error) {
        console.error('Failed to generate ad:', error);
        setGeneratedAds((prev) =>
          prev.map((a, idx) =>
            idx === i ? { ...a, status: 'failed' as const } : a
          )
        );
        failedCount++;
      }
    }

    setIsGenerating(false);

    if (completedCount > 0) {
      toast.success(`Generated ${completedCount} ads!`);
    }
    if (failedCount > 0) {
      toast.error(`${failedCount} ads failed to generate`);
    }
  }, [config, styles, client, projectOfferDescription, projectId, clientId, setGeneratedAds, setIsGenerating]);

  return { generateAds };
}
