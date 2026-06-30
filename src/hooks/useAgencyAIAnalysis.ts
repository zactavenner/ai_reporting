import { useState, useCallback } from 'react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  attachments?: File[];
  createdAt?: string;
}

interface ClientMetrics {
  name: string;
  status: string;
  adSpend: number;
  leads: number;
  calls: number;
  showedCalls: number;
  costPerLead: number;
  costPerCall: number;
  fundedInvestors: number;
  fundedDollars: number;
  costOfCapital: number;
}

interface AgencyContext {
  agencyTotals: {
    totalAdSpend: number;
    totalLeads: number;
    totalCalls: number;
    showedCalls: number;
    costPerLead: number;
    costPerCall: number;
    fundedInvestors: number;
    fundedDollars: number;
    costOfCapital: number;
  };
  clients: (ClientMetrics | null)[];
}

type AIModel = 'gemini' | 'openai';
type FullModel = 'nvidia/nemotron-3-ultra-550b-a55b:free' | 'gemini-2.5-pro' | 'gemini-3-flash' | 'gemini-3-pro' | 'gpt-5' | 'grok' | 'grok-4-reasoning';

export function useAgencyAIAnalysis() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const streamResponse = useCallback(async (
    response: Response,
    allMessages: Message[],
  ) => {
    let assistantContent = '';

    const updateAssistant = (newChunk: string) => {
      assistantContent += newChunk;
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last?.role === 'assistant') {
          return prev.map((m, i) =>
            i === prev.length - 1 ? { ...m, content: assistantContent } : m
          );
        }
        return [...prev, { role: 'assistant', content: assistantContent, createdAt: new Date().toISOString() }];
      });
    };

    if (!response.body) throw new Error('No response body');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let textBuffer = '';

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
  }, []);

  const sendMessage = useCallback(async (
    input: string,
    context: AgencyContext,
    existingMessages: Message[],
    model: AIModel = 'gemini',
    files?: File[]
  ) => {
    const userMsg: Message = {
      role: 'user',
      content: input || (files && files.length > 0 ? `[Attached ${files.length} file(s)]` : ''),
      attachments: files,
      createdAt: new Date().toISOString(),
    };
    const allMessages = [...existingMessages, userMsg];
    setMessages(allMessages);
    setIsLoading(true);

    try {
      const fileContents: { name: string; type: string; content: string }[] = [];
      if (files && files.length > 0) {
        for (const file of files) {
          const content = await fileToBase64(file);
          fileContents.push({ name: file.name, type: file.type, content });
        }
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-analysis`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({
            messages: allMessages.map(m => ({ role: m.role, content: m.content })),
            context: { isAgencyLevel: true, ...context },
            model,
            files: fileContents,
          }),
        }
      );

      if (!response.ok) {
        if (response.status === 429) throw new Error('Rate limit exceeded. Please try again later.');
        if (response.status === 402) throw new Error('AI credits exhausted. Please add more credits.');
        throw new Error('Failed to get AI response');
      }

      await streamResponse(response, allMessages);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'An error occurred';
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${errorMessage}`, createdAt: new Date().toISOString() }]);
    } finally {
      setIsLoading(false);
    }
  }, [streamResponse]);

  const sendFullContextMessage = useCallback(async (
    input: string,
    existingMessages: Message[],
    fullModel: FullModel = 'nvidia/nemotron-3-ultra-550b-a55b:free',
    clientFilter: string = 'all',
    onTokenUsage?: (used: number, system: number) => void,
  ) => {
    const userMsg: Message = { role: 'user', content: input, createdAt: new Date().toISOString() };
    const allMessages = [...existingMessages, userMsg];
    setMessages(allMessages);
    setIsLoading(true);

    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-agent-full-context`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({
            messages: allMessages.map(m => ({ role: m.role, content: m.content })),
            model: fullModel,
            clientFilter,
          }),
        }
      );

      if (!response.ok) {
        if (response.status === 429) throw new Error('Rate limit exceeded. Please try again later.');
        if (response.status === 402) throw new Error('AI credits exhausted. Please add more credits.');
        throw new Error('Failed to get AI response');
      }

      // Read token headers
      const contextTokens = parseInt(response.headers.get('X-Context-Tokens') || '0', 10);
      const systemTokens = parseInt(response.headers.get('X-System-Tokens') || '0', 10);
      if (onTokenUsage && contextTokens > 0) {
        onTokenUsage(contextTokens, systemTokens);
      }

      await streamResponse(response, allMessages);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'An error occurred';
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${errorMessage}`, createdAt: new Date().toISOString() }]);
    } finally {
      setIsLoading(false);
    }
  }, [streamResponse]);

  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  return {
    messages,
    isLoading,
    sendMessage,
    sendFullContextMessage,
    clearMessages,
  };
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
  });
}
