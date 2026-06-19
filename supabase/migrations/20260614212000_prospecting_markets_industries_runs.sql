BEGIN;

CREATE TABLE IF NOT EXISTS public.prospect_markets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code text NOT NULL DEFAULT 'CA',
  region text NOT NULL,
  city text NOT NULL,
  label text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  priority integer NOT NULL DEFAULT 100,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prospect_markets_city_not_blank CHECK (char_length(trim(city)) > 0),
  CONSTRAINT prospect_markets_region_not_blank CHECK (char_length(trim(region)) > 0),
  CONSTRAINT prospect_markets_country_region_city_unique UNIQUE (country_code, region, city)
);

CREATE INDEX IF NOT EXISTS idx_prospect_markets_enabled_priority
  ON public.prospect_markets(enabled, priority, country_code, region, city);

CREATE TABLE IF NOT EXISTS public.prospect_industries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  default_terms jsonb NOT NULL DEFAULT '[]'::jsonb,
  enabled boolean NOT NULL DEFAULT true,
  priority integer NOT NULL DEFAULT 100,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prospect_industries_name_not_blank CHECK (char_length(trim(name)) > 0),
  CONSTRAINT prospect_industries_slug_not_blank CHECK (char_length(trim(slug)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_prospect_industries_enabled_priority
  ON public.prospect_industries(enabled, priority, name);

CREATE TABLE IF NOT EXISTS public.prospect_search_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  market_id uuid REFERENCES public.prospect_markets(id) ON DELETE SET NULL,
  industry_id uuid REFERENCES public.prospect_industries(id) ON DELETE SET NULL,
  city text NOT NULL,
  region text,
  country_code text NOT NULL DEFAULT 'CA',
  industry text NOT NULL,
  query_terms jsonb NOT NULL DEFAULT '[]'::jsonb,
  query_count integer NOT NULL DEFAULT 0,
  raw_count integer NOT NULL DEFAULT 0,
  unique_count integer NOT NULL DEFAULT 0,
  saved_count integer NOT NULL DEFAULT 0,
  dialer_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'completed',
  error_message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prospect_search_runs_status_check CHECK (status IN ('completed', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_prospect_search_runs_workspace_created
  ON public.prospect_search_runs(workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_prospect_search_runs_workspace_market_industry
  ON public.prospect_search_runs(workspace_id, market_id, industry_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.prospect_search_run_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.prospect_search_runs(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  place_id text,
  business_name text NOT NULL,
  phone text,
  website text,
  formatted_address text,
  score integer,
  was_saved boolean NOT NULL DEFAULT false,
  was_added_to_dialer boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prospect_search_run_results_run
  ON public.prospect_search_run_results(run_id);

ALTER TABLE public.prospect_markets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_industries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_search_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_search_run_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "prospect_markets_read_enabled" ON public.prospect_markets;
CREATE POLICY "prospect_markets_read_enabled"
  ON public.prospect_markets FOR SELECT
  USING (enabled = true);

DROP POLICY IF EXISTS "prospect_industries_read_enabled" ON public.prospect_industries;
CREATE POLICY "prospect_industries_read_enabled"
  ON public.prospect_industries FOR SELECT
  USING (enabled = true);

DROP POLICY IF EXISTS "prospect_search_runs_member_read" ON public.prospect_search_runs;
CREATE POLICY "prospect_search_runs_member_read"
  ON public.prospect_search_runs FOR SELECT
  USING (workspace_id = ANY(public.current_user_workspace_ids()));

DROP POLICY IF EXISTS "prospect_search_run_results_member_read" ON public.prospect_search_run_results;
CREATE POLICY "prospect_search_run_results_member_read"
  ON public.prospect_search_run_results FOR SELECT
  USING (workspace_id = ANY(public.current_user_workspace_ids()));

INSERT INTO public.prospect_markets (country_code, region, city, label, priority)
VALUES
  ('CA', 'Ontario', 'Toronto', 'Toronto, ON', 1),
  ('CA', 'Ontario', 'Mississauga', 'Mississauga, ON', 2),
  ('CA', 'Ontario', 'Brampton', 'Brampton, ON', 3),
  ('CA', 'Ontario', 'Vaughan', 'Vaughan, ON', 4),
  ('CA', 'Ontario', 'Markham', 'Markham, ON', 5),
  ('CA', 'Ontario', 'Richmond Hill', 'Richmond Hill, ON', 6),
  ('CA', 'Ontario', 'Oakville', 'Oakville, ON', 7),
  ('CA', 'Ontario', 'Burlington', 'Burlington, ON', 8),
  ('CA', 'Ontario', 'Hamilton', 'Hamilton, ON', 9),
  ('CA', 'Ontario', 'Oshawa', 'Oshawa, ON', 10),
  ('CA', 'Ontario', 'Whitby', 'Whitby, ON', 11),
  ('CA', 'Ontario', 'Ajax', 'Ajax, ON', 12),
  ('CA', 'Ontario', 'Pickering', 'Pickering, ON', 13),
  ('CA', 'Ontario', 'Barrie', 'Barrie, ON', 14),
  ('CA', 'Ontario', 'Kitchener', 'Kitchener, ON', 15),
  ('CA', 'Ontario', 'Waterloo', 'Waterloo, ON', 16),
  ('CA', 'Ontario', 'London', 'London, ON', 17),
  ('CA', 'Ontario', 'Ottawa', 'Ottawa, ON', 18),
  ('CA', 'Ontario', 'Guelph', 'Guelph, ON', 19),
  ('CA', 'Ontario', 'Cambridge', 'Cambridge, ON', 20),
  ('CA', 'Alberta', 'Calgary', 'Calgary, AB', 30),
  ('CA', 'Alberta', 'Edmonton', 'Edmonton, AB', 31),
  ('CA', 'Alberta', 'Red Deer', 'Red Deer, AB', 32),
  ('CA', 'Alberta', 'Lethbridge', 'Lethbridge, AB', 33),
  ('CA', 'Alberta', 'Medicine Hat', 'Medicine Hat, AB', 34),
  ('CA', 'British Columbia', 'Vancouver', 'Vancouver, BC', 40),
  ('CA', 'British Columbia', 'Surrey', 'Surrey, BC', 41),
  ('CA', 'British Columbia', 'Burnaby', 'Burnaby, BC', 42),
  ('CA', 'British Columbia', 'Richmond', 'Richmond, BC', 43),
  ('CA', 'British Columbia', 'Victoria', 'Victoria, BC', 44),
  ('CA', 'Quebec', 'Montreal', 'Montreal, QC', 50),
  ('CA', 'Quebec', 'Laval', 'Laval, QC', 51),
  ('CA', 'Quebec', 'Quebec City', 'Quebec City, QC', 52),
  ('CA', 'Manitoba', 'Winnipeg', 'Winnipeg, MB', 60),
  ('CA', 'Saskatchewan', 'Saskatoon', 'Saskatoon, SK', 70),
  ('CA', 'Saskatchewan', 'Regina', 'Regina, SK', 71),
  ('CA', 'Nova Scotia', 'Halifax', 'Halifax, NS', 80),
  ('US', 'Texas', 'Austin', 'Austin, TX', 100),
  ('US', 'Texas', 'Dallas', 'Dallas, TX', 101),
  ('US', 'Texas', 'Houston', 'Houston, TX', 102),
  ('US', 'Florida', 'Miami', 'Miami, FL', 110),
  ('US', 'Florida', 'Tampa', 'Tampa, FL', 111),
  ('US', 'Florida', 'Orlando', 'Orlando, FL', 112),
  ('US', 'California', 'Los Angeles', 'Los Angeles, CA', 120),
  ('US', 'California', 'San Diego', 'San Diego, CA', 121),
  ('US', 'Arizona', 'Phoenix', 'Phoenix, AZ', 130),
  ('US', 'Colorado', 'Denver', 'Denver, CO', 140),
  ('US', 'Illinois', 'Chicago', 'Chicago, IL', 150),
  ('US', 'Georgia', 'Atlanta', 'Atlanta, GA', 160),
  ('US', 'New York', 'New York', 'New York, NY', 170)
ON CONFLICT (country_code, region, city) DO UPDATE SET
  label = EXCLUDED.label,
  priority = EXCLUDED.priority,
  enabled = true,
  updated_at = now();

INSERT INTO public.prospect_industries (name, slug, default_terms, priority)
VALUES
  ('Roofing contractors', 'roofing-contractors', '["roofing contractor","roofing company","roof repair","roof replacement","commercial roofing contractor","flat roof repair","metal roofing","shingle roofing"]'::jsonb, 1),
  ('Solar installers', 'solar-installers', '["solar installer","solar company","solar panels","residential solar","commercial solar","solar energy contractor"]'::jsonb, 2),
  ('HVAC contractors', 'hvac-contractors', '["HVAC contractor","HVAC company","heating contractor","air conditioning repair","furnace repair","heating and cooling"]'::jsonb, 3),
  ('Window and door companies', 'windows-doors', '["window company","window replacement","door replacement","windows and doors","window installer"]'::jsonb, 4),
  ('Pest control companies', 'pest-control', '["pest control company","pest control service","exterminator","commercial pest control","wildlife control"]'::jsonb, 5),
  ('Landscaping companies', 'landscaping', '["landscaping company","landscape contractor","lawn care service","property maintenance","grounds maintenance"]'::jsonb, 6),
  ('Snow removal companies', 'snow-removal', '["snow removal","snow plowing","commercial snow removal","winter property maintenance"]'::jsonb, 7),
  ('Lawn care companies', 'lawn-care', '["lawn care service","lawn maintenance","weed control","fertilizer service","yard maintenance"]'::jsonb, 8),
  ('Home security companies', 'home-security', '["home security company","security systems","alarm company","smart home security","CCTV installer"]'::jsonb, 9),
  ('Internet providers', 'internet-providers', '["internet provider","fiber internet","wireless internet","home internet","telecom dealer"]'::jsonb, 10),
  ('Painting companies', 'painting', '["painting company","house painter","exterior painting","interior painting","commercial painting","residential painting"]'::jsonb, 11),
  ('Driveway sealing and paving', 'driveway-sealing-paving', '["driveway sealing","driveway paving","asphalt paving","asphalt sealing","sealcoating","paving contractor","driveway repair","new driveway"]'::jsonb, 12),
  ('Garage door companies', 'garage-doors', '["garage door company","garage door repair","garage door installation","overhead door company"]'::jsonb, 13),
  ('Siding contractors', 'siding-contractors', '["siding contractor","siding company","vinyl siding","exterior siding","siding repair"]'::jsonb, 14),
  ('Insulation companies', 'insulation', '["insulation contractor","attic insulation","spray foam insulation","home insulation"]'::jsonb, 15),
  ('Deck and fence companies', 'decks-fences', '["deck builder","fence contractor","deck contractor","fence company","patio contractor"]'::jsonb, 16),
  ('Pool and spa companies', 'pools-spas', '["pool company","pool service","pool installation","hot tub dealer","spa service"]'::jsonb, 17),
  ('Cleaning companies', 'cleaning', '["cleaning company","cleaning service","commercial cleaning","house cleaning","janitorial service"]'::jsonb, 18),
  ('Junk removal companies', 'junk-removal', '["junk removal","waste removal","rubbish removal","haul away service"]'::jsonb, 19),
  ('Moving companies', 'moving-companies', '["moving company","movers","local movers","residential moving","commercial moving"]'::jsonb, 20),
  ('Real estate', 'real-estate-teams', '["real estate agents","real estate brokerage","realtor","real estate agent","real estate team","realtor team","real estate group"]'::jsonb, 21),
  ('Mortgage brokers', 'mortgage-brokers', '["mortgage broker","mortgage agent","home loan broker","mortgage specialist"]'::jsonb, 22),
  ('Insurance brokers', 'insurance-brokers', '["insurance broker","home insurance broker","auto insurance broker","insurance agency"]'::jsonb, 23),
  ('Financial advisors', 'financial-advisors', '["financial advisor","wealth advisor","investment advisor","retirement planner"]'::jsonb, 24),
  ('Energy retailers', 'energy-retailers', '["energy retailer","electricity provider","natural gas provider","utility provider"]'::jsonb, 25),
  ('Water treatment companies', 'water-treatment', '["water softener","water treatment","water filtration","reverse osmosis","water purifier"]'::jsonb, 26),
  ('Concrete contractors', 'concrete-contractors', '["concrete contractor","concrete company","stamped concrete","driveway concrete"]'::jsonb, 27),
  ('Masonry companies', 'masonry', '["masonry contractor","brick repair","stone mason","chimney repair","interlock repair"]'::jsonb, 28),
  ('Tree service companies', 'tree-service', '["tree service","arborist","tree removal","tree trimming","stump grinding"]'::jsonb, 29),
  ('Irrigation companies', 'irrigation', '["irrigation company","sprinkler system","lawn sprinkler","irrigation repair"]'::jsonb, 30),
  ('Flooring companies', 'flooring', '["flooring company","flooring contractor","hardwood flooring","carpet installer","vinyl flooring"]'::jsonb, 31),
  ('Blinds and shutters companies', 'blinds-shutters', '["window blinds","shutters","custom blinds","window coverings"]'::jsonb, 32),
  ('Appliance repair companies', 'appliance-repair', '["appliance repair","washer repair","dryer repair","fridge repair","appliance service"]'::jsonb, 33),
  ('Restoration companies', 'restoration', '["water damage restoration","fire damage restoration","restoration company","mold remediation"]'::jsonb, 34),
  ('Property management companies', 'property-management', '["property management company","residential property management","rental management"]'::jsonb, 35),
  ('Chimney companies', 'chimney-service', '["chimney sweep","chimney repair","fireplace service","chimney cleaning"]'::jsonb, 36),
  ('Duct cleaning companies', 'duct-cleaning', '["duct cleaning","air duct cleaning","vent cleaning","furnace duct cleaning"]'::jsonb, 37),
  ('Carpet cleaning companies', 'carpet-cleaning', '["carpet cleaning","rug cleaning","upholstery cleaning","steam cleaning"]'::jsonb, 38),
  ('Locksmiths', 'locksmiths', '["locksmith","mobile locksmith","residential locksmith","commercial locksmith"]'::jsonb, 39),
  ('Senior home care', 'senior-home-care', '["home care agency","senior home care","personal support worker","elder care"]'::jsonb, 40),
  ('Private tutoring', 'private-tutoring', '["tutoring service","private tutor","math tutor","learning center"]'::jsonb, 41),
  ('Pet services', 'pet-services', '["dog walker","pet sitter","mobile dog grooming","pet care service"]'::jsonb, 42),
  ('Home organization services', 'home-organization', '["home organizer","professional organizer","decluttering service","garage organization"]'::jsonb, 43),
  ('Mobile car detailing', 'mobile-car-detailing', '["mobile car detailing","auto detailing","car detailing service","mobile wash"]'::jsonb, 44)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  default_terms = EXCLUDED.default_terms,
  priority = EXCLUDED.priority,
  enabled = true,
  updated_at = now();

COMMIT;
