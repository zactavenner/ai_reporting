import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encode as base64Encode } from "https://deno.land/std@0.168.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
   "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
     const body = await req.json();
     const { action, audioUrl, audioBase64, clientId, isPublicRecording, durationSeconds, existingTaskContext, agencyMembers, agencyPods } = body;
     let { clientName } = body;

     // Handle transcribe_only action (for task voice notes)
     if (action === "transcribe_only") {
       return await handleTranscribeOnly(audioUrl);
     }

     // Handle extract_task_details action (for auto-extracting task info from voice)
     if (action === "extract_task_details") {
       return await handleExtractTaskDetails(audioUrl, existingTaskContext, agencyMembers, agencyPods);
     }

    if (!audioBase64 || !clientId) {
      return new Response(
        JSON.stringify({ error: "Missing audioBase64 or clientId" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fallback: if clientName not provided, look it up so AI has client context
    if (!clientName && clientId) {
      const { data: clientRow } = await supabase
        .from("clients")
        .select("name")
        .eq("id", clientId)
        .maybeSingle();
      if (clientRow?.name) clientName = clientRow.name;
    }

     const LOVABLE_API_KEY = Deno.env.get('OPENROUTER_API_KEY');
     if (!LOVABLE_API_KEY) {
      return new Response(
         JSON.stringify({ error: "AI API key not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Processing voice note for client:", clientId);

    // Step 1: Transcribe audio using Gemini API
     const transcriptResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
       method: "POST",
       headers: {
         Authorization: `Bearer ${LOVABLE_API_KEY}`,
         "Content-Type": "application/json",
       },
       body: JSON.stringify({
         model: "openrouter/owl-alpha",
        models: ["openrouter/owl-alpha", "google/gemini-2.0-flash-001", "openai/gpt-4o-mini"],
         messages: [
           {
             role: "user",
             content: [
               {
                 type: "text",
                 text: "Transcribe this audio recording accurately. Only output the transcription text, nothing else. If you cannot hear any speech or the audio is unclear, respond with 'No speech detected'."
               },
               {
                 type: "image_url",
                 image_url: {
                   url: `data:audio/webm;base64,${audioBase64}`
                 }
               }
             ]
           }
         ],
         max_tokens: 4096,
         temperature: 0.1,
       }),
     });

    if (!transcriptResponse.ok) {
      const errorText = await transcriptResponse.text();
      console.error("Transcription error:", transcriptResponse.status, errorText);
      
      if (transcriptResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      return new Response(
        JSON.stringify({ error: "Failed to transcribe audio" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const transcriptData = await transcriptResponse.json();
     const transcript = transcriptData.choices?.[0]?.message?.content || "";

    if (!transcript.trim() || transcript.toLowerCase().includes("no speech detected")) {
      return new Response(
        JSON.stringify({ error: "No speech detected in audio" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Transcript:", transcript.substring(0, 100) + "...");

    // Step 2: Generate summary and extract action items
     const analysisResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
       method: "POST",
       headers: {
         Authorization: `Bearer ${LOVABLE_API_KEY}`,
         "Content-Type": "application/json",
       },
       body: JSON.stringify({
         model: "openrouter/owl-alpha",
        models: ["openrouter/owl-alpha", "google/gemini-2.0-flash-001", "openai/gpt-4o-mini"],
         messages: [
           {
             role: "system",
             content: "You are an expert at analyzing meeting transcripts and extracting actionable insights. Return only valid JSON."
           },
           {
             role: "user",
             content: `You are analyzing a voice note recorded by an agency team member${clientName ? ` about the client "${clientName}"` : ""}.

Transcript:
${transcript}

Extract:
1. A short descriptive title (max 60 characters) for the voice note
2. A concise 2-3 sentence summary of the key points
3. Every action item / task mentioned that needs to be done${clientName ? ` for ${clientName}` : ""}

CRITICAL RULES for action_items (these will become real tasks in our system):
- "title": Action-oriented, starts with a verb (Create, Review, Update, Send, Build, Fix, Schedule, Follow up on…). Max 80 chars. ${clientName ? `If the task is specific to ${clientName}, include their name in the title (e.g. "Send ${clientName} the new VSL script").` : ""}
- "description": REQUIRED. Always 1-3 full sentences. Pull concrete context from the transcript: what exactly to do, why it matters, any names/dates/numbers/links mentioned, and the desired outcome. Never leave this empty, never write "N/A", never repeat the title verbatim.${clientName ? ` Reference "${clientName}" by name when relevant so the assignee has full context.` : ""}
- "priority": "high" if urgent/ASAP/blocker is implied, "low" if explicitly low-priority or nice-to-have, otherwise "medium".
- Only include real, actionable tasks. Skip status updates, observations, or already-completed work.

Return ONLY valid JSON in this exact shape:
{
  "title": "Short voice note title",
  "summary": "2-3 sentence summary",
  "action_items": [
    { "title": "Action-oriented task title", "description": "Detailed 1-3 sentence description with context", "priority": "low|medium|high" }
  ]
}`
           }
         ],
         max_tokens: 4096,
         temperature: 0.4,
       }),
     });

    if (!analysisResponse.ok) {
      const errorText = await analysisResponse.text();
      console.error("Analysis error:", analysisResponse.status, errorText);
      return new Response(
        JSON.stringify({ error: "Failed to analyze transcript" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const analysisData = await analysisResponse.json();
     const analysisContent = analysisData.choices?.[0]?.message?.content || "";
    
    console.log("Analysis response:", analysisContent);

    // Parse the JSON response
    let title = "Voice Note";
    let summary = "";
    let actionItems: Array<{ title: string; description?: string; priority: string }> = [];

    try {
      // Extract JSON from the response (handle potential markdown code blocks)
      let jsonStr = analysisContent;
      const jsonMatch = analysisContent.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1];
      }
      
      const parsed = JSON.parse(jsonStr.trim());
      title = parsed.title || title;
      summary = parsed.summary || "";
      actionItems = parsed.action_items || [];
    } catch (parseError) {
      console.error("Error parsing analysis JSON:", parseError);
      // Fallback: use transcript as summary
      summary = transcript.substring(0, 200) + (transcript.length > 200 ? "..." : "");
    }

    console.log("Extracted:", { title, summary, actionItemsCount: actionItems.length });

    // Step 3: Save voice note to database
    const { data: voiceNote, error: insertError } = await supabase
      .from("client_voice_notes")
      .insert({
        client_id: clientId,
        title,
        duration_seconds: durationSeconds || 0,
        transcript,
        summary,
        action_items: actionItems,
        recorded_by: isPublicRecording ? "Client" : "Agency",
        is_public_recording: isPublicRecording || false,
      })
      .select()
      .single();

    if (insertError) {
      console.error("Insert error:", insertError);
      return new Response(
        JSON.stringify({ error: "Failed to save voice note" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Voice note saved:", voiceNote.id);

    // Step 4: Create pending tasks for approval
    if (actionItems.length > 0) {
      const pendingTasks = actionItems.map((item) => ({
        voice_note_id: voiceNote.id,
        client_id: clientId,
        title: item.title,
        description: item.description || null,
        priority: item.priority || "medium",
        status: "pending",
      }));

      const { error: tasksError } = await supabase
        .from("pending_meeting_tasks")
        .insert(pendingTasks);

      if (tasksError) {
        console.error("Error creating pending tasks:", tasksError);
      } else {
        console.log("Created", pendingTasks.length, "pending tasks");
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        voiceNote: {
          id: voiceNote.id,
          title,
          summary,
          transcript,
          action_items: actionItems,
          duration_seconds: durationSeconds,
        },
        tasksCreated: actionItems.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error processing voice note:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// Helper function for transcribe_only action
async function handleTranscribeOnly(audioUrl: string) {
  const LOVABLE_API_KEY = Deno.env.get('OPENROUTER_API_KEY');
  if (!LOVABLE_API_KEY) {
    return new Response(
      JSON.stringify({ error: "AI API key not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    // Fetch the audio file and convert to base64
    const audioResponse = await fetch(audioUrl);
    const audioBlob = await audioResponse.arrayBuffer();
    const base64Audio = base64Encode(audioBlob);

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openrouter/owl-alpha",
        models: ["openrouter/owl-alpha", "google/gemini-2.0-flash-001", "openai/gpt-4o-mini"],
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Transcribe this audio recording accurately. Only output the transcription text, nothing else."
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:audio/webm;base64,${base64Audio}`
                }
              }
            ]
          }
        ],
        max_tokens: 4096,
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Transcription error:", response.status, errorText);
      return new Response(
        JSON.stringify({ error: "Failed to transcribe audio", transcript: "" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    const transcript = data.choices?.[0]?.message?.content || "";

    return new Response(
      JSON.stringify({ transcript }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Transcribe only error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error", transcript: "" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

// Helper function for extract_task_details action
async function handleExtractTaskDetails(
  audioUrl: string,
  existingTaskContext?: { clientName?: string; clientId?: string },
  agencyMembers?: Array<{ id: string; name: string; pod_id?: string }>,
  agencyPods?: Array<{ id: string; name: string }>
) {
  const LOVABLE_API_KEY = Deno.env.get('OPENROUTER_API_KEY');
  if (!LOVABLE_API_KEY) {
    return new Response(
      JSON.stringify({ error: "AI API key not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    // Fetch the audio file and convert to base64
    const audioResponse = await fetch(audioUrl);
    const audioBlob = await audioResponse.arrayBuffer();
    const base64Audio = base64Encode(audioBlob);

    // Step 1: Transcribe
    const transcribeResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openrouter/owl-alpha",
        models: ["openrouter/owl-alpha", "google/gemini-2.0-flash-001", "openai/gpt-4o-mini"],
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Transcribe this audio recording accurately. Only output the transcription text, nothing else."
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:audio/webm;base64,${base64Audio}`
                }
              }
            ]
          }
        ],
        max_tokens: 4096,
        temperature: 0.1,
      }),
    });

    if (!transcribeResponse.ok) {
      const errorText = await transcribeResponse.text();
      console.error("Transcription error:", transcribeResponse.status, errorText);
      return new Response(
        JSON.stringify({ error: "Failed to transcribe audio" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const transcribeData = await transcribeResponse.json();
    const transcript = transcribeData.choices?.[0]?.message?.content || "";

    if (!transcript.trim()) {
      return new Response(
        JSON.stringify({ error: "No speech detected", transcript: "" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Step 2: Extract task details with AI
    const membersList = agencyMembers?.map(m => m.name).join(", ") || "";
    const podsList = agencyPods?.map(p => p.name).join(", ") || "";

    const extractResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openrouter/owl-alpha",
        models: ["openrouter/owl-alpha", "google/gemini-2.0-flash-001", "openai/gpt-4o-mini"],
        messages: [
          {
            role: "system",
            content: `You are an expert at extracting task details from voice recordings. Extract structured task information from the transcript.

Available team members: ${membersList || "Not specified"}
Available teams/pods: ${podsList || "Not specified"}
Client context: ${existingTaskContext?.clientName || "Not specified"}

Return only valid JSON, no markdown or other text.`
          },
          {
            role: "user",
            content: `Extract task details from this voice recording transcript:

"${transcript}"

Return a JSON object with these fields:
{
  "title": "A clear, action-oriented task title (max 80 chars)",
  "description": "Detailed description of what needs to be done",
  "priority": "low" | "medium" | "high" (based on urgency mentioned),
  "suggestedAssignee": "Name of person/team mentioned, or null if none",
  "suggestedAssigneeType": "member" | "pod" | null,
  "dueDate": "YYYY-MM-DD format if a date/deadline mentioned, or null",
  "dueDateReason": "Why this date was suggested (e.g., 'mentioned Friday' or 'said by end of week')"
}

Guidelines:
- Title should start with a verb (Create, Review, Update, Send, etc.)
- If someone says "assign to [name]" or "this is for [name]", extract that as suggestedAssignee
- If they mention a team like "creatives team" or "CRM team", use suggestedAssigneeType: "pod"
- For dates: "tomorrow" = next business day, "Friday" = this week's Friday, "next week" = Monday, "ASAP" = today
- Priority: "urgent", "ASAP", "critical" = high; "when you can", "low priority" = low; otherwise = medium`
          }
        ],
        max_tokens: 1024,
        temperature: 0.3,
      }),
    });

    if (!extractResponse.ok) {
      // Fallback: return transcript only
      return new Response(
        JSON.stringify({ 
          transcript,
          extracted: null,
          error: "Failed to extract details" 
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const extractData = await extractResponse.json();
    const extractContent = extractData.choices?.[0]?.message?.content || "";

    let extracted = null;
    try {
      let jsonStr = extractContent;
      const jsonMatch = extractContent.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1];
      }
      extracted = JSON.parse(jsonStr.trim());
    } catch (parseError) {
      console.error("Error parsing extraction JSON:", parseError);
    }

    return new Response(
      JSON.stringify({
        transcript,
        extracted,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Extract task details error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}
