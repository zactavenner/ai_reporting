import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Simple hash function for password verification
async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function base64UrlEncode(value: string | ArrayBuffer): string {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value);
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function createDashboardToken(memberId: string, secret: string): Promise<string> {
  const payload = base64UrlEncode(JSON.stringify({ memberId, exp: Date.now() + 1000 * 60 * 60 * 24 * 7 }));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return `${payload}.${base64UrlEncode(signature)}`;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { password, memberName } = await req.json();

    if (!password || !memberName) {
      return new Response(
        JSON.stringify({ error: "Password and member name are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get the stored password hash from agency_settings
    const { data: settings, error: settingsError } = await supabase
      .from('agency_settings')
      .select('password_hash')
      .single();

    if (settingsError) {
      console.error('Error fetching settings:', settingsError);
      return new Response(
        JSON.stringify({ error: "Failed to verify password" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Hash the provided password and compare
    const providedHash = await hashPassword(password);
    
    console.log('Password received:', password);
    console.log('Password === HPA:', password === 'HPA');
    console.log('Provided hash:', providedHash);
    console.log('Stored hash:', settings?.password_hash);
    
    // For backward compatibility during transition, accept 'HPA' as hardcoded password
    // or compare with stored hash
    const hardcodedMatch = password === 'HPA';
    const hashMatch = settings?.password_hash && providedHash === settings.password_hash;
    const isPasswordValid = hardcodedMatch || hashMatch;
    
    console.log('Hardcoded match:', hardcodedMatch, 'Hash match:', hashMatch, 'Valid:', isPasswordValid);

    if (!isPasswordValid) {
      return new Response(
        JSON.stringify({ success: false, error: "Incorrect password" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Look up the team member
    const { data: members, error: memberError } = await supabase
      .from('agency_members')
      .select('id, name, email, role')
      .ilike('name', memberName.trim());

    if (memberError) {
      console.error('Error fetching member:', memberError);
      return new Response(
        JSON.stringify({ error: "Failed to verify member" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!members || members.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: "Team member not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const member = members[0];

    // Update last_login_at
    await supabase
      .from('agency_members')
      .update({ last_login_at: new Date().toISOString() })
      .eq('id', member.id);

    // Log the login activity
    await supabase
      .from('member_activity_log')
      .insert({
        member_id: member.id,
        action: 'login',
        entity_type: 'session',
        details: { 
          timestamp: new Date().toISOString(),
          verified_server_side: true 
        },
      });

    const dashboardToken = await createDashboardToken(member.id, supabaseServiceKey);

    return new Response(
      JSON.stringify({ 
        success: true, 
        dashboardToken,
        member: {
          id: member.id,
          name: member.name,
          email: member.email,
          role: member.role,
        }
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error('Error in verify-password:', error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
