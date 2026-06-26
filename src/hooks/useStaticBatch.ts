import { useState, useCallback } from 'react';
import type { StaticBatchConfig, GeneratedAd, AspectRatio } from '@/types';

const defaultConfig: StaticBatchConfig = {
  selectedStyles: [],
  productUrl: '',
  productDescription: '',
  characterImageUrl: '',
  productImages: [],
  usp: '',
  brandColors: [],
  brandFonts: [],
  aspectRatios: ['1:1'],
  variationsPerStyle: 1,
  includeDisclaimer: true,
  disclaimerText: 'Investing involves risk, including loss of principal. This is not investment advice. Past performance does not guarantee future results. For accredited investors only. Consult a financial advisor before investing.',
  imageModel: 'openai/gpt-image-2',
};

export function useStaticBatch() {
  const [currentStep, setCurrentStep] = useState(0);
  const [config, setConfig] = useState<StaticBatchConfig>(defaultConfig);
  const [generatedAds, setGeneratedAds] = useState<GeneratedAd[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);

  const updateConfig = useCallback((updates: Partial<StaticBatchConfig>) => {
    setConfig((prev) => ({ ...prev, ...updates }));
  }, []);

  const toggleStyle = useCallback((styleId: string) => {
    setConfig((prev) => ({
      ...prev,
      selectedStyles: prev.selectedStyles.includes(styleId)
        ? prev.selectedStyles.filter((id) => id !== styleId)
        : [...prev.selectedStyles, styleId],
    }));
  }, []);

  const toggleAspectRatio = useCallback((ratio: AspectRatio) => {
    setConfig((prev) => ({
      ...prev,
      aspectRatios: prev.aspectRatios.includes(ratio)
        ? prev.aspectRatios.filter((r) => r !== ratio)
        : [...prev.aspectRatios, ratio],
    }));
  }, []);

  const getTotalAdsCount = useCallback((allStyles?: { id: string; reference_images?: string[]; example_image_url?: string }[]) => {
    const styleVariations = config.styleVariations || {};
    return config.selectedStyles.reduce((total, styleId) => {
      const manualVariations = styleVariations[styleId] ?? config.variationsPerStyle;
      const matchedStyle = allStyles?.find(s => s.id === styleId);
      const refCount = [
        ...(matchedStyle?.reference_images || []),
        ...(matchedStyle?.example_image_url ? [matchedStyle.example_image_url] : []),
      ].filter(Boolean).length;
      const variations = refCount > 0 ? Math.max(manualVariations, refCount) : manualVariations;
      return total + config.aspectRatios.length * variations;
    }, 0);
  }, [config]);

  const nextStep = useCallback(() => {
    setCurrentStep((prev) => Math.min(prev + 1, 3));
  }, []);

  const prevStep = useCallback(() => {
    setCurrentStep((prev) => Math.max(prev - 1, 0));
  }, []);

  const goToStep = useCallback((step: number) => {
    setCurrentStep(Math.max(0, Math.min(step, 3)));
  }, []);

  const reset = useCallback(() => {
    setCurrentStep(0);
    setConfig(defaultConfig);
    setGeneratedAds([]);
    setIsGenerating(false);
  }, []);

  return {
    currentStep,
    config,
    generatedAds,
    isGenerating,
    setIsGenerating,
    setGeneratedAds,
    updateConfig,
    toggleStyle,
    toggleAspectRatio,
    getTotalAdsCount,
    nextStep,
    prevStep,
    goToStep,
    reset,
  };
}
