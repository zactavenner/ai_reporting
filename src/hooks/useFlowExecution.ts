import { useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { isGoogleApiUrl, fetchVideoViaProxy } from '@/lib/video-proxy';
import { concatenateVideos } from '@/lib/video-concat';
import type { 
  FlowNode, 
  FlowEdge,
  ImageGeneratorData,
  VideoGeneratorData,
  PromptGeneratorData,
  ImageToVideoData,
  AvatarSceneData,
  SceneCombinerData,
  ImageCombinerData,
  HooksNodeData,
  HooksTrack,
  HooksTrackScene,
} from '@/types/flowboard';
import { ANGLE_PRESETS } from '@/hooks/useAvatarGeneration';
import { getStoredKeys } from '@/hooks/useApiRateLimiter';
import { toast } from 'sonner';

const DEFAULT_GEMINI_KEY = 'AIzaSyCbOTwdc8c8YGYpl63BKSNPvU2Xd29t_4o';

// Helper to get first available API key for a service.
// Returns the default Gemini key when no localStorage key exists for gemini.
function getApiKeyForService(service: 'gemini' | 'veo3'): string | undefined {
  const keys = getStoredKeys(service);
  const available = keys.find((k) => k.key.trim());
  if (available?.key) return available.key;
  return service === 'gemini' ? DEFAULT_GEMINI_KEY : undefined;
}

// Helper to generate video via the appropriate model (Veo3 or Grok)
async function generateVideoForModel(
  model: 'veo3' | 'grok' | 'haiper-1.1' | undefined,
  body: { prompt: string; imageUrl?: string; aspectRatio: string; duration: number; apiKey?: string }
): Promise<{ operationId?: string; videoUrl?: string; status: string; error?: string }> {
  if (model === 'grok') {
    const { data, error } = await supabase.functions.invoke('generate-video-grok', {
      body: {
        prompt: body.prompt,
        imageUrl: body.imageUrl,
        aspectRatio: body.aspectRatio,
        duration: body.duration,
        apiKey: body.apiKey,
      },
    });
    if (error) throw error;
    if (data.error) throw new Error(data.message || data.error);
    return data;
  }
  if (model === 'haiper-1.1') {
    const { data, error } = await supabase.functions.invoke('generate-video-haiper', {
      body: {
        prompt: body.prompt,
        imageUrl: body.imageUrl,
        aspectRatio: body.aspectRatio,
        duration: body.duration,
      },
    });
    if (error) throw error;
    if (data.error) throw new Error(data.message || data.error);
    return data;
  }
  // Default: Veo3
  const fnName = body.imageUrl ? 'generate-video-from-image' : 'generate-broll';
  const { data, error } = await supabase.functions.invoke(fnName, { body });
  if (error) throw error;
  if (data.error) throw new Error(data.message || data.error);
  return data;
}

// Helper to poll video status for the appropriate model
async function pollVideoForModel(
  model: 'veo3' | 'grok' | 'haiper-1.1' | undefined,
  operationId: string,
  apiKey: string | undefined,
  nodeId: string,
  updateNodeData: (nodeId: string, data: Partial<FlowNode['data']>) => void
): Promise<string> {
  const maxAttempts = 60;
  const interval = 5000;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const fnName = model === 'grok' ? 'poll-grok-video' : 'poll-video-status';
    const bodyKey = model === 'grok' ? 'requestId' : 'operationId';
    const { data, error } = await supabase.functions.invoke(fnName, {
      body: { [bodyKey]: operationId, apiKey },
    });

    if (error) throw error;
    if (data.status === 'completed' && data.videoUrl) return data.videoUrl;
    if (data.status === 'failed') throw new Error(data.error || 'Video generation failed');

    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  throw new Error('Video generation timed out');
}

interface UseFlowExecutionOptions {
  nodes: FlowNode[];
  edges: FlowEdge[];
  updateNodeData: (nodeId: string, data: Partial<FlowNode['data']>) => void;
}

export function useFlowExecution({ nodes, edges, updateNodeData }: UseFlowExecutionOptions) {
  // Get upstream nodes that connect to a given node
  const getUpstreamNodes = useCallback((nodeId: string): FlowNode[] => {
    const incomingEdges = edges.filter((e) => e.target === nodeId);
    return incomingEdges
      .map((e) => nodes.find((n) => n.id === e.source))
      .filter((n): n is FlowNode => n !== undefined);
  }, [nodes, edges]);

  // Get input data from upstream nodes
  const getInputFromUpstream = useCallback((nodeId: string) => {
    const upstreamNodes = getUpstreamNodes(nodeId);
    let inputImageUrl: string | undefined;
    let inputPrompt: string | undefined;

    for (const upstream of upstreamNodes) {
      if (upstream.type === 'image-generator') {
        const data = upstream.data as ImageGeneratorData;
        if (data.generatedImageUrl) {
          inputImageUrl = data.generatedImageUrl;
        }
      } else if (upstream.type === 'avatar-scene') {
        const data = upstream.data as AvatarSceneData;
        const completedScene = data.scenes?.find(s => s.generatedImageUrl);
        if (completedScene?.generatedImageUrl) {
          inputImageUrl = completedScene.generatedImageUrl;
        } else if (data.avatarImageUrl) {
          inputImageUrl = data.avatarImageUrl;
        }
      } else if (upstream.type === 'prompt-generator') {
        const data = upstream.data as PromptGeneratorData;
        if (data.outputPrompt) {
          inputPrompt = data.outputPrompt;
        }
      } else if (upstream.type === 'image-combiner') {
        const data = upstream.data as ImageCombinerData;
        if (data.outputImageUrl) {
          inputImageUrl = data.outputImageUrl;
        }
      }
    }

    return { inputImageUrl, inputPrompt };
  }, [getUpstreamNodes]);

  // Execute image generation
  const executeImageGenerator = useCallback(async (node: FlowNode) => {
    const data = node.data as ImageGeneratorData;
    
    if (!data.prompt.trim()) {
      throw new Error('Prompt is required');
    }

    const apiKey = getApiKeyForService('gemini');

    const count = data.variationCount || 1;
    updateNodeData(node.id, { status: 'generating', error: undefined });

    try {
      const variations: string[] = [];
      
      for (let i = 0; i < count; i++) {
        const body: Record<string, unknown> = {
          prompt: data.prompt,
          aspectRatio: data.aspectRatio,
          apiKey,
        };
        if (data.referenceImageUrl) {
          body.referenceImageUrl = data.referenceImageUrl;
        }
        const { data: result, error } = await supabase.functions.invoke('generate-avatar', {
          body,
        });

        if (error) throw error;
        variations.push(result.imageUrl);
        
        updateNodeData(node.id, { 
          generatedVariations: [...variations],
          generatedImageUrl: variations[0],
        });
      }

      updateNodeData(node.id, {
        status: 'completed',
        generatedImageUrl: variations[0],
        generatedVariations: variations,
      });

      return variations[0];
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Generation failed';
      updateNodeData(node.id, { status: 'failed', error: message });
      throw error;
    }
  }, [updateNodeData]);

  // Execute video generation
  const executeVideoGenerator = useCallback(async (node: FlowNode) => {
    const data = node.data as VideoGeneratorData;
    const { inputImageUrl } = getInputFromUpstream(node.id);
    
    if (!data.prompt.trim()) {
      throw new Error('Prompt is required');
    }

    const apiKey = getApiKeyForService('veo3');

    updateNodeData(node.id, { status: 'generating', error: undefined, inputImageUrl });

    try {
      const { data: result, error } = await supabase.functions.invoke('generate-broll', {
        body: {
          prompt: data.prompt,
          aspectRatio: data.aspectRatio,
          duration: data.duration,
          inputImageUrl,
          apiKey,
        },
      });

      if (error) throw error;

      const opId = result.operationId || result.operationName;
      updateNodeData(node.id, { operationName: opId });

      const videoUrl = await pollVideoForModel('veo3', opId, apiKey, node.id, updateNodeData);
      
      updateNodeData(node.id, {
        status: 'completed',
        generatedVideoUrl: videoUrl,
      });

      return videoUrl;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Generation failed';
      updateNodeData(node.id, { status: 'failed', error: message });
      throw error;
    }
  }, [updateNodeData, getInputFromUpstream]);

  // Execute prompt generation
  const executePromptGenerator = useCallback(async (node: FlowNode) => {
    const data = node.data as PromptGeneratorData;
    const { inputImageUrl } = getInputFromUpstream(node.id);
    
    if (!data.inputPrompt.trim()) {
      throw new Error('Prompt is required');
    }

    updateNodeData(node.id, { status: 'generating', error: undefined, inputImageUrl });

    try {
      const { data: result, error } = await supabase.functions.invoke('generate-prompt', {
        body: {
          model: data.model,
          context: data.context,
          prompt: data.inputPrompt,
          imageUrl: inputImageUrl,
        },
      });

      if (error) throw error;

      updateNodeData(node.id, {
        status: 'completed',
        outputPrompt: result.generatedPrompt,
      });

      return result.generatedPrompt;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Generation failed';
      updateNodeData(node.id, { status: 'failed', error: message });
      throw error;
    }
  }, [updateNodeData, getInputFromUpstream]);

  // Execute image-to-video generation
  const executeImageToVideo = useCallback(async (node: FlowNode) => {
    const data = node.data as ImageToVideoData;
    const { inputImageUrl } = getInputFromUpstream(node.id);
    
    // Also check for avatarImageUrl if user selected an avatar
    const resolvedImageUrl = inputImageUrl || data.inputImageUrl || (data as any).avatarImageUrl;
    
    if (!resolvedImageUrl) {
      throw new Error('Input image is required - connect an image generator node or select an avatar');
    }

    updateNodeData(node.id, { status: 'generating', error: undefined, inputImageUrl: resolvedImageUrl });

    const model = data.videoModel || 'veo3';
    const veoKey = getApiKeyForService('veo3');
    // Key is optional - edge function falls back to env

    try {
      const result = await generateVideoForModel(model, {
        prompt: data.prompt || `Animate this image with ${data.cameraMotion} camera motion`,
        imageUrl: resolvedImageUrl,
        aspectRatio: data.aspectRatio || '16:9',
        duration: data.duration,
        apiKey: veoKey || undefined,
      });

      if (result.status === 'completed' && result.videoUrl) {
        updateNodeData(node.id, { status: 'completed', generatedVideoUrl: result.videoUrl });
        return result.videoUrl;
      }

      const opId = result.operationId;
      updateNodeData(node.id, { operationName: opId });

      const videoUrl = await pollVideoForModel(model, opId!, veoKey || undefined, node.id, updateNodeData);
      
      updateNodeData(node.id, {
        status: 'completed',
        generatedVideoUrl: videoUrl,
      });

      return videoUrl;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Generation failed';
      updateNodeData(node.id, { status: 'failed', error: message });
      throw error;
    }
  }, [updateNodeData, getInputFromUpstream]);

  // Execute avatar scene
  const executeAvatarScene = useCallback(async (node: FlowNode) => {
    const data = node.data as AvatarSceneData;
    
    if (!data.avatarImageUrl) {
      throw new Error('Please select an avatar first');
    }

    updateNodeData(node.id, { status: 'generating', error: undefined });

    const apiKey = getApiKeyForService('gemini');

    let avatarGender = 'female';
    let avatarAge = '26-35';
    let avatarEthnicity = 'mixed';
    if (data.avatarId) {
      const { data: avatarRow } = await supabase
        .from('avatars')
        .select('gender, age_range, ethnicity')
        .eq('id', data.avatarId)
        .single();
      if (avatarRow) {
        avatarGender = avatarRow.gender || 'female';
        avatarAge = avatarRow.age_range || '26-35';
        avatarEthnicity = avatarRow.ethnicity || 'mixed';
      }
    }

    try {
      const scenePromises = data.scenes.map(async (scene, index) => {
        const anglePreset = ANGLE_PRESETS.find(a => a.type === scene.angle);
        if (!anglePreset) return scene;

        const updatedScenes = [...data.scenes];
        updatedScenes[index] = { ...scene, status: 'generating' };
        updateNodeData(node.id, { scenes: updatedScenes });

        try {
          const { data: result, error } = await supabase.functions.invoke('generate-avatar', {
            body: {
              gender: avatarGender,
              ageRange: avatarAge,
              ethnicity: avatarEthnicity,
              style: 'ugc',
              background: 'studio',
              backgroundPrompt: scene.action,
              apiKey,
              referenceImageUrl: data.avatarImageUrl,
              angleType: scene.angle,
              anglePromptModifier: anglePreset.promptModifier,
              angleFocalLength: anglePreset.focalLength,
              angleFraming: anglePreset.framing,
              customPrompt: `Action: ${scene.action}. Maintain exact same identity as reference.`,
            },
          });

          if (error) throw error;

          return {
            ...scene,
            generatedImageUrl: result.imageUrl,
            status: 'completed' as const,
          };
        } catch (err) {
          console.error(`Error generating ${scene.angle}:`, err);
          return {
            ...scene,
            status: 'failed' as const,
          };
        }
      });

      const completedScenes = await Promise.all(scenePromises);
      const hasFailures = completedScenes.some(s => s.status === 'failed');
      
      updateNodeData(node.id, {
        scenes: completedScenes,
        status: hasFailures ? 'failed' : 'completed',
        error: hasFailures ? 'Some angles failed to generate' : undefined,
      });

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Avatar scene generation failed';
      updateNodeData(node.id, { status: 'failed', error: message });
      throw error;
    }
  }, [updateNodeData]);

  // Execute scene combiner — client-side blob concatenation OR voice dubbing
  const executeSceneCombiner = useCallback(async (node: FlowNode) => {
    const combinerData = node.data as SceneCombinerData;

    // If already combined and a voice is selected, trigger dubbing instead of re-combining
    if (combinerData.outputVideoUrl && combinerData.selectedVoiceId && combinerData.status === 'completed') {
      return await executeDubbing(node);
    }

    const upstreamNodes = getUpstreamNodes(node.id);
    
    // Collect video URLs, sorted by x-position (left-to-right order)
    const videoEntries: { x: number; url: string }[] = [];
    let detectedAspectRatio: '16:9' | '9:16' | null = null;
    
    for (const upstream of upstreamNodes) {
      if (upstream.type === 'video-generator') {
        const vData = upstream.data as VideoGeneratorData;
        if (vData.generatedVideoUrl) videoEntries.push({ x: upstream.position.x, url: vData.generatedVideoUrl });
        if (vData.aspectRatio && !detectedAspectRatio) {
          detectedAspectRatio = vData.aspectRatio;
        }
      } else if (upstream.type === 'image-to-video') {
        const itvData = upstream.data as ImageToVideoData;
        if (itvData.generatedVideoUrl) videoEntries.push({ x: upstream.position.x, url: itvData.generatedVideoUrl });
        if (itvData.aspectRatio && !detectedAspectRatio) {
          detectedAspectRatio = itvData.aspectRatio;
        }
      } else if (upstream.type === 'avatar-scene') {
        const asData = upstream.data as AvatarSceneData;
        for (const scene of asData.scenes || []) {
          if (scene.generatedVideoUrl) videoEntries.push({ x: upstream.position.x, url: scene.generatedVideoUrl });
        }
      }
    }

    // Sort by x position (left-to-right = script order)
    videoEntries.sort((a, b) => a.x - b.x);
    const videoUrls = videoEntries.map(e => e.url);

    if (videoUrls.length < 1) {
      throw new Error('Connect at least 1 completed video node to combine');
    }

    updateNodeData(node.id, { 
      status: 'generating', 
      error: undefined,
      inputVideos: videoUrls,
      aspectRatio: detectedAspectRatio || '16:9',
    });

    try {
      // Properly concatenate videos using Canvas + MediaRecorder
      const combinedBlob = await concatenateVideos(videoUrls, (current, total) => {
        console.log(`Combining video ${current + 1}/${total}...`);
      });
      const combinedUrl = URL.createObjectURL(combinedBlob);

      updateNodeData(node.id, {
        status: 'completed',
        outputVideoUrl: combinedUrl,
      });

      return combinedUrl;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Video combination failed';
      updateNodeData(node.id, { status: 'failed', error: message });
      throw error;
    }
  }, [updateNodeData, getUpstreamNodes]);

  // Execute voice dubbing on a scene combiner's output
  const executeDubbing = useCallback(async (node: FlowNode) => {
    const data = node.data as SceneCombinerData;
    if (!data.outputVideoUrl || !data.selectedVoiceId) {
      throw new Error('Combined video and voice selection are required for dubbing');
    }

    updateNodeData(node.id, {
      dubbingStatus: 'processing',
      dubbingError: undefined,
      dubbedVideoUrl: undefined,
    });

    try {
      // For blob URLs, we need to upload to storage first
      let videoUrlForDubbing = data.outputVideoUrl;
      if (data.outputVideoUrl.startsWith('blob:')) {
        // Download blob and upload to storage
        const resp = await fetch(data.outputVideoUrl);
        const blob = await resp.blob();
        const fileName = `combined/${Date.now()}-combined.mp4`;
        const { error: uploadError } = await supabase.storage
          .from('assets')
          .upload(fileName, blob, { contentType: 'video/mp4', upsert: true });
        if (uploadError) throw uploadError;
        const { data: { publicUrl } } = supabase.storage.from('assets').getPublicUrl(fileName);
        videoUrlForDubbing = publicUrl;

        // Also update the combined URL to the persisted one
        updateNodeData(node.id, { outputVideoUrl: videoUrlForDubbing });
      }

      // Start dubbing
      const { data: startResult, error: startError } = await supabase.functions.invoke('dub-video', {
        body: {
          action: 'start',
          videoUrl: videoUrlForDubbing,
          voiceId: data.selectedVoiceId,
        },
      });

      if (startError) throw startError;
      if (startResult.error) throw new Error(startResult.error);

      const dubbingId = startResult.dubbingId;
      updateNodeData(node.id, { dubbingId });

      // Poll for completion
      const maxAttempts = 120;
      const interval = 5000;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const { data: pollResult, error: pollError } = await supabase.functions.invoke('dub-video', {
          body: {
            action: 'poll',
            dubbingId,
            languageCode: 'en',
          },
        });

        if (pollError) throw pollError;

        if (pollResult.status === 'completed' && pollResult.videoUrl) {
          updateNodeData(node.id, {
            dubbingStatus: 'completed',
            dubbedVideoUrl: pollResult.videoUrl,
          });
          toast.success('Voice dubbing completed!');
          return pollResult.videoUrl;
        }

        if (pollResult.status === 'failed') {
          throw new Error(pollResult.error || 'Dubbing failed');
        }

        // Still processing
        await new Promise((resolve) => setTimeout(resolve, interval));
      }

      throw new Error('Dubbing timed out');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Dubbing failed';
      updateNodeData(node.id, {
        dubbingStatus: 'failed',
        dubbingError: message,
      });
      throw error;
    }
  }, [updateNodeData]);

  // Execute image combiner
  const executeImageCombiner = useCallback(async (node: FlowNode) => {
    const data = node.data as ImageCombinerData;
    const upstreamNodes = getUpstreamNodes(node.id);
    
    let primaryUrl = data.primaryImageUrl;
    let secondaryUrl = data.secondaryImageUrl;
    
    for (const upstream of upstreamNodes) {
      if (upstream.type === 'image-generator') {
        const imgData = upstream.data as ImageGeneratorData;
        if (imgData.generatedImageUrl) {
          if (!primaryUrl) primaryUrl = imgData.generatedImageUrl;
          else if (!secondaryUrl) secondaryUrl = imgData.generatedImageUrl;
        }
      } else if (upstream.type === 'avatar-scene') {
        const asData = upstream.data as AvatarSceneData;
        if (asData.avatarImageUrl && !primaryUrl) {
          primaryUrl = asData.avatarImageUrl;
        }
      }
    }

    if (!primaryUrl) {
      throw new Error('Primary image is required');
    }

    const apiKey = getApiKeyForService('gemini');

    updateNodeData(node.id, { status: 'generating', error: undefined, primaryImageUrl: primaryUrl, secondaryImageUrl: secondaryUrl });

    try {
      const referenceImages = [primaryUrl];
      if (secondaryUrl) referenceImages.push(secondaryUrl);

      const bgPrompt = data.backgroundOption === 'custom' && data.customBackgroundPrompt
        ? data.customBackgroundPrompt
        : data.backgroundOption === 'remove' ? 'plain white background'
        : '';

      const combinePrompt = [
        `Combine mode: ${data.combineMode}.`,
        data.prompt || 'Combine these images naturally.',
        bgPrompt ? `Background: ${bgPrompt}` : '',
        'Maintain exact identity and features from the primary image.',
      ].filter(Boolean).join(' ');

      const { data: result, error } = await supabase.functions.invoke('generate-static-ad', {
        body: {
          prompt: combinePrompt,
          aspectRatio: data.aspectRatio,
          referenceImages,
          apiKey,
        },
      });

      if (error) throw error;

      updateNodeData(node.id, {
        status: 'completed',
        outputImageUrl: result.imageUrl,
      });

      return result.imageUrl;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Image combination failed';
      updateNodeData(node.id, { status: 'failed', error: message });
      throw error;
    }
  }, [updateNodeData, getUpstreamNodes]);

  // Execute hooks A/B testing node — processes each avatar as independent track
  const executeHooks = useCallback(async (node: FlowNode) => {
    const data = node.data as HooksNodeData;

    if (!data.script.trim()) throw new Error('Script is required');
    if (!data.avatars || data.avatars.length === 0) throw new Error('Select at least one avatar');

    // Keys are optional — edge functions fall back to env secrets
    const geminiKey = getApiKeyForService('gemini') || undefined;
    const veoKey = getApiKeyForService('veo3') || undefined;
    const videoModel = data.videoModel || 'veo3';

    updateNodeData(node.id, { status: 'generating', error: undefined });

    try {
      // Step 1: Break down script into scenes
      const { data: breakdownResult, error: breakdownError } = await supabase.functions.invoke('breakdown-script', {
        body: { script: data.script, segmentDuration: 8, apiKey: geminiKey },
      });
      if (breakdownError) throw breakdownError;

      const scenes = breakdownResult.scenes || breakdownResult;
      const scenesBreakdown = Array.isArray(scenes) ? scenes : [];

      if (scenesBreakdown.length === 0) {
        throw new Error('Script breakdown returned no scenes');
      }

      // Initialize tracks for each avatar with proper scene data
      const tracks: HooksTrack[] = data.avatars.map(avatar => ({
        avatarId: avatar.avatarId,
        avatarName: avatar.avatarName,
        avatarImageUrl: avatar.avatarImageUrl,
        selectedLookId: avatar.selectedLookId,
        scenes: scenesBreakdown.map((scene: any, i: number) => ({
          id: `${avatar.avatarId}-scene-${i}`,
          order: i,
          sceneEnvironment: scene.sceneEnvironment || scene.visualPrompt || '',
          action: scene.action || '',
          lipSyncLine: scene.lipSyncLine || scene.dialogue || '',
          cameraAngle: scene.cameraAngle || 'medium',
          duration: scene.duration || 8,
          status: 'idle' as const,
        })),
        overallStatus: 'idle' as const,
      }));

      updateNodeData(node.id, { scenesBreakdown, tracks });

      // Step 2: Process each avatar track INDEPENDENTLY
      for (let t = 0; t < tracks.length; t++) {
        const track = tracks[t];
        track.overallStatus = 'generating';
        updateNodeData(node.id, { tracks: [...tracks] });

        // Fetch avatar metadata for identity-locked prompts
        let avatarGender = 'female';
        let avatarAge = '26-35';
        let avatarEthnicity = 'mixed';
        const { data: avatarRow } = await supabase
          .from('avatars')
          .select('gender, age_range, ethnicity')
          .eq('id', track.avatarId)
          .single();
        if (avatarRow) {
          avatarGender = avatarRow.gender || 'female';
          avatarAge = avatarRow.age_range || '26-35';
          avatarEthnicity = avatarRow.ethnicity || 'mixed';
        }

        // Process each scene for this avatar sequentially
        for (let s = 0; s < track.scenes.length; s++) {
          const scene = track.scenes[s];
          scene.status = 'generating';
          updateNodeData(node.id, { tracks: [...tracks] });

          try {
            // Progressive camera movement for natural flow
            const cameraProgression = [
              'facing the camera straight on, making direct eye contact',
              'turned slightly to the left, showing more of the environment',
              'walking forward naturally, camera following alongside',
              'turned about 90 degrees, shown in side profile',
              'further along the location, captured from a new vantage point',
            ];
            const cameraDirection = cameraProgression[Math.min(s, cameraProgression.length - 1)];

            // IDENTITY + CONSISTENCY prompt: same person, same outfit, same hair, varying background per scene
            const identityPrefix = `CRITICAL IDENTITY LOCK: This person must look EXACTLY like the reference image — same face, same hair style, same hair color, same skin tone, same body type. OUTFIT LOCK: The person wears the EXACT SAME outfit as in the reference image throughout ALL scenes. Do NOT change their clothing, hairstyle, or accessories. SCENE ENVIRONMENT: ${scene.sceneEnvironment}. The background/environment changes per scene based on the script, but the person's appearance stays identical. CAMERA: Scene ${s + 1} of ${track.scenes.length} — the person is ${cameraDirection}.`;
            
            const imagePrompt = `${identityPrefix} Action: ${scene.action}. Camera: ${scene.cameraAngle}. The person is saying: "${scene.lipSyncLine}"`;

            const { data: imgResult, error: imgError } = await supabase.functions.invoke('generate-avatar', {
              body: {
                prompt: imagePrompt,
                aspectRatio: data.aspectRatio,
                apiKey: geminiKey,
                referenceImageUrl: track.avatarImageUrl,
                gender: avatarGender,
                ageRange: avatarAge,
                ethnicity: avatarEthnicity,
                style: 'ugc',
                background: 'studio',
              },
            });
            if (imgError) throw imgError;
            scene.generatedImageUrl = imgResult.imageUrl;
            updateNodeData(node.id, { tracks: [...tracks] });

            // Generate video from image
            const customVideoPrompt = data.videoPrompt?.trim();
            const videoPrompt = customVideoPrompt
              ? `${customVideoPrompt}. ${scene.action}. The person says: "${scene.lipSyncLine}". Camera: ${scene.cameraAngle}.`
              : `${scene.action}. The person says: "${scene.lipSyncLine}". Keep the same outfit and hairstyle. Camera: ${scene.cameraAngle}.`;
            
            const vidResult = await generateVideoForModel(videoModel, {
              prompt: videoPrompt,
              imageUrl: scene.generatedImageUrl,
              aspectRatio: data.aspectRatio,
              duration: scene.duration,
              apiKey: veoKey,
            });

            if (vidResult.status === 'completed' && vidResult.videoUrl) {
              scene.generatedVideoUrl = vidResult.videoUrl;
            } else {
              const opId = vidResult.operationId;
              if (!opId) throw new Error('No operation ID returned from video generation');
              const videoUrl = await pollVideoForModel(videoModel, opId, veoKey, node.id, updateNodeData);
              scene.generatedVideoUrl = videoUrl;
            }
            scene.status = 'completed';
          } catch (err) {
            console.error(`Hooks: failed scene ${s} for avatar ${track.avatarName}:`, err);
            scene.status = 'failed';
          }
          updateNodeData(node.id, { tracks: [...tracks] });
        }

        track.overallStatus = track.scenes.every(s => s.status === 'completed') ? 'completed'
          : track.scenes.some(s => s.status === 'failed') ? 'failed' : 'completed';
        updateNodeData(node.id, { tracks: [...tracks] });
      }

      const allCompleted = tracks.every(t => t.overallStatus === 'completed');
      updateNodeData(node.id, {
        status: allCompleted ? 'completed' : 'failed',
        error: allCompleted ? undefined : 'Some avatar tracks had failures',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Hooks generation failed';
      updateNodeData(node.id, { status: 'failed', error: message });
      throw error;
    }
  }, [updateNodeData]);

  // Execute a single node
  const executeNode = useCallback(async (nodeId: string) => {
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) {
      toast.error('Node not found');
      return;
    }

    try {
      switch (node.type) {
        case 'image-generator':
          await executeImageGenerator(node);
          break;
        case 'video-generator':
          await executeVideoGenerator(node);
          break;
        case 'prompt-generator':
          await executePromptGenerator(node);
          break;
        case 'image-to-video':
          await executeImageToVideo(node);
          break;
        case 'avatar-scene':
          await executeAvatarScene(node);
          break;
        case 'scene-combiner':
          await executeSceneCombiner(node);
          break;
        case 'image-combiner':
          await executeImageCombiner(node);
          break;
        case 'hooks':
          await executeHooks(node);
          break;
      }
      toast.success('Generation completed');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Generation failed');
    }
  }, [nodes, executeImageGenerator, executeVideoGenerator, executePromptGenerator, executeImageToVideo, executeAvatarScene, executeSceneCombiner, executeImageCombiner, executeHooks]);

  // Topological sort for execution order
  const getExecutionOrder = useCallback((): string[] => {
    const visited = new Set<string>();
    const order: string[] = [];
    
    const visit = (nodeId: string) => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);
      
      const upstreamNodes = getUpstreamNodes(nodeId);
      for (const upstream of upstreamNodes) {
        visit(upstream.id);
      }
      
      order.push(nodeId);
    };
    
    for (const node of nodes) {
      visit(node.id);
    }
    
    return order;
  }, [nodes, getUpstreamNodes]);

  // Execute entire flow
  const executeFlow = useCallback(async () => {
    const order = getExecutionOrder();
    
    for (const nodeId of order) {
      const node = nodes.find((n) => n.id === nodeId);
      if (!node) continue;
      
      if (node.data.status === 'completed') continue;
      
      try {
        await executeNode(nodeId);
      } catch {
        break;
      }
    }
  }, [getExecutionOrder, nodes, executeNode]);

  // Retry a single scene within a Hooks A/B track
  const retryHooksScene = useCallback(async (nodeId: string, avatarId: string, sceneId: string) => {
    const node = nodes.find(n => n.id === nodeId);
    if (!node || node.type !== 'hooks') return;
    const data = node.data as HooksNodeData;
    const tracks = [...data.tracks];
    const track = tracks.find(t => t.avatarId === avatarId);
    if (!track) return;
    const scene = track.scenes.find(s => s.id === sceneId);
    if (!scene) return;

    const geminiKey = getApiKeyForService('gemini') || undefined;
    const veoKey = getApiKeyForService('veo3') || undefined;
    const videoModel = data.videoModel || 'veo3';

    scene.status = 'generating';
    scene.generatedVideoUrl = undefined;
    updateNodeData(nodeId, { status: 'generating', error: undefined, tracks: [...tracks] });

    try {
      let avatarGender = 'female', avatarAge = '26-35', avatarEthnicity = 'mixed';
      const { data: avatarRow } = await supabase.from('avatars').select('gender, age_range, ethnicity').eq('id', track.avatarId).single();
      if (avatarRow) { avatarGender = avatarRow.gender || 'female'; avatarAge = avatarRow.age_range || '26-35'; avatarEthnicity = avatarRow.ethnicity || 'mixed'; }

      const s = scene.order;
      const cameraProgression = ['facing the camera straight on, making direct eye contact','turned slightly to the left, showing more of the environment','walking forward naturally, camera following alongside','turned about 90 degrees, shown in side profile','further along the location, captured from a new vantage point'];
      const cameraDirection = cameraProgression[Math.min(s, cameraProgression.length - 1)];
      const identityPrefix = `CRITICAL IDENTITY LOCK: This person must look EXACTLY like the reference image — same face, same hair style, same hair color, same skin tone, same body type. OUTFIT LOCK: The person wears the EXACT SAME outfit as in the reference image throughout ALL scenes. Do NOT change their clothing, hairstyle, or accessories. SCENE ENVIRONMENT: ${scene.sceneEnvironment}. The background/environment changes per scene based on the script, but the person's appearance stays identical. CAMERA: Scene ${s + 1} of ${track.scenes.length} — the person is ${cameraDirection}.`;
      const imagePrompt = `${identityPrefix} Action: ${scene.action}. Camera: ${scene.cameraAngle}. The person is saying: "${scene.lipSyncLine}"`;

      // Only regenerate image if missing
      if (!scene.generatedImageUrl) {
        const { data: imgResult, error: imgError } = await supabase.functions.invoke('generate-avatar', {
          body: { prompt: imagePrompt, aspectRatio: data.aspectRatio, apiKey: geminiKey, referenceImageUrl: track.avatarImageUrl, gender: avatarGender, ageRange: avatarAge, ethnicity: avatarEthnicity, style: 'ugc', background: 'studio' },
        });
        if (imgError) throw imgError;
        scene.generatedImageUrl = imgResult.imageUrl;
        updateNodeData(nodeId, { tracks: [...tracks] });
      }

      // Generate video
      const customVideoPrompt = data.videoPrompt?.trim();
      const videoPrompt = customVideoPrompt
        ? `${customVideoPrompt}. ${scene.action}. The person says: "${scene.lipSyncLine}". Camera: ${scene.cameraAngle}.`
        : `${scene.action}. The person says: "${scene.lipSyncLine}". Keep the same outfit and hairstyle. Camera: ${scene.cameraAngle}.`;
      const vidResult = await generateVideoForModel(videoModel, {
        prompt: videoPrompt,
        imageUrl: scene.generatedImageUrl,
        aspectRatio: data.aspectRatio,
        duration: scene.duration,
        apiKey: veoKey,
      });

      if (vidResult.status === 'completed' && vidResult.videoUrl) {
        scene.generatedVideoUrl = vidResult.videoUrl;
      } else {
        const opId = vidResult.operationId;
        if (!opId) throw new Error('No operation ID returned');
        scene.generatedVideoUrl = await pollVideoForModel(videoModel, opId, veoKey, nodeId, updateNodeData);
      }
      scene.status = 'completed';
    } catch (err) {
      console.error(`Retry failed for scene ${sceneId}:`, err);
      scene.status = 'failed';
      toast.error(`Retry failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }

    track.overallStatus = track.scenes.every(s => s.status === 'completed') ? 'completed' : track.scenes.some(s => s.status === 'failed') ? 'failed' : 'generating';
    const allCompleted = tracks.every(t => t.overallStatus === 'completed');
    updateNodeData(nodeId, { status: allCompleted ? 'completed' : tracks.some(t => t.overallStatus === 'generating') ? 'generating' : 'failed', tracks: [...tracks] });
  }, [nodes, updateNodeData]);

  return {
    executeNode,
    executeFlow,
    getExecutionOrder,
    retryHooksScene,
  };
}

