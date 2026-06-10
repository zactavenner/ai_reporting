const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LINKEDIN_MCP_URL = Deno.env.get("LINKEDIN_MCP_URL");
    if (!LINKEDIN_MCP_URL) {
      throw new Error("LINKEDIN_MCP_URL is not configured");
    }

    const { tool, arguments: args, password } = await req.json();

    if (password !== "HPA1234$") {
      return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!tool) {
      return new Response(JSON.stringify({ success: false, error: "tool is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Call the MCP server
    const mcpPayload = {
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/call",
      params: {
        name: tool,
        arguments: args || {},
      },
    };

    const mcpResponse = await fetch(LINKEDIN_MCP_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
      },
      body: JSON.stringify(mcpPayload),
    });

    const responseText = await mcpResponse.text();

    // Parse SSE response
    let result = null;
    for (const line of responseText.split("\n")) {
      if (line.startsWith("data: ")) {
        try {
          const parsed = JSON.parse(line.substring(6));
          result = parsed.result || parsed.error;
        } catch {
          // skip
        }
      }
    }

    if (!result) {
      // Try direct JSON parse
      try {
        const parsed = JSON.parse(responseText);
        result = parsed.result || parsed;
      } catch {
        result = { raw: responseText };
      }
    }

    return new Response(JSON.stringify({ success: true, data: result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("linkedin-mcp-proxy error:", error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
