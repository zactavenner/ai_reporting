import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Scissors, Type, Mic, Download, Wand2, Gauge, Sparkles, Layers } from 'lucide-react';
import { ClipTrimmer } from './ClipTrimmer';
import { CaptionEditor } from './CaptionEditor';
import { VoiceoverPanel } from './VoiceoverPanel';
import { ExportDialog } from './ExportDialog';
import { SmartToolsPanel } from './SmartToolsPanel';
import { SpeedPanel } from './SpeedPanel';
import { TransitionsPanel } from './TransitionsPanel';
import { TextOverlayPanel } from './TextOverlayPanel';
import type { VideoClip, Caption, CaptionStyleType, CaptionPosition, TextOverlay, TransitionType } from '@/hooks/useVideoEditor';

interface ToolsPanelProps {
  selectedClip: VideoClip | null;
  clips: VideoClip[];
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
  totalDuration: number;
  isGeneratingCaptions: boolean;
  textOverlays: TextOverlay[];
  currentTime: number;
  onSetTrimPoints: (clipId: string, trimStart: number, trimEnd: number) => void;
  onSplitAtPlayhead: () => void;
  onRemoveClip: (clipId: string) => void;
  onGenerateCaptions: () => void;
  onAddCaption: (startTime: number, endTime: number, text: string) => void;
  onUpdateCaption: (id: string, updates: Partial<Caption>) => void;
  onDeleteCaption: (id: string) => void;
  onSetCaptionStyle: (style: CaptionStyleType) => void;
  onSetFontSize: (size: number) => void;
  onSetColor: (color: string) => void;
  onSetFontFamily: (family: string) => void;
  onSetPosition: (pos: CaptionPosition) => void;
  onSetStroke: (v: boolean) => void;
  onSetBackground: (v: boolean) => void;
  onSetVoiceoverBlobUrl: (url: string | null) => void;
  onSetVoiceoverVolume: (vol: number) => void;
  onRemoveSilence: (segments: { startTime: number; endTime: number }[]) => void;
  onSeek: (time: number) => void;
  onSetClipSpeed: (clipId: string, speed: number) => void;
  onSetClipVolume: (clipId: string, volume: number) => void;
  onSetClipTransition: (clipId: string, transition: TransitionType, duration?: number) => void;
  onAddTextOverlay: (overlay: Omit<TextOverlay, 'id'>) => void;
  onUpdateTextOverlay: (id: string, updates: Partial<TextOverlay>) => void;
  onRemoveTextOverlay: (id: string) => void;
  projectId: string;
  projectName: string;
  clientId: string | null;
  onClientChange: (clientId: string) => void;
  onSourcesPersisted: (sources: Record<string, string>) => void;
}

export function ToolsPanel(props: ToolsPanelProps) {
  return (
    <div className="h-full border-l border-border/50 bg-[hsl(var(--card))] overflow-y-auto">
      <Tabs defaultValue="captions" className="h-full">
        <TabsList className="w-full rounded-none border-b border-border/50 bg-muted/20 h-9 px-1">
          <TabsTrigger value="captions" className="gap-1 text-[10px] flex-1 h-7 data-[state=active]:bg-primary/10">
            <Type className="h-3 w-3" /> Captions
          </TabsTrigger>
          <TabsTrigger value="speed" className="gap-1 text-[10px] flex-1 h-7 data-[state=active]:bg-primary/10">
            <Gauge className="h-3 w-3" /> Speed
          </TabsTrigger>
          <TabsTrigger value="transitions" className="gap-1 text-[10px] flex-1 h-7 data-[state=active]:bg-primary/10">
            <Sparkles className="h-3 w-3" /> FX
          </TabsTrigger>
          <TabsTrigger value="text" className="gap-1 text-[10px] flex-1 h-7 data-[state=active]:bg-primary/10">
            <Layers className="h-3 w-3" /> Text
          </TabsTrigger>
          <TabsTrigger value="ai" className="gap-1 text-[10px] flex-1 h-7 data-[state=active]:bg-primary/10">
            <Wand2 className="h-3 w-3" /> AI
          </TabsTrigger>
          <TabsTrigger value="trim" className="gap-1 text-[10px] flex-1 h-7 data-[state=active]:bg-primary/10">
            <Scissors className="h-3 w-3" /> Trim
          </TabsTrigger>
          <TabsTrigger value="voiceover" className="gap-1 text-[10px] flex-1 h-7 data-[state=active]:bg-primary/10">
            <Mic className="h-3 w-3" /> VO
          </TabsTrigger>
          <TabsTrigger value="export" className="gap-1 text-[10px] flex-1 h-7 data-[state=active]:bg-primary/10">
            <Download className="h-3 w-3" /> Out
          </TabsTrigger>
        </TabsList>

        <TabsContent value="trim" className="mt-0">
          <ClipTrimmer
            clip={props.selectedClip}
            onSetTrimPoints={props.onSetTrimPoints}
            onSplitAtPlayhead={props.onSplitAtPlayhead}
            onRemoveClip={props.onRemoveClip}
          />
        </TabsContent>

        <TabsContent value="captions" className="mt-0">
          <CaptionEditor
            captions={props.captions}
            captionStyle={props.captionStyle}
            fontSize={props.captionFontSize}
            color={props.captionColor}
            fontFamily={props.captionFontFamily}
            position={props.captionPosition}
            stroke={props.captionStroke}
            background={props.captionBackground}
            isGenerating={props.isGeneratingCaptions}
            totalDuration={props.totalDuration}
            onGenerateCaptions={props.onGenerateCaptions}
            onAddCaption={props.onAddCaption}
            onUpdateCaption={props.onUpdateCaption}
            onDeleteCaption={props.onDeleteCaption}
            onSetStyle={props.onSetCaptionStyle}
            onSetFontSize={props.onSetFontSize}
            onSetColor={props.onSetColor}
            onSetFontFamily={props.onSetFontFamily}
            onSetPosition={props.onSetPosition}
            onSetStroke={props.onSetStroke}
            onSetBackground={props.onSetBackground}
          />
        </TabsContent>

        <TabsContent value="speed" className="mt-0">
          <SpeedPanel
            clip={props.selectedClip}
            onSetSpeed={props.onSetClipSpeed}
            onSetVolume={props.onSetClipVolume}
          />
        </TabsContent>

        <TabsContent value="transitions" className="mt-0">
          <TransitionsPanel
            clip={props.selectedClip}
            clips={props.clips}
            onSetTransition={props.onSetClipTransition}
          />
        </TabsContent>

        <TabsContent value="text" className="mt-0">
          <TextOverlayPanel
            overlays={props.textOverlays}
            totalDuration={props.totalDuration}
            currentTime={props.currentTime}
            onAdd={props.onAddTextOverlay}
            onUpdate={props.onUpdateTextOverlay}
            onRemove={props.onRemoveTextOverlay}
            onSeek={props.onSeek}
          />
        </TabsContent>

        <TabsContent value="ai" className="mt-0">
          <SmartToolsPanel
            clips={props.clips}
            captions={props.captions}
            onRemoveSilence={props.onRemoveSilence}
            onSeek={props.onSeek}
          />
        </TabsContent>

        <TabsContent value="voiceover" className="mt-0">
          <VoiceoverPanel
            voiceoverBlobUrl={props.voiceoverBlobUrl}
            voiceoverVolume={props.voiceoverVolume}
            onSetVoiceoverBlobUrl={props.onSetVoiceoverBlobUrl}
            onSetVoiceoverVolume={props.onSetVoiceoverVolume}
          />
        </TabsContent>

        <TabsContent value="export" className="mt-0">
          <ExportDialog
            clips={props.clips}
            captions={props.captions}
            captionStyle={props.captionStyle}
            captionFontSize={props.captionFontSize}
            captionColor={props.captionColor}
            captionFontFamily={props.captionFontFamily}
            captionPosition={props.captionPosition}
            captionStroke={props.captionStroke}
            captionBackground={props.captionBackground}
            aspectRatio={props.aspectRatio}
            voiceoverBlobUrl={props.voiceoverBlobUrl}
            voiceoverVolume={props.voiceoverVolume}
            projectId={props.projectId}
            projectName={props.projectName}
            clientId={props.clientId}
            onClientChange={props.onClientChange}
            onSourcesPersisted={props.onSourcesPersisted}
            textOverlays={props.textOverlays}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
