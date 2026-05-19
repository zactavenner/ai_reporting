// Reusable Veo3 / Sora prompt templates from the Master Doc.
// Wire into existing video generators by calling `fillPlaceholders`.

export interface Veo3Placeholders {
  SPOKESPERSON_DESC?: string;
  MARKET_CITY?: string;
  ASSET_CLASS?: string;
  PRIMARY_ASSET_DESC?: string;
  TARGET_RETURN?: string;
  TOTAL_DEALS_COMPLETED?: string;
  TOTAL_DISTRIBUTED?: string;
  CLOTHING_ITEM?: string;
}

export const PLACEHOLDER_GUIDE: Record<keyof Veo3Placeholders, string> = {
  SPOKESPERSON_DESC: 'e.g. "blonde businesswoman in a royal-blue blazer and white blouse"',
  MARKET_CITY: 'e.g. "Miami"',
  ASSET_CLASS: 'e.g. "multifamily real-estate fund"',
  PRIMARY_ASSET_DESC: 'e.g. "four-story workforce-housing build"',
  TARGET_RETURN: 'e.g. "nineteen percent" (target return — never use "guaranteed")',
  TOTAL_DEALS_COMPLETED: 'e.g. "two-hundred-fifty million dollars"',
  TOTAL_DISTRIBUTED: 'e.g. "forty million dollars distributed"',
  CLOTHING_ITEM: 'e.g. "blazer", "scarf"',
};

export interface Veo3Template {
  id: string;
  name: string;
  description: string;
  segments: { title: string; scene: string; spokenLine: string }[];
}

export const VEO3_TEMPLATES: Veo3Template[] = [
  {
    id: 'capital-raise-24s',
    name: '3-Segment / 24s Capital Raise Ad',
    description: 'Hook → Credibility → CTA. Each segment ≤ 8s, ultra-realistic 4K 60fps with live background motion.',
    segments: [
      {
        title: 'Segment 1 — Hook (0-8s)',
        scene:
          'Ultra-realistic 4K 60fps, eight-second MEDIUM tracking shot at golden hour. A confident [[SPOKESPERSON_DESC]] walks toward the camera along a palm-lined street/waterfront in [[MARKET_CITY]]. Warm coastal breeze moves their [[CLOTHING_ITEM]]. Behind them, a [[PRIMARY_ASSET_DESC]] rises under active construction; visible background motion — workers shifting materials, a crane swinging, cars passing in soft blur — keeps the scene alive. No captions or on-screen text; natural ambience only.',
        spokenLine:
          'Investors — own a stake in [[MARKET_CITY]]\'s [[ASSET_CLASS]] and target [[TARGET_RETURN]] annually.',
      },
      {
        title: 'Segment 2 — Credibility & Proof (8-16s)',
        scene:
          'Ultra-realistic 4K 60fps, eight-second locked-off MEDIUM shot on a rooftop terrace at golden hour. The same spokesperson takes two natural steps toward a glass railing overlooking the project site and skyline. Sunset lens flare; a light breeze lifts their blazer. Background action: cranes move, workers guide panels, distant traffic hums. No on-screen text.',
        spokenLine:
          'Backed by [[TOTAL_DEALS_COMPLETED]] in completed deals, [[TOTAL_DISTRIBUTED]], and zero capital lost to date.',
      },
      {
        title: 'Segment 3 — Urgency & CTA (16-24s)',
        scene:
          'Ultra-realistic 4K 60fps, eight-second interior MEDIUM shot at golden hour. Inside a staged model unit with floor-to-ceiling windows, the spokesperson enters from a hallway, takes one step toward the camera, and faces the lens. Outside, construction lifts move and cars glide along city streets for subtle motion as soft sunset light fills the room. Natural ambience only; no captions.',
        spokenLine:
          'Book your call now to lock priority allocation before this raise closes.',
      },
    ],
  },
  {
    id: 'capital-raise-hallway-cta',
    name: 'Hallway CTA (8s)',
    description: 'Single 8-second hallway tracking shot for a closing CTA.',
    segments: [
      {
        title: 'Hallway CTA',
        scene:
          'Bright, modern hallway with floor-to-ceiling windows on the right revealing a softly blurred city skyline glowing in warm golden-hour light. To the left, behind glass walls, a small team of architects and planners collaborate energetically around polished tables. A confident [[SPOKESPERSON_DESC]] walks smoothly toward the camera, purposeful yet relaxed, with subtle natural hand gestures and a warm smile. Ultra-realistic 4K 60fps, eight-second medium shot at golden hour.',
        spokenLine:
          'Ready to take the next step? Click the button below, fill out your information, and one of our advisors will be in touch.',
      },
    ],
  },
];

export function fillPlaceholders(text: string, values: Veo3Placeholders): string {
  return Object.entries(values).reduce(
    (acc, [k, v]) => (v ? acc.split(`[[${k}]]`).join(v) : acc),
    text,
  );
}

export function renderTemplate(t: Veo3Template, values: Veo3Placeholders) {
  return t.segments.map((seg) => ({
    title: seg.title,
    scene: fillPlaceholders(seg.scene, values),
    spokenLine: fillPlaceholders(seg.spokenLine, values),
  }));
}