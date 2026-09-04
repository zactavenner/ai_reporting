// Reference video style library modelled on the Creatives v6 production line.
// Each preset carries a hover-preview clip, a short prompt hint, and the full
// transcribed shot breakdown the AI rewrites per offer.
export type VideoStylePreset = {
  id: string;
  name: string;
  description: string;
  /** Muted preview clip, plays on hover. */
  preview: string;
  /** Prompt direction injected into briefs and video generation. */
  promptHint: string;
  /** Transcribed shot breakdown of the reference clip — the baseline the AI rewrites per offer. */
  baselinePrompt: string;
};

export const VIDEO_STYLE_PRESETS: VideoStylePreset[] = [
  {
    id: "land-aerial",
    baselinePrompt:
      "TRANSCRIBED REFERENCE — Aerial Terms Stack. Format: 9:16 no-presenter cinematic b-roll ad with a persistent stacked-terms overlay. Setting: sweeping drone footage of an entitlement/development story — wide aerial of graded roads cut into arid foothills under a big sky, golden-hour aerial of a development site with a crew of engineers in hi-vis vests and hard hats reviewing plans on a ridge, then a lush aerial push over finished suburban homes with pools and mature trees. Shot pattern: 4-6 second slow drone moves only (forward push, gentle orbit, reveal over a ridge line), no cuts to faces, no talking head; one mid-clip ground-level insert of the crew from behind. Speech: none or a low calm voiceover; the offer is carried entirely by the overlay. Graphics: 5 stacked rounded white caption plates held on screen for the full clip, dark bold sans text, ordered as audience qualifier, track-record proof, return figure, minimum ticket, and asset/geography line. Energy: institutional, quiet-confidence real-asset investing; cinematic ambient score.",
    name: "Aerial Terms Stack",
    description: "Drone b-roll + terms overlay",
    preview: "/style-previews/style-lansing-land.mp4",
    promptHint:
      "cinematic drone b-roll of a land development story (graded roads in arid foothills, hi-vis engineering crew on a ridge at golden hour, aerial over finished suburban homes), no talking head, persistent stack of rounded white terms plates with bold dark text, calm institutional tone",
  },
  {
    id: "podcast-duo",
    baselinePrompt:
      "TRANSCRIBED REFERENCE — Podcast Duo. Format: 9:16 crop of a two-person podcast episode. Setting: dark acoustic-panelled studio, two men in their 40s-50s seated across a table, over-ear headphones, large boom mics on arms, warm key light with a soft rim. Shot pattern: opens on the host mid-sentence in a tight single, cuts to a reverse of the guest nodding, then a two-shot for the payoff. Speech: unscripted conversational cadence — host asks a provocative question, guest answers with a specific number or claim. Graphics: bold uppercase word-by-word captions burned bottom-centre, one keyword highlighted in a brand accent, occasional full-bleed b-roll insert of a building or chart behind an angled diagonal wipe. Energy: credible, calm authority; no music bed, just room tone.",
    name: "Podcast Duo",
    description: "Two-person podcast",
    preview: "/style-previews/style-podcast-duo.mp4",
    promptHint:
      "two-person podcast set, host and guest seated across a table with boom mics, warm studio lighting and set dressing, natural back-and-forth conversation, clean lower-third captions, credible interview tone",
  },

  {
    id: "lakeside",
    baselinePrompt:
      "TRANSCRIBED REFERENCE — Lakeside. Format: 9:16 vertical selfie-to-camera. Setting: affluent lakeside estate, boats and far shoreline behind, bright midday daylight, shallow depth of field. Subject: polished woman in her 40s, neutral linen blazer, styled hair, subtle jewellery, speaks directly to camera while gesturing with one hand. Shot pattern: single continuous handheld medium shot with slight sway, one step of reframe as she leans in for the offer line. Speech: warm advisory tone — opens with a status/identity callout, states the problem, then the invitation. Graphics: light elegant serif or script lower-third with her name/role, minimal captions. Energy: high-trust, unhurried, wealth-adjacent.",
    name: "Lakeside",
    description: "Luxury waterfront advisor",
    preview: "/style-previews/style-lakeside.mp4",
    promptHint:
      "affluent lakeside estate backdrop, bright natural daylight, polished female advisor in neutral linen suit, elegant script captions, calm high-trust tone",
  },
  {
    id: "clinic-walk",
    baselinePrompt:
      "TRANSCRIBED REFERENCE — Clinic Walk. Format: 9:16 handheld selfie walk-and-talk. Setting: bright modern clinic or facility corridor, staff in scrubs moving in the background, cool overhead lighting with daylight from side windows. Subject: friendly woman in her 30s in a coloured coat, arm extended holding the phone, walking toward camera the whole time. Shot pattern: continuous walking single with natural bob, background parallax, one turn into a room at the end. Speech: fast insider tone — 'nobody tells you this' style hook, then a stat, then a soft CTA. Graphics: bold pill-shaped highlight captions with big numbers ('460 million') popping on beat, mid-screen. Energy: energetic, credible-insider, native/organic feel.",
    name: "Clinic Walk",
    description: "Walk & talk selfie",
    preview: "/style-previews/style-clinic-walk.mp4",
    promptHint:
      "handheld selfie walk-and-talk through a bright modern facility, real staff activity in the background, bold pill-shaped caption highlights, conversational insider tone",
  },
  {
    id: "atrium",
    baselinePrompt:
      "TRANSCRIBED REFERENCE — Atrium. Format: 9:16 vertical, walking to camera. Setting: glass atrium office lobby, geometric daylight architecture, glass and steel behind. Subject: credible male expert 50s in a white coat or tailored suit, walking slowly toward a locked-off camera. Shot pattern: locked medium shot as he approaches, subtle push-in, brief cut to an over-shoulder of a screen or document. Speech: measured explainer — names the audience's fear, reframes it, gives the mechanism. Graphics: clean rounded-rectangle caption cards in soft white with blue accent keywords, small floating text bubble callout ('watching your portfolio swing'). Energy: institutional authority, calm, proof-driven.",
    name: "Atrium",
    description: "Corporate authority",
    preview: "/style-previews/style-atrium.mp4",
    promptHint:
      "glass atrium office lobby, daylight architecture, credible expert in a white coat or suit walking to camera, clean blue-accent captions, authoritative explainer tone",
  },
  {
    id: "studio-mic",
    baselinePrompt:
      "TRANSCRIBED REFERENCE — Studio Mic. Format: 9:16 podcast close-up. Setting: warm wood-slat wall, plant, neon or backlit signage bokeh, soft key from camera-left. Subject: attractive woman late 20s, minimal top, a large black condenser microphone prominent in the lower third of frame. Shot pattern: tight static close-up, occasional micro-zoom on emphasis, cut to a wider 3/4 angle for the second beat. Speech: candid podcast-clip delivery — confession-style hook, personal story, then lesson. Graphics: small clean sans captions bottom-centre, subtle waveform or clip-title tag. Energy: intimate, conversational, scroll-stopping face-first framing.",
    name: "Studio Mic",
    description: "Podcast close-up",
    preview: "/style-previews/style-studio-mic.mp4",
    promptHint:
      "warm wood-slat podcast studio with neon sign, large condenser microphone in frame, soft key light, tight close-up framing, candid podcast-clip tone",
  },
  {

    id: "street-interview",
    baselinePrompt:
      "TRANSCRIBED REFERENCE — Street Interview. Format: 9:16 man-on-the-street. Setting: outdoor city sidewalk with a recognisable landmark (bridge/skyline) behind, overcast documentary light. Subject: interviewer's handheld mic entering frame, respondent is a grey-bearded man 60s in a jacket answering candidly. Shot pattern: handheld medium, quick reframes, jump cuts between multiple respondents' answers to the same question. Speech: unscripted question posed off-camera, honest surprised answers, one strong quote used as the hook. Graphics: on-screen question text at top, hard-cut captions, small location tag. Energy: raw, credible, curiosity-driven social proof.",
    name: "Street Interview",
    description: "Man-on-the-street",
    preview: "/style-previews/style-street-interview.mp4",
    promptHint:
      "outdoor street interview with handheld mic, recognizable city landmark backdrop, overcast documentary lighting, candid unscripted reactions",
  },
  {
    id: "explainer-grid",
    baselinePrompt:
      "TRANSCRIBED REFERENCE — Explainer Grid. Format: 9:16, alternating talking head and 3D motion-graphics inserts. Setting: sunlit corporate office, subject seated at a desk with a lapel mic, shallow background. Subject: confident man in a dark suit and red tie, 30s-40s, direct-to-camera delivery with open-hand gestures. Shot pattern: 2-4 second talking-head beats intercut with full-screen graphic panels on a black perspective grid — glowing dollar figures, brand logo plates, buildings and simple arrows animating in. Speech: authority explainer — problem, market size, the money mechanism, then the ask. Graphics: heavy uppercase captions with a coloured keyword per line (green for money, red for risk), big animated numbers, diagonal wipe transitions. Energy: high-conviction financial pitch, fast cuts, driving background bed.",
    name: "Explainer Grid",
    description: "Suited pitch + 3D graphics",
    preview: "/style-previews/style-explainer-grid.mp4",
    promptHint:
      "sunlit office talking head in a dark suit intercut with black-grid 3D motion graphics, glowing money figures and logo plates, uppercase colour-keyed captions, fast authority explainer pacing",
  },
  {
    id: "collage-ugc",
    baselinePrompt:
      "TRANSCRIBED REFERENCE — Collage UGC. Format: 9:16 selfie talking head with torn-paper collage inserts. Setting: bright interior with venetian blinds and soft daylight; inserts are stock photography of the asset/product in a ripped-paper cutout over a coloured field (chalkboard, deep blue). Subject: attractive woman in her 20s, dark wavy hair, black top and delicate gold necklace, hands-forward gestures. Shot pattern: continuous handheld medium selfie, punctuated by 1-2 second collage cutaways with paper-tear transitions. Speech: quick educational cadence — category claim, three reasons, soft CTA. Graphics: serif or stencil title cards ('Expertise'), boxed white-pill captions bottom-third with the key word in dark and the rest in grey. Energy: editorial, credible, magazine-like.",
    name: "Collage UGC",
    description: "Selfie + torn-paper inserts",
    preview: "/style-previews/style-collage-ugc.mp4",
    promptHint:
      "bright interior selfie talking head with venetian blinds, torn-paper collage cutaway inserts over coloured fields, boxed white-pill captions and stencil title cards, editorial educational tone",
  },
  {
    id: "founder-proof",
    baselinePrompt:
      "TRANSCRIBED REFERENCE — Founder Proof. Format: 9:16 mixed-media proof reel. Setting: styled home office / bookshelf backdrop with warm lamps for the host; inserts are flat-colour teal text cards and a tiled grid of smiling users on phones. Subject: polished woman in a floral blouse, dark hair, calm to-camera delivery. Shot pattern: opens on a fast blurred whip-pan, cuts to a bold statement card, then a 9-tile user-grid montage, then settles on the clean talking head for the close. Speech: measured founder/analyst tone — contrarian claim, proof stat ('50 million users'), differentiator. Graphics: thin white sans captions bottom-centre, animated red X and check marks over statement cards, subtle logo lockup. Energy: trust-building proof stack, moderate pacing.",
    name: "Founder Proof",
    description: "Proof stack + user grid",
    preview: "/style-previews/style-founder-proof.mp4",
    promptHint:
      "styled home-office talking head intercut with flat teal statement cards, red X/check marks and a tiled grid montage of users on phones, thin white captions, proof-driven founder tone",
  },
  {
    id: "kitchen-blonde",
    baselinePrompt:
      "TRANSCRIBED REFERENCE — Kitchen Confessional. Format: 9:16 close talking head with data insert. Setting: modern designer kitchen, matte grey cabinetry, warm recessed lighting, subject seated at a white island. Subject: attractive blonde woman late 30s, long straight hair, navy fine-knit top, pearl necklace, animated hand gestures. Shot pattern: tight-to-medium static single with micro reframes, one full-screen dark chart card (revenue curve, ranking badge, big number), then a lifestyle b-roll of hands using the product on a phone. Speech: rhetorical-question hook, insider claim, hard proof number, urgency close. Graphics: magenta/violet highlight-block captions bottom-third, gradient chart card with '#1' badge and growth percentage. Energy: confident insider, punchy, retail-investor friendly.",
    name: "Kitchen Confessional",
    description: "Designer kitchen + data card",
    preview: "/style-previews/style-kitchen-blonde.mp4",
    promptHint:
      "modern designer kitchen talking head, blonde presenter in navy knit at a white island, magenta highlight-block captions, one full-screen gradient revenue chart card and phone b-roll, confident insider pacing",
  },
  {
    id: "claymation",
    baselinePrompt:
      "TRANSCRIBED REFERENCE — Claymation Story. Format: 9:16 fully animated 3D clay/stop-motion style story ad. Setting: stylised miniature sets — cluttered dim home office with a desk lamp, sticky notes and coffee cups, versus a sunlit seaside terrace with an umbrella and potted plants. Subjects: two soft clay-textured characters, one exhausted with stubble and eye bags, one relaxed in a green polo, both at tiny laptops with visible platform logo stickers. Shot pattern: alternating A/B comparison beats, gentle push-ins, tactile handmade props animating on cuts. Speech: warm narrated third-person story — 'Ben does X... John does Y' contrast, ending on the mechanism. Graphics: centred white sans subtitle lines, small platform badges and green up-arrows on the laptops. Energy: charming, contrast-driven, soft playful score.",
    name: "Claymation Story",
    description: "3D clay A/B story",
    preview: "/style-previews/style-claymation.mp4",
    promptHint:
      "3D clay stop-motion style animated ad, two soft clay characters in contrasting miniature sets (cluttered dark office vs sunlit seaside terrace), tiny laptops with platform badges, centred white subtitles, warm narrated A/B story",
  },
  {
    id: "testimonial-cuts",
    baselinePrompt:
      "TRANSCRIBED REFERENCE — Testimonial Cuts. Format: 9:16 UGC testimonial with supporting b-roll. Setting: home interiors for the speaker; inserts include a clinician demonstrating on a patient, an older person moving energetically outdoors, and a macro lab shot of capsules on a tray. Subject: warm woman in her 50s-60s, blonde bob, cardigan, homely natural light, speaking candidly to a handheld phone. Shot pattern: testimonial beat, cut to demonstration b-roll with simple animated icons, cut to lifestyle proof, cut to product/manufacturing macro, back to speaker. Speech: relative-of-user testimonial — 'my husband couldn't believe', symptom language, before/after, product reveal. Graphics: rounded white caption pills with the emphasis word bolder, small animated lightning/pain icons over the demo shot. Energy: authentic, homemade, health-offer credibility.",
    name: "Testimonial Cuts",
    description: "UGC testimonial + b-roll",
    preview: "/style-previews/style-testimonial-cuts.mp4",
    promptHint:
      "authentic homemade UGC testimonial from an older presenter in a home interior, intercut with demonstration b-roll, active lifestyle proof and macro product shots, rounded white caption pills with animated icons",
  },
  {
    id: "doc-vsl",
    baselinePrompt:
      "TRANSCRIBED REFERENCE — Doc VSL. Format: 9:16 documentary-style story VSL with a pinned red headline banner. Setting: real domestic environments — kitchen, living room, hallway — plus a close macro insert of the mechanism/product in use. Subjects: several everyday people, one emotional woman confessing to camera, one older woman taking a capsule at the kitchen table, incidental family/child footage. Shot pattern: cold-open macro curiosity shot, cut to emotional testimony, cut to routine demonstration, cut to consequence footage; slightly imperfect handheld framing throughout. Speech: first-person story arc — dire diagnosis, the turning point, the result; spoken plainly, no polish. Graphics: persistent red-highlighted quote headline at the top ('Doctor said I'd go blind...'), hard black-box captions bottom-third, timeline callouts ('AFTER 8 WEEKS'). Energy: raw documentary curiosity, long-form retention pacing.",
    name: "Doc VSL",
    description: "Story VSL + red headline",
    preview: "/style-previews/style-doc-vsl.mp4",
    promptHint:
      "documentary-style story VSL in real domestic settings, persistent red-highlighted quote headline at top, hard black-box captions and timeline callouts, emotional first-person testimony intercut with routine demonstration and macro inserts, raw handheld feel",
  },
];


/** A style card the gallery can render, whether built in or uploaded in Settings. */
export type StyleCard = {
  id: string;
  name: string;
  description: string;
  preview: string;
  promptHint: string;
  baselinePrompt?: string;
};

/** Combined prompt direction for the selected style names across built-in + custom styles. */
/** The transcribed baseline for a selected style, if any. */
export function videoStyleBaseline(name: string, custom: StyleCard[] = []): string {
  const card = [...VIDEO_STYLE_PRESETS, ...custom].find((c) => c.name === name);
  return card?.baselinePrompt ?? card?.promptHint ?? "";
}

export function videoStyleHint(names: string[], custom: StyleCard[] = []): string {
  return [...VIDEO_STYLE_PRESETS, ...custom]
    .filter((p) => names.includes(p.name))
    .map((p) => p.promptHint)
    .filter(Boolean)
    .join("; ");
}

