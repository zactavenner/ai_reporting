// Helpers for classifying weekly-call / huddle action items into a category
// and suggesting an assignee. Assignee mapping is intentionally simple: it
// checks whether a task title mentions a team member by name, otherwise falls
// back to a category → member preference stored in localStorage.

export type TaskCategory = 'crm' | 'ads' | 'creative' | 'team' | 'ops' | 'other';

const CATEGORY_KEYWORDS: Record<Exclude<TaskCategory, 'other'>, RegExp> = {
  crm: /\b(crm|ghl|gohighlevel|hubspot|pipeline|lead|contact|follow[- ]?up|sms|email sequence|nurture|disposition|setter|booked|no[- ]show)\b/i,
  ads: /\b(ads?|meta|facebook|instagram|campaign|adset|budget|cpl|cpa|roas|spend|creative test|targeting)\b/i,
  creative: /\b(creative|video|edit|thumbnail|hook|script|copy|design|render|caption|voiceover|b[- ]?roll)\b/i,
  team: /\b(team|hire|hiring|onboarding|training|1[- ]?on[- ]?1|payroll|standup|huddle)\b/i,
  ops: /\b(ops|process|sop|workflow|automation|zapier|integration|report|dashboard|sync|billing|invoice)\b/i,
};

export function detectCategory(title: string): TaskCategory {
  for (const [cat, re] of Object.entries(CATEGORY_KEYWORDS)) {
    if (re.test(title)) return cat as TaskCategory;
  }
  return 'other';
}

export interface MemberLite { id: string; name: string; role?: string | null }

const LS_KEY = 'callTasks.categoryAssignee.v1';

function loadPrefs(): Record<TaskCategory, string | null> {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || '{}');
  } catch { return {} as any; }
}

export function rememberCategoryAssignee(cat: TaskCategory, memberName: string) {
  const prefs = loadPrefs();
  prefs[cat] = memberName;
  try { localStorage.setItem(LS_KEY, JSON.stringify(prefs)); } catch {}
}

/**
 * Suggest an assignee for a task:
 * 1. If the title mentions a member's name, pick them.
 * 2. Otherwise use the remembered category → member pref.
 * 3. Otherwise pick the first admin, then the first member.
 */
export function suggestAssignee(title: string, members: MemberLite[]): MemberLite | null {
  if (!members.length) return null;
  const lower = title.toLowerCase();
  const named = members.find((m) => m.name && lower.includes(m.name.toLowerCase()));
  if (named) return named;
  const cat = detectCategory(title);
  const prefs = loadPrefs();
  const prefName = prefs[cat];
  if (prefName) {
    const hit = members.find((m) => m.name === prefName);
    if (hit) return hit;
  }
  return members.find((m) => m.role === 'admin') || members[0];
}

export const CATEGORY_LABEL: Record<TaskCategory, string> = {
  crm: 'CRM',
  ads: 'Ads',
  creative: 'Creative',
  team: 'Team',
  ops: 'Ops',
  other: 'Other',
};