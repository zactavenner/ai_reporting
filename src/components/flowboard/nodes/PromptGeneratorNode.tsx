import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { MessageSquare, Check, Loader2, AlertCircle, Copy } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import type { PromptGeneratorNode as PromptGeneratorNodeType, PromptModel } from '@/types/flowboard';
import { cn } from '@/lib/utils';
import { NodeDeleteButton } from './NodeDeleteButton';
import { toast } from 'sonner';

type PromptGeneratorNodeProps = NodeProps<PromptGeneratorNodeType>;

const MODELS: { value: PromptModel; label: string }[] = [
  { value: 'nvidia/nemotron-3-ultra-550b-a55b:free', label: 'Nemotron 3 Ultra' },
  { value: 'gpt-5-mini', label: 'GPT 5 Mini' },
  { value: 'gpt-5', label: 'GPT 5' },
  { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
];

export const PromptGeneratorNode = memo(({ id, data, selected }: PromptGeneratorNodeProps) => {
  const isCompleted = data.status === 'completed';
  const isGenerating = data.status === 'generating';
  const isFailed = data.status === 'failed';

  const handleCopyOutput = () => {
    if (data.outputPrompt) {
      navigator.clipboard.writeText(data.outputPrompt);
      toast.success('Copied to clipboard');
    }
  };

  return (
    <div 
      className={cn(
        "w-72 rounded-xl border bg-card shadow-lg transition-all relative group/node",
        selected ? "ring-2 ring-primary border-primary" : "border-border",
        isCompleted && "border-emerald-500/50"
      )}
    >
      <NodeDeleteButton nodeId={id} onDelete={data.onDeleteNode} />
      {/* Input Handle - for image */}
      <Handle
        type="target"
        position={Position.Left}
        id="image-input"
        className="!w-3 !h-3 !bg-primary !border-2 !border-background !top-1/2"
      />

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30 rounded-t-xl">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-accent text-accent-foreground">
            <MessageSquare className="h-4 w-4" />
          </div>
          <span className="font-medium text-sm text-foreground">GPT Prompt</span>
        </div>
        {isCompleted && (
          <div className="p-1 rounded-full bg-emerald-500/20">
            <Check className="h-3.5 w-3.5 text-emerald-400" />
          </div>
        )}
        {isGenerating && (
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
        )}
        {isFailed && (
          <AlertCircle className="h-4 w-4 text-destructive" />
        )}
      </div>

      {/* Content */}
      <div className="p-4 space-y-3">
        {/* Model */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Model</label>
          <Select value={data.model} disabled>
            <SelectTrigger className="h-8 text-xs nodrag">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODELS.map((model) => (
                <SelectItem key={model.value} value={model.value}>{model.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Context */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
            <span className="text-primary">●</span> Context
          </label>
          <Textarea
            value={data.context}
            placeholder="System instructions..."
            className="min-h-[40px] text-xs resize-none nodrag"
            readOnly
          />
        </div>

        {/* Input Prompt */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
            <span className="text-primary">●</span> Prompt *
          </label>
          <Textarea
            value={data.inputPrompt}
            placeholder="User input..."
            className="min-h-[40px] text-xs resize-none nodrag"
            readOnly
          />
        </div>

        {/* Credits indicator */}
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="text-primary">🔵</span>
          <span>0.01 credits/request</span>
        </div>

        {/* Input image preview if connected */}
        {data.inputImageUrl && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Connected Image</label>
            <div className="relative aspect-square w-16 rounded-lg overflow-hidden bg-muted">
              <img 
                src={data.inputImageUrl} 
                alt="Input" 
                className="w-full h-full object-cover"
              />
            </div>
          </div>
        )}

        {/* Generated Output */}
        {data.outputPrompt && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-muted-foreground">Generated Output</label>
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-6 w-6 nodrag"
                onClick={handleCopyOutput}
              >
                <Copy className="h-3 w-3" />
              </Button>
            </div>
            <div className="bg-muted/50 rounded-lg p-2 text-xs text-foreground max-h-24 overflow-y-auto">
              {data.outputPrompt}
            </div>
          </div>
        )}

        {/* Error display */}
        {data.error && (
          <div className="text-xs text-destructive bg-destructive/10 rounded-lg p-2">
            {data.error}
          </div>
        )}
      </div>

      {/* Output Handle */}
      <Handle
        type="source"
        position={Position.Right}
        id="text-output"
        className="!w-3 !h-3 !bg-primary !border-2 !border-background"
      />
    </div>
  );
});

PromptGeneratorNode.displayName = 'PromptGeneratorNode';
