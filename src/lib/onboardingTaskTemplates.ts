export type OnboardingTemplateKey = 'standard' | 'capital';

export const ONBOARDING_TEMPLATE_OPTIONS: { key: OnboardingTemplateKey; label: string; description: string }[] = [
  { key: 'standard', label: 'Standard', description: 'General agency onboarding (intake → ads → funnel → launch)' },
  { key: 'capital', label: 'Capital Raising', description: 'Accredited capital raising SOP — compliance, PPM, investor pipeline' },
];

const STANDARD_TASKS = [
    { category: 'Setup', title: 'Complete client intake form', sort_order: 1 },
    { category: 'Setup', title: 'Upload brand assets (logo, colors, fonts)', sort_order: 2 },
    { category: 'Setup', title: 'Connect GHL sub-account', sort_order: 3 },
    { category: 'Setup', title: 'Set up pipelines & calendar mappings', sort_order: 4 },
    { category: 'Setup', title: 'Configure webhook mappings', sort_order: 5 },
    { category: 'Ads', title: 'Connect Meta ad account', sort_order: 6 },
    { category: 'Ads', title: 'Install Meta pixel on website', sort_order: 7 },
    { category: 'Ads', title: 'Create first ad campaign', sort_order: 8 },
    { category: 'Ads', title: 'Upload initial creatives', sort_order: 9 },
    { category: 'Funnel', title: 'Set up landing page', sort_order: 10 },
    { category: 'Funnel', title: 'Set up booking page', sort_order: 11 },
    { category: 'Funnel', title: 'Configure email/SMS sequences', sort_order: 12 },
    { category: 'Fulfillment', title: 'Generate research report', sort_order: 13 },
    { category: 'Fulfillment', title: 'Generate marketing angles', sort_order: 14 },
    { category: 'Fulfillment', title: 'Generate ad copy & scripts', sort_order: 15 },
    { category: 'Launch', title: 'Client kickoff call completed', sort_order: 16 },
    { category: 'Launch', title: 'Verify pixel tracking', sort_order: 17 },
    { category: 'Launch', title: 'Launch ads', sort_order: 18 },
];

// Capital Raising SOP template — modeled after the AI Capital Raising pipeline
// (compliance, PPM, accredited investor funnel, capital creative ads, investor close).
const CAPITAL_TASKS = [
  { category: 'Compliance & Legal', title: 'Confirm Reg D 506(b) or 506(c) exemption', sort_order: 1 },
  { category: 'Compliance & Legal', title: 'Upload Private Placement Memorandum (PPM)', sort_order: 2 },
  { category: 'Compliance & Legal', title: 'Add subscription agreement & operating agreement', sort_order: 3 },
  { category: 'Compliance & Legal', title: 'Approve mandatory risk disclaimer + “Targeted returns” copy rules', sort_order: 4 },
  { category: 'Compliance & Legal', title: 'Set accredited investor verification process', sort_order: 5 },

  { category: 'Offer Setup', title: 'Define target return %, hold period, and minimum investment', sort_order: 6 },
  { category: 'Offer Setup', title: 'Document fund/asset thesis and track record', sort_order: 7 },
  { category: 'Offer Setup', title: 'Upload investor deck & one-pager', sort_order: 8 },
  { category: 'Offer Setup', title: 'Generate AI offer summary in client_assets', sort_order: 9 },

  { category: 'Brand & Creative', title: 'Load Capital Creative ad style (Deep Green / Gold / Playfair)', sort_order: 10 },
  { category: 'Brand & Creative', title: 'Generate hero return statics (15% / 18% targeted return)', sort_order: 11 },
  { category: 'Brand & Creative', title: 'Generate VSL script + caller script via generate-asset', sort_order: 12 },
  { category: 'Brand & Creative', title: 'Produce 3 avatar ad variations (Veo 3.1)', sort_order: 13 },
  { category: 'Brand & Creative', title: 'Compliance review — no “guaranteed”, disclaimer present', sort_order: 14 },

  { category: 'Funnel', title: 'Build accredited investor opt-in landing page', sort_order: 15 },
  { category: 'Funnel', title: 'Add accreditation qualifier quiz/form', sort_order: 16 },
  { category: 'Funnel', title: 'Set up investor booking calendar (45-min discovery)', sort_order: 17 },
  { category: 'Funnel', title: 'Configure nurture email/SMS sequence with PPM delivery', sort_order: 18 },

  { category: 'Ads', title: 'Connect Meta ad account & install pixel', sort_order: 19 },
  { category: 'Ads', title: 'Create CBO campaign with accredited audience targeting', sort_order: 20 },
  { category: 'Ads', title: 'Upload Capital Creative statics & video ads', sort_order: 21 },
  { category: 'Ads', title: 'Set CPL / CoC% target thresholds & alerts', sort_order: 22 },

  { category: 'CRM & Pipeline', title: 'Connect GHL sub-account & map investor pipeline stages', sort_order: 23 },
  { category: 'CRM & Pipeline', title: 'Set stages: Lead → Qualified → Booked → Showed → Committed → Funded', sort_order: 24 },
  { category: 'CRM & Pipeline', title: 'Wire webhook ingest for accreditation form', sort_order: 25 },
  { category: 'CRM & Pipeline', title: 'Enable Slack channel mapping (creatives + approvals)', sort_order: 26 },

  { category: 'Launch', title: 'Investor kickoff call completed', sort_order: 27 },
  { category: 'Launch', title: 'Verify pixel + lead/call tracking end-to-end', sort_order: 28 },
  { category: 'Launch', title: 'Launch ads & enable daily reporting', sort_order: 29 },
  { category: 'Launch', title: 'Schedule weekly investor pipeline review', sort_order: 30 },
];

export function getOnboardingTemplate(key: OnboardingTemplateKey) {
  return key === 'capital' ? CAPITAL_TASKS : STANDARD_TASKS;
}

export function getTemplatesForClientType(clientType?: string | null) {
  const t = (clientType || '').toLowerCase();
  if (t.includes('capital') || t.includes('invest') || t.includes('fund')) {
    return CAPITAL_TASKS;
  }
  return STANDARD_TASKS;
}

// Map onboarding categories → agency pod name so seeded PM tasks are
// auto-routed to the right department on creation.
export const CATEGORY_TO_POD: Record<string, string> = {
  'Compliance & Legal': 'Account Management',
  'Offer Setup': 'Account Management',
  'Brand & Creative': 'Creatives',
  'Funnel': 'Media Buying',
  'Ads': 'Media Buying',
  'CRM & Pipeline': 'CRM',
  'Setup': 'Account Management',
  'Fulfillment': 'Creatives',
  'Launch': 'Account Management',
};

export function podForCategory(category: string): string | null {
  return CATEGORY_TO_POD[category] ?? 'Account Management';
}
