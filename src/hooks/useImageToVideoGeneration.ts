import { useState, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useApiRateLimiter } from './useApiRateLimiter';

interface GenerationResult {
  status: 'processing' | 'completed' | 'failed';
  operationId?: string;
  videoUrl?: string;
  error?: string;
  progress?: number;
}

interface ImageToVideoParams {
  sceneId: string;
  imageUrl: string;
  prompt: string;
  aspectRatio: '16:9' | '9:16';
  duration?: number;
  model?: 'veo3' | 'seedance-pro';
  onStatusUpdate: (sceneId: string, result: GenerationResult) => void;
}

export function useImageToVideoGeneration() {
  const [generatingSceneId, setGeneratingSceneId] = useState<string | null>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  const { getAvailableKey, logUsage, hasAnyKey, refreshUsage } = useApiRateLimiter('veo3');

  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  const generateVideoFromImage = useCallback(async ({
    sceneId,
    imageUrl,
    prompt,
    aspectRatio,
    duration = 8,
    model = 'veo3',
    onStatusUpdate,
  }: ImageToVideoParams) => {
    // Validate image URL
    if (!imageUrl) {
      toast.error('No image provided', { description: 'Generate a scene image first' });
      onStatusUpdate(sceneId, { status: 'failed', error: 'No image provided' });
      return null;
    }

    // Try localStorage key; if none, edge function uses server env vars
    const available = getAvailableKey();
    
    let apiKey: string | undefined;
    let keyIndex = 0;
    
    if ('rateLimited' in available) {
      toast.error('Rate limited', { description: available.message });
      onStatusUpdate(sceneId, { status: 'failed', error: available.message });
      return null;
    }
    
    apiKey = available.key || undefined;
    keyIndex = available.keyIndex;

    setGeneratingSceneId(sceneId);
    onStatusUpdate(sceneId, { status: 'processing' });

    try {
      console.log(`🎬 Starting image-to-video for scene ${sceneId}`);
      console.log(`📷 Image URL: ${imageUrl.substring(0, 80)}...`);
      console.log(`📝 Prompt: ${prompt.substring(0, 100)}...`);

      const { data, error } = await supabase.functions.invoke('generate-video-from-image', {
        body: {
          prompt,
          imageUrl,
          aspectRatio,
          duration,
          apiKey,
          model,
        },
      });

      if (error || data.error) {
        const errorMsg = error?.message || data.error || data.message;
        console.error('Image-to-video error:', errorMsg);
        
        await logUsage({
          service: 'veo3',
          keyIndex,
          requestType: 'image_to_video',
          success: false,
          metadata: { sceneId, prompt: prompt.substring(0, 200), error: errorMsg },
        });
        
        onStatusUpdate(sceneId, { status: 'failed', error: errorMsg });
        setGeneratingSceneId(null);
        return null;
      }

      await logUsage({
        service: 'veo3',
        keyIndex,
        requestType: 'image_to_video',
        success: true,
        metadata: { sceneId, prompt: prompt.substring(0, 200), operationId: data.operationId },
      });

      refreshUsage();

      if (data.status === 'completed' && data.videoUrl) {
        console.log(`✓ Video completed immediately for scene ${sceneId}`);
        onStatusUpdate(sceneId, { status: 'completed', videoUrl: data.videoUrl });
        setGeneratingSceneId(null);
        toast.success('Video generated!');
        return data.videoUrl;
      }

      if (data.operationId) {
        console.log(`⏳ Polling started for operation: ${data.operationId}`);
        onStatusUpdate(sceneId, { 
          status: 'processing', 
          operationId: data.operationId 
        });
        
        // Start polling for completion
        startPolling(sceneId, data.operationId, apiKey, onStatusUpdate);
        return data.operationId;
      }

      console.warn('Unexpected response:', data);
      onStatusUpdate(sceneId, { status: 'failed', error: 'Unexpected response format' });
      setGeneratingSceneId(null);
      return null;
    } catch (err) {
      console.error('Image-to-video generation error:', err);
      const errorMsg = err instanceof Error ? err.message : 'Failed to start generation';
      toast.error('Generation failed', { description: errorMsg });
      onStatusUpdate(sceneId, { status: 'failed', error: errorMsg });
      setGeneratingSceneId(null);
      return null;
    }
  }, [getAvailableKey, logUsage, refreshUsage]);

  const startPolling = useCallback((
    sceneId: string,
    operationId: string,
    apiKey: string,
    onStatusUpdate: (sceneId: string, result: GenerationResult) => void
  ) => {
    stopPolling();

    let attempts = 0;
    const maxAttempts = 60; // 5 minutes at 5-second intervals

    const poll = async () => {
      attempts++;

      if (attempts > maxAttempts) {
        stopPolling();
        setGeneratingSceneId(null);
        onStatusUpdate(sceneId, { status: 'failed', error: 'Generation timed out after 5 minutes' });
        toast.error('Video generation timed out');
        return;
      }

      try {
        const { data, error } = await supabase.functions.invoke('poll-video-status', {
          body: { operationId, apiKey },
        });

        if (error) {
          console.error('Poll error:', error);
          return;
        }

        console.log(`📊 Poll response for ${sceneId} (attempt ${attempts}):`, data?.status);

        if (data.status === 'completed') {
          console.log(`✓ Scene ${sceneId} completed with video URL:`, data.videoUrl?.substring(0, 80));
          stopPolling();
          setGeneratingSceneId(null);
          onStatusUpdate(sceneId, { status: 'completed', videoUrl: data.videoUrl });
          toast.success('Video generated!');
          return;
        }

        if (data.status === 'failed') {
          console.error(`✗ Scene ${sceneId} failed:`, data.error);
          stopPolling();
          setGeneratingSceneId(null);
          onStatusUpdate(sceneId, { status: 'failed', error: data.error });
          toast.error('Video generation failed', { description: data.error });
          return;
        }

        // Still processing - update progress
        onStatusUpdate(sceneId, {
          status: 'processing',
          operationId,
          progress: data.progress || (attempts / maxAttempts),
        });
      } catch (err) {
        console.error('Poll error:', err);
      }
    };

    pollIntervalRef.current = setInterval(poll, 5000);
    poll(); // Initial poll
  }, [stopPolling]);

  return {
    generateVideoFromImage,
    generatingSceneId,
    stopPolling,
    hasApiKey: hasAnyKey,
  };
}
