import { useEffect, useState, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { VideoEditorCanvas } from '@/components/video-editor/VideoEditorCanvas';
import { Timeline } from '@/components/video-editor/Timeline';
import { ToolsPanel } from '@/components/video-editor/ToolsPanel';
import { EditorHeader } from '@/components/video-editor/EditorHeader';
import { VideoProjectHome } from '@/components/video-editor/VideoProjectHome';
import { CanvasToolbar } from '@/components/video-editor/CanvasToolbar';
import { useVideoEditor } from '@/hooks/useVideoEditor';
import { useVideoCaptions } from '@/hooks/useVideoCaptions';
import { useVideoProjects, VideoProject } from '@/hooks/useVideoProjects';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';

export default function VideoEditorPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const srcUrl = searchParams.get('src') || '';
  const clipsParam = searchParams.get('clips') || '';
  const nameParam = searchParams.get('name') || '';
  const arParam = (searchParams.get('ar') || '16:9') as '16:9' | '9:16' | '1:1';

  const editor = useVideoEditor(arParam);
  const captionManager = useVideoCaptions();
  const projectManager = useVideoProjects();

  const [zoom, setZoom] = useState(1);
  const [initialized, setInitialized] = useState(false);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState('Untitled Project');
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved');
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef<string>('');

  // Load from URL source (single clip)
  useEffect(() => {
    if (srcUrl && !initialized) {
      setInitialized(true);
      projectManager.createProject(nameParam || 'Imported Video', arParam).then(proj => {
        if (proj) {
          setActiveProjectId(proj.id);
          setProjectName(proj.name);
          editor.addClipFromUrl(srcUrl);
        }
      });
    }
  }, [srcUrl, initialized]);

  // Load from multiple clips (flowboard export)
  useEffect(() => {
    if (clipsParam && !initialized) {
      setInitialized(true);
      try {
        const urls: string[] = JSON.parse(decodeURIComponent(clipsParam));
        if (urls.length > 0) {
          projectManager.createProjectFromUrls(nameParam || 'Flowboard Export', urls, arParam).then(async proj => {
            if (proj) {
              setActiveProjectId(proj.id);
              setProjectName(proj.name);
              for (const url of urls) {
                try {
                  await editor.addClipFromUrl(url);
                } catch (err) {
                  console.warn('Failed to load clip:', url, err);
                }
              }
            }
          });
        }
      } catch (err) {
        console.error('Failed to parse clips param:', err);
      }
    }
  }, [clipsParam, initialized]);

  // Sync caption state
  useEffect(() => { editor.setCaptions(captionManager.captions); }, [captionManager.captions]);
  useEffect(() => { editor.setCaptionStyle(captionManager.captionStyle); }, [captionManager.captionStyle]);
  useEffect(() => { editor.setCaptionFontSize(captionManager.fontSize); }, [captionManager.fontSize]);
  useEffect(() => { editor.setCaptionColor(captionManager.color); }, [captionManager.color]);
  useEffect(() => { editor.setCaptionFontFamily(captionManager.fontFamily); }, [captionManager.fontFamily]);
  useEffect(() => { editor.setCaptionPosition(captionManager.position); }, [captionManager.position]);
  useEffect(() => { editor.setCaptionStroke(captionManager.stroke); }, [captionManager.stroke]);
  useEffect(() => { editor.setCaptionBackground(captionManager.background); }, [captionManager.background]);

  const selectedClip = editor.clips.find(c => c.id === editor.selectedClipId) || null;

  const handleGenerateCaptions = useCallback(() => {
    const firstClip = editor.clips[0];
    if (firstClip) captionManager.generateCaptions(firstClip.blobUrl);
  }, [editor.clips, captionManager]);

  // ──── Auto-save logic ────
  const getStateSnapshot = useCallback(() => {
    return JSON.stringify({
      clips: editor.clips.map(c => ({
        sourceUrl: c.blobUrl, // Persist the URL for reload
        blobUrl: c.blobUrl,
        trimStart: c.trimStart,
        trimEnd: c.trimEnd,
        order: c.order,
        duration: c.duration,
        speed: c.speed,
        volume: c.volume,
        transition: c.transition,
        transitionDuration: c.transitionDuration,
        label: c.label,
        locked: c.locked,
      })),
      captions: captionManager.captions,
      captionSettings: {
        style: captionManager.captionStyle,
        fontSize: captionManager.fontSize,
        color: captionManager.color,
        fontFamily: captionManager.fontFamily,
        position: captionManager.position,
        stroke: captionManager.stroke,
        background: captionManager.background,
      },
      textOverlays: editor.textOverlays,
      aspectRatio: editor.aspectRatio,
    });
  }, [editor.clips, editor.textOverlays, editor.aspectRatio, captionManager]);

  useEffect(() => {
    if (!activeProjectId) return;
    const snapshot = getStateSnapshot();
    if (snapshot === lastSavedRef.current) return;

    setSaveStatus('unsaved');
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      setSaveStatus('saving');
      let parsed: any;
      try {
        parsed = JSON.parse(snapshot);
      } catch (e) {
        console.error('Bad snapshot, skipping save', e);
        setSaveStatus('unsaved');
        return;
      }
      const success = await projectManager.saveProjectState(activeProjectId, {
        clips_data: parsed.clips,
        caption_data: parsed.captions,
        caption_settings: parsed.captionSettings,
        text_overlays: parsed.textOverlays,
        aspect_ratio: parsed.aspectRatio,
      } as any);
      if (success) {
        lastSavedRef.current = snapshot;
        setSaveStatus('saved');
      } else {
        setSaveStatus('unsaved');
      }
    }, 2000);

    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [getStateSnapshot, activeProjectId]);

  // ──── Project operations ────
  const handleCreateProject = useCallback(async () => {
    const proj = await projectManager.createProject();
    if (proj) {
      setActiveProjectId(proj.id);
      setProjectName(proj.name);
      lastSavedRef.current = '';
      setSaveStatus('saved');
    }
  }, [projectManager]);

  const handleOpenProject = useCallback(async (id: string) => {
    const proj = await projectManager.loadProject(id);
    if (!proj) return;
    setActiveProjectId(proj.id);
    setProjectName(proj.name);

    // Restore state
    const ar = (proj.aspect_ratio || '16:9') as '16:9' | '9:16' | '1:1';
    editor.setAspectRatio(ar);

    // Restore caption settings
    const cs = ((proj as any).caption_settings || (proj.metadata as any)?.caption_settings || {}) as any;
    if (cs.style) captionManager.setCaptionStyle(cs.style);
    if (cs.fontSize) captionManager.setFontSize(cs.fontSize);
    if (cs.color) captionManager.setColor(cs.color);
    if (cs.fontFamily) captionManager.setFontFamily(cs.fontFamily);
    if (cs.position) captionManager.setPosition(cs.position);
    if (cs.stroke !== undefined) captionManager.setStroke(cs.stroke);
    if (cs.background !== undefined) captionManager.setBackground(cs.background);

    // Restore clips from stored source URLs
    const clipsData = ((proj as any).clips_data || (proj.metadata as any)?.clips_data || proj.scenes || []) as any[];
    for (const clipData of clipsData) {
      const url = clipData.sourceUrl || clipData.blobUrl;
      if (url && !url.startsWith('blob:') && url.length > 0) {
        try {
          await editor.addClipFromUrl(url);
        } catch (err) {
          console.warn('Failed to restore clip:', url, err);
        }
      }
    }

    // Restore captions
    const captionData = ((proj as any).caption_data || (proj.metadata as any)?.caption_data || []) as any[];
    if (captionData.length > 0) {
      captionData.forEach((c: any) => {
        captionManager.addCaption(c.startTime, c.endTime, c.text);
      });
    }

    lastSavedRef.current = '';
    setSaveStatus('saved');
  }, [projectManager, editor, captionManager]);

  const handleBack = useCallback(() => {
    setActiveProjectId(null);
    setProjectName('Untitled Project');
  }, []);

  const handleRename = useCallback(async (name: string) => {
    if (!activeProjectId) return;
    setProjectName(name);
    await projectManager.renameProject(activeProjectId, name);
  }, [activeProjectId, projectManager]);

  const handleAspectRatioChange = useCallback((ar: '16:9' | '9:16' | '1:1') => {
    editor.setAspectRatio(ar);
  }, [editor]);

  // ──── Keyboard shortcuts ────
  useEffect(() => {
    if (!activeProjectId) return;
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      switch (e.key) {
        case ' ':
          e.preventDefault();
          editor.togglePlayPause();
          break;
        case 'j':
          editor.seek(Math.max(0, editor.currentTime - 5));
          break;
        case 'l':
          editor.seek(Math.min(editor.totalDuration, editor.currentTime + 5));
          break;
        case 'k':
          editor.togglePlayPause();
          break;
        case 's':
          if (!e.ctrlKey && !e.metaKey) editor.splitAtPlayhead();
          break;
        case 'Delete':
        case 'Backspace':
          if (editor.selectedClipId) editor.removeClip(editor.selectedClipId);
          break;
        case 'd':
          if (editor.selectedClipId) editor.duplicateClip(editor.selectedClipId);
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [editor, activeProjectId]);

  // ──── Render ────
  if (!activeProjectId && !srcUrl && !clipsParam) {
    return (
      <AppLayout>
        <VideoProjectHome
          projects={projectManager.projects}
          isLoading={projectManager.isLoading}
          onCreateProject={handleCreateProject}
          onOpenProject={handleOpenProject}
          onDeleteProject={projectManager.deleteProject}
          onDuplicateProject={projectManager.duplicateProject}
          onRenameProject={projectManager.renameProject}
        />
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="flex flex-col h-[calc(100vh-48px)] -m-6 bg-[hsl(var(--background))]">
        {/* Editor Header */}
        <EditorHeader
          projectName={projectName}
          aspectRatio={editor.aspectRatio}
          saveStatus={saveStatus}
          onBack={handleBack}
          onRename={handleRename}
          onAspectRatioChange={handleAspectRatioChange}
        />

        {/* Top: Preview + Tools with resizable panels */}
        <ResizablePanelGroup direction="horizontal" className="flex-1 min-h-0">
          <ResizablePanel defaultSize={70} minSize={45}>
            <div className="h-full flex flex-col overflow-hidden bg-[#0a0a0a]">
              <CanvasToolbar
                hasSelectedClip={!!selectedClip}
                clipMuted={selectedClip ? selectedClip.volume === 0 : false}
                clipSpeed={selectedClip?.speed}
                onSplit={editor.splitAtPlayhead}
                onTrim={() => {
                  if (selectedClip) {
                    editor.setTrimPoints(selectedClip.id, selectedClip.trimStart, selectedClip.trimEnd);
                  }
                }}
                onToggleMute={() => {
                  if (selectedClip) {
                    editor.setClipVolume(selectedClip.id, selectedClip.volume === 0 ? 1 : 0);
                  }
                }}
                onAddText={() => {
                  editor.addTextOverlay({
                    text: 'New Text',
                    x: 50, y: 50,
                    fontSize: 32,
                    fontFamily: 'Inter',
                    fontWeight: 'bold',
                    color: '#ffffff',
                    opacity: 1,
                    startTime: editor.currentTime,
                    endTime: Math.min(editor.currentTime + 3, editor.totalDuration || 3),
                    animation: 'none',
                  });
                }}
                onAddAudio={() => {
                  // Placeholder — could open audio upload
                }}
                onSetSpeed={(speed) => {
                  if (selectedClip) editor.setClipSpeed(selectedClip.id, speed);
                }}
              />
              <div className="flex-1 p-3 flex items-center justify-center overflow-hidden">
                <div className="shadow-2xl shadow-black/50 rounded-lg overflow-hidden max-h-[60vh]" style={{ aspectRatio: editor.aspectRatio === '9:16' ? '9/16' : editor.aspectRatio === '1:1' ? '1/1' : '16/9' }}>
                  <VideoEditorCanvas
                    clips={editor.clips}
                    currentTime={editor.currentTime}
                    isPlaying={editor.isPlaying}
                    captions={captionManager.captions}
                    captionStyle={captionManager.captionStyle}
                    captionFontSize={captionManager.fontSize}
                    captionColor={captionManager.color}
                    captionFontFamily={captionManager.fontFamily}
                    captionPosition={captionManager.position}
                    captionStroke={captionManager.stroke}
                    captionBackground={captionManager.background}
                    aspectRatio={editor.aspectRatio}
                    totalDuration={editor.totalDuration}
                    loadError={editor.loadError}
                    isLoading={editor.isLoading}
                    onTimeUpdate={editor.setCurrentTime}
                    onTogglePlayPause={editor.togglePlayPause}
                    onSeek={editor.seek}
                    onFileUpload={editor.addClipFromFile}
                    sourceUrl={srcUrl || undefined}
                  />
                </div>
              </div>
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel defaultSize={30} minSize={22} maxSize={42}>
            <ToolsPanel
              selectedClip={selectedClip}
              clips={editor.clips}
              captions={captionManager.captions}
              captionStyle={captionManager.captionStyle}
              captionFontSize={captionManager.fontSize}
              captionColor={captionManager.color}
              captionFontFamily={captionManager.fontFamily}
              captionPosition={captionManager.position}
              captionStroke={captionManager.stroke}
              captionBackground={captionManager.background}
              voiceoverBlobUrl={editor.voiceoverBlobUrl}
              voiceoverVolume={editor.voiceoverVolume}
              aspectRatio={editor.aspectRatio}
              totalDuration={editor.totalDuration}
              isGeneratingCaptions={captionManager.isGenerating}
              textOverlays={editor.textOverlays}
              currentTime={editor.currentTime}
              onSetTrimPoints={editor.setTrimPoints}
              onSplitAtPlayhead={editor.splitAtPlayhead}
              onRemoveClip={editor.removeClip}
              onGenerateCaptions={handleGenerateCaptions}
              onAddCaption={captionManager.addCaption}
              onUpdateCaption={captionManager.updateCaption}
              onDeleteCaption={captionManager.deleteCaption}
              onSetCaptionStyle={captionManager.setCaptionStyle}
              onSetFontSize={captionManager.setFontSize}
              onSetColor={captionManager.setColor}
              onSetFontFamily={captionManager.setFontFamily}
              onSetPosition={captionManager.setPosition}
              onSetStroke={captionManager.setStroke}
              onSetBackground={captionManager.setBackground}
              onSetVoiceoverBlobUrl={editor.setVoiceoverBlobUrl}
              onSetVoiceoverVolume={editor.setVoiceoverVolume}
              onRemoveSilence={editor.removeSilenceSegments}
              onSeek={editor.seek}
              onSetClipSpeed={editor.setClipSpeed}
              onSetClipVolume={editor.setClipVolume}
              onSetClipTransition={editor.setClipTransition}
              onAddTextOverlay={editor.addTextOverlay}
              onUpdateTextOverlay={editor.updateTextOverlay}
              onRemoveTextOverlay={editor.removeTextOverlay}
            />
          </ResizablePanel>
        </ResizablePanelGroup>

        {/* Bottom: Timeline */}
        <Timeline
          clips={editor.clips}
          captions={captionManager.captions}
          textOverlays={editor.textOverlays}
          currentTime={editor.currentTime}
          totalDuration={editor.totalDuration}
          selectedClipId={editor.selectedClipId}
          voiceoverBlobUrl={editor.voiceoverBlobUrl}
          snapEnabled={editor.snapEnabled}
          rippleEnabled={editor.rippleEnabled}
          onSeek={editor.seek}
          onSelectClip={editor.setSelectedClipId}
          onDuplicateClip={editor.duplicateClip}
          onSplitAtPlayhead={editor.splitAtPlayhead}
          onRemoveClip={editor.removeClip}
          onToggleClipLock={editor.toggleClipLock}
          onToggleSnap={() => editor.setSnapEnabled(!editor.snapEnabled)}
          onToggleRipple={() => editor.setRippleEnabled(!editor.rippleEnabled)}
          zoom={zoom}
          onZoomChange={setZoom}
        />
      </div>
    </AppLayout>
  );
}
