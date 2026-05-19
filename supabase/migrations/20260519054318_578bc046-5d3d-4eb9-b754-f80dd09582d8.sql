ALTER TABLE public.ai_studio_conversations
  ADD COLUMN IF NOT EXISTS canvas_zoom numeric NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS canvas_pan_x numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS canvas_pan_y numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS focused_canvas_item_id text;