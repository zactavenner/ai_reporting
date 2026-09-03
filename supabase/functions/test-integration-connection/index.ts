import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { resolveMeetgeekApiKey, meetgeekRegionEnv } from '../_shared/meetgeekApiKey.ts';
import {
  MEETGEEK_REGION_ORDER,
  normalizeMeetgeekRegion,
  regionBaseUrl,
} from '../_shared/meetgeekRegion.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { integration, client_id, mode } = await req.json();
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // ── Full health check mode: tests all integrations + lead cross-check ──
    if (mode === 'full_health_check' && client_id) {
      const { data: client } = await supabase
        .from('clients')
        .select('ghl_api_key, ghl_location_id, meta_ad_account_id, meta_access_token, hubspot_access_token, hubspot_portal_id')
        .eq('id', client_id)
        .single();

      if (!client) {
        return new Response(JSON.stringify({ error: 'Client not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const results: Record<string, any> = {};

      // ── Test Meta Graph API ──
      const metaToken = client.meta_access_token || Deno.env.get('META_SHARED_ACCESS_TOKEN');
      const metaAccountId = client.meta_ad_account_id;
      
      if (metaToken && metaAccountId) {
        try {
          const actId = metaAccountId.startsWith('act_') ? metaAccountId : `act_${metaAccountId}`;
          
          // Test basic connection
          const meRes = await fetch(`https://graph.facebook.com/v21.0/me?access_token=${metaToken}`);
          if (!meRes.ok) {
            results.meta = { success: false, error: `Token invalid (${meRes.status})` };
          } else {
            // Test ad account access
            const accountRes = await fetch(
              `https://graph.facebook.com/v21.0/${actId}?fields=name,account_status&access_token=${metaToken}`
            );
            if (!accountRes.ok) {
              results.meta = { success: false, error: `Ad account access denied (${accountRes.status})` };
            } else {
              const accountData = await accountRes.json();
              
              // Get Meta lead count (last 30 days from lead forms)
              const since = Math.floor((Date.now() - 30 * 86400000) / 1000);
              const until = Math.floor(Date.now() / 1000);
              const insightsRes = await fetch(
                `https://graph.facebook.com/v21.0/${actId}/insights?fields=actions&time_range={"since":"${new Date(since * 1000).toISOString().split('T')[0]}","until":"${new Date(until * 1000).toISOString().split('T')[0]}"}&level=account&access_token=${metaToken}`
              );
              
              let metaLeadCount = 0;
              if (insightsRes.ok) {
                const insightsData = await insightsRes.json();
                const actions = insightsData.data?.[0]?.actions || [];
                const leadAction = actions.find((a: any) => 
                  a.action_type === 'lead' || a.action_type === 'onsite_conversion.lead_grouped'
                );
                metaLeadCount = leadAction ? parseInt(leadAction.value) : 0;
              }

              // Check token expiry
              let tokenExpiry: string | null = null;
              let tokenDaysLeft: number | null = null;
              try {
                const debugRes = await fetch(
                  `https://graph.facebook.com/v21.0/debug_token?input_token=${metaToken}&access_token=${metaToken}`
                );
                if (debugRes.ok) {
                  const debugData = await debugRes.json();
                  if (debugData.data?.expires_at) {
                    tokenExpiry = new Date(debugData.data.expires_at * 1000).toISOString();
                    tokenDaysLeft = Math.ceil((debugData.data.expires_at * 1000 - Date.now()) / 86400000);
                  }
                  // Check scopes
                  results.meta_scopes = debugData.data?.scopes || [];
                }
              } catch (_) {}

              results.meta = { 
                success: true, 
                account_name: accountData.name,
                account_status: accountData.account_status,
                meta_lead_count_30d: metaLeadCount,
                token_expires_at: tokenExpiry,
                token_days_left: tokenDaysLeft,
              };
            }
          }
        } catch (e) {
          results.meta = { success: false, error: e.message };
        }
      } else {
        results.meta = { success: false, error: !metaToken ? 'No Meta token' : 'No ad account ID' };
      }

      // ── Test GHL API ──
      if (client.ghl_api_key && client.ghl_location_id) {
        try {
          // Test location access
          const locRes = await fetch(
            `https://services.leadconnectorhq.com/locations/${client.ghl_location_id}`,
            { headers: { Authorization: `Bearer ${client.ghl_api_key}`, Version: '2021-07-28' } }
          );
          
          if (!locRes.ok) {
            const status = locRes.status;
            const errorHint = status === 401 ? 'Invalid API Key — regenerate in GHL Settings' 
              : status === 403 ? 'Key lacks permissions — check GHL scopes'
              : `GHL returned ${status}`;
            results.ghl = { success: false, error: errorHint, status_code: status };
          } else {
            // Test contacts search endpoint
            const contactsRes = await fetch(
              `https://services.leadconnectorhq.com/contacts/?locationId=${client.ghl_location_id}&limit=1`,
              { headers: { Authorization: `Bearer ${client.ghl_api_key}`, Version: '2021-07-28' } }
            );
            
            const contactsOk = contactsRes.ok;
            let ghlTotalContacts = 0;
            if (contactsOk) {
              const contactsData = await contactsRes.json();
              ghlTotalContacts = contactsData.meta?.total || contactsData.total || 0;
            }

            // Test calendars endpoint
            const calRes = await fetch(
              `https://services.leadconnectorhq.com/calendars/?locationId=${client.ghl_location_id}`,
              { headers: { Authorization: `Bearer ${client.ghl_api_key}`, Version: '2021-07-28' } }
            );

            // Test opportunities endpoint
            const oppRes = await fetch(
              `https://services.leadconnectorhq.com/opportunities/search?location_id=${client.ghl_location_id}&limit=1`,
              { 
                method: 'POST',
                headers: { 
                  Authorization: `Bearer ${client.ghl_api_key}`, 
                  Version: '2021-07-28',
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ location_id: client.ghl_location_id }),
              }
            );

            results.ghl = { 
              success: true,
              contacts: { success: contactsOk, total: ghlTotalContacts, error: contactsOk ? null : `Status ${contactsRes.status}` },
              calendars: { success: calRes.ok, error: calRes.ok ? null : `Status ${calRes.status}` },
              opportunities: { success: oppRes.ok || oppRes.status === 400, error: (oppRes.ok || oppRes.status === 400) ? null : `Status ${oppRes.status}` },
            };
          }
        } catch (e) {
          results.ghl = { success: false, error: e.message };
        }
      } else {
        results.ghl = { success: false, error: !client.ghl_api_key ? 'No GHL API key' : 'No GHL Location ID' };
      }

      // ── Test HubSpot API ──
      if (client.hubspot_access_token) {
        try {
          const res = await fetch('https://api.hubapi.com/crm/v3/objects/contacts?limit=1', {
            headers: { Authorization: `Bearer ${client.hubspot_access_token}` },
          });
          results.hubspot = { 
            success: res.ok, 
            error: res.ok ? null : `HubSpot returned ${res.status}`,
            total: res.ok ? (await res.json()).total : 0,
          };
        } catch (e) {
          results.hubspot = { success: false, error: e.message };
        }
      } else {
        results.hubspot = { success: false, error: 'No HubSpot token', not_configured: true };
      }

      // ── Cross-check: DB lead count (last 30 days) ──
      const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
      const { count: dbLeadCount } = await supabase
        .from('leads')
        .select('id', { count: 'exact', head: true })
        .eq('client_id', client_id)
        .gte('created_at', thirtyDaysAgo);

      results.lead_cross_check = {
        db_leads_30d: dbLeadCount || 0,
        meta_leads_30d: results.meta?.meta_lead_count_30d || 0,
        crm_total: results.ghl?.contacts?.total || results.hubspot?.total || 0,
        delta: Math.abs((dbLeadCount || 0) - (results.meta?.meta_lead_count_30d || 0)),
        healthy: results.meta?.meta_lead_count_30d 
          ? Math.abs((dbLeadCount || 0) - results.meta.meta_lead_count_30d) <= Math.max(5, (results.meta.meta_lead_count_30d || 1) * 0.1)
          : true, // If no Meta leads data, don't flag
      };

      // Update integration_status records
      for (const [name, result] of Object.entries(results)) {
        if (name === 'lead_cross_check' || name === 'meta_scopes') continue;
        const intName = name === 'meta' ? 'meta_ads' : name;
        if (!['meta_ads', 'ghl', 'hubspot'].includes(intName)) continue;
        
        await supabase
          .from('integration_status')
          .upsert({
            client_id,
            integration_name: intName,
            is_connected: result.success,
            last_sync_status: result.success ? 'success' : 'failed',
            last_error_message: result.success ? null : (result.error || 'Unknown error'),
            last_sync_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            ...(intName === 'meta_ads' && results.meta?.token_expires_at 
              ? { token_expires_at: results.meta.token_expires_at } : {}),
          }, { onConflict: 'client_id,integration_name' });
      }

      return new Response(JSON.stringify(results), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── Single integration test (existing behavior) ──
    let success = false;
    let message = '';
    let tokenExpiresAt: string | null = null;

    if (integration === 'meta_ads') {
      const token = Deno.env.get('META_SHARED_ACCESS_TOKEN');
      if (!token) {
        message = 'No Meta access token configured';
      } else {
        try {
          const res = await fetch(`https://graph.facebook.com/v21.0/me?access_token=${token}`);
          if (res.ok) {
            success = true;
            message = 'Meta Ads connected successfully';
            const debugRes = await fetch(
              `https://graph.facebook.com/v21.0/debug_token?input_token=${token}&access_token=${token}`
            );
            if (debugRes.ok) {
              const debugData = await debugRes.json();
              if (debugData.data?.expires_at) {
                tokenExpiresAt = new Date(debugData.data.expires_at * 1000).toISOString();
              }
            }
          } else {
            message = `Meta API returned ${res.status}`;
          }
        } catch (e) {
          message = `Meta connection failed: ${e.message}`;
        }
      }
    } else if (integration === 'ghl') {
      if (client_id) {
        const { data: client } = await supabase
          .from('clients')
          .select('ghl_api_key, ghl_location_id')
          .eq('id', client_id)
          .single();
        if (client?.ghl_api_key && client?.ghl_location_id) {
          try {
            const res = await fetch(
              `https://services.leadconnectorhq.com/locations/${client.ghl_location_id}`,
              { headers: { Authorization: `Bearer ${client.ghl_api_key}`, Version: '2021-07-28' } }
            );
            success = res.ok;
            message = res.ok ? 'GHL connected' : `GHL returned ${res.status}`;
          } catch (e) {
            message = `GHL connection failed: ${e.message}`;
          }
        } else {
          message = 'No GHL credentials configured for this client';
        }
      } else {
        message = 'Client ID required for GHL test';
      }
    } else if (integration === 'stripe') {
      const key = Deno.env.get('STRIPE_SECRET_KEY');
      if (!key) {
        message = 'No Stripe key configured';
      } else {
        try {
          const res = await fetch('https://api.stripe.com/v1/balance', {
            headers: { Authorization: `Bearer ${key}` },
          });
          success = res.ok;
          message = res.ok ? 'Stripe connected' : `Stripe returned ${res.status}`;
        } catch (e) {
          message = `Stripe connection failed: ${e.message}`;
        }
      }
    } else if (integration === 'meetgeek') {
      // Real authenticated read, not a presence check: a stale key must fail here.
      const key = await resolveMeetgeekApiKey(supabase);
      if (!key) {
        success = false;
        message = 'No MeetGeek API key';
      } else {
        const pinned = normalizeMeetgeekRegion(meetgeekRegionEnv());
        const regions = pinned ? [pinned] : MEETGEEK_REGION_ORDER;
        let lastStatus: number | null = null;
        for (const region of regions) {
          try {
            const res = await fetch(`${regionBaseUrl(region)}/v1/meetings?limit=1`, {
              headers: { Authorization: `Bearer ${key}` },
            });
            lastStatus = res.status;
            if (res.ok) {
              success = true;
              message = `MeetGeek connected (${region.toUpperCase()} region)`;
              break;
            }
          } catch {
            lastStatus = null;
          }
        }
        if (!success) {
          message = lastStatus === 401 || lastStatus === 403
            ? 'MeetGeek rejected the API key (unauthorized)'
            : `MeetGeek returned ${lastStatus ?? 'a network error'}`;
        }
      }
    } else if (integration === 'hubspot') {
      if (client_id) {
        const { data: client } = await supabase
          .from('clients')
          .select('hubspot_access_token')
          .eq('id', client_id)
          .single();
        if (client?.hubspot_access_token) {
          try {
            const res = await fetch('https://api.hubapi.com/crm/v3/objects/contacts?limit=1', {
              headers: { Authorization: `Bearer ${client.hubspot_access_token}` },
            });
            success = res.ok;
            message = res.ok ? 'HubSpot connected' : `HubSpot returned ${res.status}`;
          } catch (e) {
            message = `HubSpot connection failed: ${e.message}`;
          }
        } else {
          message = 'No HubSpot token for this client';
        }
      } else {
        message = 'Client ID required for HubSpot test';
      }
    }

    // Upsert integration status
    const upsertData: Record<string, unknown> = {
      integration_name: integration,
      is_connected: success,
      last_sync_status: success ? 'success' : 'failed',
      last_error_message: success ? null : message,
      updated_at: new Date().toISOString(),
    };
    if (client_id) upsertData.client_id = client_id;
    if (tokenExpiresAt) upsertData.token_expires_at = tokenExpiresAt;

    if (client_id) {
      await supabase
        .from('integration_status')
        .upsert(
          { ...upsertData, client_id },
          { onConflict: 'client_id,integration_name' }
        );
    }

    return new Response(JSON.stringify({ success, message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, message: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
