import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { 
  Send, Loader2, Plus, Trash2, Bot, X, 
  Paperclip, ChevronLeft, ChevronRight, Sparkles, Zap, Database
} from 'lucide-react';
import { format } from 'date-fns';
import ReactMarkdown from 'react-markdown';
import { 
  useAIHubConversations, 
  useAIHubMessages, 
  useCreateAIHubConversation, 
  useDeleteAIHubConversation,
  useAddAIHubMessage,
} from '@/hooks/useAIHubConversations';
import { useGPTKnowledgeLinks } from '@/hooks/useCustomGPTs';
import { useKnowledgeDocuments } from '@/hooks/useKnowledgeBase';
import { useGPTFiles } from '@/hooks/useGPTFiles';
import { CustomGPT } from '@/hooks/useCustomGPTs';
import { Client } from '@/hooks/useClients';
import { AggregatedMetrics } from '@/hooks/useMetrics';
import { AIToolsMenu, TOOL_MODES, ToolMode } from './AIToolsMenu';
import { TokenUsageBar, FULL_MODEL_OPTIONS, MODEL_LIMITS } from './TokenUsageBar';
import { cn } from '@/lib/utils';

interface AIHubChatProps {
  selectedGPT: CustomGPT | null;
  onClearGPT: () => void;
  clients: Client[];
  clientMetrics: Record<string, AggregatedMetrics>;
  agencyMetrics: AggregatedMetrics;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

type AIModel = 'nvidia/nemotron-3-ultra:free' | 'gemini-2.5-pro' | 'gemini-3-flash' | 'gemini-3-pro' | 'gpt-5' | 'grok';

const QUICK_ACTIONS = [
  { label: 'Compare all clients', prompt: 'Compare the performance of all active clients and identify the top performer.' },
  { label: 'Top performer this week', prompt: 'Which client has the best performance this week and why?' },
  { label: 'Budget recommendations', prompt: 'Based on current metrics, provide budget optimization recommendations for all clients.' },
];

export function AIHubChat({ selectedGPT, onClearGPT, clients, clientMetrics, agencyMetrics }: AIHubChatProps) {
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [localMessages, setLocalMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [model, setModel] = useState<AIModel>('nvidia/nemotron-3-ultra:free');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [activeTool, setActiveTool] = useState<ToolMode | null>(null);
  const [selectedClientFilter, setSelectedClientFilter] = useState<string>('all');
  const [fullPortfolioMode, setFullPortfolioMode] = useState(true);
  const [tokenUsage, setTokenUsage] = useState({ used: 0, system: 0 });
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: conversations = [] } = useAIHubConversations(selectedGPT?.id);
  const { data: dbMessages = [] } = useAIHubMessages(selectedConversationId || undefined);
  const createConversation = useCreateAIHubConversation();
  const deleteConversation = useDeleteAIHubConversation();
  const addMessage = useAddAIHubMessage();

  const { data: gptLinks = [] } = useGPTKnowledgeLinks(selectedGPT?.id);
  const { data: documents = [] } = useKnowledgeDocuments();
  const { data: gptFiles = [] } = useGPTFiles(selectedGPT?.id);

  const linkedDocs = selectedGPT 
    ? documents.filter(d => gptLinks.some(l => l.document_id === d.id))
    : documents;

  useEffect(() => {
    if (dbMessages.length > 0) {
      setLocalMessages(dbMessages.map(m => ({ 
        role: m.role as 'user' | 'assistant', 
        content: m.content 
      })));
    } else {
      setLocalMessages([]);
    }
  }, [dbMessages]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [localMessages]);

  // Estimate local token usage for conversation messages
  useEffect(() => {
    const convTokens = localMessages.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0);
    setTokenUsage(prev => ({ ...prev, used: prev.system + convTokens }));
  }, [localMessages]);

  const handleNewConversation = async () => {
    const conv = await createConversation.mutateAsync({
      gptId: selectedGPT?.id,
      title: selectedGPT ? `Chat with ${selectedGPT.name}` : 'New Chat',
    });
    setSelectedConversationId(conv.id);
    setLocalMessages([]);
    setTokenUsage({ used: 0, system: 0 });
  };

  const handleSelectTool = (tool: ToolMode) => {
    setActiveTool(activeTool?.id === tool.id ? null : tool);
  };

  const buildSystemPrompt = () => {
    let prompt = selectedGPT?.system_prompt || 
      'You are an expert advertising agency AI assistant. Help analyze performance data, provide insights, and assist with strategy.';

    if (activeTool) {
      prompt += `\n\n[TOOL MODE: ${activeTool.name}]\n${activeTool.prompt}`;
    }

    if (selectedGPT && gptFiles.length > 0) {
      prompt += '\n\nYou have access to these GPT-specific data sources:\n';
      gptFiles.forEach(file => {
        if (file.content) {
          prompt += `\n--- ${file.name} ---\n${file.content}\n`;
        } else if (file.website_url) {
          prompt += `\n- ${file.name}: ${file.website_url}\n`;
        } else if (file.file_url) {
          prompt += `\n- ${file.name}: [File uploaded]\n`;
        }
      });
    }

    if (linkedDocs.length > 0) {
      prompt += '\n\nYou have access to the following knowledge base documents:\n';
      linkedDocs.forEach(doc => {
        if (doc.extracted_text || doc.content) {
          prompt += `\n--- ${doc.name} ---\n${doc.extracted_text || doc.content}\n`;
        } else if (doc.website_url) {
          prompt += `\n- ${doc.name}: ${doc.website_url}\n`;
        }
      });
    }

    if (selectedClientFilter !== 'all') {
      const client = clients.find(c => c.id === selectedClientFilter);
      const metrics = clientMetrics[selectedClientFilter];
      if (client && metrics) {
        prompt += `\n\nContext: Analyzing ${client.name} specifically.
Client Metrics:
- Ad Spend: $${metrics.totalAdSpend?.toLocaleString() || 0}
- Leads: ${metrics.totalLeads || 0}
- Calls: ${metrics.totalCalls || 0}
- Shows: ${metrics.showedCalls || 0}
- Cost per Lead: $${metrics.costPerLead?.toFixed(2) || 0}
- Funded Investors: ${metrics.fundedInvestors || 0}
- Funded Dollars: $${metrics.fundedDollars?.toLocaleString() || 0}`;
      }
    } else {
      prompt += `\n\nCurrent Agency Metrics:
- Total Ad Spend: $${agencyMetrics.totalAdSpend?.toLocaleString() || 0}
- Total Leads: ${agencyMetrics.totalLeads || 0}
- Total Calls: ${agencyMetrics.totalCalls || 0}
- Shows: ${agencyMetrics.showedCalls || 0}
- Cost per Lead: $${agencyMetrics.costPerLead?.toFixed(2) || 0}
- Funded Investors: ${agencyMetrics.fundedInvestors || 0}
- Funded Dollars: $${agencyMetrics.fundedDollars?.toLocaleString() || 0}

Active Clients: ${clients.filter(c => c.status === 'active').map(c => c.name).join(', ')}`;
    }

    return prompt;
  };

  const handleSend = async (overrideInput?: string) => {
    const messageText = overrideInput || input.trim();
    if (!messageText && attachments.length === 0) return;
    if (isLoading) return;

    let conversationId = selectedConversationId;
    if (!conversationId) {
      const conv = await createConversation.mutateAsync({
        gptId: selectedGPT?.id,
        title: messageText.slice(0, 50) || 'New Chat',
      });
      conversationId = conv.id;
      setSelectedConversationId(conv.id);
    }

    const userMessage = messageText || `[Attached ${attachments.length} file(s)]`;
    const newMessages: Message[] = [...localMessages, { role: 'user', content: userMessage }];
    setLocalMessages(newMessages);
    setInput('');
    setIsLoading(true);

    await addMessage.mutateAsync({
      conversationId,
      role: 'user',
      content: userMessage,
    });

    let assistantContent = '';

    try {
      const fileContents: { name: string; type: string; content: string }[] = [];
      for (const file of attachments) {
        const content = await fileToBase64(file);
        fileContents.push({ name: file.name, type: file.type, content });
      }
      setAttachments([]);

      let response: Response;

      if (fullPortfolioMode && !selectedGPT) {
        // Use the full-context edge function
        response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-agent-full-context`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
            },
            body: JSON.stringify({
              messages: newMessages.map(m => ({ role: m.role, content: m.content })),
              model,
              clientFilter: selectedClientFilter,
            }),
          }
        );
      } else {
        // Legacy: use ai-analysis
        const modelMap: Record<string, string> = {
          'gemini-2.5-pro': 'gemini',
          'gemini-3-flash': 'gemini',
          'gemini-3-pro': 'gemini-pro',
          'gpt-5': 'openai',
        };
        response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-analysis`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
            },
            body: JSON.stringify({
              messages: [
                { role: 'system', content: buildSystemPrompt() },
                ...newMessages,
              ],
              context: { 
                isAgencyLevel: true,
                clientFilter: selectedClientFilter !== 'all' ? selectedClientFilter : undefined,
                toolMode: activeTool?.id,
              },
              model: modelMap[model] || 'gemini',
              files: fileContents,
            }),
          }
        );
      }

      if (!response.ok) {
        if (response.status === 429) throw new Error('Rate limit exceeded. Please try again later.');
        if (response.status === 402) throw new Error('AI credits exhausted. Please add more credits.');
        throw new Error('Failed to get AI response');
      }

      // Read token headers
      const contextTokens = parseInt(response.headers.get('X-Context-Tokens') || '0', 10);
      const systemTokens = parseInt(response.headers.get('X-System-Tokens') || '0', 10);
      if (contextTokens > 0) {
        setTokenUsage({ used: contextTokens, system: systemTokens });
      }

      if (!response.body) throw new Error('No response body');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let textBuffer = '';

      const updateAssistant = (newChunk: string) => {
        assistantContent += newChunk;
        setLocalMessages(prev => {
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant') {
            return prev.map((m, i) => 
              i === prev.length - 1 ? { ...m, content: assistantContent } : m
            );
          }
          return [...prev, { role: 'assistant', content: assistantContent }];
        });
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        textBuffer += decoder.decode(value, { stream: true });
        let newlineIndex: number;
        while ((newlineIndex = textBuffer.indexOf('\n')) !== -1) {
          let line = textBuffer.slice(0, newlineIndex);
          textBuffer = textBuffer.slice(newlineIndex + 1);
          if (line.endsWith('\r')) line = line.slice(0, -1);
          if (line.startsWith(':') || line.trim() === '') continue;
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6).trim();
          if (jsonStr === '[DONE]') break;
          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) updateAssistant(content);
          } catch {
            textBuffer = line + '\n' + textBuffer;
            break;
          }
        }
      }

      // Update token usage with assistant response
      if (assistantContent) {
        const assistantTokens = Math.ceil(assistantContent.length / 4);
        setTokenUsage(prev => ({ ...prev, used: prev.used + assistantTokens }));

        await addMessage.mutateAsync({
          conversationId,
          role: 'assistant',
          content: assistantContent,
        });
      }

      setActiveTool(null);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'An error occurred';
      setLocalMessages(prev => [...prev, { role: 'assistant', content: `Error: ${errorMessage}` }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setAttachments(prev => [...prev, ...files].slice(0, 10));
    e.target.value = '';
  };

  const handleQuickAction = (prompt: string) => {
    setInput(prompt);
    handleSend(prompt);
  };

  const activeClients = clients.filter(c => c.status === 'active');

  return (
    <div className="flex h-[700px] border rounded-xl overflow-hidden bg-card shadow-sm">
      {/* Sidebar */}
      <div className={cn(
        "border-r bg-muted/30 transition-all duration-300 flex flex-col",
        sidebarOpen ? "w-64" : "w-0 overflow-hidden"
      )}>
        <div className="p-3 border-b flex items-center justify-between">
          <h4 className="font-semibold text-sm">Conversations</h4>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleNewConversation}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1">
            {conversations.map((conv) => (
              <div
                key={conv.id}
                className={cn(
                  "flex items-center justify-between p-2 rounded-lg cursor-pointer hover:bg-muted group",
                  selectedConversationId === conv.id && "bg-muted"
                )}
                onClick={() => setSelectedConversationId(conv.id)}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{conv.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {format(new Date(conv.updated_at), 'MMM d, h:mm a')}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="opacity-0 group-hover:opacity-100 h-6 w-6"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteConversation.mutate(conv.id);
                    if (selectedConversationId === conv.id) {
                      setSelectedConversationId(null);
                    }
                  }}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
            {conversations.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">
                No conversations yet
              </p>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="p-3 border-b flex items-center justify-between bg-background/80 backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-8 w-8"
              onClick={() => setSidebarOpen(!sidebarOpen)}
            >
              {sidebarOpen ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </Button>
            {selectedGPT ? (
              <div className="flex items-center gap-2">
                <div 
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-lg"
                  style={{ backgroundColor: `${selectedGPT.color}20` }}
                >
                  🤖
                </div>
                <div>
                  <p className="font-semibold text-sm">{selectedGPT.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {gptFiles.length} files • {linkedDocs.length} docs
                  </p>
                </div>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClearGPT}>
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
                  <Bot className="h-4 w-4 text-primary" />
                </div>
                <span className="font-semibold text-sm">Agency AI</span>
                {fullPortfolioMode && (
                  <Badge variant="secondary" className="text-[10px] gap-1">
                    <Database className="h-3 w-3" />
                    Full Portfolio
                  </Badge>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* Full Portfolio Toggle */}
            {!selectedGPT && (
              <div className="flex items-center gap-1.5">
                <Switch
                  id="full-portfolio"
                  checked={fullPortfolioMode}
                  onCheckedChange={setFullPortfolioMode}
                  className="scale-75"
                />
                <Label htmlFor="full-portfolio" className="text-[10px] text-muted-foreground cursor-pointer">
                  Full Data
                </Label>
              </div>
            )}
            
            {/* Client Filter */}
            <Select value={selectedClientFilter} onValueChange={setSelectedClientFilter}>
              <SelectTrigger className="w-[140px] h-8 text-xs">
                <SelectValue placeholder="All Clients" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Clients</SelectItem>
                {activeClients.map((client) => (
                  <SelectItem key={client.id} value={client.id}>
                    {client.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            
            {/* Model Selection */}
            <Select value={model} onValueChange={(v) => setModel(v as AIModel)}>
              <SelectTrigger className="w-[160px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FULL_MODEL_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    <div className="flex items-center gap-2">
                      <span>{opt.label}</span>
                      <Badge variant="outline" className="text-[9px] px-1 py-0">{opt.badge}</Badge>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Token Usage Bar */}
        <TokenUsageBar usedTokens={tokenUsage.used} systemTokens={tokenUsage.system} model={model} />

        {/* Messages */}
        <ScrollArea className="flex-1 p-4" ref={scrollRef}>
          <div className="space-y-4 max-w-3xl mx-auto">
            {localMessages.length === 0 && (
              <div className="text-center py-12">
                <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
                  <Bot className="h-8 w-8 text-primary" />
                </div>
                <h3 className="font-semibold text-lg mb-2">
                  {selectedGPT ? `Chat with ${selectedGPT.name}` : 'Agency AI Assistant'}
                </h3>
                <p className="text-muted-foreground text-sm max-w-md mx-auto mb-6">
                  {selectedGPT?.description || 
                    (fullPortfolioMode 
                      ? 'Full Portfolio Mode: I have complete access to all client data including metrics, leads, calls, tasks, meetings, and pipeline data.'
                      : 'Ask about clients, campaigns, or performance metrics. I have access to your agency data.'
                    )}
                </p>
                
                <div className="flex flex-wrap justify-center gap-2">
                  {QUICK_ACTIONS.map((action, i) => (
                    <Button 
                      key={i}
                      variant="outline" 
                      size="sm"
                      className="text-xs"
                      onClick={() => handleQuickAction(action.prompt)}
                    >
                      {action.label}
                    </Button>
                  ))}
                </div>
              </div>
            )}
            {localMessages.map((message, i) => (
              <div
                key={i}
                className={cn(
                  "flex gap-3",
                  message.role === 'user' ? "justify-end" : "justify-start"
                )}
              >
                {message.role === 'assistant' && (
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center flex-shrink-0">
                    <Bot className="h-4 w-4 text-primary" />
                  </div>
                )}
                <div
                  className={cn(
                    "max-w-[80%] rounded-2xl px-4 py-2.5",
                    message.role === 'user'
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted"
                  )}
                >
                  {message.role === 'assistant' ? (
                    <div className="prose prose-sm dark:prose-invert max-w-none">
                      <ReactMarkdown>{message.content}</ReactMarkdown>
                    </div>
                  ) : (
                    <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                  )}
                </div>
              </div>
            ))}
            {isLoading && localMessages[localMessages.length - 1]?.role !== 'assistant' && (
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                </div>
                <div className="bg-muted rounded-2xl px-4 py-2.5">
                  <p className="text-sm text-muted-foreground">Thinking...</p>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Input Area */}
        <div className="p-4 border-t bg-background/80 backdrop-blur-sm">
          {activeTool && (
            <div className="flex items-center gap-2 mb-2 max-w-3xl mx-auto">
              <Badge variant="secondary" className="gap-1">
                {activeTool.icon}
                {activeTool.name}
                <X 
                  className="h-3 w-3 cursor-pointer ml-1" 
                  onClick={() => setActiveTool(null)}
                />
              </Badge>
            </div>
          )}
          
          {attachments.length > 0 && (
            <div className="flex gap-2 mb-2 flex-wrap max-w-3xl mx-auto">
              {attachments.map((file, i) => (
                <Badge key={i} variant="secondary" className="gap-1">
                  {file.name.slice(0, 20)}
                  <X 
                    className="h-3 w-3 cursor-pointer" 
                    onClick={() => setAttachments(prev => prev.filter((_, idx) => idx !== i))}
                  />
                </Badge>
              ))}
            </div>
          )}
          
          <div className="flex gap-2 max-w-3xl mx-auto items-center">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileSelect}
              className="hidden"
              multiple
              accept=".pdf,.doc,.docx,.txt,.csv,.json,.png,.jpg,.jpeg"
            />
            <Button 
              variant="ghost" 
              size="icon"
              className="h-9 w-9 shrink-0"
              onClick={() => fileInputRef.current?.click()}
            >
              <Paperclip className="h-4 w-4" />
            </Button>
            
            <AIToolsMenu onSelectTool={handleSelectTool} activeTool={activeTool} />
            
            <div className="flex-1 relative">
              <Input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
                placeholder="Ask about clients, metrics, or get insights..."
                disabled={isLoading}
                className="pr-20 h-10 rounded-full bg-muted/50 border-0 focus-visible:ring-1"
              />
              <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-1">
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                  {FULL_MODEL_OPTIONS.find(m => m.value === model)?.badge}
                </Badge>
              </div>
            </div>
            
            <Button 
              onClick={() => handleSend()} 
              disabled={isLoading || (!input.trim() && attachments.length === 0)}
              size="icon"
              className="h-9 w-9 shrink-0 rounded-full"
            >
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
  });
}
