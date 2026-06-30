import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface TeamMemberContextType {
  currentMember: TeamMember | null;
  login: (member: TeamMember) => Promise<void>;
  logout: () => void;
  isLoading: boolean;
}

const TeamMemberContext = createContext<TeamMemberContextType | undefined>(undefined);

const SESSION_MEMBER_ID = 'team_member_id';
const SESSION_MEMBER_NAME = 'team_member_name';
const SESSION_MEMBER_EMAIL = 'team_member_email';
const SESSION_MEMBER_ROLE = 'team_member_role';
const SESSION_DASHBOARD_TOKEN = 'dashboard_session_token';
const ADMIN_EMAILS = new Set(['ads@highperformanceads.com', 'nic@hpa.com']);

const normalizeMember = (member: TeamMember): TeamMember => ({
  ...member,
  email: (member.email || '').trim().toLowerCase(),
  role: ADMIN_EMAILS.has((member.email || '').trim().toLowerCase())
    ? 'admin'
    : (member.role || 'member').trim().toLowerCase(),
});

const persistMember = (member: TeamMember) => {
  const normalized = normalizeMember(member);
  localStorage.setItem(SESSION_MEMBER_ID, normalized.id);
  localStorage.setItem(SESSION_MEMBER_NAME, normalized.name);
  localStorage.setItem(SESSION_MEMBER_EMAIL, normalized.email);
  localStorage.setItem(SESSION_MEMBER_ROLE, normalized.role);
  return normalized;
};

export function TeamMemberProvider({ children }: { children: ReactNode }) {
  const [currentMember, setCurrentMember] = useState<TeamMember | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const restoreSession = async () => {
      const storedId = localStorage.getItem(SESSION_MEMBER_ID);
      const storedName = localStorage.getItem(SESSION_MEMBER_NAME);
      const storedEmail = localStorage.getItem(SESSION_MEMBER_EMAIL);
      const storedRole = localStorage.getItem(SESSION_MEMBER_ROLE);

      if (!storedId || !storedName || !storedEmail) {
        if (!cancelled) setIsLoading(false);
        return;
      }

      const storedMember = normalizeMember({
        id: storedId,
        name: storedName,
        email: storedEmail,
        role: storedRole || 'member',
      });

      try {
        let { data, error } = await supabase
          .from('agency_members')
          .select('id, name, email, role')
          .eq('id', storedId)
          .maybeSingle();

        // Some long-lived dashboard sessions were created before role updates.
        // If the stored ID is stale/mismatched, re-check by email so the UI can
        // immediately pick up server-side admin changes without forcing logout.
        if ((!data || error) && storedEmail) {
          const byEmail = await supabase
            .from('agency_members')
            .select('id, name, email, role')
            .ilike('email', storedEmail.trim())
            .maybeSingle();

          data = byEmail.data;
          error = byEmail.error;
        }

        if (cancelled) return;

        if (error || !data) {
          setCurrentMember(storedMember);
          return;
        }

        const freshMember = persistMember(data as TeamMember);
        setCurrentMember(freshMember);
      } catch (error) {
        if (!cancelled) setCurrentMember(storedMember);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    restoreSession();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = async (member: TeamMember) => {
    const normalizedMember = persistMember(member);
    setCurrentMember(normalizedMember);
    
    // Update last_login_at in database
    await supabase
      .from('agency_members')
      .update({ last_login_at: new Date().toISOString() })
      .eq('id', member.id);
    
    // Log activity
    await supabase
      .from('member_activity_log')
      .insert({
        member_id: member.id,
        action: 'login',
        entity_type: 'session',
        details: { timestamp: new Date().toISOString() },
      });
  };

  const logout = () => {
    localStorage.removeItem(SESSION_MEMBER_ID);
    localStorage.removeItem(SESSION_MEMBER_NAME);
    localStorage.removeItem(SESSION_MEMBER_EMAIL);
    localStorage.removeItem(SESSION_MEMBER_ROLE);
    localStorage.removeItem(SESSION_DASHBOARD_TOKEN);
    localStorage.removeItem('dashboard_auth');
    setCurrentMember(null);
  };

  return (
    <TeamMemberContext.Provider value={{ currentMember, login, logout, isLoading }}>
      {children}
    </TeamMemberContext.Provider>
  );
}

export function useTeamMember() {
  const context = useContext(TeamMemberContext);
  // Return safe defaults if used outside provider (e.g., during SSR or error boundaries)
  if (context === undefined) {
    console.warn('[useTeamMember] Used outside TeamMemberProvider, returning safe defaults');
    return {
      currentMember: null,
      login: async () => {},
      logout: () => {},
      isLoading: false,
    };
  }
  return context;
}