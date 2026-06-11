import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Key, Eye, EyeOff, Save, Shield, AlertTriangle, CheckCircle, XCircle, Loader2, RefreshCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

type Validation = {
  ok: boolean;
  token?: string;
  expires_at?: string | null;
  scopes?: string[];
  ad_accounts?: { id: string; name: string; account_status: number }[];
  user?: { id: string; name: string };
  error?: string;
};

export function MasterMetaTokenCard() {
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [validating, setValidating] = useState(false);
  const [checkingCurrent, setCheckingCurrent] = useState(false);
  const [result, setResult] = useState<Validation | null>(null);
  const [currentStatus, setCurrentStatus] = useState<Validation | null>(null);

  const runValidation = async (tok?: string): Promise<Validation | null> => {
    try {
      const { data, error } = await supabase.functions.invoke('meta-token-refresh', {
        body: { action: 'validate', token: tok },
      });
      if (error) throw error;
      return data as Validation;
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Validation failed' };
    }
  };

  const handleValidate = async () => {
    if (!token.trim()) {
      toast.error('Paste a token first');
      return;
    }
    setValidating(true);
    setResult(null);
    const v = await runValidation(token.trim());
    setResult(v);
    if (v?.ok) toast.success(`Token valid — ${v.ad_accounts?.length ?? 0} ad accounts accessible`);
    else toast.error(v?.error || 'Token invalid');
    setValidating(false);
  };

  const handleCheckCurrent = async () => {
    setCheckingCurrent(true);
    const v = await runValidation();
    setCurrentStatus(v);
    setCheckingCurrent(false);
  };

  const handleSave = async () => {
    if (!result?.ok) {
      toast.error('Validate the token first — only green tokens can be saved');
      return;
    }
    // Saving the secret itself requires the secrets management flow.
    // Surface clear instructions; the secret rotation is handled outside the app.
    toast.info('Update META_SHARED_ACCESS_TOKEN in Project Secrets to roll it out to all syncs.');
  };

  const daysLeft = result?.expires_at
    ? Math.ceil((new Date(result.expires_at).getTime() - Date.now()) / 86400000)
    : null;

  return (
    <Card className="border-2 border-border">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Key className="h-5 w-5 text-primary" />
            <CardTitle className="text-base">Master Meta Graph API Token</CardTitle>
          </div>
          <Badge variant="outline" className="text-xs gap-1">
            <Shield className="h-3 w-3" />
            All Accounts
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="p-3 bg-muted/50 rounded-md space-y-2">
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle className="h-4 w-4 text-chart-2" />
            <span className="font-medium">Shared token is active</span>
          </div>
          <p className="text-xs text-muted-foreground">
            This token is used by all client accounts that don't have a client-specific override. 
            Update it here when you generate a new long-lived token from the Graph API Explorer.
          </p>
        </div>

        <div className="p-3 border border-chart-4/30 bg-chart-4/5 rounded-md">
          <div className="flex items-center gap-2 text-xs">
            <AlertTriangle className="h-3.5 w-3.5 text-chart-4" />
            <span className="font-medium">Token expires every ~60 days</span>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">
            Generate a new long-lived token at{' '}
            <a 
              href="https://developers.facebook.com/tools/explorer/" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-primary underline"
            >
              Graph API Explorer
            </a>
            {' '}→ Extend Access Token. Required permissions: ads_read, ads_management, business_management, pages_show_list, leads_retrieval
          </p>
        </div>

        <div className="space-y-2">
          <Label className="text-xs">New Long-Lived Access Token</Label>
          <div className="relative">
            <Input
              type={showToken ? 'text' : 'password'}
              placeholder="Paste new long-lived token here..."
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="pr-10 font-mono text-xs"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
              onClick={() => setShowToken(!showToken)}
            >
              {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground">
            This will update the shared token used across all Meta Ad accounts
          </p>
        </div>

        <Button 
          onClick={handleSaveMasterToken} 
          disabled={saving || !token.trim()} 
          className="w-full"
          variant="default"
        >
          <Save className="h-4 w-4 mr-2" />
          {saving ? 'Updating...' : 'Update Master Token'}
        </Button>
      </CardContent>
    </Card>
  );
}
