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

// Capital Raising SOP template — mirrors the official SOP board exactly.
// Items with `parent_title` are nested as sub-subtasks under that parent item
// inside the same category.
const CAPITAL_TASKS: TemplateItem[] = [
  // Client Setup / Requests
  { category: 'Client Setup / Requests', title: 'Add team members to GHL based on emails & numbers provided', sort_order: 1 },
  { category: 'Client Setup / Requests', title: 'Meta Ad account Access', sort_order: 2 },
  { category: 'Client Setup / Requests', parent_title: 'Meta Ad account Access', title: 'Page Created', sort_order: 3 },
  { category: 'Client Setup / Requests', parent_title: 'Meta Ad account Access', title: 'Pixel Created', sort_order: 4 },
  { category: 'Client Setup / Requests', parent_title: 'Meta Ad account Access', title: 'Audience / LLA Audience Created', sort_order: 5 },
  { category: 'Client Setup / Requests', parent_title: 'Meta Ad account Access', title: 'Credit Card Added', sort_order: 6 },
  { category: 'Client Setup / Requests', title: 'Domain DNS Access', sort_order: 7 },
  { category: 'Client Setup / Requests', title: 'Connect Calendar with GHL', sort_order: 8 },
  { category: 'Client Setup / Requests', title: 'Download Phone App for GoHighLevel', sort_order: 9 },
  { category: 'Client Setup / Requests', title: 'Setup Availability', sort_order: 10 },
  { category: 'Client Setup / Requests', title: 'Purchase Phone Number with Person Identification', sort_order: 11 },
  { category: 'Client Setup / Requests', title: 'Ad / FAQ Videos', sort_order: 12 },
  { category: 'Client Setup / Requests', parent_title: 'Ad / FAQ Videos', title: 'Edit Videos', sort_order: 13 },
  { category: 'Client Setup / Requests', parent_title: 'Ad / FAQ Videos', title: 'Get Approval', sort_order: 14 },
  { category: 'Client Setup / Requests', title: 'Add $97/month Subscription to NK Account (If they are using our platform)', sort_order: 15 },
  { category: 'Client Setup / Requests', title: 'Client to Purchase Phone Number & ID Verification', sort_order: 16 },

  // Ads
  { category: 'Ads', title: 'Setup Business Portfolio or Get Access', sort_order: 17 },
  { category: 'Ads', title: 'Setup Ad Account with Billing', sort_order: 18 },
  { category: 'Ads', title: 'Credit Card is on File (spending limit is good)', sort_order: 19 },
  { category: 'Ads', title: 'Ad Account Warm Up Completed', sort_order: 20 },
  { category: 'Ads', parent_title: 'Ad Account Warm Up Completed', title: '$25/day Engagment Likes Campaign (no images or text)', sort_order: 21 },
  { category: 'Ads', parent_title: 'Ad Account Warm Up Completed', title: 'Wait Until $5 is spent then move to next campaign', sort_order: 22 },
  { category: 'Ads', title: 'Setup Audiences on Meta', sort_order: 23 },
  { category: 'Ads', parent_title: 'Setup Audiences on Meta', title: 'LLA - Funded Investors', sort_order: 24 },
  { category: 'Ads', parent_title: 'Setup Audiences on Meta', title: 'LLA - Investor Leads', sort_order: 25 },
  { category: 'Ads', title: 'Pixel is Setup on Funnel', sort_order: 26 },
  { category: 'Ads', title: 'Setup Lead Form - DQ Non Accredited', sort_order: 27 },
  { category: 'Ads', title: 'Review Copy & Creatives', sort_order: 28 },
  { category: 'Ads', title: 'Create Ad Campaign with Copy & Creatives', sort_order: 29 },
  { category: 'Ads', title: 'Launch Final Lead Gen - Ad Campaign After Approval', sort_order: 30 },
  { category: 'Ads', title: 'API Meta Ads Setup', sort_order: 31 },
  { category: 'Ads', title: 'Make Sure Comment Guard is setup with MODERATION & AGENT to reply to comments', sort_order: 32 },

  // CRM
  { category: 'CRM', title: 'Set-Up For A2P & Phone Number', sort_order: 33 },
  { category: 'CRM', parent_title: 'Set-Up For A2P & Phone Number', title: 'Submit A2P', sort_order: 34 },
  { category: 'CRM', parent_title: 'Set-Up For A2P & Phone Number', title: 'Purchase Phone Numbers (1 For Each Location)', sort_order: 35 },
  { category: 'CRM', title: 'Reporting Setup - Google Sheets', sort_order: 36 },
  { category: 'CRM', parent_title: 'Reporting Setup - Google Sheets', title: 'Add sheet to Current Clients Tab under Client Name', sort_order: 37 },
  { category: 'CRM', parent_title: 'Reporting Setup - Google Sheets', title: 'Shared with Client', sort_order: 38 },
  { category: 'CRM', parent_title: 'Reporting Setup - Google Sheets', title: 'Leads Connected', sort_order: 39 },
  { category: 'CRM', parent_title: 'Reporting Setup - Google Sheets', title: 'Funded Connected', sort_order: 40 },
  { category: 'CRM', parent_title: 'Reporting Setup - Google Sheets', title: 'Committed Connected', sort_order: 41 },
  { category: 'CRM', parent_title: 'Reporting Setup - Google Sheets', title: 'Booked Calls Connected', sort_order: 42 },
  { category: 'CRM', parent_title: 'Reporting Setup - Google Sheets', title: 'Call Transcript > Sheet Connected', sort_order: 43 },
  { category: 'CRM', parent_title: 'Reporting Setup - Google Sheets', title: 'Make > Ad Spend Reporting Tab', sort_order: 44 },
  { category: 'CRM', title: 'Funnel Setup', sort_order: 45 },
  { category: 'CRM', parent_title: 'Funnel Setup', title: 'Link sub-domain to Funnel or purchase domain', sort_order: 46 },
  { category: 'CRM', parent_title: 'Funnel Setup', title: 'Calendar Page', sort_order: 47 },
  { category: 'CRM', parent_title: 'Funnel Setup', title: 'Use CHATGPT TO REVIEW IT FOR FEEDBACK', sort_order: 48 },
  { category: 'CRM', parent_title: 'Funnel Setup', title: 'Get Approval from Manager', sort_order: 49 },
  { category: 'CRM', parent_title: 'Funnel Setup', title: 'Setup Thank You Page with Video using AI or from Client (Include Pitch Deck Here to Download)', sort_order: 50 },
  { category: 'CRM', title: 'Communicate Status of Setup Completion', sort_order: 51 },
  { category: 'CRM', title: 'Phase 2 (1 Week Out After Launch)', sort_order: 52 },
  { category: 'CRM', parent_title: 'Phase 2 (1 Week Out After Launch)', title: 'AI Setter (Use Prompt)', sort_order: 53 },
  { category: 'CRM', parent_title: 'Phase 2 (1 Week Out After Launch)', title: 'AI Caller', sort_order: 54 },
  { category: 'CRM', parent_title: 'Phase 2 (1 Week Out After Launch)', title: 'AI Transcript > Google Sheet', sort_order: 55 },
  { category: 'CRM', parent_title: 'Phase 2 (1 Week Out After Launch)', title: 'AI Video with VEO3', sort_order: 56 },
  { category: 'CRM', parent_title: 'Phase 2 (1 Week Out After Launch)', title: 'Customer File of Old Leads', sort_order: 57 },
  { category: 'CRM', parent_title: 'Phase 2 (1 Week Out After Launch)', title: 'Google Ads Account', sort_order: 58 },
  { category: 'CRM', title: 'VSL Creation (ONLY IF NOT PROVIDED)', sort_order: 59 },
  { category: 'CRM', parent_title: 'VSL Creation (ONLY IF NOT PROVIDED)', title: 'Take Survey, Website and Create VSL Script', sort_order: 60 },
  { category: 'CRM', parent_title: 'VSL Creation (ONLY IF NOT PROVIDED)', title: 'Upload to GAMMA.APP', sort_order: 61 },
  { category: 'CRM', parent_title: 'VSL Creation (ONLY IF NOT PROVIDED)', title: 'Export as PDF > Canva', sort_order: 62 },
  { category: 'CRM', parent_title: 'VSL Creation (ONLY IF NOT PROVIDED)', title: 'Share Embed Code of Slides & Put onto GHL Funnel', sort_order: 63 },

  // Creatives
  { category: 'Creatives', title: 'Create 20 Creatives for Fund', sort_order: 64 },
  { category: 'Creatives', title: 'Create 4 - 30 second Video Ads', sort_order: 65 },
  { category: 'Creatives', parent_title: 'Create 4 - 30 second Video Ads', title: 'Podcast Style', sort_order: 66 },
  { category: 'Creatives', parent_title: 'Create 4 - 30 second Video Ads', title: 'Deal Overview with Numbers as Hook', sort_order: 67 },
  { category: 'Creatives', parent_title: 'Create 4 - 30 second Video Ads', title: 'UGC STYLE (Rv Park = Scence is selfie style at RV park talking about fund)', sort_order: 68 },
  { category: 'Creatives', parent_title: 'Create 4 - 30 second Video Ads', title: 'Market Trend Hook, Body, CTA', sort_order: 69 },
];

export type TemplateItem = { category: string; title: string; sort_order: number; parent_title?: string | null };

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

/**
 * Load an onboarding template from the database (admin-editable).
 * Falls back to the bundled defaults if no rows are configured for the key.
 */
export async function fetchOnboardingTemplate(
  key: OnboardingTemplateKey,
): Promise<TemplateItem[]> {
  const { supabase } = await import('@/integrations/supabase/client');
  const { data, error } = await supabase
    .from('onboarding_template_items' as any)
    .select('category, parent_title, title, sort_order')
    .eq('template_key', key)
    .order('sort_order', { ascending: true });
  if (error) {
    console.warn('[onboarding-template] fetch failed, using bundled default', error);
    return getOnboardingTemplate(key);
  }
  if (!data || data.length === 0) return getOnboardingTemplate(key);
  return data as any;
}

// Map onboarding categories → agency pod name so seeded PM tasks are
// auto-routed to the right department on creation.
export const CATEGORY_TO_POD: Record<string, string> = {
  'Client Setup / Requests': 'Account Management',
  'Ads': 'Media Buying',
  'CRM': 'CRM',
  'Creatives': 'Creatives',
  'Compliance & Legal': 'Account Management',
  'Offer Setup': 'Account Management',
  'Brand & Creative': 'Creatives',
  'Funnel': 'Media Buying',
  'Setup': 'Account Management',
  'Fulfillment': 'Creatives',
  'Launch': 'Account Management',
};

export function podForCategory(category: string): string | null {
  return CATEGORY_TO_POD[category] ?? 'Account Management';
}
