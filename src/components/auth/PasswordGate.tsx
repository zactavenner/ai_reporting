import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Lock, Loader2 } from 'lucide-react';
import { TeamMemberProvider, useTeamMember } from '@/contexts/TeamMemberContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

const SESSION_KEY = 'dashboard_auth';

interface PasswordGateProps {
  children: React.ReactNode;
}

function PasswordGateContent({ children }: PasswordGateProps) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const { login, currentMember } = useTeamMember();

  useEffect(() => {
    // Check if already authenticated in this session
    const storedAuth = localStorage.getItem(SESSION_KEY);
    const dashboardToken = localStorage.getItem('dashboard_session_token');
    if (storedAuth === 'true' && dashboardToken) {
      setIsAuthenticated(true);
    } else if (storedAuth === 'true' && !dashboardToken) {
      localStorage.removeItem(SESSION_KEY);
    }
    setIsLoading(false);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    if (!password.trim()) {
      setError('Please enter the password');
      return;
    }

    if (!name.trim()) {
      setError('Please enter your name');
      return;
    }

    setIsLoggingIn(true);
    
    try {
      // Verify password server-side via edge function
      const { data, error: fnError } = await supabase.functions.invoke('verify-password', {
        body: { password, memberName: name.trim() }
      });

      if (fnError) {
        console.error('Login error:', fnError);
        setError('Failed to sign in. Please try again.');
        setIsLoggingIn(false);
        return;
      }

      if (!data.success) {
        setError(data.error || 'Incorrect password or member not found');
        if (data.error === 'Incorrect password') {
          setPassword('');
        }
        setIsLoggingIn(false);
        return;
      }

      if (data.dashboardToken) {
        localStorage.setItem('dashboard_session_token', data.dashboardToken);
      }

      // Login successful - store member in context
      await login({
        id: data.member.id,
        name: data.member.name,
        email: data.member.email,
        role: data.member.role,
      });

      localStorage.setItem(SESSION_KEY, 'true');
      setIsAuthenticated(true);
      toast.success(`Welcome back, ${data.member.name}!`);
    } catch (err) {
      console.error('Login error:', err);
      setError('Failed to sign in. Please try again.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (isAuthenticated) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md border-2 border-border">
        <CardHeader className="text-center">
          <div className="mx-auto w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-4">
            <Lock className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-2xl">Capital Raising Dashboard</CardTitle>
          <CardDescription>Enter password and your name to access</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Input
                type="password"
                placeholder="Enter password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={error && !password ? 'border-destructive' : ''}
                autoFocus
              />
            </div>
            <div>
              <Input
                type="text"
                placeholder="Your name (e.g. bill)"
                value={name}
                onChange={(e) => setName(e.target.value.toLowerCase())}
                className={error && !name ? 'border-destructive' : ''}
              />
            </div>
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
            <Button type="submit" className="w-full" disabled={isLoggingIn}>
              {isLoggingIn ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Signing in...
                </>
              ) : (
                'Access Dashboard'
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export function PasswordGate({ children }: PasswordGateProps) {
  return (
    <TeamMemberProvider>
      <PasswordGateContent>{children}</PasswordGateContent>
    </TeamMemberProvider>
  );
}
