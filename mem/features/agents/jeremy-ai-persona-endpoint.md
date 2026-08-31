---
name: Jeremy AI request path
description: Jeremy AI talks ONLY to the Utari Persona MCP (send_message + get_response polling); no model calls
type: feature
---
- Jeremy AI (`agency_agents.slug = 'jeremy_ai'`, `capabilities.provider = 'utari_persona'`) must be reached ONLY through the Utari Persona MCP endpoint stored in `capabilities.mcp_url` (`https://persona-mcp.utari.ai/mcp/?k=<JWT>`). Never route Jeremy through OpenRouter/Lovable AI models.
- Shared client: `supabase/functions/_shared/utariPersona.ts` → `askUtariPersona()`. Contract: `send_message` with `wait_for_reply: false` to get a run handle, then poll `get_response` (`wait_for_reply: false`) every 3s until status is not running (4-minute budget). `run_id` can be null — always send `""` instead of null (server rejects null with a pydantic validation error) and poll by `conversation_id`.
- Callers: `test-agent` (used by `jarvis-goal-worker` → `askJeremy`) and the `ai-studio` `jeremy_ai` rail agent branch (chat-only, no tools). Persona conversation id persists per (agent_id, client_id) in `agent_mcp_conversations`.
- Token expires 2027-01 (JWT `exp` 1795971935) — refresh `capabilities.mcp_url` when rotated.
