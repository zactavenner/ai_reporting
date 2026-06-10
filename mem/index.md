# Project Memory

## Core
- Supabase with RLS, Edge Functions, Lovable AI Gateway (gemini-2.5-flash). Internal edge auth uses `hpa1234` password in body. No client-side API keys.
- Visuals: Luxury glass-card (forest green, Space Grotesk). Capital Creative style: Deep Green #0B2B26, Gold #C5A55A, Playfair Display.
- Compliance: Never use "guaranteed" for investments. Must use "targeted returns" and mandatory SEC/FINRA risk disclaimers.
- Reporting: Valid leads demand non-empty email AND phone. Read from `v_client_performance_*` views. No live marketing APIs in UI.
- Data Ownership: Automated syncs own Ads/CRM fields. Never manually edit API-owned data.
- Imports: Always use `@/integrations/supabase/client` for Supabase interactions.
- Constraints: Do not use automated connector tools to remediate Slack tokens; fix manually.

## Memories
- [AI Studio v2](mem://features/ai-studio/v2-architecture) — Server-persisted chat per user+client, Manus canvas, Gemini 3 Pro static ads, no image markdown in replies.
