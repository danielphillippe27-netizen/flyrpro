-- Brokerage normalization: canonical table, workspace linkage, search, seed.
-- Enables leaderboard grouping by brokerage without text-variant splits.
-- Idempotent; run after workspace_subscription_and_onboarding.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Extension for fuzzy autocomplete
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------------
-- 2) Master brokerages table (source of truth)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.brokerages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  slug text,
  logo_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_brokerages_name_lower
  ON public.brokerages (lower(name));

CREATE INDEX IF NOT EXISTS idx_brokerages_name_trgm
  ON public.brokerages USING gin (name gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- 3) Workspace linkage (canonical + fallback)
-- ---------------------------------------------------------------------------
ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS brokerage_id uuid REFERENCES public.brokerages(id) ON DELETE SET NULL;

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS brokerage_name text;

CREATE INDEX IF NOT EXISTS idx_workspaces_brokerage_id
  ON public.workspaces(brokerage_id);

-- ---------------------------------------------------------------------------
-- 4) RLS: public read for autocomplete
-- ---------------------------------------------------------------------------
ALTER TABLE public.brokerages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read access" ON public.brokerages;
CREATE POLICY "Public read access"
  ON public.brokerages
  FOR SELECT
  USING (true);

-- ---------------------------------------------------------------------------
-- 5) Seed brokerage names (ON CONFLICT DO NOTHING)
-- ---------------------------------------------------------------------------
INSERT INTO public.brokerages (name) VALUES
  ('COMPASS'),
  ('EXP REALTY'),
  ('KELLER WILLIAMS'),
  ('RE/MAX'),
  ('COLDWELL BANKER'),
  ('CENTURY 21'),
  ('ROYAL LEPAGE'),
  ('SOTHEBY''S INTERNATIONAL REALTY'),
  ('BERKSHIRE HATHAWAY HOMESERVICES'),
  ('REVEL REALTY INC'),
  ('DOUGLAS ELLIMAN'),
  ('THE AGENCY'),
  ('THE REAL BROKERAGE'),
  ('REDFIN'),
  ('SUTTON GROUP'),
  ('RIGHT AT HOME REALTY'),
  ('ENGEL & VÖLKERS'),
  ('CHRISTIE''S INTERNATIONAL REAL ESTATE'),
  ('BETTER HOMES AND GARDENS REAL ESTATE'),
  ('ERA REAL ESTATE'),
  ('HOMESMART'),
  ('REALTY ONE GROUP'),
  ('EXIT REALTY'),
  ('WEICHERT, REALTORS'),
  ('HOWARD HANNA REAL ESTATE SERVICES'),
  ('WILLIAM RAVEIS REAL ESTATE'),
  ('JOHN L. SCOTT REAL ESTATE'),
  ('LONG & FOSTER REAL ESTATE'),
  ('ALLEN TATE REALTORS'),
  ('FATHOM REALTY'),
  ('UNITED REAL ESTATE'),
  ('@PROPERTIES'),
  ('SIDE'),
  ('LPT REALTY'),
  ('THE CORCORAN GROUP'),
  ('BROWN HARRIS STEVENS'),
  ('SERHANT.'),
  ('NEST SEEKERS INTERNATIONAL'),
  ('NEXTHOME'),
  ('WINDERMERE REAL ESTATE'),
  ('CIR REALTY'),
  ('MACDONALD REALTY'),
  ('PEERAGE REALTY PARTNERS'),
  ('BOSLEY REAL ESTATE'),
  ('CHESTNUT PARK REAL ESTATE'),
  ('FOREST HILL REAL ESTATE'),
  ('HARVEY KALLES REAL ESTATE'),
  ('JOHNSTON & DANIEL'),
  ('SAVE MAX REAL ESTATE'),
  ('ZOOCASA'),
  ('PROPERLY'),
  ('STRATA'),
  ('UNRESERVED'),
  ('OPENDOOR'),
  ('ZILLOW GROUP'),
  ('CRYEST-LEIKE REAL ESTATE SERVICES'),
  ('BAIRD & WARNER'),
  ('WATSON REALTY CORP'),
  ('SIBCY CLINE REALTORS'),
  ('SHOREWEST REALTORS'),
  ('HARRY NORMAN, REALTORS'),
  ('HOULIHAN LAWRENCE'),
  ('INTERO REAL ESTATE SERVICES'),
  ('ONE PERCENT REALTY'),
  ('MAXWELL REALTY'),
  ('PARKS REAL ESTATE'),
  ('REECE NICHOLS'),
  ('SMITH & ASSOCIATES REAL ESTATE'),
  ('STARK COMPANY REALTORS'),
  ('THE GROUP REAL ESTATE'),
  ('WASHINGTON FINE PROPERTIES'),
  ('WEST USA REALTY'),
  ('ZEPHYR REAL ESTATE'),
  ('DREAM TOWN REALTY'),
  ('GIBSON SOTHEBY''S INTERNATIONAL REALTY'),
  ('GREENRIDGE REALTY'),
  ('JACK CONWAY & COMPANY'),
  ('JORDAN BARIS INC.'),
  ('DALE SORENSEN REAL ESTATE'),
  ('DANIEL GALE SOTHEBY''S INTERNATIONAL REALTY'),
  ('DECKER BULLOCK SOTHEBY''S INTERNATIONAL REALTY'),
  ('DIANE TURTON, REALTORS'),
  ('FIRST TEAM REAL ESTATE'),
  ('LYON REAL ESTATE'),
  ('RODMAN REALTY'),
  ('SLIFER SMITH & FRAMPTON'),
  ('SAMSON PROPERTIES'),
  ('GLORIA NILSON & CO. REAL ESTATE'),
  ('HUNT REAL ESTATE'),
  ('KEYES COMPANY'),
  ('COACH REALTORS'),
  ('HIGGINS GROUP PRIVATE BROKERAGE'),
  ('GUIDANCE REALTY'),
  ('HOMELIFE'),
  ('IPRO REALTY'),
  ('KINGSBURY REALTY'),
  ('STREETCITY REALTY'),
  ('TRILLIUMWEST REAL ESTATE BROKERAGE')
ON CONFLICT (name) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 6) Search function (prefix priority, then contains, limit)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.search_brokerages(
  query text,
  max_results int DEFAULT 20
)
RETURNS SETOF public.brokerages
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT *
  FROM public.brokerages
  WHERE query IS NOT NULL
    AND length(trim(query)) > 0
    AND (name ILIKE trim(query) || '%' OR name ILIKE '%' || trim(query) || '%')
  ORDER BY
    CASE WHEN name ILIKE trim(query) || '%' THEN 0 ELSE 1 END,
    name ASC
  LIMIT greatest(1, least(max_results, 50));
$$;

COMMENT ON FUNCTION public.search_brokerages(text, int)
  IS 'Brokerage autocomplete: prefix matches first, then contains; used by onboarding when industry is Real Estate.';

GRANT EXECUTE ON FUNCTION public.search_brokerages(text, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_brokerages(text, int) TO anon;

COMMIT;
