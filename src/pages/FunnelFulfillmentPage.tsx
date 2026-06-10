import { useState } from 'react';
import logo from '@/assets/logo-aicra.png';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Lock, Phone } from 'lucide-react';

export default function Fulfillment() {
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (password === 'hpa1234') {
      setAuthenticated(true);
      setError('');
    } else {
      setError('Incorrect password. Please try again.');
    }
  };

  if (!authenticated) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-6">
        <Card className="w-full max-w-sm">
          <CardHeader className="text-center">
            <img src={logo} alt="AI Capital Raising Accelerator" className="h-8 mx-auto mb-4" />
            <CardTitle className="text-lg font-bold">Internal Access</CardTitle>
            <p className="text-sm text-muted-foreground">Enter the team password to continue.</p>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  type="password"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10"
                  autoFocus
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full font-semibold">Unlock</Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-background sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <a href="/">
            <img src={logo} alt="AI Capital Raising Accelerator" className="h-8" />
          </a>
          <a href="https://aicapitalraising.com/steps" target="_blank" rel="noopener noreferrer">
            <Button size="sm" className="font-semibold rounded-lg">
              <Phone className="w-4 h-4 mr-1.5" />
              Kick Off Call
            </Button>
          </a>
        </div>
      </header>

      <section className="py-16 md:py-20 px-6">
        <div className="max-w-4xl mx-auto space-y-12">
          <div className="text-center">
            <h1 className="font-display text-3xl md:text-4xl font-bold text-foreground mb-2">
              Internal Team Training
            </h1>
            <p className="text-muted-foreground">Fulfillment resources and training videos for the team.</p>
            <div className="luxury-divider mt-6" />
          </div>

          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="px-6 py-4 border-b border-border bg-muted/40">
              <span className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Training Video</span>
              <h3 className="font-display text-lg font-bold text-foreground mt-0.5">Fulfillment Overview</h3>
            </div>
            <div className="p-6">
              <div className="relative w-full" style={{ paddingBottom: '56.25%' }}>
                <iframe
                  src="https://www.loom.com/embed/1b57868dca364c65831dc8344d554ac5"
                  frameBorder="0"
                  allowFullScreen
                  className="absolute inset-0 w-full h-full rounded-lg"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-border py-8 bg-muted/30">
        <div className="max-w-6xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <img src={logo} alt="AI Capital Raising Accelerator" className="h-7" />
          <p className="text-xs text-muted-foreground">© {new Date().getFullYear()} AI Capital Raising. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
