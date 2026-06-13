import { useState, useRef, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Slider } from '@/components/ui/slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Upload, Loader2, Volume2, ImagePlus, Sparkles, Wand2, Smartphone, Mic, Square } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { AvatarStyle } from '@/types';
import {
  useAvatarGeneration,
  ETHNICITY_OPTIONS,
  BACKGROUND_PRESETS,
  STYLE_OPTIONS,
  STYLE_PRESETS,
  REALISM_LEVELS,
  CAMERA_DEVICE_OPTIONS,
  ASPECT_RATIO_OPTIONS,
} from '@/hooks/useAvatarGeneration';

// Top ElevenLabs voices
const ELEVENLABS_VOICES = [
  { id: '', name: 'No Voice' },
  { id: 'CwhRBWXzGAHq8TQ4Fs17', name: 'Roger (Male)' },
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah (Female)' },
  { id: 'FGY2WhTYpPnrIDTdsKH5', name: 'Laura (Female)' },
  { id: 'IKne3meq5aSn9XLyUdCD', name: 'Charlie (Male)' },
  { id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George (Male)' },
  { id: 'N2lVS1w4EtoT3dr4eOWO', name: 'Callum (Male)' },
  { id: 'SAz9YHcvj6GT2YYXdXww', name: 'River (Non-binary)' },
  { id: 'TX3LPaxmHKxFdv7VOQHJ', name: 'Liam (Male)' },
  { id: 'Xb7hH8MSUJpSbSDYk0k2', name: 'Alice (Female)' },
  { id: 'XrExE9yKIg1WjnnlVkGX', name: 'Matilda (Female)' },
  { id: 'bIHbv24MWmeRgasZH58o', name: 'Will (Male)' },
  { id: 'cgSgspJ2msm6clMCkdW9', name: 'Jessica (Female)' },
  { id: 'cjVigY5qzO86Huf0OWal', name: 'Eric (Male)' },
  { id: 'iP95p4xoKVk53GoZ742B', name: 'Chris (Male)' },
  { id: 'nPczCjzI2devNBz1zQrb', name: 'Brian (Male)' },
  { id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel (Male)' },
  { id: 'pFZP5JQG7iQjIQuC4Bku', name: 'Lily (Female)' },
  { id: 'pqHfZKP75CvOlQylNhV4', name: 'Bill (Male)' },
];

// Age range options
const AGE_RANGE_OPTIONS = [
  { id: '18-25', name: '18-25' },
  { id: '26-35', name: '26-35' },
  { id: '36-45', name: '36-45' },
  { id: '46-55', name: '46-55' },
  { id: '55+', name: '55+' },
];

interface CreateAvatarDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId?: string;
  isStock?: boolean;
}

export function CreateAvatarDialog({ open, onOpenChange, clientId, isStock = false }: CreateAvatarDialogProps) {
  // Shared state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [style, setStyle] = useState<AvatarStyle>('ugc');
  const [voiceId, setVoiceId] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  
  // Upload state
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Generation state
  const [mode, setMode] = useState<'upload' | 'generate'>('generate');
  const [gender, setGender] = useState('female');
  const [ageRange, setAgeRange] = useState('26-35');
  const [ethnicity, setEthnicity] = useState('caucasian');
  const [background, setBackground] = useState('podcast');
  const [customPrompt, setCustomPrompt] = useState('');
  const [generatedImageUrl, setGeneratedImageUrl] = useState<string | null>(null);
  
  // New Nano Banana Pro controls
  const [cameraDevice, setCameraDevice] = useState<'iphone' | 'samsung'>('iphone');
  const [aspectRatio, setAspectRatio] = useState<'9:16' | '6:19'>('9:16');
  const [realism, setRealism] = useState(0.7);
  const [wideAngle, setWideAngle] = useState(0.5);
  const [realismLevel, setRealismLevel] = useState<string>('ultra-realistic');
  const [stylePreset, setStylePreset] = useState<string>('');

  const { generateAvatar, isGenerating, hasApiKey } = useAvatarGeneration();
  const queryClient = useQueryClient();

  // Voice + AI enhance
  const [isRecording, setIsRecording] = useState(false);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const enhancePrompt = useCallback(async (audioBase64?: string) => {
    setIsEnhancing(true);
    try {
      const { data, error } = await supabase.functions.invoke('enhance-avatar-prompt', {
        body: { audioBase64, audioFormat: 'webm', text: customPrompt || undefined },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Enhance failed');
      setCustomPrompt(data.enhancedPrompt);
      toast.success('Prompt enhanced — review and generate');
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || 'Failed to enhance prompt');
    } finally {
      setIsEnhancing(false);
    }
  }, [customPrompt]);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      audioChunksRef.current = [];
      const mr = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm',
      });
      mediaRecorderRef.current = mr;
      mr.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mr.start(1000);
      setIsRecording(true);
      setRecordingTime(0);
      timerRef.current = setInterval(() => setRecordingTime((p) => p + 1), 1000);
    } catch (e) {
      console.error(e);
      toast.error('Microphone access denied');
    }
  }, []);

  const stopRecording = useCallback(async () => {
    const mr = mediaRecorderRef.current;
    if (!mr || mr.state === 'inactive') return;
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    await new Promise<void>((resolve) => {
      mr.onstop = async () => {
        setIsRecording(false);
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        audioChunksRef.current = [];
        if (blob.size < 1000) { toast.error('Recording too short'); resolve(); return; }
        const reader = new FileReader();
        reader.onloadend = async () => {
          const base64 = (reader.result as string).split(',')[1];
          await enhancePrompt(base64);
          resolve();
        };
        reader.readAsDataURL(blob);
      };
      mr.stop();
    });
  }, [enhancePrompt]);

  const toggleRecording = () => { isRecording ? stopRecording() : startRecording(); };

  const createMutation = useMutation({
    mutationFn: async () => {
      const finalImageUrl = mode === 'generate' ? generatedImageUrl : imageUrl;
      
      if (!name || !finalImageUrl) {
        throw new Error('Name and image are required');
      }

      const { data, error } = await supabase
        .from('avatars')
        .insert({
          client_id: isStock ? null : (clientId || null),
          name,
          description: description || null,
          gender: gender || null,
          age_range: ageRange || null,
          ethnicity: ethnicity || null,
          style,
          image_url: finalImageUrl,
          is_stock: isStock,
          elevenlabs_voice_id: voiceId || null,
          looks_count: 1,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['avatars'] });
      toast.success('Avatar created successfully');
      resetForm();
      onOpenChange(false);
    },
    onError: (error) => {
      toast.error('Failed to create avatar');
      console.error(error);
    },
  });

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      const fileExt = file.name.split('.').pop();
      const folder = isStock ? 'stock-avatars' : `client-avatars/${clientId || 'unassigned'}`;
      const filePath = `${folder}/${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('avatars')
        .getPublicUrl(filePath);

      setImageUrl(publicUrl);
    } catch (error) {
      console.error('Upload error:', error);
      toast.error('Failed to upload image');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleGenerate = async () => {
    const result = await generateAvatar({
      gender,
      ageRange,
      ethnicity,
      style,
      background,
      customPrompt,
      isStock,
      clientId,
      cameraDevice,
      aspectRatio,
      realism,
      wideAngle,
      realism_level: realismLevel as any || undefined,
      style_preset: stylePreset as any || undefined,
    });

    if (result.success && result.imageUrl) {
      setGeneratedImageUrl(result.imageUrl);
      // Auto-generate a name if empty
      if (!name) {
        const ethnicityName = ETHNICITY_OPTIONS.find(e => e.id === ethnicity)?.name || '';
        const genderName = gender.charAt(0).toUpperCase() + gender.slice(1);
        setName(`${genderName} ${ethnicityName.split('/')[0]} Avatar`);
      }
    }
  };

  const resetForm = () => {
    setName('');
    setDescription('');
    setGender('female');
    setAgeRange('26-35');
    setEthnicity('caucasian');
    setStyle('ugc');
    setVoiceId('');
    setImageUrl('');
    setBackground('podcast');
    setCustomPrompt('');
    setGeneratedImageUrl(null);
    setMode('generate');
    setCameraDevice('iphone');
    setAspectRatio('9:16');
    setRealism(0.7);
    setWideAngle(0.5);
  };

  const currentImage = mode === 'generate' ? generatedImageUrl : imageUrl;
  const canCreate = name && currentImage;
  const currentAspectDimensions = ASPECT_RATIO_OPTIONS.find(a => a.id === aspectRatio)?.dimensions || '768 × 1024 px';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create New Avatar</DialogTitle>
        </DialogHeader>

        <Tabs value={mode} onValueChange={(v) => setMode(v as 'upload' | 'generate')}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="generate" className="gap-2">
              <Sparkles className="h-4 w-4" />
              Generate
            </TabsTrigger>
            <TabsTrigger value="upload" className="gap-2">
              <Upload className="h-4 w-4" />
              Upload
            </TabsTrigger>
          </TabsList>

          {/* Upload Tab */}
          <TabsContent value="upload" className="space-y-5 pt-4">
            <div className="flex justify-center">
              {imageUrl ? (
                <div className="relative group">
                  <div className="w-40 h-52 rounded-2xl overflow-hidden border-2 border-primary/20">
                    <img
                      src={imageUrl}
                      alt="Avatar preview"
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="absolute bottom-2 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Change
                  </Button>
                </div>
              ) : (
                <button
                  className="w-40 h-52 rounded-2xl border-2 border-dashed flex flex-col items-center justify-center text-muted-foreground hover:text-foreground hover:border-foreground/50 transition-colors bg-muted/50"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading}
                >
                  {isUploading ? (
                    <Loader2 className="h-8 w-8 animate-spin" />
                  ) : (
                    <>
                      <ImagePlus className="h-10 w-10 mb-2" />
                      <span className="text-sm font-medium">Upload Photo</span>
                      <span className="text-xs text-muted-foreground mt-1">
                        3:4 Portrait
                      </span>
                    </>
                  )}
                </button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileUpload}
              />
            </div>
          </TabsContent>

          {/* Generate Tab - Enhanced with Nano Banana Pro controls */}
          <TabsContent value="generate" className="space-y-5 pt-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Left: Controls */}
              <div className="space-y-5">

                {/* Camera Device Selection */}
                <div>
                  <Label className="text-xs mb-2 block flex items-center gap-2">
                    <Smartphone className="h-3.5 w-3.5" />
                    Camera Device
                  </Label>
                  <div className="flex gap-2">
                    {CAMERA_DEVICE_OPTIONS.map((cam) => (
                      <button
                        key={cam.id}
                        onClick={() => setCameraDevice(cam.id as 'iphone' | 'samsung')}
                        className={cn(
                          'flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all border',
                          cameraDevice === cam.id
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-muted hover:bg-muted/80 border-transparent'
                        )}
                      >
                        {cam.name}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Aspect Ratio */}
                <div>
                  <Label className="text-xs mb-2 block">Size</Label>
                  <div className="flex gap-2">
                    {ASPECT_RATIO_OPTIONS.map((ar) => (
                      <button
                        key={ar.id}
                        onClick={() => setAspectRatio(ar.id as '9:16' | '6:19')}
                        className={cn(
                          'flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all border',
                          aspectRatio === ar.id
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-muted hover:bg-muted/80 border-transparent'
                        )}
                      >
                        {ar.name}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Realism Slider */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label className="text-xs">Realism</Label>
                    <span className="text-xs text-muted-foreground">{Math.round(realism * 100)}%</span>
                  </div>
                  <Slider
                    value={[realism]}
                    onValueChange={(v) => setRealism(v[0])}
                    min={0}
                    max={1}
                    step={0.05}
                    className="w-full"
                  />
                  <div className="flex justify-between mt-1">
                    <span className="text-xs text-muted-foreground">Polished</span>
                    <span className="text-xs text-muted-foreground">Raw</span>
                  </div>
                </div>

                {/* Wide Angle Slider */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label className="text-xs">Focal Length</Label>
                    <span className="text-xs text-muted-foreground">{wideAngle < 0.5 ? '85mm' : wideAngle < 1 ? '35mm' : '24mm'}</span>
                  </div>
                  <Slider
                    value={[wideAngle]}
                    onValueChange={(v) => setWideAngle(v[0])}
                    min={0}
                    max={1.5}
                    step={0.1}
                    className="w-full"
                  />
                  <div className="flex justify-between mt-1">
                    <span className="text-xs text-muted-foreground">Portrait</span>
                    <span className="text-xs text-muted-foreground">Wide</span>
                  </div>
                </div>

                {/* Demographics */}
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <Label className="text-xs">Gender</Label>
                    <Select value={gender} onValueChange={setGender}>
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="male">Male</SelectItem>
                        <SelectItem value="female">Female</SelectItem>
                        <SelectItem value="non-binary">Non-binary</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Age</Label>
                    <Select value={ageRange} onValueChange={setAgeRange}>
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {AGE_RANGE_OPTIONS.map((age) => (
                          <SelectItem key={age.id} value={age.id}>
                            {age.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Ethnicity</Label>
                    <Select value={ethnicity} onValueChange={setEthnicity}>
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ETHNICITY_OPTIONS.map((eth) => (
                          <SelectItem key={eth.id} value={eth.id}>
                            {eth.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Style Selection */}
                <div>
                  <Label className="text-xs mb-2 block">Style</Label>
                  <div className="flex flex-wrap gap-2">
                    {STYLE_OPTIONS.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => setStyle(s.id as AvatarStyle)}
                        className={cn(
                          'px-3 py-1.5 rounded-full text-xs font-medium transition-all border',
                          style === s.id
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-muted hover:bg-muted/80 border-transparent'
                        )}
                      >
                        {s.name}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Style Preset */}
                <div>
                  <Label className="text-xs mb-2 block">Style Preset</Label>
                  <Select value={stylePreset || 'none'} onValueChange={(v) => setStylePreset(v === 'none' ? '' : v)}>
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="None" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None — default</SelectItem>
                      {STYLE_PRESETS.map((sp) => (
                        <SelectItem key={sp.id} value={sp.id}>
                          {sp.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Realism Level */}
                <div>
                  <Label className="text-xs mb-2 block">Realism Level</Label>
                  <div className="flex gap-2">
                    {REALISM_LEVELS.map((rl) => (
                      <button
                        key={rl.id}
                        onClick={() => setRealismLevel(rl.id)}
                        className={cn(
                          'flex-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-all border',
                          realismLevel === rl.id
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-muted hover:bg-muted/80 border-transparent'
                        )}
                      >
                        {rl.name}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Background Selection */}
                <div>
                  <Label className="text-xs mb-2 block">Background</Label>
                  <div className="flex flex-wrap gap-2">
                    {BACKGROUND_PRESETS.map((bg) => (
                      <button
                        key={bg.id}
                        onClick={() => setBackground(bg.id)}
                        className={cn(
                          'px-3 py-1.5 rounded-full text-xs font-medium transition-all border',
                          background === bg.id
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-muted hover:bg-muted/80 border-transparent'
                        )}
                      >
                        {bg.name}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Custom Prompt */}
                <div>
                  <Label className="text-xs">Custom Details (optional)</Label>
                  <Textarea
                    value={customPrompt}
                    onChange={(e) => setCustomPrompt(e.target.value)}
                    placeholder="Add specific details like hair color, accessories..."
                    rows={2}
                    className="text-sm"
                  />
                </div>

                {/* Info footer */}
                <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t">
                  <span>{currentAspectDimensions}</span>
                  <span>Nano Banana Pro</span>
                </div>
              </div>

              {/* Right: Preview */}
              <div className="flex flex-col items-center justify-center">
                {generatedImageUrl ? (
                  <div className="relative group">
                    <div className={cn(
                      "rounded-2xl overflow-hidden border-2 border-primary/20",
                      aspectRatio === '9:16' ? 'w-36 h-64' : 'w-40 h-52'
                    )}>
                      <img
                        src={generatedImageUrl}
                        alt="Generated avatar"
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="absolute bottom-2 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity gap-1"
                      onClick={handleGenerate}
                      disabled={isGenerating}
                    >
                      <Wand2 className="h-3 w-3" />
                      Regenerate
                    </Button>
                  </div>
                ) : (
                  <button
                    className={cn(
                      "rounded-2xl border-2 border-dashed flex flex-col items-center justify-center text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors bg-gradient-to-br from-primary/5 to-primary/10",
                      aspectRatio === '9:16' ? 'w-36 h-64' : 'w-40 h-52'
                    )}
                    onClick={handleGenerate}
                    disabled={isGenerating}
                  >
                    {isGenerating ? (
                      <>
                        <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        <span className="text-sm font-medium mt-2">Generating...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-10 w-10 mb-2 text-primary" />
                        <span className="text-sm font-medium">Generate Avatar</span>
                        <span className="text-xs text-muted-foreground mt-1">
                          Nano Banana Pro
                        </span>
                      </>
                    )}
                  </button>
                )}

                {/* Generate Button */}
                {hasApiKey && (
                  <Button
                    onClick={handleGenerate}
                    disabled={isGenerating}
                    className="w-full mt-4 gap-2"
                  >
                    {isGenerating ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Sparkles className="h-4 w-4" />
                    )}
                    {isGenerating ? 'Generating...' : 'Generate'}
                  </Button>
                )}
              </div>
            </div>
          </TabsContent>
        </Tabs>

        {/* Shared Fields */}
        <div className="space-y-4 pt-2 border-t mt-4">
          {/* Name */}
          <div>
            <Label htmlFor="name">Name *</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Sarah, Marcus, Araj"
            />
          </div>

          {/* Description */}
          <div>
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description for prompting context..."
              rows={2}
            />
          </div>

          {/* Voice Selection */}
          <div>
            <Label className="flex items-center gap-2">
              <Volume2 className="h-4 w-4" />
              ElevenLabs Voice
            </Label>
            <Select value={voiceId} onValueChange={setVoiceId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a voice..." />
              </SelectTrigger>
              <SelectContent>
                {ELEVENLABS_VOICES.map((voice) => (
                  <SelectItem key={voice.id || 'none'} value={voice.id || 'none'}>
                    {voice.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
              Voice for lip-sync video generation
            </p>
          </div>
        </div>

        <DialogFooter className="pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={!canCreate || createMutation.isPending}
          >
            {createMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : null}
            Create Avatar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
