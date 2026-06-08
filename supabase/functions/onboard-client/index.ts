import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PASSWORD = "HPA1234$";

// Capital Raising onboarding task templates
const CAPITAL_RAISING_TASKS = [
  { category: 'Client Setup', title: 'DNS & Domain configured', sort_order: 1 },
  { category: 'Client Setup', title: 'GHL sub-account created', sort_order: 2 },
  { category: 'Client Setup', title: 'GHL API key saved', sort_order: 3 },
  { category: 'Client Setup', title: 'Meta Ad Account access granted', sort_order: 4 },
  { category: 'Client Setup', title: 'Meta Pixel installed', sort_order: 5 },
  { category: 'Client Setup', title: 'Business Manager access granted', sort_order: 6 },
  { category: 'System Config', title: 'Reporting dashboard connected', sort_order: 7 },
  { category: 'System Config', title: 'Calendar IDs mapped', sort_order: 8 },
  { category: 'System Config', title: 'Pipeline stages configured', sort_order: 9 },
  { category: 'System Config', title: 'Slack channel mapped', sort_order: 10 },
  { category: 'System Config', title: 'Webhook integrations set up', sort_order: 11 },
  { category: 'Funnel & Creative', title: 'Quiz funnel created', sort_order: 12 },
  { category: 'Funnel & Creative', title: 'Thank-you / booking page live', sort_order: 13 },
  { category: 'Funnel & Creative', title: 'Brand assets collected (logo, colors, fonts)', sort_order: 14 },
  { category: 'Funnel & Creative', title: 'Ad creatives designed & approved', sort_order: 15 },
  { category: 'Funnel & Creative', title: 'Ad copy written & approved', sort_order: 16 },
  { category: 'Media Buying', title: 'Target audiences built', sort_order: 17 },
  { category: 'Media Buying', title: 'Campaign structure created', sort_order: 18 },
  { category: 'Media Buying', title: 'Conversion events configured', sort_order: 19 },
  { category: 'Media Buying', title: 'Campaign launched', sort_order: 20 },
];

const ECOM_TASKS = [
  { category: 'Client Setup', title: 'Domain & hosting configured', sort_order: 1 },
  { category: 'Client Setup', title: 'Meta Ad Account access granted', sort_order: 2 },
  { category: 'Client Setup', title: 'Meta Pixel installed', sort_order: 3 },
  { category: 'Client Setup', title: 'Business Manager access granted', sort_order: 4 },
  { category: 'System Config', title: 'Reporting dashboard connected', sort_order: 5 },
  { category: 'System Config', title: 'Slack channel mapped', sort_order: 6 },
  { category: 'Funnel & Creative', title: 'Product catalog set up', sort_order: 7 },
  { category: 'Funnel & Creative', title: 'Brand assets collected', sort_order: 8 },
  { category: 'Funnel & Creative', title: 'Ad creatives designed & approved', sort_order: 9 },
  { category: 'Funnel & Creative', title: 'Ad copy written & approved', sort_order: 10 },
  { category: 'Media Buying', title: 'Target audiences built', sort_order: 11 },
  { category: 'Media Buying', title: 'Campaign structure created', sort_order: 12 },
  { category: 'Media Buying', title: 'Campaign launched', sort_order: 13 },
];

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();

    // Auth check
    if (body.password !== PASSWORD) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Connect to the production database
    const originalUrl = Deno.env.get("ORIGINAL_SUPABASE_URL");
    const originalKey = Deno.env.get("ORIGINAL_SUPABASE_SERVICE_ROLE_KEY");

    if (!originalUrl || !originalKey) {
      throw new Error("Missing ORIGINAL_SUPABASE_URL or ORIGINAL_SUPABASE_SERVICE_ROLE_KEY");
    }

    const supabase = createClient(originalUrl, originalKey);

    // Extract onboarding data
    const {
      company_name,
      contact_name,
      contact_email,
      contact_phone,
      fund_type,
      website,
      raise_amount,
      timeline,
      min_investment,
      target_investor,
      pitch_deck_link,
      pitch_deck_path,
      budget_mode,
      budget_amount,
      investor_list_path,
      brand_notes,
      additional_notes,
      kickoff_date,
      kickoff_time,
      speaker_name,
      industry_focus,
      targeted_returns,
      hold_period,
      distribution_schedule,
      investment_range,
      tax_advantages,
      credibility,
      fund_history,
      client_type,
      // Allow passing an existing source_client_id from aicapitalraising.com
      source_client_id,
    } = body;

    if (!company_name) {
      return new Response(JSON.stringify({ error: "company_name is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const slug = slugify(company_name);
    const resolvedClientType = client_type || 'CAPITAL_RAISING';

    // Check if client already exists by slug or name
    const { data: existing } = await supabase
      .from('clients')
      .select('id')
      .or(`slug.eq.${slug},name.ilike.${company_name}`)
      .limit(1);

    let clientId: string;

    if (existing && existing.length > 0) {
      clientId = existing[0].id;
      console.log(`Client already exists: ${clientId}`);
    } else {
      // Create new client
      const { data: newClient, error: clientError } = await supabase
        .from('clients')
        .insert({
          name: company_name,
          slug,
          status: 'onboarding',
          industry: fund_type || industry_focus || null,
          description: [
            fund_type ? `Fund Type: ${fund_type}` : null,
            raise_amount ? `Raise: $${raise_amount}` : null,
            timeline ? `Timeline: ${timeline}` : null,
            speaker_name ? `Speaker: ${speaker_name}` : null,
          ].filter(Boolean).join(' | ') || null,
          website_url: website || null,
          offer_description: [
            targeted_returns ? `Returns: ${targeted_returns}` : null,
            hold_period ? `Hold: ${hold_period}` : null,
            distribution_schedule ? `Distribution: ${distribution_schedule}` : null,
            tax_advantages ? `Tax: ${tax_advantages}` : null,
            credibility || null,
            fund_history || null,
          ].filter(Boolean).join(' | ') || null,
          client_type: resolvedClientType,
        })
        .select('id')
        .single();

      if (clientError) {
        console.error('Client creation error:', clientError);
        throw new Error(`Failed to create client: ${clientError.message}`);
      }

      clientId = newClient.id;
      console.log(`Created new client: ${clientId} (${company_name})`);
    }

    // Save intake data
    const { error: intakeError } = await supabase
      .from('client_intake')
      .upsert({
        client_id: clientId,
        contact_name: contact_name || null,
        contact_email: contact_email || null,
        contact_phone: contact_phone || null,
        fund_type: fund_type || null,
        raise_amount: raise_amount || null,
        timeline: timeline || null,
        min_investment: min_investment || null,
        target_investor: target_investor || null,
        pitch_deck_link: pitch_deck_link || null,
        pitch_deck_path: pitch_deck_path || null,
        budget_mode: budget_mode || 'monthly',
        budget_amount: budget_amount || null,
        investor_list_path: investor_list_path || null,
        brand_notes: brand_notes || null,
        additional_notes: additional_notes || null,
        kickoff_date: kickoff_date || null,
        kickoff_time: kickoff_time || null,
        status: 'submitted',
      }, { onConflict: 'client_id' });

    if (intakeError) {
      console.error('Intake save error:', intakeError);
      // Non-fatal — continue
    }

    // Seed onboarding checklist into the regular PM `tasks` system:
    // creates an "Onboarding" project, one parent task per category,
    // and a subtask under each parent for every template item.
    try {
      const { data: existingProject } = await supabase
        .from('projects')
        .select('id')
        .eq('client_id', clientId)
        .eq('type', 'onboarding')
        .maybeSingle();

      let projectId = existingProject?.id as string | undefined;
      if (!projectId) {
        const { data: project, error: pErr } = await supabase
          .from('projects')
          .insert({
            client_id: clientId,
            name: 'Onboarding',
            type: 'onboarding',
            description: 'Auto-generated onboarding checklist',
          })
          .select('id')
          .single();
        if (pErr) throw pErr;
        projectId = project!.id;

        const templates = resolvedClientType === 'ECOM' ? ECOM_TASKS : CAPITAL_RAISING_TASKS;
        const categoryOrder: string[] = [];
        const itemsByCat = new Map<string, typeof templates>();
        for (const t of templates) {
          if (!itemsByCat.has(t.category)) { categoryOrder.push(t.category); itemsByCat.set(t.category, []); }
          itemsByCat.get(t.category)!.push(t);
        }
        const parentRows = categoryOrder.map((category, idx) => ({
          client_id: clientId, project_id: projectId, title: category,
          description: 'Onboarding section', category, sort_order: (idx + 1) * 100,
          status: 'todo', stage: 'todo', priority: 'medium',
          visible_to_client: true, show_subtasks_to_client: true,
        }));
        const { data: parents, error: pTaskErr } = await supabase
          .from('tasks').insert(parentRows).select('id, category, title');
        if (pTaskErr) throw pTaskErr;
        const parentByCat = new Map<string, string>();
        (parents ?? []).forEach((r: any) => parentByCat.set(r.category || r.title, r.id));
        const subRows = templates.map(t => ({
          client_id: clientId, project_id: projectId,
          parent_task_id: parentByCat.get(t.category) ?? null,
          title: t.title, description: `Onboarding · ${t.category}`,
          category: t.category, sort_order: t.sort_order,
          status: 'todo', stage: 'todo', priority: 'medium',
          visible_to_client: true,
        }));
        const { error: sErr } = await supabase.from('tasks').insert(subRows);
        if (sErr) throw sErr;
        console.log(`Seeded ${parentRows.length} sections + ${subRows.length} subtasks for ${company_name}`);
      }
    } catch (seedErr) {
      console.error('Onboarding seed error:', seedErr);
    }

    // Also create initial project management tasks
    const initialTasks = [
      { title: `Onboarding Kickoff - ${company_name}`, priority: 'high', status: 'todo', stage: 'todo' },
      { title: `Collect Brand Assets - ${company_name}`, priority: 'medium', status: 'todo', stage: 'todo' },
      { title: `Research & Positioning - ${company_name}`, priority: 'medium', status: 'todo', stage: 'todo' },
      { title: `Create Quiz Funnel - ${company_name}`, priority: 'medium', status: 'todo', stage: 'todo' },
      { title: `Ad Creatives - ${company_name}`, priority: 'medium', status: 'todo', stage: 'todo' },
    ];

    const { error: pmTaskError } = await supabase
      .from('tasks')
      .insert(initialTasks.map(t => ({
        client_id: clientId,
        title: t.title,
        priority: t.priority,
        status: t.status,
        stage: t.stage,
        visible_to_client: true,
      })));

    if (pmTaskError) {
      console.error('PM task creation error:', pmTaskError);
    } else {
      console.log(`Created ${initialTasks.length} PM tasks for ${company_name}`);
    }

    // === Create Offer with ALL intake fields populated ===
    const offerDescription = [
      fund_type ? `Fund Type: ${fund_type}` : null,
      raise_amount ? `Raise Amount: $${raise_amount}` : null,
      targeted_returns ? `Targeted Returns: ${targeted_returns}` : null,
      hold_period ? `Hold Period: ${hold_period}` : null,
      distribution_schedule ? `Distribution: ${distribution_schedule}` : null,
      min_investment ? `Min Investment: $${min_investment}` : null,
      tax_advantages ? `Tax Advantages: ${tax_advantages}` : null,
      credibility || null,
      fund_history || null,
      target_investor ? `Target Investor: ${target_investor}` : null,
    ].filter(Boolean).join('\n');

    const offerTitle = `${company_name} - Capital Raising Campaign`;
    let offerId: string | null = null;

    const { data: offerData, error: offerError } = await supabase
      .from('client_offers')
      .insert({
        client_id: clientId,
        title: offerTitle,
        description: offerDescription || null,
        offer_type: 'campaign',
        fund_name: company_name,
        fund_type: fund_type || null,
        raise_amount: raise_amount || null,
        min_investment: min_investment || null,
        timeline: timeline || null,
        target_investor: target_investor || 'Accredited Investors',
        targeted_returns: targeted_returns || null,
        hold_period: hold_period || null,
        distribution_schedule: distribution_schedule || null,
        investment_range: investment_range || null,
        tax_advantages: tax_advantages || null,
        credibility: credibility || null,
        fund_history: fund_history || null,
        website_url: website || null,
        speaker_name: speaker_name || null,
        industry_focus: industry_focus || null,
        brand_notes: brand_notes || null,
        additional_notes: additional_notes || null,
        budget_amount: budget_amount ? Number(budget_amount) : null,
        budget_mode: budget_mode || null,
        pitch_deck_url: pitch_deck_link || null,
        status: 'active',
      })
      .select('id')
      .single();

    if (offerError) {
      console.error('Offer creation error:', offerError);
    } else {
      offerId = offerData.id;
      console.log(`Created offer: ${offerId} for ${company_name}`);
    }

    // === NEW: Fetch client brand info for ad generation ===
    const { data: clientBrand } = await supabase
      .from('clients')
      .select('brand_colors, brand_fonts, website_url, public_token')
      .eq('id', clientId)
      .single();

    // === Trigger fulfill-client pipeline (single source of truth) ===
    const cloudUrl = Deno.env.get('SUPABASE_URL') || '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';

    // Fire-and-forget: triggers the full pipeline (research → copy → ads → avatar → video)
    EdgeRuntime.waitUntil(
      fetch(`${cloudUrl}/functions/v1/fulfill-client`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${anonKey}`,
        },
        body: JSON.stringify({
          password: PASSWORD,
          client_id: clientId,
          offer_id: offerId,
        }),
      }).then(res => {
        console.log(`Fulfill-client triggered: ${res.status}`);
      }).catch(err => {
        console.error('Fulfill-client trigger failed:', err);
      })
    );

    // Build shareable public link
    const publicToken = clientBrand?.public_token;
    const publicLink = publicToken
      ? `https://report-bloom-magic.lovable.app/public/${publicToken}`
      : null;

    return new Response(
      JSON.stringify({
        success: true,
        client_id: clientId,
        offer_id: offerId,
        slug,
        public_link: publicLink,
        message: `Client "${company_name}" onboarded successfully. Auto-generating 10 ads + copy in background.`,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("Onboard client error:", err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
