import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Regex patterns for extracting data from emails
const patterns = {
  name: /Name:\s*(.+?)(?:\n|$)/i,
  amount: /(?:Amount:\s*\$?|investment (?:of|for)\s*\$?|just placed an investment for\s*\$?)([\d,]+(?:\.\d{2})?)/i,
  email: /Email:\s*([^\s@]+@[^\s@]+\.[^\s@]+)/i,
  phone: /Phone:\s*([\d\s\-+()]+)/i,
  offering: /Offering(?:\s+Name)?:\s*(.+?)(?:\n|$)/i,
  investorClass: /(?:Investor\s+)?Class:\s*(.+?)(?:\n|$)/i,
  accredited: /Accredited:\s*(Yes|No)/i,
};

function parseEmailWithRegex(body: string): Record<string, any> {
  const result: Record<string, any> = {};
  
  for (const [key, pattern] of Object.entries(patterns)) {
    const match = body.match(pattern);
    if (match) {
      if (key === 'amount') {
        result[key] = parseFloat(match[1].replace(/,/g, ''));
      } else if (key === 'accredited') {
        result[key] = match[1].toLowerCase() === 'yes';
      } else {
        result[key] = match[1].trim();
      }
    }
  }
  
  return result;
}

async function parseEmailWithAI(subject: string, body: string): Promise<Record<string, any>> {
  const LOVABLE_API_KEY = Deno.env.get('OPENROUTER_API_KEY');
  
  if (!LOVABLE_API_KEY) {
    console.log("OPENROUTER_API_KEY not configured, using regex only");
    return {};
  }
  
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "nvidia/nemotron-3-ultra:free",
        models: ["nvidia/nemotron-3-ultra:free", "google/gemini-2.0-flash-001", "openai/gpt-4o-mini"],
        messages: [
          {
            role: "system",
            content: `You are an expert at extracting structured data from investor portal notification emails. 
Extract the following fields if present: name, email, phone, amount (investment amount as a number), offering (fund/offering name), investorClass (Class A, B, etc.), accredited (true/false).
Return ONLY a valid JSON object with these fields. Use null for missing fields.`
          },
          {
            role: "user",
            content: `Subject: ${subject}\n\nBody:\n${body}`
          }
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "extract_investor_data",
              description: "Extract structured investor data from email content",
              parameters: {
                type: "object",
                properties: {
                  name: { type: "string", description: "Investor's full name" },
                  email: { type: "string", description: "Investor's email address" },
                  phone: { type: "string", description: "Investor's phone number" },
                  amount: { type: "number", description: "Investment amount in dollars" },
                  offering: { type: "string", description: "Name of the fund or offering" },
                  investorClass: { type: "string", description: "Investor class (e.g., Class A, Class B)" },
                  accredited: { type: "boolean", description: "Whether the investor is accredited" }
                },
                required: ["name", "amount"],
                additionalProperties: false
              }
            }
          }
        ],
        tool_choice: { type: "function", function: { name: "extract_investor_data" } }
      }),
    });
    
    if (!response.ok) {
      console.error("AI parsing failed:", response.status);
      return {};
    }
    
    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    
    if (toolCall?.function?.arguments) {
      return JSON.parse(toolCall.function.arguments);
    }
    
    return {};
  } catch (error) {
    console.error("AI parsing error:", error);
    return {};
  }
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const pathParts = url.pathname.split('/');
    const clientId = pathParts[pathParts.length - 1];

    if (!clientId || clientId === 'parse-investor-email') {
      return new Response(
        JSON.stringify({ error: 'Client ID is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { subject, body, from } = await req.json();

    if (!body) {
      return new Response(
        JSON.stringify({ error: 'Email body is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Processing email for client ${clientId}`);
    console.log(`Subject: ${subject}`);
    console.log(`From: ${from}`);

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify client exists
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('id, name')
      .eq('id', clientId)
      .maybeSingle();

    if (clientError || !client) {
      return new Response(
        JSON.stringify({ error: 'Client not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get client settings for email parsing config
    const { data: settings } = await supabase
      .from('client_settings')
      .select('email_parsing_enabled, email_trusted_domains, email_auto_approve_threshold, email_default_offering')
      .eq('client_id', clientId)
      .maybeSingle();

    // Check if email parsing is enabled
    if (settings && !settings.email_parsing_enabled) {
      return new Response(
        JSON.stringify({ error: 'Email parsing is disabled for this client' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse email using regex first
    let parsedData = parseEmailWithRegex(body);
    console.log("Regex parsed data:", parsedData);

    // If we didn't get key fields, try AI parsing
    if (!parsedData.name || !parsedData.amount) {
      const aiData = await parseEmailWithAI(subject || '', body);
      console.log("AI parsed data:", aiData);
      
      // Merge AI data with regex data, preferring regex results
      parsedData = {
        ...aiData,
        ...Object.fromEntries(
          Object.entries(parsedData).filter(([_, v]) => v !== undefined && v !== null)
        )
      };
    }

    // Apply default offering if not found
    if (!parsedData.offering && settings?.email_default_offering) {
      parsedData.offering = settings.email_default_offering;
    }

    // Generate a unique external_id for the funded investor
    const externalId = `email-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Determine if we should auto-approve
    const autoApproveThreshold = settings?.email_auto_approve_threshold || 0;
    const shouldAutoApprove = autoApproveThreshold > 0 && parsedData.amount && parsedData.amount <= autoApproveThreshold;
    const approvalStatus = shouldAutoApprove ? 'approved' : 'pending_review';

    // Create funded investor record (shows in metrics immediately)
    const { data: fundedInvestor, error: fundedError } = await supabase
      .from('funded_investors')
      .insert({
        client_id: clientId,
        external_id: externalId,
        name: parsedData.name || 'Unknown Investor',
        funded_amount: parsedData.amount || 0,
        source: 'email_parsed',
        approval_status: approvalStatus,
      })
      .select()
      .single();

    if (fundedError) {
      console.error("Error creating funded investor:", fundedError);
      return new Response(
        JSON.stringify({ error: 'Failed to create funded investor record' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create email_parsed_investors record for review
    const { data: parsedRecord, error: parsedError } = await supabase
      .from('email_parsed_investors')
      .insert({
        client_id: clientId,
        email_subject: subject,
        email_body: body,
        email_from: from,
        email_received_at: new Date().toISOString(),
        parsed_name: parsedData.name,
        parsed_email: parsedData.email,
        parsed_phone: parsedData.phone,
        parsed_amount: parsedData.amount,
        parsed_offering: parsedData.offering,
        parsed_class: parsedData.investorClass,
        parsed_accredited: parsedData.accredited,
        raw_parsed_data: parsedData,
        status: shouldAutoApprove ? 'approved' : 'pending',
        funded_investor_id: fundedInvestor.id,
      })
      .select()
      .single();

    if (parsedError) {
      console.error("Error creating parsed record:", parsedError);
      // Clean up funded investor if we couldn't create the parsed record
      await supabase.from('funded_investors').delete().eq('id', fundedInvestor.id);
      return new Response(
        JSON.stringify({ error: 'Failed to create parsed email record' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Successfully parsed email for ${parsedData.name}, amount: $${parsedData.amount}`);

    return new Response(
      JSON.stringify({
        success: true,
        message: shouldAutoApprove ? 'Email parsed and auto-approved' : 'Email parsed and pending approval',
        parsedData,
        fundedInvestorId: fundedInvestor.id,
        parsedRecordId: parsedRecord.id,
        approvalStatus,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error processing email:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
