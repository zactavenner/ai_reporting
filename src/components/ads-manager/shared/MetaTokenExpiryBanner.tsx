import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertTriangle, ExternalLink } from "lucide-react";
import { useClients } from "@/hooks/useClients";
import { formatDistanceToNow } from "date-fns";

/**
 * Surfaces Meta Marketing API tokens that are expired or expiring within 14 days.
 * Reads `integration_status` (integration_name like 'meta%') and joins client name in JS.
 * Renders nothing if all tokens are healthy.
 */
export function MetaTokenExpiryBanner({ clientFilter }: { clientFilter?: string }) {
  const { data: clients = [] } = useClients();
  const { data: rows = [] } = useQuery({
    queryKey: ["meta-token-expiry"],
    refetchInterval: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("integration_status")
        .select("client_id, integration_name, token_expires_at, is_connected")
        .ilike("integration_name", "meta%")
        .not("token_expires_at", "is", null);
      if (error) { console.warn("token expiry query failed", error); return []; }
      return data || [];
    },
  });

  const now = Date.now();
  const SOON_MS = 14 * 24 * 60 * 60 * 1000;
  const issues = (rows as any[])
    .filter(r => {
      if (!r.token_expires_at) return false;
      if (clientFilter && clientFilter !== "all" && r.client_id !== clientFilter) return false;
      const ms = new Date(r.token_expires_at).getTime() - now;
      return ms < SOON_MS;
    })
    .map(r => {
      const client = (clients as any[]).find((c: any) => c.id === r.client_id);
      const ms = new Date(r.token_expires_at).getTime() - now;
      return {
        clientId: r.client_id,
        clientName: client?.name || "Unknown client",
        expiresAt: r.token_expires_at,
        expired: ms <= 0,
      };
    })
    .sort((a, b) => new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime());

  if (issues.length === 0) return null;

  const anyExpired = issues.some(i => i.expired);

  return (
    <Alert variant={anyExpired ? "destructive" : "default"} className="mb-3 border-amber-500/60">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle className="text-sm">
        {anyExpired
          ? `Meta token expired for ${issues.filter(i => i.expired).length} client(s)`
          : `Meta token expiring soon (${issues.length})`}
      </AlertTitle>
      <AlertDescription>
        <div className="text-xs mt-1 space-y-1 max-h-40 overflow-y-auto">
          {issues.slice(0, 10).map(i => (
            <div key={i.clientId} className="flex items-center justify-between gap-2">
              <span className="truncate">
                <span className="font-medium">{i.clientName}</span>
                <span className={i.expired ? "text-destructive ml-2" : "text-muted-foreground ml-2"}>
                  {i.expired
                    ? `expired ${formatDistanceToNow(new Date(i.expiresAt))} ago`
                    : `expires in ${formatDistanceToNow(new Date(i.expiresAt))}`}
                </span>
              </span>
              <Button asChild size="sm" variant="outline" className="h-6 px-2 text-[10px]">
                <a
                  href={`https://business.facebook.com/settings/system-users?business_id=`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Reconnect <ExternalLink className="h-3 w-3 ml-1" />
                </a>
              </Button>
            </div>
          ))}
          {issues.length > 10 && (
            <div className="text-muted-foreground italic">+{issues.length - 10} more…</div>
          )}
        </div>
      </AlertDescription>
    </Alert>
  );
}