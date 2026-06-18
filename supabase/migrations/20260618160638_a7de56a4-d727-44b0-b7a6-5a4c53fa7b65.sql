CREATE TABLE public.meta_mcp_tool_calls (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  user_id UUID,
  tool_name TEXT NOT NULL,
  arguments JSONB NOT NULL DEFAULT '{}'::jsonb,
  response JSONB,
  success BOOLEAN NOT NULL DEFAULT true,
  error TEXT,
  duration_ms INTEGER,
  source TEXT NOT NULL DEFAULT 'mcp-agent-server',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT ON public.meta_mcp_tool_calls TO authenticated;
GRANT ALL ON public.meta_mcp_tool_calls TO service_role;

ALTER TABLE public.meta_mcp_tool_calls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view meta mcp tool calls"
  ON public.meta_mcp_tool_calls FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Service role manages meta mcp tool calls"
  ON public.meta_mcp_tool_calls FOR ALL
  TO service_role USING (true) WITH CHECK (true);

CREATE INDEX idx_meta_mcp_tool_calls_client_created ON public.meta_mcp_tool_calls(client_id, created_at DESC);
CREATE INDEX idx_meta_mcp_tool_calls_tool ON public.meta_mcp_tool_calls(tool_name, created_at DESC);