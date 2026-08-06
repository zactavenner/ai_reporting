CREATE TABLE public.onboarding_prompts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  section text NOT NULL,
  label text NOT NULL,
  description text,
  prompt text NOT NULL,
  default_prompt text NOT NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.onboarding_prompts TO authenticated;
GRANT ALL ON public.onboarding_prompts TO service_role;

ALTER TABLE public.onboarding_prompts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read onboarding prompts"
  ON public.onboarding_prompts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert onboarding prompts"
  ON public.onboarding_prompts FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update onboarding prompts"
  ON public.onboarding_prompts FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated can delete onboarding prompts"
  ON public.onboarding_prompts FOR DELETE TO authenticated USING (true);

CREATE TRIGGER onboarding_prompts_updated_at
  BEFORE UPDATE ON public.onboarding_prompts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.onboarding_prompts (key, section, label, description, prompt, default_prompt, meta, sort_order) VALUES
('mission_header','brief','Mission header','Opening instruction handed to the Jarvis mission engine.','Build the COMPLETE onboarding asset suite for {{client_name}} end to end, working with Jeremy AI and the client''s specialist agents. Save every deliverable with save_asset (library + AI Studio canvas) as you finish it.','Build the COMPLETE onboarding asset suite for {{client_name}} end to end, working with Jeremy AI and the client''s specialist agents. Save every deliverable with save_asset (library + AI Studio canvas) as you finish it.','{}',10),
('offer_summary','deliverables','1. Offer summary','asset_type: offer_summary','offer_summary — summary of the offer, the location/market, the unique strategy and the credibility proof.','offer_summary — summary of the offer, the location/market, the unique strategy and the credibility proof.','{"asset_type":"offer_summary"}',20),
('angles','deliverables','2. Marketing angles','asset_type: angles','angles — 5 distinct marketing angles, each with the audience, the core belief being shifted and why it wins.','angles — 5 distinct marketing angles, each with the audience, the core belief being shifted and why it wins.','{"asset_type":"angles"}',30),
('ad_copy','deliverables','3. Ad copy','asset_type: ad_copy','ad_copy — 5 ad copy variants, each with 3 headline options, primary text and CTA.','ad_copy — 5 ad copy variants, each with 3 headline options, primary text and CTA.','{"asset_type":"ad_copy"}',40),
('nurture_emails','deliverables','4. Nurture emails','asset_type: nurture_emails','nurture_emails — 10 nurture emails (subject + preview + body), sequenced with purpose per email.','nurture_emails — 10 nurture emails (subject + preview + body), sequenced with purpose per email.','{"asset_type":"nurture_emails"}',50),
('appointment_reminders','deliverables','5. Appointment reminders','asset_type: appointment_reminders','appointment_reminders — appointment reminder set: confirmation + 24h + 1h emails AND the matching SMS messages.','appointment_reminders — appointment reminder set: confirmation + 24h + 1h emails AND the matching SMS messages.','{"asset_type":"appointment_reminders"}',60),
('vsl','deliverables','6. VSL script','asset_type: vsl','vsl — a full VSL script with timestamps and the hook/story/offer/close structure.','vsl — a full VSL script with timestamps and the hook/story/offer/close structure.','{"asset_type":"vsl"}',70),
('video_scripts','deliverables','7. Video ad scripts','asset_type: video_scripts','video_scripts — 5 video ad scripts (hook, body, CTA, on-screen text, shot notes), written for a female spokesperson around 30.','video_scripts — 5 video ad scripts (hook, body, CTA, on-screen text, shot notes), written for a female spokesperson around 30.','{"asset_type":"video_scripts"}',80),
('faq_scripts','deliverables','8. FAQ video scripts','asset_type: faq_scripts','faq_scripts — 5 FAQ video scripts answering the real objections of this investor profile.','faq_scripts — 5 FAQ video scripts answering the real objections of this investor profile.','{"asset_type":"faq_scripts"}',90),
('static_ad_brief','deliverables','9. Static ad direction','asset_type: static_ad_brief','static_ad_brief — the creative direction for the statics, then call generate_static_ads ONCE with count 10. That is the entire static budget: 10 creatives, each on its own concept slot and aspect ratio. Do not call it a second time.','static_ad_brief — the creative direction for the statics, then call generate_static_ads ONCE with count 10. That is the entire static budget: 10 creatives, each on its own concept slot and aspect ratio. Do not call it a second time.','{"asset_type":"static_ad_brief"}',100),
('avatar','deliverables','10. Client avatar','tool: create_client_avatar','create_client_avatar — create and assign the client avatar: attractive professional female, around 30, warm and credible on camera.','create_client_avatar — create and assign the client avatar: attractive professional female, around 30, warm and credible on camera.','{"tool":"create_client_avatar"}',110),
('static_market-thesis','statics','Static — Market thesis','1:1','Bold market-thesis statement card: why this market and why now, one confident sentence, data-led.','Bold market-thesis statement card: why this market and why now, one confident sentence, data-led.','{"slot":"market-thesis","ratio":"1:1"}',200),
('static_fund-terms','statics','Static — Fund terms','4:5','Clean fund terms card: minimum investment, hold period and targeted returns laid out as a tight spec sheet.','Clean fund terms card: minimum investment, hold period and targeted returns laid out as a tight spec sheet.','{"slot":"fund-terms","ratio":"4:5"}',210),
('static_track-record','statics','Static — Track record','1:1','Credibility / track record proof: prior performance and operator history rendered as a trust badge layout.','Credibility / track record proof: prior performance and operator history rendered as a trust badge layout.','{"slot":"track-record","ratio":"1:1"}',220),
('static_distributions','statics','Static — Distributions','9:16','Distribution schedule angle: cadence of income, calm premium chart-style visual.','Distribution schedule angle: cadence of income, calm premium chart-style visual.','{"slot":"distributions","ratio":"9:16"}',230),
('static_tax-advantage','statics','Static — Tax advantage','4:5','Tax advantage angle: the structural benefit stated plainly with a document/ledger visual motif.','Tax advantage angle: the structural benefit stated plainly with a document/ledger visual motif.','{"slot":"tax-advantage","ratio":"4:5"}',240),
('static_entry-point','statics','Static — Entry point','1:1','Entry point clarity: what it takes to participate, removing the ''this isn''t for me'' objection.','Entry point clarity: what it takes to participate, removing the ''this isn''t for me'' objection.','{"slot":"entry-point","ratio":"1:1"}',250),
('static_timing','statics','Static — Timing','9:16','Timing / scarcity of the window, framed on real market conditions — never hype, never promissory.','Timing / scarcity of the window, framed on real market conditions — never hype, never promissory.','{"slot":"timing","ratio":"9:16"}',260),
('static_spokesperson','statics','Static — Spokesperson','4:5','Spokesperson credibility portrait with a short authority quote overlaid.','Spokesperson credibility portrait with a short authority quote overlaid.','{"slot":"spokesperson","ratio":"4:5"}',270),
('static_risk-managed','statics','Static — Risk managed','1:1','Risk-managed framing: how downside is controlled, with the required risk disclaimer visible.','Risk-managed framing: how downside is controlled, with the required risk disclaimer visible.','{"slot":"risk-managed","ratio":"1:1"}',280),
('static_direct-cta','statics','Static — Direct CTA','9:16','Direct call-to-action: book the call, accredited-investor callout, minimal and high-contrast.','Direct call-to-action: book the call, accredited-investor callout, minimal and high-contrast.','{"slot":"direct-cta","ratio":"9:16"}',290),
('video_podcast','videos','Video — Podcast clip','30s · 9:16','Podcast-style two-shot: spokesperson mid-conversation on a mic, natural head movement and hand gestures, warm studio lighting, shallow depth of field, looks like a clipped long-form episode.','Podcast-style two-shot: spokesperson mid-conversation on a mic, natural head movement and hand gestures, warm studio lighting, shallow depth of field, looks like a clipped long-form episode.','{"slot":"podcast","label":"Podcast clip"}',300),
('video_street_interview','videos','Video — Street interview','30s · 9:16','Street interview: handheld camera, spokesperson answering on a busy city sidewalk, natural ambient movement of people behind, slight camera sway, candid documentary feel.','Street interview: handheld camera, spokesperson answering on a busy city sidewalk, natural ambient movement of people behind, slight camera sway, candid documentary feel.','{"slot":"street_interview","label":"Street interview"}',310),
('video_walk_and_talk','videos','Video — Walk and talk','30s · 9:16','Walk-and-talk: spokesperson walking toward camera through a business district, camera tracking backward, natural gait, hair and clothing moving, continuous motion throughout.','Walk-and-talk: spokesperson walking toward camera through a business district, camera tracking backward, natural gait, hair and clothing moving, continuous motion throughout.','{"slot":"walk_and_talk","label":"Walk and talk"}',320),
('video_broll','videos','Video — B-roll narration','30s · 9:16','Cinematic b-roll: slow dolly and crane moves over the market/asset, no talking head, motion in every frame, narration-driven.','Cinematic b-roll: slow dolly and crane moves over the market/asset, no talking head, motion in every frame, narration-driven.','{"slot":"broll","label":"B-roll narration"}',330),
('video_split_screen','videos','Video — Split screen','30s · 9:16','Split screen: the 9:16 frame is divided into two stacked halves by a hard horizontal split. The spokesperson is a talking head filling ONE half (bottom by default, top on the second beat) and the other half carries supporting visual proof (asset b-roll, chart, screen recording) that is always moving. Perfect lip sync, audio from the speaker only, captions on the seam.','Split screen: the 9:16 frame is divided into two stacked halves by a hard horizontal split. The spokesperson is a talking head filling ONE half (bottom by default, top on the second beat) and the other half carries supporting visual proof (asset b-roll, chart, screen recording) that is always moving. Perfect lip sync, audio from the speaker only, captions on the seam.','{"slot":"split_screen","label":"Split screen"}',340),
('output_limits','workflow','Hard output limits','Budget rules the tools enforce.','HARD OUTPUT LIMITS FOR THIS ONBOARDING (enforced by the tools):
 - Exactly 10 static creatives, all driven by THIS client''s offer above — no generic fund filler.
 - Exactly 5 videos, 30 seconds each, natural and full of motion, one per style: podcast clip, street interview, walk-and-talk, cinematic b-roll, split screen (speaker in one half of the frame, supporting visual in the other).
 - When a generator reports its budget is exhausted, that deliverable is done. Never re-run it.','HARD OUTPUT LIMITS FOR THIS ONBOARDING (enforced by the tools):
 - Exactly 10 static creatives, all driven by THIS client''s offer above — no generic fund filler.
 - Exactly 5 videos, 30 seconds each, natural and full of motion, one per style: podcast clip, street interview, walk-and-talk, cinematic b-roll, split screen (speaker in one half of the frame, supporting visual in the other).
 - When a generator reports its budget is exhausted, that deliverable is done. Never re-run it.','{}',400),
('review_workflow','workflow','Review & approval workflow','Jeremy consults, approval gates, video production, final report.','THEN:
A. Consult Jeremy (ask_jeremy) on the angles, the ad copy and the video scripts BEFORE finalising them, and record_decision with his verdict each time.
B. request_approval with queue_type "creative_review" for the static ads + avatar (list the creative ids / urls in the payload).
C. request_approval with queue_type "video_scripts" for the 5 video ad scripts + 5 FAQ scripts.
D. Poll check_approval. ONLY once the video_scripts approval is "approved" may you produce videos: pick the 5 strongest approved scripts and call generate_video once per style (podcast, street_interview, walk_and_talk, broll, split_screen) with the avatar image, duration 30, 9:16 — then poll check_video_job.
E. If an approval is rejected, read the rejection reason, rewrite the affected deliverable, save it again and request approval once more.
F. finish_mission with a markdown report: deliverables saved, creatives generated, Jeremy verdicts, approval states and videos produced.','THEN:
A. Consult Jeremy (ask_jeremy) on the angles, the ad copy and the video scripts BEFORE finalising them, and record_decision with his verdict each time.
B. request_approval with queue_type "creative_review" for the static ads + avatar (list the creative ids / urls in the payload).
C. request_approval with queue_type "video_scripts" for the 5 video ad scripts + 5 FAQ scripts.
D. Poll check_approval. ONLY once the video_scripts approval is "approved" may you produce videos: pick the 5 strongest approved scripts and call generate_video once per style (podcast, street_interview, walk_and_talk, broll, split_screen) with the avatar image, duration 30, 9:16 — then poll check_video_job.
E. If an approval is rejected, read the rejection reason, rewrite the affected deliverable, save it again and request approval once more.
F. finish_mission with a markdown report: deliverables saved, creatives generated, Jeremy verdicts, approval states and videos produced.','{}',410);