// Capital Raising playbook thresholds + checklists from the Master Doc.
// Used by the Constraint Diagnostics engine.

export type ConstraintType =
  | 'high_cpbc'
  | 'low_show_rate'
  | 'low_close_rate'
  | 'low_quality';

export const KPI_THRESHOLDS = {
  cpbcMax: 250, // CPBC > $250 = high
  cplcMax: 200, // cost per LIVE qualified call target
  showRateMin: 0.6, // sub 60% = low
  closeRateMin: 0.25, // sub 25% = low
  cashRoasMin: 2,
  revRoasMin: 5,
} as const;

export interface ChecklistItem {
  key: string;
  label: string;
  hint?: string;
}

export interface ChecklistSection {
  type: string;
  title: string;
  items: ChecklistItem[];
}

export const CHECKLISTS: ChecklistSection[] = [
  {
    type: 'cpbc',
    title: 'High CPBC Checklist',
    items: [
      { key: 'audiences', label: 'Test different audience segments (influencers, softwares, podcasts, books, fields/titles)' },
      { key: 'laa', label: 'Run LAA tests at 1%–10% from client list, scraped leads, past bookings, opt-ins, video viewers' },
      { key: 'opt_event', label: 'Test optimization event: leads vs schedule (with and without opt-in)' },
      { key: 'funnel_struct', label: 'Test removing opt-in / DSL vs VSL / straight-to-calendar' },
      { key: 'qual_msg', label: 'Add qualifying disclaimer messaging on ads + funnel + booking page' },
      { key: 'results_proof', label: 'Add more and bigger results / testimonials' },
      { key: 'creatives', label: 'Refresh creatives: 5–10 new intros paired with best body + CTA' },
      { key: 'partial_offer', label: 'Partial offer change — sharper specificity in the guarantee' },
    ],
  },
  {
    type: 'funnel',
    title: 'Funnel Checklist',
    items: [
      { key: 'dsl', label: 'Test ads straight to a Deck Sales Letter (no opt-in, optimized for schedule)' },
      { key: 'cal_direct', label: 'Test ads straight to the calendar (optimized for schedule)' },
      { key: 'discl', label: 'Add qualifying disclaimers throughout funnel + booking page' },
      { key: 'friction_qs', label: 'Add friction-based questions (revenue, business model, intent)' },
      { key: 'price_q', label: '(B2C) Add price-range question with auto-cancel for "No"' },
    ],
  },
  {
    type: 'audience',
    title: 'Audience Checklist',
    items: [
      { key: 'overqual_list', label: 'Source an over-qualified lead list and rebuild 1% & 2% LAAs' },
      { key: 'recreate_laa', label: 'Recreate LAAs with updated qualified call / lead lists' },
      { key: 'segments', label: 'Test segments: influencers, softwares, podcasts, books, magazines, job titles' },
    ],
  },
  {
    type: 'offer',
    title: 'Offer Checklist',
    items: [
      { key: 'rewrite_offer', label: 'Restructure offer around a higher outcome (further-down-funnel metric)' },
      { key: 'rewrite_scripts', label: 'Rewrite ad scripts + copy for the new angle (do NOT re-record VSL yet)' },
      { key: 'dsl_launch', label: 'Launch new offer ads with updated copy + DSL' },
      { key: 'validate_then_vsl', label: 'Only re-record VSL once new offer is proven to outperform' },
    ],
  },
  {
    type: 'pre_booking',
    title: 'Pre-Booking Checklist (Show Rate)',
    items: [
      { key: 'strict_msg', label: 'HYPER specific / strict messaging on ads + funnel' },
      { key: 'opt_sched', label: 'Test optimize for schedule (higher-quality FB segment)' },
      { key: 'dsl_vs_vsl', label: 'Test DSL vs VSL' },
      { key: 'ip_q', label: 'Calendly IP question: "Are you 100% able to show up?"' },
      { key: 'price_q', label: '(B2C) Add price range to Calendly question' },
      { key: 'fee_q', label: '$97 no-show fee question (track CPLC vs CPBC trade-off)' },
    ],
  },
  {
    type: 'post_booking',
    title: 'Post-Booking Checklist (Show Rate)',
    items: [
      { key: 'tyv_structure', label: 'Thank-you page: accept invite image + $97 fee callout + TY video + training' },
      { key: 'cancel_unqual', label: 'Cancel unqualified bookings + obvious no-shows (gmail, 1-word answers, fake info)' },
      { key: 'confirm_seq', label: 'Immediate SMS + email "reply to confirm" sequence (cancel non-responders)' },
      { key: 'native_reminders', label: 'Native calendar reminders at 12h / 3h / 1h prior' },
      { key: 'social_connect', label: 'Connect on socials where applicable' },
      { key: 'zoom_q', label: 'Night-before + morning-of Zoom link confirmation Q' },
      { key: 'manual_call', label: 'Setter/closer call no-shows at scheduled time' },
    ],
  },
  {
    type: 'close_rate',
    title: 'Close Rate Checklist',
    items: [
      { key: 'qc_calls', label: 'QC sales calls — review at least 5 recent calls' },
      { key: 'follow_up', label: 'Confirm a follow-up is booked ON the call (not after)' },
      { key: 'collect_card', label: 'Collect payment on the call (no "think about it" exits)' },
      { key: 'objection_doc', label: 'Build objection-handling doc from real call patterns' },
      { key: 'closer_training', label: 'Daily team calls + closer training reinforcement' },
    ],
  },
];

export interface FunnelSnapshot {
  cpbc?: number;
  showRate?: number;
  closeRate?: number;
  cashRoas?: number;
  revRoas?: number;
  cplc?: number;
  noShows?: number;
  canceledUnqual?: number;
}

export function diagnoseConstraint(s: FunnelSnapshot): {
  constraint: ConstraintType;
  reason: string;
  recommendedChecklists: string[];
} {
  const t = KPI_THRESHOLDS;
  if ((s.canceledUnqual ?? 0) > (s.noShows ?? 0) * 2 && (s.canceledUnqual ?? 0) >= 25) {
    return {
      constraint: 'low_quality',
      reason: 'Most lost calls are cancellations due to unqualified leads — quality, not show rate.',
      recommendedChecklists: ['audience', 'offer', 'funnel'],
    };
  }
  if (s.showRate !== undefined && s.showRate < t.showRateMin) {
    return {
      constraint: 'low_show_rate',
      reason: `Show rate ${(s.showRate * 100).toFixed(0)}% < ${t.showRateMin * 100}% target.`,
      recommendedChecklists: ['pre_booking', 'post_booking'],
    };
  }
  if (s.closeRate !== undefined && s.closeRate < t.closeRateMin) {
    return {
      constraint: 'low_close_rate',
      reason: `Close rate ${(s.closeRate * 100).toFixed(0)}% < ${t.closeRateMin * 100}% target.`,
      recommendedChecklists: ['close_rate'],
    };
  }
  if (s.cpbc !== undefined && s.cpbc > t.cpbcMax) {
    return {
      constraint: 'high_cpbc',
      reason: `CPBC $${s.cpbc.toFixed(0)} > $${t.cpbcMax} target.`,
      recommendedChecklists: ['cpbc', 'funnel', 'audience'],
    };
  }
  return {
    constraint: 'high_cpbc',
    reason: 'Metrics within KPI — review checklists proactively to keep them there.',
    recommendedChecklists: ['cpbc'],
  };
}

export const WELCOME_MESSAGE_TEMPLATE = `Hi {{first_name}}, welcome aboard! 🎉

This group will be your main hub for updates, quick communication, and support as we get started.

👉 Please make sure you've completed these steps today:

1. Fill out the onboarding form: https://aicapitalraising.com/onboarding
2. Grant Meta access: https://aicapitalraising.com/access
3. Schedule weekly call with me: https://aicapitalraising.com/review

Once the form is submitted, our system automatically sets up your Google doc, ad copy, subaccount, and project tasks so we can kick things off fast.

We're excited to get started and make this a big success together!

— {{am_name}}`;

export const KICKOFF_AGENDA = [
  { title: 'Welcome & Expectations', minutes: 3, note: 'Quick intro & set expectations for today\'s call' },
  { title: 'Current Status & Next Steps', minutes: 5, note: 'Recap and overview of what\'s been completed & outstanding' },
  { title: 'Scorecard Walkthrough', minutes: 3, note: 'New Lead → Booked → Funded → Scorecard flow' },
  { title: 'Review Campaign Assets', minutes: 7, note: 'Walk through creatives, ad copy, funnel (preview)' },
  { title: 'Access & Task Completion', minutes: 5, note: 'Review outstanding access / tasks needed from client' },
  { title: 'Capital Calculator & Scaling', minutes: 5, note: 'Expected ad spend vs return, scaling strategy, funding timeline' },
  { title: 'Q&A & Next Steps', minutes: 2, note: 'Answer questions and recap action items' },
  { title: 'Closing', minutes: 2, note: 'Reiterate key goals and alignment' },
];

export const KICKOFF_LINKS = [
  { label: 'Pitch Deck', url: 'https://deck.aicapitalraising.com' },
  { label: 'Capital Calculator', url: 'https://aicapitalraising.com/calculator' },
  { label: 'Onboarding Form', url: 'https://aicapitalraising.com/onboarding' },
  { label: 'Meta Access', url: 'https://aicapitalraising.com/access' },
  { label: 'Schedule Weekly Review', url: 'https://aicapitalraising.com/review' },
  { label: 'Client Resources', url: 'https://aicapitalraising.com/client' },
];