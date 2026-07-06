import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Eye, EyeOff, ExternalLink, CheckCircle2, XCircle, Plug } from 'lucide-react';

const PLATFORMS = [
  { id: 'google', name: 'Google Ads', icon: '🔍', description: 'Connect Google Ads accounts.', docsUrl: 'https://developers.google.com/google-ads/api/docs/start', fields: [{ key: 'customer_id', label: 'Customer ID', placeholder: '123-456-7890' }] },
  { id: 'linkedin', name: 'LinkedIn Ads', icon: '💼', description: 'Connect LinkedIn Campaign Manager.', docsUrl: 'https://learn.microsoft.com/en-us/linkedin/marketing/', fields: [{ key: 'access_token', label: 'Access Token', placeholder: 'AQV...', secret: true }] },
  { id: 'tiktok', name: 'TikTok Ads', icon: '🎵', description: 'Connect TikTok Ads Manager.', docsUrl: 'https://business-api.tiktok.com/portal/docs', fields: [{ key: 'access_token', label: 'Access Token', placeholder: 'Your token...', secret: true }] },
];

export function AgencyIntegrationsTab() {
  const [expandedPlatform, setExpandedPlatform] = useState<string | null>(null);
  const [formValues, setFormValues] = useState<Record<string, Record<string, string>>>({});
  const [visibleFields, setVisibleFields] = useState<Record<string, boolean>>({});

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold flex items-center gap-2"><Plug className="h-5 w-5" />Ad Platform Integrations</h2>
        <p className="text-sm text-muted-foreground mt-1">Connect your advertising platforms to automatically sync spend and performance data.</p>
      </div>
      <div className="grid gap-4">
        {PLATFORMS.map((platform) => {
          const isExpanded = expandedPlatform === platform.id;
          return (
            <Card key={platform.id} className="border-2 border-border overflow-hidden">
              <div className="flex items-center justify-between p-4 cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => setExpandedPlatform(isExpanded ? null : platform.id)}>
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{platform.icon}</span>
                  <div><h3 className="font-semibold">{platform.name}</h3><p className="text-xs text-muted-foreground">{platform.description}</p></div>
                </div>
                <Badge variant="secondary"><XCircle className="h-3 w-3 mr-1" /> Disconnected</Badge>
              </div>
              {isExpanded && (
                <div className="border-t border-border p-4 bg-muted/30 space-y-4">
                  {platform.fields.map((field) => (
                    <div key={field.key} className="space-y-1">
                      <Label className="text-sm">{field.label}</Label>
                      <Input type={field.secret && !visibleFields[`${platform.id}-${field.key}`] ? 'password' : 'text'} placeholder={field.placeholder} className="font-mono text-sm" value={formValues[platform.id]?.[field.key] || ''} onChange={(e) => setFormValues(prev => ({ ...prev, [platform.id]: { ...(prev[platform.id] || {}), [field.key]: e.target.value } }))} />
                    </div>
                  ))}
                  <div className="flex items-center justify-between pt-2">
                    <a href={platform.docsUrl} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1"><ExternalLink className="h-3 w-3" />Docs</a>
                    <Button size="sm">Connect</Button>
                  </div>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
