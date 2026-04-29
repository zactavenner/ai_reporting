INSERT INTO public.ad_styles (
  name, description, style_config, prompt_template,
  client_id, is_default, display_order, is_active
)
SELECT
  'Capital Creative',
  'Premium institutional design system for accredited capital raising offers. Deep green / navy / black backgrounds, gold accents, Playfair Display headlines, hero return number, compliance qualifier and disclaimer.',
  jsonb_build_object(
    'palette', jsonb_build_object(
      'backgrounds', jsonb_build_array('#0B2B26','#0A1628','#1A1A2E','#0D3B3B','#0A0A0A'),
      'gold', jsonb_build_object('primary','#C5A55A','light','#D4B96E','dark','#A8893E'),
      'text', jsonb_build_object('white','#FFFFFF','offWhite','#F0EDED','lightGray','#B8B8B8','gold','#C5A55A')
    ),
    'typography', jsonb_build_object(
      'headline', jsonb_build_object('family','Playfair Display, serif','weight',900,'transform','uppercase'),
      'qualifier', jsonb_build_object('size','13px','weight',700,'letterSpacing','5px','transform','uppercase'),
      'heroReturn', jsonb_build_object('size','56-72px','weight',900),
      'cta', jsonb_build_object('size','13-15px','weight',800,'letterSpacing','3-4px','transform','uppercase')
    ),
    'compliance', jsonb_build_object(
      'qualifierText','ACCREDITED INVESTORS',
      'returnPrefix','Target',
      'disclaimer','This opportunity is for accredited investors only. All investments carry risk, including the potential loss of principal. Past performance does not guarantee future results. Any sale of securities will be made solely via our Private Placement Memorandum. Please consult your financial advisor before investing.'
    ),
    'powerWords', jsonb_build_array(
      'ACCREDITED','PROJECTED','TARGETED','SECURED','ASSET-BACKED',
      'PAID MONTHLY','QUARTERLY PAYOUTS','PREFERRED RETURNS','HIGH-YIELD',
      'IRR','TAX ADVANTAGES','CASH FLOW','ZERO MISSED PAYMENTS','AUM',
      'VERTICALLY INTEGRATED','HUD-INSURED'
    ),
    'directive_key','capital_creative'
  ),
  E'CAPITAL CREATIVE DESIGN SYSTEM — MANDATORY STYLE GUIDE:\nYou MUST follow this design system precisely. This is the production standard for accredited capital raising ads.\n\nCOLOR PALETTE:\n- Backgrounds: Deep Green #0B2B26, Navy #0A1628, Charcoal #1A1A2E, Dark Teal #0D3B3B, Pure Black #0A0A0A\n- Gold accents: Primary #C5A55A, Light #D4B96E, Dark #A8893E\n- Text: White #FFFFFF, Off-White #F0EDED, Light Gray #B8B8B8, Gold #C5A55A\n- CTA buttons: Gold bg #C5A55A with dark text, or Red #E74C3C with white text\n\nTYPOGRAPHY HIERARCHY:\n1. QUALIFIER LINE at top: small uppercase "ACCREDITED INVESTORS" — 13px, weight 700, letter-spacing 5px\n2. HERO RETURN NUMBER: biggest element — 56-72px, weight 900, gold color (e.g. "15%" or "18%")\n3. RETURN LABEL: "PREFERRED RETURNS" or "TARGETED RETURNS" — bold, uppercase\n4. HEADLINE: Playfair Display serif, 24-32px, weight 900, uppercase\n5. BENEFIT BULLETS: 14-16px, weight 600, uppercase, 2-3px letter-spacing, with gold vertical bar markers\n6. CTA: 13-15px, weight 800, uppercase, 3-4px letter-spacing, gold background\n7. DISCLAIMER: tiny 7-9px text at the very bottom, 35% opacity\n\nLAYOUT RULES:\n- Dark, premium backgrounds — NEVER white or light backgrounds\n- Gold accent elements (lines, bars, dots) for visual hierarchy\n- Strong vertical hierarchy: qualifier → hero number → headline → benefits → CTA → disclaimer\n- Real estate / land / development imagery as subtle background when applicable\n\nCOMPLIANCE (mandatory):\n- Always prefix return numbers with "Target" or "Projected" — NEVER say "guaranteed"\n- Include "ACCREDITED INVESTORS" qualifier at top\n- Include the small disclaimer at the bottom: "This opportunity is for accredited investors only. All investments carry risk, including the potential loss of principal. Past performance does not guarantee future results. Any sale of securities will be made solely via our Private Placement Memorandum. Please consult your financial advisor before investing."\n\nVISUAL FEEL: Premium, institutional, trustworthy — BlackRock meets high-end real estate fund marketing.',
  NULL, TRUE, 0, TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM public.ad_styles
  WHERE client_id IS NULL AND lower(name) = 'capital creative'
);

UPDATE public.ad_styles
SET display_order = GREATEST(display_order, 1)
WHERE client_id IS NULL
  AND lower(name) <> 'capital creative';