CREATE OR REPLACE FUNCTION public.generate_client_slug(client_name text)
RETURNS text
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  base_slug text := 'high-performance-ads';
  final_slug text;
  counter integer := 1;
BEGIN
  final_slug := base_slug;
  WHILE EXISTS (SELECT 1 FROM public.clients WHERE slug = final_slug) LOOP
    counter := counter + 1;
    final_slug := base_slug || '-' || counter;
  END LOOP;
  RETURN final_slug;
END;
$function$;