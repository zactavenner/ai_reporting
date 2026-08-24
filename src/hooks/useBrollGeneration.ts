import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useApiRateLimiter, type ServiceType } from './useApiRateLimiter';
import { dashboardAuthHeaders } from '@/lib/dashboardAuthHeaders';

type AspectRatio = '16:9' | '9:16' | '1:1' | '4:5';

interface GenerationResult {
  status: 'processing' | 'completed' | 'failed';
  operationId?: string;
  videoUrl?: string;
  error?: string;
  message?: string;
}

export function useBrollGeneration() {
  const [isGenerating, setIsGenerating] = useState(false);
  const [pollInterval, setPollInterval] = useState<NodeJS.Timeout | null>(null);
  
  // Use rate limiter for API key management
  const { getAvailableKey, logUsage, hasAnyKey, refreshUsage } = useApiRateLimiter('veo3');

  // Start video generation with rate limiting
  const generateVideo = useCallback(async (
    prompt: string,
    aspectRatio: AspectRatio,
    duration: number,
    onStatusUpdate: (status: GenerationResult) => void
  ) => {
    // Try localStorage key; if none, edge function uses server env vars
    const available = getAvailableKey();
    
    let apiKey: string | undefined;
    let keyIndex = 0;
    
    if ('rateLimited' in available) {
      toast.error('Rate limited', { description: available.message });
      onStatusUpdate({ status: 'failed', error: available.message });
      return null;
    }
    
    apiKey = available.key || undefined;
    keyIndex = available.keyIndex;

    setIsGenerating(true);

    try {
      const { data, error } = await supabase.functions.invoke('generate-broll', {
        body: {
          prompt,
          aspectRatio,
          duration,
          apiKey,
          keyIndex, // Pass key index for tracking
        },
      });

      if (error) {
        console.error('Edge function error:', error);
        // Log failed attempt
        await logUsage({
          service: 'veo3',
          keyIndex,
          requestType: 'video_generation',
          success: false,
          metadata: { prompt, aspectRatio, duration, error: error.message },
        });
        onStatusUpdate({ status: 'failed', error: error.message });
        return null;
      }

      if (data.error) {
        toast.error(data.error, { description: data.message });
        // Log failed attempt
        await logUsage({
          service: 'veo3',
          keyIndex,
          requestType: 'video_generation',
          success: false,
          metadata: { prompt, aspectRatio, duration, error: data.error },
        });
        onStatusUpdate({ status: 'failed', error: data.error });
        return null;
      }

      // Log successful API call
      await logUsage({
        service: 'veo3',
        keyIndex,
        requestType: 'video_generation',
        success: true,
        metadata: { prompt, aspectRatio, duration, operationId: data.operationId },
      });

      // Refresh usage stats
      refreshUsage();

      // If video is ready immediately
      if (data.status === 'completed' && data.videoUrl) {
        onStatusUpdate({ status: 'completed', videoUrl: data.videoUrl });
        return data.videoUrl;
      }

      // If we got an operation ID, start polling
      if (data.operationId) {
        onStatusUpdate({ 
          status: 'processing', 
          operationId: data.operationId,
          message: data.message 
        });
        
        // Start polling for completion (uses same key for consistency)
        startPolling(data.operationId, apiKey, onStatusUpdate);
        return data.operationId;
      }

      return null;
    } catch (err) {
      console.error('Generation error:', err);
      onStatusUpdate({ status: 'failed', error: 'Failed to start video generation' });
      return null;
    } finally {
      setIsGenerating(false);
    }
  }, [getAvailableKey, logUsage, refreshUsage]);

  // Poll for video completion
  const startPolling = useCallback((
    operationId: string,
    apiKey: string,
    onStatusUpdate: (status: GenerationResult) => void
  ) => {
    // Clear any existing poll
    if (pollInterval) {
      clearInterval(pollInterval);
    }

    let attempts = 0;
    const maxAttempts = 60; // 5 minutes at 5-second intervals

    const poll = async () => {
      attempts++;

      if (attempts > maxAttempts) {
        clearInterval(interval);
        setPollInterval(null);
        onStatusUpdate({ status: 'failed', error: 'Video generation timed out' });
        return;
      }

      try {
        const { data, error } = await supabase.functions.invoke('poll-video-status', {
          body: { operationId, apiKey },
        });

        if (error) {
          console.error('Poll error:', error);
          return; // Keep polling
        }

        if (data.status === 'completed') {
          clearInterval(interval);
          setPollInterval(null);
          onStatusUpdate({ status: 'completed', videoUrl: data.videoUrl });
          toast.success('Video generated!');
          return;
        }

        if (data.status === 'failed') {
          clearInterval(interval);
          setPollInterval(null);
          onStatusUpdate({ status: 'failed', error: data.error });
          toast.error('Video generation failed', { description: data.error });
          return;
        }

        // Still processing
        onStatusUpdate({
          status: 'processing',
          operationId,
          message: data.message || `Generating... (attempt ${attempts})`,
        });
      } catch (err) {
        console.error('Poll error:', err);
        // Keep polling on network errors
      }
    };

    // Poll every 5 seconds
    const interval = setInterval(poll, 5000);
    setPollInterval(interval);

    // Initial poll
    poll();
  }, [pollInterval]);

  // Stop polling
  const stopPolling = useCallback(() => {
    if (pollInterval) {
      clearInterval(pollInterval);
      setPollInterval(null);
    }
  }, [pollInterval]);

  // Generate video from keyframes (start + end frame)
  const generateFromKeyframes = useCallback(async (
    startImageUrl: string,
    endImageUrl: string,
    transitionPrompt: string | undefined,
    aspectRatio: AspectRatio,
    duration: number,
    onStatusUpdate: (status: GenerationResult) => void
  ) => {
    setIsGenerating(true);

    try {
      // Step 1: Analyze keyframes with Gemini to get optimal transition prompt
      console.log('🔍 Analyzing keyframes...');
      const { data: analysisData, error: analysisError } = await supabase.functions.invoke('analyze-keyframes', {
        body: { startImageUrl, endImageUrl, userPrompt: transitionPrompt },
      });

      if (analysisError || analysisData?.error) {
        const errMsg = analysisData?.error || analysisError?.message || 'Keyframe analysis failed';
        toast.error('Keyframe analysis failed', { description: errMsg });
        onStatusUpdate({ status: 'failed', error: errMsg });
        return null;
      }

      const generatedPrompt = analysisData.prompt;
      console.log('✅ Transition prompt:', generatedPrompt?.slice(0, 100));

      // Step 2: Use image-to-video with start frame and generated prompt
      const available = getAvailableKey();
      let apiKey: string | undefined;
      if ('rateLimited' in available) {
        toast.error('Rate limited', { description: available.message });
        onStatusUpdate({ status: 'failed', error: available.message });
        return null;
      }
      apiKey = available.key || undefined;

      const { data, error } = await supabase.functions.invoke('generate-video-from-image', {
        headers: dashboardAuthHeaders(),
        body: {
          prompt: generatedPrompt,
          imageUrl: startImageUrl,
          aspectRatio: aspectRatio === '1:1' || aspectRatio === '4:5' ? '16:9' : aspectRatio,
          duration,
          apiKey,
        },
      });

      if (error || data?.error) {
        const errMsg = data?.error || error?.message || 'Video generation failed';
        onStatusUpdate({ status: 'failed', error: errMsg });
        return null;
      }

      if (data.status === 'completed' && data.videoUrl) {
        onStatusUpdate({ status: 'completed', videoUrl: data.videoUrl });
        return data.videoUrl;
      }

      if (data.operationId) {
        onStatusUpdate({
          status: 'processing',
          operationId: data.operationId,
          message: data.message,
        });
        startPolling(data.operationId, apiKey || '', onStatusUpdate);
        return data.operationId;
      }

      return null;
    } catch (err) {
      console.error('Keyframe generation error:', err);
      onStatusUpdate({ status: 'failed', error: 'Failed to generate from keyframes' });
      return null;
    } finally {
      setIsGenerating(false);
    }
  }, [getAvailableKey, startPolling]);

  return {
    generateVideo,
    generateFromKeyframes,
    isGenerating,
    stopPolling,
    hasApiKey: hasAnyKey,
  };
}
