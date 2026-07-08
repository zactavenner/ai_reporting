import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const LOVABLE_API_KEY = Deno.env.get('OPENROUTER_API_KEY');
  const supabase = createClient(supabaseUrl, supabaseKey);

  if (!LOVABLE_API_KEY) {
    return new Response(JSON.stringify({ error: "OPENROUTER_API_KEY not configured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const forceClientId = body.client_id as string | undefined;

    console.log("Weekly creative loop executed on Monday", new Date().toISOString());

    // Date ranges
    const now = new Date();
    const weekAgo = new Date(now); weekAgo.setDate(weekAgo.getDate() - 7);
    const twoWeeksAgo = new Date(now); twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
    const weekAgoStr = weekAgo.toISOString().split("T")[0];
    const twoWeeksAgoStr = twoWeeksAgo.toISOString().split("T")[0];
    const todayStr = now.toISOString().split("T")[0];

    // Get active clients
    let clientQuery = supabase.from("clients").select("id, name, industry, status").eq("status", "active");
    if (forceClientId) clientQuery = clientQuery.eq("id", forceClientId);
    const { data: clients, error: cErr } = await clientQuery;
    if (cErr) throw new Error(`Clients: ${cErr.message}`);

    // Get settings for CPL targets
    const { data: allSettings } = await supabase
      .from("client_settings")
      .select("client_id, cpl_threshold_red, cpl_threshold_yellow");
    const settingsMap = new Map((allSettings || []).map(s => [s.client_id, s]));

    // Get this week + last week metrics
    const { data: thisWeekMetrics } = await supabase
      .from("daily_metrics")
      .select("client_id, ad_spend, leads, clicks, impressions")
      .gte("date", weekAgoStr).lte("date", todayStr);

    const { data: lastWeekMetrics } = await supabase
      .from("daily_metrics")
      .select("client_id, ad_spend, leads")
      .gte("date", twoWeeksAgoStr).lt("date", weekAgoStr);

    // Aggregate per client
    const agg = (rows: any[], clientId: string) => {
      const filtered = (rows || []).filter(r => r.client_id === clientId);
      return filtered.reduce((a, r) => ({
        spend: a.spend + (r.ad_spend || 0),
        leads: a.leads + (r.leads || 0),
        clicks: a.clicks + (r.clicks || 0),
        impressions: a.impressions + (r.impressions || 0),
      }), { spend: 0, leads: 0, clicks: 0, impressions: 0 });
    };

    // Get top creatives per client (approved/launched)
    const { data: allCreatives } = await supabase
      .from("creatives")
      .select("id, client_id, title, type, platform, headline, body_copy, file_url, status")
      .in("status", ["approved", "launched"])
      .order("created_at", { ascending: false })
      .limit(200);

    // Get live ads for reference
    const { data: liveAds } = await supabase
      .from("client_live_ads")
      .select("client_id, headline, primary_text, cta_type, media_type, thumbnail_url, ai_analysis")
      .eq("status", "active")
      .order("scraped_at", { ascending: false })
      .limit(100);

    const results: any[] = [];

    for (const client of clients || []) {
      try {
        const thisWeek = agg(thisWeekMetrics || [], client.id);
        const lastWeek = agg(lastWeekMetrics || [], client.id);
        const settings = settingsMap.get(client.id);

        const currentCpl = thisWeek.leads > 0 ? thisWeek.spend / thisWeek.leads : 0;
        const prevCpl = lastWeek.leads > 0 ? lastWeek.spend / lastWeek.leads : 0;
        const ctr = thisWeek.impressions > 0 ? (thisWeek.clicks / thisWeek.impressions) * 100 : 0;
        const targetCpl = settings?.cpl_threshold_red || settings?.cpl_threshold_yellow || 0;

        const cplTrend = prevCpl === 0 ? "stable" : currentCpl < prevCpl * 0.95 ? "down" : currentCpl > prevCpl * 1.05 ? "up" : "stable";

        const clientCreatives = (allCreatives || []).filter(c => c.client_id === client.id).slice(0, 3);
        const clientAds = (liveAds || []).filter(a => a.client_id === client.id).slice(0, 3);

        // Build context for AI
        const contextData = {
          clientName: client.name,
          industry: client.industry || "Unknown",
          thisWeek: { spend: thisWeek.spend, leads: thisWeek.leads, cpl: currentCpl, ctr },
          lastWeek: { spend: lastWeek.spend, leads: lastWeek.leads, cpl: prevCpl },
          cplTrend,
          targetCpl,
          topCreatives: clientCreatives.map(c => ({ title: c.title, type: c.type, headline: c.headline, body: c.body_copy })),
          liveAds: clientAds.map(a => ({ headline: a.headline, text: a.primary_text, cta: a.cta_type })),
        };

        // Generate brief + scripts via AI
        const aiResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "openrouter/auto",
            messages: [
              {
                role: "system",
                content: `You are a senior performance media strategist. Generate a weekly creative brief AND ad scripts. Return ONLY valid JSON:

{
  "brief_summary": "2-3 sentence overview of this week's performance",
  "top_performers": ["description of top 3 performing creatives/ads"],
  "cpl_analysis": "CPL trend analysis and why",
  "recommended_improvements": ["3-5 specific improvement suggestions"],
  "performance_vs_target": "How current CPL compares to target",
  "next_week_focus": ["2-3 focus areas for next week"],
  "hook_patterns": ["3-5 hook formulas to use"],
  "offer_angles": ["2-3 offer angles"],
  "video_scripts": [
    {
      "title": "Script title",
      "hook": "Opening hook (first 3 seconds)",
      "body": "Main body script (15-30 seconds total)",
      "cta": "Closing CTA",
      "duration_seconds": 15
    }
  ],
  "static_scripts": [
    {
      "title": "Ad title",
      "headline": "Ad headline",
      "body": "Primary text / body copy",
      "cta": "CTA text"
    }
  ]
}`
              },
              {
                role: "user",
                content: `Generate a weekly brief and ad scripts for:\n\n${JSON.stringify(contextData, null, 2)}`
              },
            ],
            max_tokens: 4000,
          }),
        });

        if (!aiResponse.ok) {
          if (aiResponse.status === 429) { console.warn("Rate limited, pausing..."); await new Promise(r => setTimeout(r, 10000)); continue; }
          throw new Error(`AI error ${aiResponse.status}`);
        }

        const aiData = await aiResponse.json();
        const raw = aiData.choices?.[0]?.message?.content || "";
        const cleaned = raw.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();

        let parsed: any;
        try { parsed = JSON.parse(cleaned); } catch {
          console.error(`Failed JSON parse for ${client.name}:`, cleaned.substring(0, 200));
          results.push({ client: client.name, status: "error", reason: "Invalid AI JSON" });
          continue;
        }

        // Save brief
        const { data: brief, error: briefErr } = await supabase.from("creative_briefs").insert({
          client_id: client.id,
          client_name: client.name,
          status: "pending",
          source: "weekly_auto",
          hook_patterns: parsed.hook_patterns || [],
          offer_angles: parsed.offer_angles || [],
          recommended_variations: parsed.video_scripts || [],
          winning_ad_summary: contextData.topCreatives,
          full_brief_json: {
            ...parsed,
            generated_at: new Date().toISOString(),
            period: `${weekAgoStr} to ${todayStr}`,
            cpl_trend: cplTrend,
            current_cpl: currentCpl,
            target_cpl: targetCpl,
          },
        }).select("id").single();

        if (briefErr) { console.error(`Brief insert error:`, briefErr.message); continue; }

        // Save video scripts
        const scriptInserts: any[] = [];
        for (const vs of parsed.video_scripts || []) {
          scriptInserts.push({
            client_id: client.id,
            brief_id: brief.id,
            script_type: "video",
            title: vs.title,
            hook: vs.hook,
            body: vs.body,
            cta: vs.cta,
            duration_seconds: vs.duration_seconds || 15,
            status: "draft",
          });
        }
        for (const ss of parsed.static_scripts || []) {
          scriptInserts.push({
            client_id: client.id,
            brief_id: brief.id,
            script_type: "static",
            title: ss.title,
            hook: ss.headline,
            body: ss.body,
            cta: ss.cta,
            status: "draft",
          });
        }

        if (scriptInserts.length > 0) {
          const { error: scriptErr } = await supabase.from("ad_scripts").insert(scriptInserts);
          if (scriptErr) console.error(`Script insert error:`, scriptErr.message);
        }

        results.push({
          client: client.name,
          status: "generated",
          briefId: brief.id,
          scriptsCount: scriptInserts.length,
          cpl: currentCpl.toFixed(2),
          cplTrend,
        });

        // Rate limit protection
        await new Promise(r => setTimeout(r, 2000));
      } catch (clientErr) {
        console.error(`Error for ${client.name}:`, clientErr);
        results.push({ client: client.name, status: "error", reason: String(clientErr) });
      }
    }

    console.log(`Weekly brief generation complete: ${results.filter(r => r.status === 'generated').length} briefs generated for week of ${weekAgoStr}`);

    return new Response(JSON.stringify({ success: true, results, run_at: new Date().toISOString(), week_of: weekAgoStr }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("weekly-brief-generator error:", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
