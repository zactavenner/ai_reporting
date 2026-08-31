---
name: Jeremy AI persona registry + request path
description: Jeremy AI talks ONLY to a persona MCP endpoint from the agency_personas registry (send_message + get_response polling); no model calls
type: feature
---
- Jeremy AI (`agency_agents.slug = 'jeremy_ai'`, `capabilities.provider = 'utari_persona'`) is reached ONLY through a persona MCP endpoint. Never route Jeremy through OpenRouter/Lovable AI models.
- **Registry (no hardcoded URLs):** `public.agency_personas` (service-role only — `mcp_url` embeds a bearer token). Masked projection for the UI: `public.v_agency_personas` (host + `has_token` only). Managed via the operator-gated `agency-personas` edge function (`list` / `upsert` / `set_default` / `delete` / `test`) and Settings → Personas.
- Server resolution: `_shared/personas.ts` → `resolvePersona(supa, slug)` = explicit slug → default active → first active → `PERSONA_MCP_URL` env → throws `PersonaNotConfiguredError` (never a silent fallback to another persona).
- Transport: `_shared/utariPersona.ts` → `askUtariPersona({ message, mcpUrl, conversationId })`. `mcpUrl` is required. Contract: `send_message` with `wait_for_reply: false` to get a run handle, then poll `get_response` (`wait_for_reply: false`) every 3s until status is not running (4-minute budget). Send `""` instead of null for `run_id`/`conversation_id`; poll by `conversation_id` when `run_id` is null.
- Threads: `agent_mcp_conversations` is scoped by `(agent_id, COALESCE(client_id), persona_slug)`, so switching persona starts a clean persona conversation. Write it with `savePersonaConversation()` (update-then-insert — the unique index is an expression index PostgREST upsert can't target).
- Callers: `ai-studio` (`jeremy_ai` rail agent, chat-only, accepts `personaSlug` from the composer's Persona picker) and `test-agent` (accepts `persona_slug`; used by `jarvis-goal-worker` → `askJeremy`).
- Seeded persona `jeremy` ("Jeremy (Utari)") points at `persona-mcp.utari.ai`; its token expires 2027-01 — rotate the endpoint in Settings → Personas, not in code.
