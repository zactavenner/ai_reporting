import { useState, useCallback, useRef } from 'react';
import { fetchVideoAsBlob } from '@/lib/video-proxy';

export type TransitionType = 'none' | 'crossfade' | 'wipe-left' | 'wipe-right' | 'wipe-up' | 'zoom-in' | 'zoom-out' | 'slide-left' | 'slide-right' | 'dissolve';

export interface VideoClip {
  id: string;
  blobUrl: string;
  sourceUrl?: string;
  startTime: number;
  endTime: number;
  trimStart: number;
  trimEnd: number;
  order: number;
  duration: number;
  speed: number;
  volume: number;
  transition: TransitionType;
  transitionDuration: number;
  label?: string;
  locked?: boolean;
}

export interface CaptionWord {
  word: string;
  startTime: number;
  endTime: number;
}

export interface Caption {
  id: string;
  text: string;
  startTime: number;
  endTime: number;
  words?: CaptionWord[];
}

export type CaptionStyleType =
  | 'viral-pop'
  | 'karaoke'
  | 'boxed'
  | 'typewriter'
  | 'gradient'
  | 'minimal'
  | 'neon'
  | 'classic'
  | 'none';

export type CaptionPosition = 'top' | 'center' | 'bottom';

export interface TextOverlay {
  id: string;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  fontFamily: string;
  color: string;
  background?: string;
  startTime: number;
  endTime: number;
  animation: 'none' | 'fade' | 'slide' | 'bounce' | 'typewriter' | 'scale';
  fontWeight: string;
  opacity: number;
}

export interface VideoEditorState {
  clips: VideoClip[];
  currentTime: number;
  isPlaying: boolean;
  selectedClipId: string | null;
  captions: Caption[];
  captionStyle: CaptionStyleType;
  captionFontSize: number;
  captionColor: string;
  captionFontFamily: string;
  captionPosition: CaptionPosition;
  captionStroke: boolean;
  captionBackground: boolean;
  voiceoverBlobUrl: string | null;
  voiceoverVolume: number;
  aspectRatio: '16:9' | '9:16' | '1:1';
  loadError: string | null;
  isLoading: boolean;
  totalDuration: number;
  textOverlays: TextOverlay[];
  snapEnabled: boolean;
  rippleEnabled: boolean;
}

export function useVideoEditor(initialAspectRatio: '16:9' | '9:16' | '1:1' = '16:9') {
  const [clips, setClips] = useState<VideoClip[]>([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [captionStyle, setCaptionStyle] = useState<CaptionStyleType>('none');
  const [captionFontSize, setCaptionFontSize] = useState(32);
  const [captionColor, setCaptionColor] = useState('#ffffff');
  const [captionFontFamily, setCaptionFontFamily] = useState('Inter');
  const [captionPosition, setCaptionPosition] = useState<CaptionPosition>('bottom');
  const [captionStroke, setCaptionStroke] = useState(true);
  const [captionBackground, setCaptionBackground] = useState(false);
  const [voiceoverBlobUrl, setVoiceoverBlobUrl] = useState<string | null>(null);
  const [voiceoverVolume, setVoiceoverVolume] = useState(0.8);
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16' | '1:1'>(initialAspectRatio);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [textOverlays, setTextOverlays] = useState<TextOverlay[]>([]);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [rippleEnabled, setRippleEnabled] = useState(true);

  const videoRef = useRef<HTMLVideoElement | null>(null);

  const totalDuration = clips.reduce((sum, clip) => {
    const effectiveDuration = ((clip.trimEnd || clip.duration) - (clip.trimStart || 0)) / (clip.speed || 1);
    return sum + effectiveDuration;
  }, 0);

  const addClipFromBlobUrl = useCallback(async (blobUrl: string, sourceUrl?: string) => {
    const duration = await getVideoDuration(blobUrl);
    const newClip: VideoClip = {
      id: crypto.randomUUID(),
      blobUrl,
      sourceUrl,
      startTime: totalDuration,
      endTime: totalDuration + duration,
      trimStart: 0,
      trimEnd: duration,
      order: clips.length,
      duration,
      speed: 1,
      volume: 1,
      transition: 'none',
      transitionDuration: 0.5,
    };
    setClips(prev => [...prev, newClip]);
    if (!selectedClipId) setSelectedClipId(newClip.id);
  }, [clips, totalDuration, selectedClipId]);

  const addClipFromUrl = useCallback(async (url: string) => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const blob = await fetchVideoAsBlob(url);
      const blobUrl = URL.createObjectURL(blob);
      await addClipFromBlobUrl(blobUrl, url);
    } catch (err) {
      console.error('Failed to fetch video:', err);
      setLoadError(
        "This video can't be loaded directly due to browser restrictions. Please download it first, then upload it here."
      );
    } finally {
      setIsLoading(false);
    }
  }, [addClipFromBlobUrl]);

  const addClipFromFile = useCallback(async (file: File) => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const blobUrl = URL.createObjectURL(file);
      await addClipFromBlobUrl(blobUrl);
    } catch (err) {
      setLoadError('Failed to load video file.');
    } finally {
      setIsLoading(false);
    }
  }, [addClipFromBlobUrl]);

  const removeClip = useCallback((clipId: string) => {
    setClips(prev => {
      const filtered = prev.filter(c => c.id !== clipId);
      return recalculateTimings(filtered);
    });
    if (selectedClipId === clipId) {
      setSelectedClipId(null);
    }
  }, [selectedClipId]);

  const splitAtPlayhead = useCallback(() => {
    const clipAtTime = getClipAtTime(currentTime);
    if (!clipAtTime) return;

    const relativeTime = currentTime - clipAtTime.startTime + clipAtTime.trimStart;
    if (relativeTime <= clipAtTime.trimStart + 0.1 || relativeTime >= clipAtTime.trimEnd - 0.1) return;

    const clip1: VideoClip = {
      ...clipAtTime,
      id: crypto.randomUUID(),
      trimEnd: relativeTime,
      duration: clipAtTime.duration,
    };
    const clip2: VideoClip = {
      ...clipAtTime,
      id: crypto.randomUUID(),
      trimStart: relativeTime,
      duration: clipAtTime.duration,
      transition: 'none',
    };

    setClips(prev => {
      const idx = prev.findIndex(c => c.id === clipAtTime.id);
      const newClips = [...prev];
      newClips.splice(idx, 1, clip1, clip2);
      return recalculateTimings(newClips);
    });
  }, [currentTime, clips]);

  const setTrimPoints = useCallback((clipId: string, trimStart: number, trimEnd: number) => {
    setClips(prev => {
      const updated = prev.map(c =>
        c.id === clipId ? { ...c, trimStart, trimEnd } : c
      );
      return recalculateTimings(updated);
    });
  }, []);

  const setClipSpeed = useCallback((clipId: string, speed: number) => {
    setClips(prev => {
      const updated = prev.map(c =>
        c.id === clipId ? { ...c, speed: Math.max(0.25, Math.min(4, speed)) } : c
      );
      return recalculateTimings(updated);
    });
  }, []);

  const setClipVolume = useCallback((clipId: string, volume: number) => {
    setClips(prev => prev.map(c =>
      c.id === clipId ? { ...c, volume: Math.max(0, Math.min(2, volume)) } : c
    ));
  }, []);

  const setClipTransition = useCallback((clipId: string, transition: TransitionType, duration?: number) => {
    setClips(prev => prev.map(c =>
      c.id === clipId ? { ...c, transition, transitionDuration: duration ?? c.transitionDuration } : c
    ));
  }, []);

  const setClipLabel = useCallback((clipId: string, label: string) => {
    setClips(prev => prev.map(c =>
      c.id === clipId ? { ...c, label } : c
    ));
  }, []);

  const toggleClipLock = useCallback((clipId: string) => {
    setClips(prev => prev.map(c =>
      c.id === clipId ? { ...c, locked: !c.locked } : c
    ));
  }, []);

  const duplicateClip = useCallback((clipId: string) => {
    setClips(prev => {
      const clip = prev.find(c => c.id === clipId);
      if (!clip) return prev;
      const idx = prev.findIndex(c => c.id === clipId);
      const newClip: VideoClip = { ...clip, id: crypto.randomUUID(), transition: 'none' };
      const newClips = [...prev];
      newClips.splice(idx + 1, 0, newClip);
      return recalculateTimings(newClips);
    });
  }, []);

  const reorderClips = useCallback((fromIndex: number, toIndex: number) => {
    setClips(prev => {
      const newClips = [...prev];
      const [moved] = newClips.splice(fromIndex, 1);
      newClips.splice(toIndex, 0, moved);
      return recalculateTimings(newClips);
    });
  }, []);

  const getClipAtTime = useCallback((time: number): VideoClip | null => {
    let accumulated = 0;
    for (const clip of clips) {
      const effectiveDuration = (clip.trimEnd - clip.trimStart) / (clip.speed || 1);
      if (time >= accumulated && time < accumulated + effectiveDuration) {
        return clip;
      }
      accumulated += effectiveDuration;
    }
    return null;
  }, [clips]);

  // Text overlay management
  const addTextOverlay = useCallback((overlay: Omit<TextOverlay, 'id'>) => {
    setTextOverlays(prev => [...prev, { ...overlay, id: crypto.randomUUID() }]);
  }, []);

  const updateTextOverlay = useCallback((id: string, updates: Partial<TextOverlay>) => {
    setTextOverlays(prev => prev.map(o => o.id === id ? { ...o, ...updates } : o));
  }, []);

  const removeTextOverlay = useCallback((id: string) => {
    setTextOverlays(prev => prev.filter(o => o.id !== id));
  }, []);

  // Remove silence segments from clips
  const removeSilenceSegments = useCallback((silentSegments: { startTime: number; endTime: number }[]) => {
    if (silentSegments.length === 0 || clips.length === 0) return;
    
    const sorted = [...silentSegments].sort((a, b) => b.startTime - a.startTime);
    
    let newClips = [...clips];
    for (const segment of sorted) {
      const updatedClips: VideoClip[] = [];
      for (const clip of newClips) {
        const clipStart = clip.startTime;
        const clipEnd = clip.startTime + (clip.trimEnd - clip.trimStart) / (clip.speed || 1);
        
        if (segment.endTime <= clipStart || segment.startTime >= clipEnd) {
          updatedClips.push(clip);
        } else {
          const localSilenceStart = segment.startTime - clipStart + clip.trimStart;
          const localSilenceEnd = segment.endTime - clipStart + clip.trimStart;
          
          if (localSilenceStart > clip.trimStart) {
            updatedClips.push({ ...clip, id: crypto.randomUUID(), trimEnd: localSilenceStart });
          }
          if (localSilenceEnd < clip.trimEnd) {
            updatedClips.push({ ...clip, id: crypto.randomUUID(), trimStart: localSilenceEnd });
          }
        }
      }
      newClips = updatedClips;
    }
    
    setClips(recalculateTimings(newClips));
  }, [clips]);

  // Snap time to nearest clip boundary
  const snapTime = useCallback((time: number, threshold = 0.15): number => {
    if (!snapEnabled) return time;
    const boundaries: number[] = [0, totalDuration];
    let acc = 0;
    for (const clip of clips) {
      const dur = (clip.trimEnd - clip.trimStart) / (clip.speed || 1);
      boundaries.push(acc);
      boundaries.push(acc + dur);
      acc += dur;
    }
    for (const b of boundaries) {
      if (Math.abs(time - b) < threshold) return b;
    }
    return time;
  }, [clips, totalDuration, snapEnabled]);

  const seek = useCallback((time: number) => {
    setCurrentTime(Math.max(0, Math.min(time, totalDuration)));
  }, [totalDuration]);

  const play = useCallback(() => setIsPlaying(true), []);
  const pause = useCallback(() => setIsPlaying(false), []);
  const togglePlayPause = useCallback(() => setIsPlaying(prev => !prev), []);

  return {
    clips,
    currentTime,
    isPlaying,
    selectedClipId,
    captions,
    captionStyle,
    captionFontSize,
    captionColor,
    captionFontFamily,
    captionPosition,
    captionStroke,
    captionBackground,
    voiceoverBlobUrl,
    voiceoverVolume,
    aspectRatio,
    loadError,
    isLoading,
    totalDuration,
    textOverlays,
    snapEnabled,
    rippleEnabled,
    videoRef,
    setCurrentTime,
    setSelectedClipId,
    setCaptions,
    setCaptionStyle,
    setCaptionFontSize,
    setCaptionColor,
    setCaptionFontFamily,
    setCaptionPosition,
    setCaptionStroke,
    setCaptionBackground,
    setVoiceoverBlobUrl,
    setVoiceoverVolume,
    setAspectRatio,
    setLoadError,
    setSnapEnabled,
    setRippleEnabled,
    addClipFromUrl,
    addClipFromFile,
    removeClip,
    splitAtPlayhead,
    setTrimPoints,
    setClipSpeed,
    setClipVolume,
    setClipTransition,
    setClipLabel,
    toggleClipLock,
    duplicateClip,
    reorderClips,
    getClipAtTime,
    addTextOverlay,
    updateTextOverlay,
    removeTextOverlay,
    removeSilenceSegments,
    snapTime,
    seek,
    play,
    pause,
    togglePlayPause,
  };
}

function recalculateTimings(clips: VideoClip[]): VideoClip[] {
  let accumulated = 0;
  return clips.map((clip, index) => {
    const effectiveDuration = (clip.trimEnd - clip.trimStart) / (clip.speed || 1);
    const updated = {
      ...clip,
      order: index,
      startTime: accumulated,
      endTime: accumulated + effectiveDuration,
    };
    accumulated += effectiveDuration;
    return updated;
  });
}

function getVideoDuration(blobUrl: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      resolve(video.duration);
      video.remove();
    };
    video.onerror = () => {
      reject(new Error('Failed to load video metadata'));
      video.remove();
    };
    video.src = blobUrl;
  });
}
