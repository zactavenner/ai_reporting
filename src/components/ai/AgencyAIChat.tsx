import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { 
  MessageCircle, 
  X, 
  Send, 
  Trash2, 
  Sparkles, 
  Mic, 
  MicOff,
  Paperclip,
  ChevronDown,
  Loader2,
  FileText,
  Image as ImageIcon,
  Film,
  Database
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAgencyAIAnalysis } from '@/hooks/useAgencyAIAnalysis';
import { Client } from '@/hooks/useClients';
import { AggregatedMetrics } from '@/hooks/useMetrics';
import { useMeetings } from '@/hooks/useMeetings';
import { TokenUsageBar, FULL_MODEL_OPTIONS, MODEL_LIMITS } from './TokenUsageBar';
import ReactMarkdown from 'react-markdown';

type AIModel = 'gemini-2.5-pro' | 'gemini-3-flash' | 'gemini-3-pro' | 'gpt-5';

interface AgencyAIChatProps {
  clients: Client[];
  clientMetrics: Record<string, AggregatedMetrics>;
  agencyMetrics: AggregatedMetrics;
}

const modelLabels: Record<AIModel, string> = {
  'gemini-2.5-pro': 'Gemini 2.5 Pro',
  'gemini-3-flash': 'Gemini 3 Flash',
  'gemini-3-pro': 'Gemini 3 Pro',
  'gpt-5': 'GPT-5',
};

const agencyQuickQuestions = [
  "Which client needs immediate attention?",
  "Compare all clients' CPL performance",
  "What's the agency-wide conversion rate?",
  "Identify our best performing client",
];

const clientQuickQuestions = [
  "Summarize this client's recent performance",
  "What are their key improvement areas?",
  "How is their funnel performing?",
  "What's their cost efficiency trend?",
];

export function AgencyAIChat({ clients, clientMetrics, agencyMetrics }: AgencyAIChatProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [model, setModel] = useState<AIModel>('gemini-2.5-pro');
  const [isRecording, setIsRecording] = useState(false);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [fullPortfolioMode, setFullPortfolioMode] = useState(true);
  const [tokenUsage, setTokenUsage] = useState({ used: 0, system: 0 });
  
  const { messages, isLoading, sendMessage, sendFullContextMessage, clearMessages } = useAgencyAIAnalysis();
  const { data: meetings = [] } = useMeetings();
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  
  const selectedClient = selectedClientId ? clients.find(c => c.id === selectedClientId) : null;

  // Filter meetings to last 7 days
  const recentMeetings = useMemo(() => {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    return meetings
      .filter(m => {
        if (!m.meeting_date) return false;
        const meetingDate = new Date(m.meeting_date);
        return meetingDate >= sevenDaysAgo;
      })
      .filter(m => !selectedClientId || m.client_id === selectedClientId)
      .slice(0, 10); // Limit to 10 most recent
  }, [meetings, selectedClientId]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  // Auto-detect current client broadcast by AgencyAIStudioTab / client detail pages
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { clientId?: string } | undefined;
      if (detail?.clientId) setSelectedClientId(detail.clientId);
    };
    window.addEventListener('agency:current-client', handler);
    return () => window.removeEventListener('agency:current-client', handler);
  }, []);

  // Build context based on selected client filter
  const buildContext = useCallback(() => {
    const filteredClients = selectedClientId 
      ? clients.filter(c => c.id === selectedClientId)
      : clients;
    
    const clientSummaries = filteredClients.map(client => {
      const metrics = clientMetrics[client.id];
      if (!metrics) return null;
      return {
        name: client.name,
        status: client.status,
        adSpend: metrics.totalAdSpend,
        leads: metrics.totalLeads,
        calls: metrics.totalCalls,
        showedCalls: metrics.showedCalls,
        costPerLead: metrics.costPerLead,
        costPerCall: metrics.costPerCall,
        fundedInvestors: metrics.fundedInvestors,
        fundedDollars: metrics.fundedDollars,
        costOfCapital: metrics.costOfCapital,
      };
    }).filter(Boolean);

    // If single client selected, use their metrics as totals
    const totals = selectedClientId && clientMetrics[selectedClientId]
      ? {
          totalAdSpend: clientMetrics[selectedClientId].totalAdSpend,
          totalLeads: clientMetrics[selectedClientId].totalLeads,
          totalCalls: clientMetrics[selectedClientId].totalCalls,
          showedCalls: clientMetrics[selectedClientId].showedCalls,
          costPerLead: clientMetrics[selectedClientId].costPerLead,
          costPerCall: clientMetrics[selectedClientId].costPerCall,
          fundedInvestors: clientMetrics[selectedClientId].fundedInvestors,
          fundedDollars: clientMetrics[selectedClientId].fundedDollars,
          costOfCapital: clientMetrics[selectedClientId].costOfCapital,
        }
      : {
          totalAdSpend: agencyMetrics.totalAdSpend,
          totalLeads: agencyMetrics.totalLeads,
          totalCalls: agencyMetrics.totalCalls,
          showedCalls: agencyMetrics.showedCalls,
          costPerLead: agencyMetrics.costPerLead,
          costPerCall: agencyMetrics.costPerCall,
          fundedInvestors: agencyMetrics.fundedInvestors,
          fundedDollars: agencyMetrics.fundedDollars,
          costOfCapital: agencyMetrics.costOfCapital,
        };

    // Build meeting summaries for AI context
    const meetingSummaries = recentMeetings.map(m => ({
      title: m.title,
      date: m.meeting_date,
      client: clients.find(c => c.id === m.client_id)?.name || 'Unassigned',
      summary: m.summary?.slice(0, 500) || null,
      actionItemsCount: Array.isArray(m.action_items) ? m.action_items.length : 0,
      duration: m.duration_minutes,
    }));

    return {
      agencyTotals: totals,
      clients: clientSummaries,
      focusedClient: selectedClient?.name || null,
      recentMeetings: meetingSummaries,
    };
  }, [clients, clientMetrics, agencyMetrics, selectedClientId, selectedClient, recentMeetings]);

  const handleSend = async () => {
    if ((!input.trim() && attachments.length === 0) || isLoading) return;
    
    const message = input.trim();
    const files = [...attachments];
    
    setInput('');
    setAttachments([]);

    if (fullPortfolioMode) {
      await sendFullContextMessage(
        message,
        messages,
        model,
        selectedClientId || 'all',
        (used, system) => setTokenUsage({ used, system }),
      );
    } else {
      const context = buildContext();
      const legacyModel = model === 'gpt-5' ? 'openai' as const : 'gemini' as const;
      await sendMessage(message, context, messages, legacyModel, files);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setAttachments(prev => [...prev, ...files]);
    e.target.value = '';
  };

  const handleRemoveAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        audioChunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        stream.getTracks().forEach(track => track.stop());
        
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = async () => {
          const base64Audio = reader.result as string;
          
          try {
            const response = await fetch(
              `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/transcribe-audio`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
                },
                body: JSON.stringify({ audio: base64Audio }),
              }
            );
            
            if (response.ok) {
              const { text } = await response.json();
              if (text) {
                setInput(prev => prev ? `${prev} ${text}` : text);
              }
            } else {
              const audioFile = new File([audioBlob], 'voice-message.webm', { type: 'audio/webm' });
              setAttachments(prev => [...prev, audioFile]);
            }
          } catch (error) {
            console.error('Transcription failed:', error);
            const audioFile = new File([audioBlob], 'voice-message.webm', { type: 'audio/webm' });
            setAttachments(prev => [...prev, audioFile]);
          }
        };
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error('Failed to start recording:', err);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const getFileIcon = (file: File) => {
    if (file.type.startsWith('image/')) return <ImageIcon className="h-3 w-3" />;
    if (file.type.startsWith('video/')) return <Film className="h-3 w-3" />;
    if (file.type.startsWith('audio/')) return <Mic className="h-3 w-3" />;
    return <FileText className="h-3 w-3" />;
  };

  return (
    <>
      {/* Floating Chat Button */}
      <Button
        onClick={() => setIsOpen(true)}
        className={cn(
          'fixed bottom-6 right-6 h-14 w-14 rounded-full shadow-lg z-50',
          'bg-primary hover:bg-primary/90',
          isOpen && 'hidden'
        )}
        size="icon"
      >
        <Sparkles className="h-6 w-6" />
      </Button>

      {/* Chat Panel */}
      <div
        className={cn(
          'fixed bottom-6 right-6 w-[450px] h-[600px] bg-card border-2 border-border rounded-lg shadow-xl z-50 flex flex-col',
          'transition-all duration-200 ease-in-out',
          isOpen ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none'
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <span className="font-semibold">
              {selectedClient ? `${selectedClient.name} AI` : 'Agency AI Analyst'}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {/* Client Filter */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 text-xs gap-1 max-w-[120px]">
                  <span className="truncate">{selectedClient?.name || 'All Clients'}</span>
                  <ChevronDown className="h-3 w-3 shrink-0" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-[300px] overflow-y-auto">
                <DropdownMenuItem onClick={() => setSelectedClientId(null)}>
                  All Clients
                </DropdownMenuItem>
                <div className="h-px bg-border my-1" />
                {clients.filter(c => c.status === 'active').map(client => (
                  <DropdownMenuItem 
                    key={client.id} 
                    onClick={() => setSelectedClientId(client.id)}
                  >
                    {client.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            {/* Model Selector */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 text-xs gap-1">
                  {modelLabels[model]}
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {FULL_MODEL_OPTIONS.map((opt) => (
                  <DropdownMenuItem key={opt.value} onClick={() => setModel(opt.value as AIModel)}>
                    {opt.label} ({opt.badge})
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="ghost"
              size="icon"
              onClick={clearMessages}
              className="h-8 w-8"
              title="Clear chat"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsOpen(false)}
              className="h-8 w-8"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Token Usage Bar */}
        <TokenUsageBar usedTokens={tokenUsage.used} systemTokens={tokenUsage.system} model={model} />

        {/* Messages - iMessage style */}
        <ScrollArea className="flex-1 p-4" ref={scrollRef}>
          {messages.length === 0 ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground text-center">
                {selectedClient 
                  ? `Ask me anything about ${selectedClient.name}'s performance.`
                  : `Ask me anything about your agency performance across all ${clients.length} clients.`
                }
              </p>
              <div className="grid grid-cols-2 gap-2">
                {(selectedClient ? clientQuickQuestions : agencyQuickQuestions).map((q) => (
                  <Button
                    key={q}
                    variant="outline"
                    size="sm"
                    className="text-xs h-auto py-2 px-3 whitespace-normal text-left"
                    onClick={() => {
                      if (!isLoading) {
                        const context = buildContext();
                        const legacyModel = model === 'gpt-5' ? 'openai' as const : 'gemini' as const;
                        sendMessage(q, context, messages, legacyModel);
                      }
                    }}
                    disabled={isLoading}
                  >
                    {q}
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={cn(
                    'flex',
                    msg.role === 'user' ? 'justify-end' : 'justify-start'
                  )}
                >
                  <div
                    className={cn(
                      'max-w-[85%] px-4 py-2 rounded-2xl text-sm',
                      msg.role === 'user'
                        ? 'bg-blue-500 text-white rounded-br-md'
                        : 'bg-muted text-foreground rounded-bl-md'
                    )}
                  >
                    {msg.attachments && msg.attachments.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-2">
                        {msg.attachments.map((att, j) => (
                          <span key={j} className="text-xs bg-background/20 px-2 py-0.5 rounded flex items-center gap-1">
                            {getFileIcon(att)}
                            {att.name.slice(0, 20)}
                          </span>
                        ))}
                      </div>
                    )}
                    {msg.role === 'assistant' ? (
                      <div className="prose prose-sm dark:prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
                        <ReactMarkdown>{msg.content}</ReactMarkdown>
                      </div>
                    ) : (
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                    )}
                  </div>
                </div>
              ))}
              {isLoading && messages[messages.length - 1]?.role === 'user' && (
                <div className="flex justify-start">
                  <div className="bg-muted px-4 py-2 rounded-2xl rounded-bl-md">
                    <div className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span className="text-sm text-muted-foreground">Analyzing...</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </ScrollArea>

        {/* Attachments Preview */}
        {attachments.length > 0 && (
          <div className="px-4 py-2 border-t border-border">
            <div className="flex flex-wrap gap-2">
              {attachments.map((file, i) => (
                <div key={i} className="flex items-center gap-1 bg-muted px-2 py-1 rounded text-xs">
                  {getFileIcon(file)}
                  <span className="max-w-20 truncate">{file.name}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-4 w-4"
                    onClick={() => handleRemoveAttachment(i)}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Input */}
        <div className="p-4 border-t border-border">
          <div className="flex gap-2">
            <input
              type="file"
              ref={fileInputRef}
              className="hidden"
              multiple
              accept="image/*,video/*,.pdf,.doc,.docx,.txt,.png"
              onChange={handleFileSelect}
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 shrink-0"
              onClick={() => fileInputRef.current?.click()}
              title="Attach files (PDF, PNG, TXT, etc.)"
            >
              <Paperclip className="h-4 w-4" />
            </Button>
            <Button
              variant={isRecording ? 'destructive' : 'ghost'}
              size="icon"
              className="h-10 w-10 shrink-0"
              onClick={isRecording ? stopRecording : startRecording}
              title={isRecording ? 'Stop recording' : 'Voice message'}
            >
              {isRecording ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </Button>
            <Input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about any client..."
              disabled={isLoading}
              className="flex-1"
            />
            <Button
              onClick={handleSend}
              disabled={((!input.trim() && attachments.length === 0) || isLoading)}
              size="icon"
              className="h-10 w-10 shrink-0 bg-blue-500 hover:bg-blue-600"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-2 text-center">
            Upload files, record voice, or type your question
          </p>
        </div>
      </div>
    </>
  );
}
