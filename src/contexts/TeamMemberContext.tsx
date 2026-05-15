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

export function TeamMemberProvider({ children }: { children: ReactNode }) {
  const [currentMember, setCurrentMember] = useState<TeamMember | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Restore session on mount
    const storedId = localStorage.getItem(SESSION_MEMBER_ID);
    const storedName = localStorage.getItem(SESSION_MEMBER_NAME);
    const storedEmail = localStorage.getItem(SESSION_MEMBER_EMAIL);
    const storedRole = localStorage.getItem(SESSION_MEMBER_ROLE);
    
    if (storedId && storedName && storedEmail) {
      setCurrentMember({
        id: storedId,
        name: storedName,
        email: storedEmail,
        role: storedRole || 'member',
      });
    }
    setIsLoading(false);
  }, []);

  const login = async (member: TeamMember) => {
    // Store in session
    localStorage.setItem(SESSION_MEMBER_ID, member.id);
    localStorage.setItem(SESSION_MEMBER_NAME, member.name);
    localStorage.setItem(SESSION_MEMBER_EMAIL, member.email);
    localStorage.setItem(SESSION_MEMBER_ROLE, member.role);
    
    setCurrentMember(member);
    
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