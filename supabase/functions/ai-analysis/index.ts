import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface ClientMetrics {
  name?: string;
  status?: string;
  adSpend?: number;
  leads?: number;
  calls?: number;
  showedCalls?: number;
  costPerLead?: number;
  costPerCall?: number;
  fundedInvestors?: number;
  fundedDollars?: number;
  costOfCapital?: number;
}

interface MetricsContext {
  isAgencyLevel?: boolean;
  clientName?: string;
  totalAdSpend?: number;
  leads?: number;
  calls?: number;
  showedCalls?: number;
  costPerLead?: number;
  costPerCall?: number;
  costPerShow?: number;
  fundedInvestors?: number;
  fundedDollars?: number;
  costPerInvestor?: number;
  costOfCapital?: number;
  showedPercent?: number;
  agencyTotals?: {
    totalAdSpend?: number;
    totalLeads?: number;
    totalCalls?: number;
    showedCalls?: number;
    costPerLead?: number;
    costPerCall?: number;
    fundedInvestors?: number;
    fundedDollars?: number;
    costOfCapital?: number;
  };
  clients?: ClientMetrics[];
  recentMeetings?: {
    title: string;
    date: string | null;
    client: string;
    summary: string | null;
    actionItemsCount: number;
    duration: number | null;
  }[];
}

interface FileContent {
  name: string;
  type: string;
  content: string;
}

function buildSystemPrompt(context: MetricsContext): string {
  if (context.isAgencyLevel) {
    return buildAgencyPrompt(context);
  }
  return buildClientPrompt(context);
}

function buildClientPrompt(context: MetricsContext): string {
  const metrics = [];
  
  if (context.clientName) {
    metrics.push(`Client: ${context.clientName}`);
  }
  if (context.totalAdSpend !== undefined) {
    metrics.push(`Total Ad Spend: $${context.totalAdSpend.toLocaleString()}`);
  }
  if (context.leads !== undefined) {
    metrics.push(`Leads: ${context.leads}`);
  }
  if (context.calls !== undefined) {
    metrics.push(`Calls Booked: ${context.calls}`);
  }
  if (context.showedCalls !== undefined) {
    metrics.push(`Showed Calls: ${context.showedCalls}`);
  }
  if (context.showedPercent !== undefined) {
    metrics.push(`Show Rate: ${context.showedPercent.toFixed(1)}%`);
  }
  if (context.costPerLead !== undefined) {
    metrics.push(`Cost Per Lead: $${context.costPerLead.toFixed(2)}`);
  }
  if (context.costPerCall !== undefined) {
    metrics.push(`Cost Per Call: $${context.costPerCall.toFixed(2)}`);
  }
  if (context.costPerShow !== undefined) {
    metrics.push(`Cost Per Show: $${context.costPerShow.toFixed(2)}`);
  }
  if (context.fundedInvestors !== undefined) {
    metrics.push(`Funded Investors: ${context.fundedInvestors}`);
  }
  if (context.fundedDollars !== undefined) {
    metrics.push(`Funded Amount: $${context.fundedDollars.toLocaleString()}`);
  }
  if (context.costPerInvestor !== undefined) {
    metrics.push(`Cost Per Investor: $${context.costPerInvestor.toFixed(2)}`);
  }
  if (context.costOfCapital !== undefined) {
    metrics.push(`Cost of Capital: ${context.costOfCapital.toFixed(2)}%`);
  }

  return `You are an expert advertising performance analyst helping agencies optimize their client campaigns. You provide actionable insights based on campaign metrics.

Current Performance Metrics:
${metrics.length > 0 ? metrics.join('\n') : 'No metrics data available.'}

Guidelines:
- Be concise and actionable in your responses
- Focus on the most important insights first
- Suggest specific improvements when relevant
- Compare metrics to industry benchmarks when helpful
- If asked about missing data, acknowledge and work with what's available
- Use bullet points for clarity when listing recommendations`;
}

function buildAgencyPrompt(context: MetricsContext): string {
  const { agencyTotals, clients, recentMeetings } = context;

  let agencySection = "AGENCY TOTALS:\n";
  if (agencyTotals) {
    agencySection += `- Total Ad Spend: $${agencyTotals.totalAdSpend?.toLocaleString() || 0}
- Total Leads: ${agencyTotals.totalLeads || 0}
- Total Calls: ${agencyTotals.totalCalls || 0}
- Showed Calls: ${agencyTotals.showedCalls || 0}
- Cost Per Lead: $${agencyTotals.costPerLead?.toFixed(2) || 0}
- Cost Per Call: $${agencyTotals.costPerCall?.toFixed(2) || 0}
- Funded Investors: ${agencyTotals.fundedInvestors || 0}
- Funded Amount: $${agencyTotals.fundedDollars?.toLocaleString() || 0}
- Cost of Capital: ${agencyTotals.costOfCapital?.toFixed(2) || 0}%`;
  }

  let clientsSection = "\n\nCLIENT BREAKDOWN:\n";
  if (clients && clients.length > 0) {
    clients.forEach((client, i) => {
      if (client) {
        clientsSection += `
${i + 1}. ${client.name} (${client.status})
   - Ad Spend: $${client.adSpend?.toLocaleString() || 0}
   - Leads: ${client.leads || 0}
   - CPL: $${client.costPerLead?.toFixed(2) || 0}
   - Calls: ${client.calls || 0}
   - Showed: ${client.showedCalls || 0}
   - Cost/Call: $${client.costPerCall?.toFixed(2) || 0}
   - Funded Investors: ${client.fundedInvestors || 0}
   - Funded $: $${client.fundedDollars?.toLocaleString() || 0}
   - CoC: ${client.costOfCapital?.toFixed(2) || 0}%
`;
      }
    });
  }

  let meetingsSection = "";
  if (recentMeetings && recentMeetings.length > 0) {
    meetingsSection = "\n\nRECENT MEETINGS (Last 7 Days):\n";
    recentMeetings.forEach((meeting, i) => {
      const date = meeting.date ? new Date(meeting.date).toLocaleDateString() : 'Unknown';
      meetingsSection += `
${i + 1}. "${meeting.title}" - ${meeting.client} (${date})
   - Duration: ${meeting.duration || 0} minutes
   - Action Items: ${meeting.actionItemsCount}
   ${meeting.summary ? `- Summary: ${meeting.summary}` : ''}
`;
    });
  }

  return `You are an expert advertising agency performance analyst. You have complete visibility into all client performance data, recent meetings, and can compare, analyze, and provide strategic recommendations across the entire portfolio.

${agencySection}
${clientsSection}
${meetingsSection}

ANALYSIS CAPABILITIES:
- Compare performance across all clients
- Identify which clients need immediate attention
- Spot trends and patterns in the data
- Provide budget reallocation recommendations
- Benchmark individual clients against agency averages
- Reference recent meetings and action items when relevant
- Connect meeting discussions to performance metrics

Guidelines:
- Be specific about which client you're referring to
- Use data to support your recommendations
- Prioritize actionable insights
- When comparing clients, highlight both top performers and those needing improvement
- Consider the full funnel from leads to funded investors
- Reference relevant meeting notes when they provide context
- Use markdown formatting for clarity (headers, bullets, bold)`;
}

function convertToGeminiMessages(messages: Message[], systemPrompt: string) {
  const contents = [];
  
  // Add system prompt as first user message
  contents.push({
    role: "user",
    parts: [{ text: `System: ${systemPrompt}` }]
  });
  contents.push({
    role: "model",
    parts: [{ text: "I understand. I'll act as an expert advertising performance analyst and follow the guidelines provided." }]
  });
  
  // Convert messages
  for (const msg of messages) {
    contents.push({
      role: msg.role === "user" ? "user" : "model",
      parts: [{ text: msg.content }]
    });
  }
  
  return contents;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages, context, model, files } = await req.json() as {
      messages: Message[];
      context: MetricsContext;
      model?: 'gemini' | 'openai';
      files?: FileContent[];
    };

    // Fetch API key from agency_settings first, fallback to env var
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
    if (!OPENROUTER_API_KEY) {
      throw new Error("OPENROUTER_API_KEY is not configured.");
    }

    const systemPrompt = buildSystemPrompt(context);

    // Build message content with file attachments if present
    let userMessages = [...messages];
    
    if (files && files.length > 0) {
      const lastUserMsgIndex = userMessages.findLastIndex(m => m.role === 'user');
      if (lastUserMsgIndex >= 0) {
        let fileContext = "\n\n[Attached files for context:";
        for (const file of files) {
          if (file.type.startsWith('text/') || file.type === 'application/pdf') {
            fileContext += `\n- ${file.name} (${file.type})`;
          } else if (file.type.startsWith('image/')) {
            fileContext += `\n- ${file.name} (image attached)`;
          } else if (file.type.startsWith('video/')) {
            fileContext += `\n- ${file.name} (video attached)`;
          } else if (file.type.startsWith('audio/')) {
            fileContext += `\n- ${file.name} (audio/voice message attached)`;
          } else {
            fileContext += `\n- ${file.name} (${file.type})`;
          }
        }
        fileContext += "]";
        userMessages[lastUserMsgIndex] = {
          ...userMessages[lastUserMsgIndex],
          content: userMessages[lastUserMsgIndex].content + fileContext
        };
      }
    }

    const orMessages = [
      { role: "system", content: systemPrompt },
      ...userMessages.map(m => ({ role: m.role, content: m.content })),
    ];

    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          "HTTP-Referer": "https://reporting.highperformanceads.com",
          "X-Title": "HPA Reporting",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          models: ["google/gemini-2.5-flash", "google/gemini-2.0-flash-001", "openai/gpt-4o-mini"],
          messages: orMessages,
          temperature: 0.7,
          max_tokens: 8192,
          stream: true,
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Gemini API error:", response.status, errorText);
      
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again later." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({ error: "OpenRouter API error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // OpenRouter returns OpenAI-compatible SSE — pass through directly
    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (error) {
    console.error("AI analysis error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
