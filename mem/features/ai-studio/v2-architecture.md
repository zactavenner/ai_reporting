---
name: AI Studio v2 Architecture
description: Per-user/client server-persisted chat, Manus canvas, Gemini 3 Pro static ads
type: feature
---
- Tables: ai_studio_conversations (unique user_id+client_id), ai_studio_messages, ai_studio_canvas_items. RLS auth.uid()=user_id. Soft-clear via cleared_at.
- Edge fn `ai-studio` accepts {clientId, userText, docUrl, sheetUrl, quality}. Streams SSE events: conversation, step, text, tool_start, tool_end, canvas_placeholder, canvas_placeholder_failed, canvas_item, error, done. Persists user msg before streaming, assistant msg + tool events after.
- Static ads: `generate_static_ad` tool. quality='pro' calls Gemini 3 Pro Image Preview directly with GEMINI_API_KEY (Ads Generator 5.0 prompt builder ported: aspect→dims, brand colors/fonts, 9:16 safe zone, reference cloning, disclaimer). 'fast' uses Nano Banana 2 via Lovable AI Gateway. Outputs to `creatives/ai-studio/{clientId}/...` and inserts client_assets row (asset_type='static_ad', source='ai_studio').
- System prompt + sanitizeAssistantText strip image markdown / <img> / image URLs from chat replies — images live ONLY on the canvas.
