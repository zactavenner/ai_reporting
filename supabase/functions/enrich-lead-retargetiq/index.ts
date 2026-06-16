import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface EnrichResult {
  identity: any;
  allIdentities: any[];
  companies: any[];
  method: string;
  rawResponse: any;
}

function collectAllCompanies(identities: any[]): any[] {
  const seen = new Set<string>();
  const all: any[] = [];
  for (const id of identities) {
    // Identity-level company fields
    if (id.companyName || id.company) {
      const key = `${id.companyName || id.company}|${id.title || ''}`;
      if (!seen.has(key)) {
        seen.add(key);
        all.push({
          company: id.companyName || id.company,
          title: id.title || id.jobTitle || null,
          industry: id.industry || null,
          linkedin: id.linkedin || id.linkedinUrl || null,
          revenue: id.revenue || null,
          employeeCount: id.employeeCount || id.employees || null,
          website: id.companyWebsite || id.website || null,
          phone: id.companyPhone || null,
          address: id.companyAddress || null,
          city: id.companyCity || null,
          state: id.companyState || null,
          zip: id.companyZip || null,
        });
      }
    }
    // Nested companies array
    for (const c of (id.companies || [])) {
      const key = `${c.company || c.name || ''}|${c.title || ''}`;
      if (!seen.has(key)) {
        seen.add(key);
        all.push({
          ...c,
          company: c.company || c.name || null,
          linkedin: c.linkedin || c.linkedinUrl || null,
        });
      }
    }
  }
  return all;
}

async function lookupByPhone(apiKey: string, slug: string, phone: string): Promise<EnrichResult | null> {
  const cleanPhone = phone.replace(/\D/g, '');
  if (cleanPhone.length < 10) return null;
  console.log(`[RetargetIQ] Lookup by phone: ${cleanPhone}`);
  try {
    const res = await fetch('https://app.retargetiq.com/api/v2/GetDataByPhone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey, website: slug, phone: cleanPhone }),
    });
    const text = await res.text();
    if (!res.ok) return null;
    const data = JSON.parse(text);
    if (data.success && data.data?.identities?.length > 0) {
      console.log(`[RetargetIQ] ✓ Phone match: ${data.data.identities.length} identities`);
      return {
        identity: data.data.identities[0],
        allIdentities: data.data.identities,
        companies: collectAllCompanies(data.data.identities),
        method: 'phone',
        rawResponse: data.data,
      };
    }
  } catch (e) { console.error('[RetargetIQ] Phone lookup error:', e); }
  return null;
}

async function lookupByEmail(apiKey: string, slug: string, email: string): Promise<EnrichResult | null> {
  console.log(`[RetargetIQ] Lookup by email: ${email}`);
  try {
    const res = await fetch('https://app.retargetiq.com/api/v2/GetDataByEmail', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey, website: slug, email: email.trim() }),
    });
    const text = await res.text();
    if (!res.ok) return null;
    const data = JSON.parse(text);
    if (data.success && data.data?.identities?.length > 0) {
      console.log(`[RetargetIQ] ✓ Email match: ${data.data.identities.length} identities`);
      return {
        identity: data.data.identities[0],
        allIdentities: data.data.identities,
        companies: collectAllCompanies(data.data.identities),
        method: 'email',
        rawResponse: data.data,
      };
    }
  } catch (e) { console.error('[RetargetIQ] Email lookup error:', e); }
  return null;
}

async function lookupByAddress(apiKey: string, slug: string, params: any): Promise<EnrichResult | null> {
  const query: any = { api_key: apiKey, website: slug };
  if (params.first_name) query.firstName = params.first_name;
  if (params.last_name) query.lastName = params.last_name;
  if (params.address) query.address = params.address;
  if (params.city) query.city = params.city;
  if (params.state) query.state = params.state;
  if (params.zip) query.zip = params.zip;
  console.log(`[RetargetIQ] Lookup by address`);
  try {
    const res = await fetch('https://app.retargetiq.com/api/v2/GetDataByAddress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(query),
    });
    const text = await res.text();
    if (!res.ok) return null;
    const data = JSON.parse(text);
    if (data.success && data.data?.identities?.length > 0) {
      console.log(`[RetargetIQ] ✓ Address match: ${data.data.identities.length} identities`);
      return {
        identity: data.data.identities[0],
        allIdentities: data.data.identities,
        companies: collectAllCompanies(data.data.identities),
        method: 'address',
        rawResponse: data.data,
      };
    }
  } catch (e) { console.error('[RetargetIQ] Address lookup error:', e); }
  return null;
}

function mergeResults(results: EnrichResult[], knownFirstName?: string, knownLastName?: string): { primary: any; allIdentities: any[]; companies: any[]; methods: string[]; rawResponses: any[] } {
  if (results.length === 0) return { primary: null, allIdentities: [], companies: [], methods: [], rawResponses: [] };

  // Collect all unique identities across all results
  const identityMap = new Map<string, any>();
  const companySeen = new Set<string>();
  const allCompanies: any[] = [];
  const methods: string[] = [];
  const rawResponses: any[] = [];

  for (const r of results) {
    methods.push(r.method);
    rawResponses.push(r.rawResponse);
    for (const id of r.allIdentities) {
      const key = `${id.firstName || ''}-${id.lastName || ''}-${id.address || ''}-${id.zip || ''}`;
      if (!identityMap.has(key)) {
        identityMap.set(key, id);
      } else {
        const existing = identityMap.get(key);
        const merged = { ...existing };
        for (const [k, v] of Object.entries(id)) {
          if (v && !merged[k]) merged[k] = v;
          if (Array.isArray(v) && Array.isArray(merged[k])) {
            const existingSet = new Set(merged[k].map((x: any) => JSON.stringify(x)));
            for (const item of v) {
              if (!existingSet.has(JSON.stringify(item))) merged[k].push(item);
            }
          }
        }
        identityMap.set(key, merged);
      }
    }
    // Merge companies with full deduplication
    for (const c of r.companies) {
      const key = `${c.company || ''}|${c.title || ''}`;
      if (!companySeen.has(key)) {
        companySeen.add(key);
        allCompanies.push(c);
      }
    }
  }

  const allIdentities = Array.from(identityMap.values());

  // Pick primary identity: prefer the one matching the known contact name
  let primary = allIdentities[0];
  const knownFirst = (knownFirstName || '').toLowerCase().trim();
  const knownLast = (knownLastName || '').toLowerCase().trim();

  if (knownFirst || knownLast) {
    // Score each identity by name match
    let bestScore = -1;
    for (const id of allIdentities) {
      let score = 0;
      const idFirst = (id.firstName || '').toLowerCase().trim();
      const idLast = (id.lastName || '').toLowerCase().trim();

      if (knownFirst && idFirst === knownFirst) score += 10;
      else if (knownFirst && idFirst && idFirst.startsWith(knownFirst.substring(0, 3))) score += 3;
      if (knownLast && idLast === knownLast) score += 10;
      else if (knownLast && idLast && idLast.startsWith(knownLast.substring(0, 3))) score += 3;

      // Tiebreak: richer data wins
      const fieldCount = Object.values(id).filter(v => v != null && v !== '').length;
      score += fieldCount * 0.01;

      if (score > bestScore) {
        bestScore = score;
        primary = id;
      }
    }
    console.log(`[RetargetIQ] Primary identity selected: ${primary.firstName} ${primary.lastName} (score=${bestScore.toFixed(2)}, known=${knownFirst} ${knownLast})`);
  } else {
    // No known name — fall back to richest identity
    let maxFields = 0;
    for (const id of allIdentities) {
      const fieldCount = Object.values(id).filter(v => v != null && v !== '').length;
      if (fieldCount > maxFields) {
        maxFields = fieldCount;
        primary = id;
      }
    }
  }

  return { primary, allIdentities, companies: allCompanies.length > 0 ? allCompanies : primary?.companies || [], methods, rawResponses };
}

// Safely convert a value to boolean, returning null for empty/missing values
function toBoolOrNull(val: any): boolean | null {
  if (val == null || val === '') return null;
  if (typeof val === 'boolean') return val;
  if (typeof val === 'string') {
    const lower = val.toLowerCase().trim();
    if (lower === 'true' || lower === 'yes' || lower === '1') return true;
    if (lower === 'false' || lower === 'no' || lower === '0') return false;
    return null;
  }
  return Boolean(val);
}

function extractDataFields(identity: any) {
  const d = identity?.data || {};
  const f = identity?.finances || {};

  // Build interests JSONB from boolean fields
  const interestKeys = [
    'carsInterest','entertainmentInterest','homeStudy','woodworking','homeImprovementInterest',
    'aerobics','nascar','scuba','weightLifting','artsAndCrafts','boatingSailing','gambling',
    'charityInterest','cigars','antiques','coins','fineArtsCollector','stamps','dieting','diy',
    'fitness','epicurean','gardening','golf','healthyLivingInterest','birdWatching','cooking',
    'knittingQuiltingSewing','photography','selfImprovement','homeDecor','hunting','motorcycles',
    'movies','music','outdoors','campingHiking','fishing','walking','rv','motorRacing',
    'baseball','basketball','football','hockey','soccer','running','snowSkiing','tennis',
    'outdoorsHunting','luxuryLife','travelBusiness','travelPersonal','sohoBusiness',
    'petOwner','catOwner','dogOwner','magazineSubscriber','travelCruises','travelVacation',
    'truckOwner','travelForeign','healthyLiving','dollCollector','figurinesCollector',
    'platesCollector','sportsMemorabiliaCollector',
  ];
  const interests: Record<string, boolean> = {};
  for (const k of interestKeys) {
    if (d[k] != null && d[k] !== '') interests[k] = Boolean(d[k]);
  }

  // Build reading interests JSONB
  const readingKeys = [
    'readingAvidReader','readingAstrology','readingFiction','readingBooksOnTape','readingChildrens',
    'readingComputerIt','readingCookingCulinary','readingCountryLifestyle','readingEntertainment',
    'readingFashion','readingFinance','readingHealthRemedies','readingHistory',
    'readingInteriorDecorating','readingMedicalHealth','readingMilitary','readingMystery',
    'readingRomance','readingScienceFiction','readingScienceTechnology','readingSports',
    'readingWorldNewsPolitics','readingMagazines','readingBibleDevotional',
  ];
  const readingInterests: Record<string, boolean> = {};
  for (const k of readingKeys) {
    if (d[k] != null && d[k] !== '') readingInterests[k] = Boolean(d[k]);
  }

  // Build donation history JSONB
  const donationKeys = [
    'recentDonationAnimalCause','recentDonationArtsCulturalCause','recentDonationChildrensCause',
    'recentDonationEnvironmentalCause','recentDonationHealthCause','recentDonationPoliticalCause',
    'recentDonationPoliticalConservativeCause','recentDonationPoliticalLiberalCause',
    'recentDonationPoliticalSocialCause','recentDonationReligiousCause','recentDonationVeteransCause',
  ];
  const donationHistory: Record<string, boolean> = {};
  for (const k of donationKeys) {
    if (d[k] != null && d[k] !== '') donationHistory[k] = Boolean(d[k]);
  }

  // Build affinities JSONB
  const affinityKeys = [
    'apparelAffinity','womensApparelAffinity','womensFashionAffinity','bargainHunterAffinity',
    'catalogAffinity','cookingAffinity','doItYourselfAffinity','gardeningAffinity',
    'womensHomeLivingAffinity','homeDecoratingAffinity','travelAffinity','travelUsAffinity',
    'tvMoviesAffinity',
  ];
  const affinities: Record<string, any> = {};
  for (const k of affinityKeys) {
    if (d[k] != null && d[k] !== '') affinities[k] = d[k];
  }

  // Build purchase behavior JSONB
  const purchaseKeys = [
    'books','cosmetics','healthBeautyProducts','investments','jewelry','autoParts',
    'childrensProducts','clothing','gifts','homeFurnishing','homeImprovement','musicalInstruments',
    'plusSizeClothing','recentCatalogPurchasesDollars','recentCatalogPurchasesAvgDollars',
    'recentApparelPurchasesDollars','recentApparelPurchasesAvgDollars',
    'recentHomeGoodsLivingPurchasesDollars','recentHomeGoodsLivingPurchasesAvgDollars',
    'recentPublishingPurchasesDollars','recentWomensFashionPurchasesDollars',
    'recentWomensFashionPurchasesAvgDollars','recentCatalogPurchasesCatalogs',
    'recentCatalogPurchasesOrders','recentCatalogPurchasesItems',
    'recentApparelPurchasesOrders','recentApparelPurchasesItems',
    'recentHealthPurchasesItems','recentHomeGoodsLivingPurchasesOrders',
    'recentHomeGoodsLivingPurchasesItems','recentHomeDecoratingPurchasesCompanies',
    'recentHomeDecoratingPurchasesPublishers','recentHomeLivingPurchasesPublishers',
    'recentHousewaresPurchasesPublishers','recentPurchasesPublishers',
    'recentMagazineSubscriptions','recentPublishingPurchasesTitles',
    'recentWomensFashionPurchasesOrders','recentWomensFashionPurchasesCompanies',
    'recentBargainSeekerPurchasesCompanies','recentTravelPurchasesCompanies',
  ];
  const purchaseBehavior: Record<string, any> = {};
  for (const k of purchaseKeys) {
    if (d[k] != null && d[k] !== '') purchaseBehavior[k] = d[k];
  }

  // Build vehicle summary from data-level vehicle fields
  const vehicleDataKeys = [
    'householdVehicles','vehiclePurchasedAnyNew',
    'vehicleBodyTypeSuv','vehicleBodyTypeSedan','vehicleBodyTypeTruck','vehicleBodyTypeVan',
    'vehicleBodyTypeCoupe','vehicleBodyTypeConvertible','vehicleBodyTypeMinivan',
    'vehicleBodyTypeWagon','vehicleBodyTypeHatchback','vehicleBodyTypeCrossover',
    'vehicleClassLuxury','vehicleClassMainstream','vehicleClassCompact','vehicleClassExotic',
    'vehicleDriveTypeAwd','vehicleDriveTypeFwd','vehicleDriveTypeRwd','vehicleDriveType4Wd',
    'vehicleFuelGasoline','vehicleFuelDiesel','vehicleFuelHybrid','vehicleFuelFlexFuel',
    'vehicleMsrpMin','vehicleMsrpMax','vehicleYearEarliest','vehicleYearLatest',
    'vehicleSizeFullSize','vehicleSizeMidSize','vehicleSizeSmall','vehicleSizeSports',
    'vehicleMaxPayload',
  ];
  const vehicleSummary: Record<string, any> = {};
  for (const k of vehicleDataKeys) {
    if (d[k] != null && d[k] !== '') vehicleSummary[k] = d[k];
  }

  return {
    // Financial - existing
    household_income: d.householdIncome || f.householdIncome || null,
    income_level: d.incomeLevel || null,
    credit_range: d.creditRange || f.creditRange || null,
    discretionary_income: d.discretionaryIncome || f.discretionaryIncome || null,
    financial_power: f.financialPower != null && f.financialPower !== '' ? Number(f.financialPower) : null,
    net_worth: d.householdNetWorth || null,
    net_worth_midpoint: d.householdNetWorthMidpoint != null && d.householdNetWorthMidpoint !== '' ? Number(d.householdNetWorthMidpoint) : null,
    home_ownership: d.homeOwnership || null,
    home_value: d.homeValue != null && d.homeValue !== '' ? Number(d.homeValue) : null,
    median_home_value: d.medianHomeValue != null && d.medianHomeValue !== '' ? Number(d.medianHomeValue) : null,
    mortgage_amount: d.mortgageAmount != null && d.mortgageAmount !== '' ? Number(d.mortgageAmount) : null,
    owns_investments: toBoolOrNull(d.ownsInvestments),
    is_investor: toBoolOrNull(d.investor),
    owns_stocks_bonds: toBoolOrNull(d.ownsStocksAndBonds),
    // Financial - NEW
    credit_midpoint: d.creditMidpoint != null && d.creditMidpoint !== '' ? Number(d.creditMidpoint) : null,
    household_income_midpoint: d.householdIncomeMidpoint != null && d.householdIncomeMidpoint !== '' ? Number(d.householdIncomeMidpoint) : null,
    median_income: d.medianIncome != null && d.medianIncome !== '' ? Number(d.medianIncome) : null,
    mortgage_refinance_amount: d.mortgageRefinanceAmount != null && d.mortgageRefinanceAmount !== '' ? Number(d.mortgageRefinanceAmount) : null,
    mortgage_refinance_age: d.mortgageRefinanceAge != null && d.mortgageRefinanceAge !== '' ? Number(d.mortgageRefinanceAge) : null,
    home_purchased_years_ago: d.homePurchasedYearsAgo != null && d.homePurchasedYearsAgo !== '' ? Number(d.homePurchasedYearsAgo) : null,
    owns_mutual_funds: toBoolOrNull(d.ownsMutualFunds),
    owns_swimming_pool: toBoolOrNull(d.ownsSwimmingPool),
    credit_card: toBoolOrNull(d.creditCard),
    bank_card: toBoolOrNull(d.bankCard),
    premium_card: toBoolOrNull(d.premiumCard),
    amex_card: toBoolOrNull(d.amexCard),
    premium_amex_card: toBoolOrNull(d.premiumAmexCard),
    // Demographics - existing
    education: d.education || null,
    occupation: d.occupationDetail || null,
    occupation_type: d.occupationType || null,
    occupation_category: d.occupationCategory || null,
    marital_status: d.maritalStatus || null,
    age: d.age != null && d.age !== '' ? Number(d.age) : null,
    generation: d.generation || null,
    ethnicity: d.ethnicGroup || null,
    language: d.language || null,
    urbanicity: d.urbanicity || null,
    // Demographics - NEW
    birth_year: d.birthYear != null && d.birthYear !== '' ? Number(d.birthYear) : null,
    religion: d.religion || null,
    ethnicity_detail: d.ethnicityDetail || null,
    white_collar: toBoolOrNull(d.whiteCollar),
    blue_collar: toBoolOrNull(d.blueCollar),
    speaks_english: toBoolOrNull(d.speaksEnglish),
    multilingual: toBoolOrNull(d.multilingual),
    voter: toBoolOrNull(d.voter),
    political_contributor: toBoolOrNull(d.politicalContributor),
    likely_charitable_donor: toBoolOrNull(d.likelyCharitableDonor),
    single_family_dwelling: toBoolOrNull(d.singleFamilyDwelling),
    // Household - existing
    household_adults: d.householdAdults != null && d.householdAdults !== '' ? Number(d.householdAdults) : null,
    household_persons: d.householdPersons != null && d.householdPersons !== '' ? Number(d.householdPersons) : null,
    has_children: toBoolOrNull(d.householdChild),
    dwelling_type: d.dwellingType || null,
    length_of_residence: d.lengthOfResidence != null && d.lengthOfResidence !== '' ? Number(d.lengthOfResidence) : null,
    is_veteran: toBoolOrNull(d.householdVeteran),
    // Geo - NEW
    county_name: identity?.countyName || null,
    latitude: identity?.latitude != null ? Number(identity.latitude) : null,
    longitude: identity?.longitude != null ? Number(identity.longitude) : null,
    dma: identity?.dma != null ? Number(identity.dma) : null,
    congressional_district: identity?.congressionalDistrict || null,
    // JSONB grouped fields
    interests: Object.keys(interests).length > 0 ? interests : null,
    reading_interests: Object.keys(readingInterests).length > 0 ? readingInterests : null,
    donation_history: Object.keys(donationHistory).length > 0 ? donationHistory : null,
    affinities: Object.keys(affinities).length > 0 ? affinities : null,
    purchase_behavior: Object.keys(purchaseBehavior).length > 0 ? purchaseBehavior : null,
    vehicle_summary: Object.keys(vehicleSummary).length > 0 ? vehicleSummary : null,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { client_id, lead_id, external_id, phone, email, address, city, state, zip, website_slug, first_name, last_name } = await req.json();

    const apiKey = Deno.env.get('RETARGETIQ_API_KEY');
    if (!apiKey) {
      return new Response(JSON.stringify({ success: false, error: 'RetargetIQ API key not configured' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // Get website slug
    let slug = website_slug;
    if (!slug && client_id) {
      const { data: settings } = await supabase.from('client_settings').select('retargetiq_website_slug').eq('client_id', client_id).single();
      slug = settings?.retargetiq_website_slug;
    }
    if (!slug) {
      return new Response(JSON.stringify({ success: false, error: 'RetargetIQ website slug not configured.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ========== RESOLVE KNOWN CONTACT NAME ==========
    let knownFirstName = first_name || '';
    let knownLastName = last_name || '';

    // If we don't have a name but have a lead_id or external_id, fetch it
    if (!knownFirstName && !knownLastName) {
      let leadRecord: any = null;
      if (lead_id) {
        const { data } = await supabase.from('leads').select('name').eq('id', lead_id).single();
        leadRecord = data;
      } else if (external_id && client_id) {
        const { data } = await supabase.from('leads').select('name').eq('external_id', external_id).eq('client_id', client_id).single();
        leadRecord = data;
      }
      if (leadRecord?.name) {
        const parts = leadRecord.name.trim().split(/\s+/);
        knownFirstName = parts[0] || '';
        knownLastName = parts.slice(1).join(' ') || '';
      }
    }

    console.log(`[RetargetIQ] Known contact: ${knownFirstName} ${knownLastName}`);

    // ========== WATERFALL ENRICHMENT ==========
    const results: EnrichResult[] = [];

    // Step 1: Phone lookup
    if (phone) {
      const r = await lookupByPhone(apiKey, slug, phone);
      if (r) results.push(r);
    }

    // Step 2: Email lookup
    if (email) {
      const r = await lookupByEmail(apiKey, slug, email);
      if (r) results.push(r);
    }

    // Step 3: Address lookup
    if (address || (city && state)) {
      const r = await lookupByAddress(apiKey, slug, { first_name: knownFirstName, last_name: knownLastName, address, city, state, zip });
      if (r) results.push(r);
    }

    // Step 4: Cross-reference — always try discovered emails (even if we already had one)
    {
      const alreadyTriedEmails = new Set<string>();
      if (email) alreadyTriedEmails.add(email.trim().toLowerCase());
      const foundEmails = results.flatMap(r => (r.identity?.emails || []).map((e: any) => (e?.email || e || '').toString().trim().toLowerCase()));
      for (const crossEmail of foundEmails) {
        if (!crossEmail || alreadyTriedEmails.has(crossEmail)) continue;
        alreadyTriedEmails.add(crossEmail);
        console.log(`[RetargetIQ] Cross-ref: enriching by discovered email ${crossEmail}`);
        const r = await lookupByEmail(apiKey, slug, crossEmail);
        if (r) results.push(r);
        break; // limit to 1 cross-ref to avoid CPU timeout
      }
    }

    // Step 5: Cross-reference — always try discovered phones (even if we already had one)
    {
      const alreadyTriedPhones = new Set<string>();
      if (phone) alreadyTriedPhones.add(phone.replace(/\D/g, ''));
      const foundPhones = results.flatMap(r => (r.identity?.phones || []).map((p: any) => (p?.phone || p || '').toString().replace(/\D/g, '')));
      for (const crossPhone of foundPhones) {
        if (!crossPhone || crossPhone.length < 10 || alreadyTriedPhones.has(crossPhone)) continue;
        alreadyTriedPhones.add(crossPhone);
        console.log(`[RetargetIQ] Cross-ref: enriching by discovered phone ${crossPhone}`);
        const r = await lookupByPhone(apiKey, slug, crossPhone);
        if (r) results.push(r);
        break; // limit to 1 cross-ref
      }
    }

    // Step 6: Merge all results — use known contact name to pick correct primary identity
    const merged = mergeResults(results, knownFirstName, knownLastName);

    if (!merged.primary) {
      // RetargetIQ returned no identities for this contact. This is a normal
      // "no match" — not a failure. Persist a stub row so cron sweeps skip
      // this lead for the configured refresh window instead of re-spending
      // API quota on the same dead lookup every cycle.
      try {
        if (client_id && external_id) {
          await supabase.from('lead_enrichment').upsert({
            client_id,
            external_id,
            lead_id: lead_id || null,
            enriched_at: new Date().toISOString(),
            last_enriched_at: new Date().toISOString(),
            enrichment_match_count: 0,
            enrichment_methods_used: ['no_match'],
            enrichment_version: 2,
          }, { onConflict: 'client_id,external_id' });
        }
      } catch (stubErr) {
        console.error('[RetargetIQ] no-match stub upsert failed:', stubErr);
      }
      return new Response(JSON.stringify({ success: true, matched: false, reason: 'no_match' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const identity = merged.primary;
    const dataFields = extractDataFields(identity);

    // Check if the primary identity actually matches the known contact name
    const primaryFirst = (identity.firstName || '').toLowerCase().trim();
    const primaryLast = (identity.lastName || '').toLowerCase().trim();
    const contactFirst = (knownFirstName || '').toLowerCase().trim();
    const contactLast = (knownLastName || '').toLowerCase().trim();
    const primaryMatchesContact = (!contactFirst && !contactLast) ||
      (contactFirst && primaryFirst === contactFirst) ||
      (contactLast && primaryLast === contactLast);

    // Spouse data: all identities that are NOT the primary
    const primaryKey = `${identity.firstName || ''}-${identity.lastName || ''}`;
    let spouseIdentities = merged.allIdentities
      .filter(s => `${s.firstName || ''}-${s.lastName || ''}` !== primaryKey)
      .map(s => ({
        firstName: s.firstName, lastName: s.lastName,
        gender: s.gender, age: s.data?.age,
        phones: s.phones || [], emails: s.emails || [],
        companies: s.companies || [],
        address: s.address, city: s.city, state: s.state, zip: s.zip,
        education: s.data?.education, occupation: s.data?.occupationDetail,
        maritalStatus: s.data?.maritalStatus,
      }));

    // If the primary identity doesn't match the contact name, treat the returned
    // identity as a household member and store it in spouse_data too, so the user
    // still gets all the enrichment data even though it's for a different person
    if (!primaryMatchesContact && contactFirst) {
      console.log(`[RetargetIQ] Primary identity (${identity.firstName} ${identity.lastName}) does not match contact (${knownFirstName} ${knownLastName}) — storing as household member`);
      // Add primary to spouse list since it's actually a household member
      spouseIdentities = [{
        firstName: identity.firstName, lastName: identity.lastName,
        gender: identity.gender, age: identity.data?.age,
        phones: identity.phones || [], emails: identity.emails || [],
        companies: identity.companies || [],
        address: identity.address, city: identity.city, state: identity.state, zip: identity.zip,
        education: identity.data?.education, occupation: identity.data?.occupationDetail,
        maritalStatus: identity.data?.maritalStatus,
      }, ...spouseIdentities];
    }

    // Derived V2 scores
    const netWorthMid = Number(dataFields.net_worth_midpoint || 0);
    const incomeMid = Number(dataFields.household_income_midpoint || 0)
      || Number(dataFields.median_income || 0);
    const homeVal = Number(dataFields.home_value || 0);
    const mortgageVal = Number(dataFields.mortgage_amount || 0);
    const homeEquity = homeVal && mortgageVal ? Math.max(0, homeVal - mortgageVal) : (homeVal || null);

    // Investor score (0-100)
    const nwNorm = Math.min(1, netWorthMid / 5_000_000);
    const incNorm = Math.min(1, incomeMid / 500_000);
    const accreditedFlag = (netWorthMid >= 1_000_000 || incomeMid >= 200_000) ? 1 : 0;
    const investmentsFlag = dataFields.owns_investments || dataFields.is_investor || dataFields.owns_stocks_bonds ? 1 : 0;
    const businessFlag = (identity.companies?.length || merged.companies.length) > 0 ? 1 : 0;
    const investorScore = Math.round(Math.min(100,
      (0.35 * nwNorm + 0.25 * incNorm + 0.20 * accreditedFlag + 0.10 * investmentsFlag + 0.10 * businessFlag) * 100
    ));
    const accreditedProb = investorScore >= 75 ? 'high' : investorScore >= 50 ? 'medium' : 'low';
    const businessOwner = businessFlag === 1 && investorScore >= 40;

    // Confidence score
    const methodBonus = merged.methods.length * 15;
    const identityBonus = Math.min(30, merged.allIdentities.length * 10);
    const contactBonus = (identity.phones?.length ? 15 : 0) + (identity.emails?.length ? 15 : 0) + (identity.address ? 10 : 0);
    const confidenceScore = Math.min(100, methodBonus + identityBonus + contactBonus);

    const nowIso = new Date().toISOString();
    // Build enrichment record — use known contact name if primary doesn't match
    const enrichRecord: any = {
      lead_id: lead_id || null,
      client_id,
      external_id: external_id || `manual-${Date.now()}`,
      source: 'retargetiq',
      raw_data: merged.rawResponses.length === 1 ? merged.rawResponses[0] : merged.rawResponses,
      first_name: primaryMatchesContact ? (identity.firstName || null) : (knownFirstName || identity.firstName || null),
      last_name: primaryMatchesContact ? (identity.lastName || null) : (knownLastName || identity.lastName || null),
      address: [identity.address, identity.city, identity.state, identity.zip].filter(Boolean).join(', ') || null,
      city: identity.city || null,
      state: identity.state || null,
      zip: identity.zip || null,
      gender: identity.gender === 'M' ? 'Male' : identity.gender === 'F' ? 'Female' : identity.gender || null,
      birth_date: identity.birthDate || null,
      company_name: merged.companies[0]?.company || identity.companyName || identity.company || null,
      company_title: merged.companies[0]?.title || identity.title || identity.jobTitle || null,
      linkedin_url: merged.companies[0]?.linkedin || identity.linkedin || identity.linkedinUrl || null,
      enriched_phones: identity.phones || [],
      enriched_emails: identity.emails || [],
      vehicles: identity.vehicles || [],
      enriched_at: nowIso,
      last_enriched_at: nowIso,
      enrichment_version: 2,
      confidence_score: confidenceScore,
      estimated_income: incomeMid || null,
      home_equity: homeEquity,
      investor_score: investorScore,
      accredited_probability: accreditedProb,
      business_owner: businessOwner,
      ...dataFields,
      companies: merged.companies.length > 0 ? merged.companies : null,
      spouse_data: spouseIdentities.length > 0 ? spouseIdentities : null,
      is_primary_identity: primaryMatchesContact,
      retargetiq_id: identity.id || merged.rawResponses[0]?.id || null,
      enrichment_methods_used: merged.methods,
      enrichment_match_count: merged.allIdentities.length,
    };

    // Upsert enrichment record
    const { data: upserted, error: upsertError } = await supabase
      .from('lead_enrichment')
      .upsert(enrichRecord, { onConflict: 'external_id,client_id' })
      .select()
      .single();

    if (upsertError) {
      console.error('Upsert error:', upsertError);
      return new Response(JSON.stringify({ success: false, error: upsertError.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Write enrichment data back to leads table if we have a lead_id or external_id
    if (lead_id || external_id) {
      const leadUpdate: any = {};
      if (identity.phones?.length > 0) {
        const bestPhone = identity.phones[0]?.phone || identity.phones[0];
        if (bestPhone) leadUpdate.phone = bestPhone;
      }
      if (identity.emails?.length > 0) {
        const bestEmail = identity.emails[0]?.email || identity.emails[0];
        if (bestEmail) leadUpdate.email = bestEmail;
      }
      if (identity.firstName || identity.lastName) {
        const fullName = [identity.firstName, identity.lastName].filter(Boolean).join(' ');
        if (fullName) leadUpdate.name = fullName;
      }

      if (Object.keys(leadUpdate).length > 0) {
        if (lead_id) {
          const { data: existingLead } = await supabase.from('leads').select('name, phone, email').eq('id', lead_id).single();
          if (existingLead) {
            if (existingLead.phone) delete leadUpdate.phone;
            if (existingLead.email) delete leadUpdate.email;
            if (existingLead.name) delete leadUpdate.name;
          }
          if (Object.keys(leadUpdate).length > 0) {
            await supabase.from('leads').update(leadUpdate).eq('id', lead_id);
            console.log(`[RetargetIQ] Updated lead ${lead_id} with:`, leadUpdate);
          }
        } else if (external_id && client_id) {
          const { data: existingLead } = await supabase.from('leads').select('id, name, phone, email').eq('external_id', external_id).eq('client_id', client_id).single();
          if (existingLead) {
            if (existingLead.phone) delete leadUpdate.phone;
            if (existingLead.email) delete leadUpdate.email;
            if (existingLead.name) delete leadUpdate.name;
            if (Object.keys(leadUpdate).length > 0) {
              await supabase.from('leads').update(leadUpdate).eq('id', existingLead.id);
              console.log(`[RetargetIQ] Updated lead ${existingLead.id} with:`, leadUpdate);
            }
          }
        }
      }
    }

    // ============================================================
    // Push enrichment summary as a NOTE to the GHL contact
    // (Re-enabled — clean financial summary formatted for readability)
    // ============================================================
    try {
      const { data: ghlClient } = await supabase
        .from('clients')
        .select('ghl_api_key, ghl_location_id')
        .eq('id', client_id)
        .single();

      if (ghlClient?.ghl_api_key && external_id) {
        const er = enrichRecord;
        const fmtMoney = (v: any) => {
          if (v === null || v === undefined || v === '') return null;
          const n = typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.-]/g, ''));
          return Number.isFinite(n) && n > 0 ? `$${n.toLocaleString()}` : String(v);
        };

        const lines: string[] = [];
        lines.push('💎 FINANCIAL SNAPSHOT');
        lines.push('');
        if (netWorthMid) lines.push(`• Estimated Net Worth: ${fmtMoney(netWorthMid)}`);
        else if (dataFields.net_worth) lines.push(`• Estimated Net Worth: ${dataFields.net_worth}`);
        if (incomeMid) lines.push(`• Estimated Household Income: ${fmtMoney(incomeMid)}`);
        else if (dataFields.household_income) lines.push(`• Estimated Household Income: ${dataFields.household_income}`);
        if (homeVal) lines.push(`• Primary Residence Value: ${fmtMoney(homeVal)}`);
        if (homeEquity) lines.push(`• Estimated Home Equity: ${fmtMoney(homeEquity)}`);
        lines.push(`• Accredited Investor Probability: ${accreditedProb.charAt(0).toUpperCase() + accreditedProb.slice(1)}`);
        lines.push(`• Investor Profile Score: ${investorScore}/100`);
        lines.push(`• Business Ownership: ${businessOwner ? 'Likely' : 'Unknown'}`);
        lines.push('');
        lines.push(`Last Updated: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}`);
        lines.push('Generated by RetargetIQ');

        const noteBody = lines.join('\n');

        const noteRes = await fetch(`https://services.leadconnectorhq.com/contacts/${external_id}/notes`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${ghlClient.ghl_api_key}`,
            'Content-Type': 'application/json',
            'Version': '2021-07-28',
          },
          body: JSON.stringify({ body: noteBody }),
        });

        if (noteRes.ok) {
          console.log(`[RetargetIQ] ✓ Pushed enrichment note to GHL contact ${external_id}`);
        } else {
          const errText = await noteRes.text();
          console.error(`[RetargetIQ] Failed to push GHL note (${noteRes.status}):`, errText.slice(0, 300));
        }

        // ---- Tags ----
        const tags: string[] = ['enriched'];
        if (netWorthMid >= 1_000_000) tags.push('networth_1m_plus');
        if (netWorthMid >= 5_000_000) tags.push('networth_5m_plus');
        if (incomeMid >= 250_000) tags.push('income_250k_plus');
        if (incomeMid >= 500_000) tags.push('income_500k_plus');
        if (accreditedProb === 'high') tags.push('likely_accredited');
        if (businessOwner) tags.push('business_owner');
        try {
          await fetch(`https://services.leadconnectorhq.com/contacts/${external_id}/tags`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${ghlClient.ghl_api_key}`,
              'Content-Type': 'application/json',
              'Version': '2021-07-28',
            },
            body: JSON.stringify({ tags }),
          });
          console.log(`[RetargetIQ] ✓ Applied tags to ${external_id}:`, tags.join(','));
        } catch (tErr) { console.error('[RetargetIQ] tag push failed:', tErr); }

        // ---- Custom fields (auto-create + upsert) ----
        try {
          const fieldDefs: { key: string; name: string; dataType: string; value: any }[] = [
            { key: 'estimated_net_worth', name: 'Estimated Net Worth', dataType: 'MONETORY', value: netWorthMid || null },
            { key: 'estimated_income', name: 'Estimated Income', dataType: 'MONETORY', value: incomeMid || null },
            { key: 'home_value', name: 'Home Value', dataType: 'MONETORY', value: homeVal || null },
            { key: 'home_equity', name: 'Home Equity', dataType: 'MONETORY', value: homeEquity || null },
            { key: 'investor_score', name: 'Investor Score', dataType: 'NUMERICAL', value: investorScore },
            { key: 'accredited_probability', name: 'Accredited Probability', dataType: 'TEXT', value: accreditedProb },
            { key: 'business_owner', name: 'Business Owner', dataType: 'TEXT', value: businessOwner ? 'Yes' : 'No' },
            { key: 'last_enrichment_date', name: 'Last Enrichment Date', dataType: 'DATE', value: nowIso.split('T')[0] },
          ];

          const { data: cs } = await supabase
            .from('client_settings')
            .select('ghl_custom_field_map')
            .eq('client_id', client_id)
            .maybeSingle();
          const fieldMap: Record<string, string> = ((cs as any)?.ghl_custom_field_map || {}) as any;

          const missing = fieldDefs.filter(f => !fieldMap[f.key]);
          if (missing.length > 0 && ghlClient.ghl_location_id) {
            try {
              const r = await fetch(`https://services.leadconnectorhq.com/locations/${ghlClient.ghl_location_id}/customFields`, {
                headers: {
                  'Authorization': `Bearer ${ghlClient.ghl_api_key}`,
                  'Version': '2021-07-28',
                },
              });
              if (r.ok) {
                const j = await r.json();
                const existing: any[] = j.customFields || [];
                for (const f of missing) {
                  const found = existing.find((e: any) =>
                    (e.fieldKey || '').toLowerCase().endsWith(f.key.toLowerCase()) ||
                    (e.name || '').toLowerCase() === f.name.toLowerCase()
                  );
                  if (found) {
                    fieldMap[f.key] = found.id;
                  } else {
                    const cr = await fetch(`https://services.leadconnectorhq.com/locations/${ghlClient.ghl_location_id}/customFields`, {
                      method: 'POST',
                      headers: {
                        'Authorization': `Bearer ${ghlClient.ghl_api_key}`,
                        'Content-Type': 'application/json',
                        'Version': '2021-07-28',
                      },
                      body: JSON.stringify({ name: f.name, dataType: f.dataType, placeholder: f.name, model: 'contact' }),
                    });
                    if (cr.ok) {
                      const cj = await cr.json();
                      if (cj.customField?.id) fieldMap[f.key] = cj.customField.id;
                    }
                  }
                }
                await supabase
                  .from('client_settings')
                  .update({ ghl_custom_field_map: fieldMap })
                  .eq('client_id', client_id);
              }
            } catch (cfErr) { console.error('[RetargetIQ] custom fields discovery failed:', cfErr); }
          }

          const customFields = fieldDefs
            .filter(f => f.value != null && f.value !== '' && fieldMap[f.key])
            .map(f => ({ id: fieldMap[f.key], field_value: f.value }));

          if (customFields.length > 0) {
            await fetch(`https://services.leadconnectorhq.com/contacts/${external_id}`, {
              method: 'PUT',
              headers: {
                'Authorization': `Bearer ${ghlClient.ghl_api_key}`,
                'Content-Type': 'application/json',
                'Version': '2021-07-28',
              },
              body: JSON.stringify({ customFields }),
            });
            console.log(`[RetargetIQ] ✓ Wrote ${customFields.length} custom fields to ${external_id}`);
          }
        } catch (cfErr) { console.error('[RetargetIQ] custom fields push failed:', cfErr); }

        // ---- History row ----
        try {
          await supabase.from('lead_enrichment_history').insert({
            client_id,
            lead_id: lead_id || null,
            external_id,
            event_type: 'enrichment',
            changes: {
              investor_score: investorScore,
              accredited_probability: accreditedProb,
              net_worth_midpoint: netWorthMid || null,
              home_value: homeVal || null,
              home_equity: homeEquity || null,
              confidence_score: confidenceScore,
              methods: merged.methods,
            },
          });
        } catch (hErr) { console.error('[RetargetIQ] history insert failed:', hErr); }
      }
    } catch (ghlErr) {
      console.error('[RetargetIQ] GHL note push error (non-fatal):', ghlErr);
    }

    // Push enrichment summary to HubSpot contact engagement/note
    try {
      const { data: clientData2 } = await supabase
        .from('clients')
        .select('hubspot_access_token, hubspot_portal_id')
        .eq('id', client_id)
        .single();

      if (clientData2?.hubspot_access_token) {
        // Find HubSpot contact by email or external_id
        let hsContactId: string | null = null;

        // Try searching by email first
        const searchEmail = email || (identity.emails?.[0]?.email || identity.emails?.[0]);
        if (searchEmail) {
          const searchRes = await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/search`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${clientData2.hubspot_access_token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: searchEmail }] }],
              limit: 1,
            }),
          });
          if (searchRes.ok) {
            const searchData = await searchRes.json();
            if (searchData.results?.length > 0) {
              hsContactId = searchData.results[0].id;
            }
          }
        }

        if (hsContactId) {
          // Build note lines (reuse same data)
          const hsLines: string[] = ['📊 RetargetIQ Enrichment Data', ''];
          const er = enrichRecord;
          if (er.address) hsLines.push(`📍 Address: ${er.address}`);
          if (dataFields.net_worth) hsLines.push(`💰 Net Worth: ${dataFields.net_worth}`);
          if (dataFields.household_income) hsLines.push(`💵 HH Income: ${dataFields.household_income}`);
          if (dataFields.home_value) hsLines.push(`🏡 Home Value: $${Number(dataFields.home_value).toLocaleString()}`);
          if (dataFields.home_ownership) hsLines.push(`🔑 Ownership: ${dataFields.home_ownership}`);
          if (dataFields.credit_range) hsLines.push(`💳 Credit: ${dataFields.credit_range}`);
          if (dataFields.is_investor) hsLines.push(`📈 Investor: Yes`);
          if (dataFields.education) hsLines.push(`🎓 Education: ${dataFields.education}`);
          if (dataFields.occupation) hsLines.push(`💼 Occupation: ${dataFields.occupation}`);
          if (er.company_name) hsLines.push(`🏢 Company: ${er.company_name}${er.company_title ? ` (${er.company_title})` : ''}`);
          if (er.linkedin_url) hsLines.push(`🔗 LinkedIn: ${er.linkedin_url}`);
          if (er.gender) hsLines.push(`👤 Gender: ${er.gender}`);
          if (dataFields.age) hsLines.push(`🎂 Age: ${dataFields.age}`);
          if (dataFields.marital_status) hsLines.push(`💍 Marital: ${dataFields.marital_status}`);
          if (spouseIdentities.length > 0) {
            hsLines.push('');
            hsLines.push('👥 Household Members:');
            for (const sp of spouseIdentities) {
              hsLines.push(`  • ${sp.firstName || ''} ${sp.lastName || ''}${sp.occupation ? ` — ${sp.occupation}` : ''}`);
            }
          }
          hsLines.push('');
          hsLines.push(`🔄 Enriched: ${new Date().toLocaleDateString()} via ${merged.methods.join('+')}`);

          // Create HubSpot note engagement
          const noteRes = await fetch(`https://api.hubapi.com/crm/v3/objects/notes`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${clientData2.hubspot_access_token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              properties: {
                hs_note_body: hsLines.join('\n'),
                hs_timestamp: new Date().toISOString(),
              },
              associations: [{
                to: { id: hsContactId },
                types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 202 }],
              }],
            }),
          });

          if (noteRes.ok) {
            console.log(`[RetargetIQ] ✓ Pushed enrichment note to HubSpot contact ${hsContactId}`);
          } else {
            const errText = await noteRes.text();
            console.error(`[RetargetIQ] Failed to push HubSpot note (${noteRes.status}):`, errText);
          }
        }
      }
    } catch (hsErr) {
      console.error('[RetargetIQ] HubSpot note push error (non-fatal):', hsErr);
    }

    console.log(`[RetargetIQ] ✓ Enriched ${external_id} via ${merged.methods.join('+')} — ${merged.allIdentities.length} identities, ${merged.companies.length} companies`);

    return new Response(JSON.stringify({ success: true, enrichment: upserted }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: unknown) {
    console.error('Enrichment error:', err);
    return new Response(JSON.stringify({ success: false, error: err instanceof Error ? err.message : String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
