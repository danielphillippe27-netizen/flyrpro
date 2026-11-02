-- Reversible corrections above immutable campaign geometry. No source building,
-- address, contact, visit, or parcel row is deleted by this API.
BEGIN;
CREATE TABLE public.campaign_map_edit_states (
  campaign_id uuid PRIMARY KEY REFERENCES public.campaigns(id) ON DELETE CASCADE,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  features jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(features) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.campaign_map_edit_mutations (
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  mutation_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  changes jsonb NOT NULL,
  previous_values jsonb NOT NULL,
  revision bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id, mutation_id)
);
ALTER TABLE public.campaign_map_edit_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_map_edit_mutations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.campaign_map_edit_states, public.campaign_map_edit_mutations FROM anon, authenticated;
GRANT ALL ON public.campaign_map_edit_states, public.campaign_map_edit_mutations TO service_role;

CREATE FUNCTION public.apply_campaign_map_edits(
  p_campaign_id uuid, p_actor_id uuid, p_mutation_id uuid,
  p_base_revision bigint, p_changes jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  s public.campaign_map_edit_states%ROWTYPE;
  prior public.campaign_map_edit_mutations%ROWTYPE;
  c jsonb; k text; before_values jsonb := '{}'::jsonb; keys text[] := '{}';
BEGIN
  IF jsonb_typeof(p_changes) IS DISTINCT FROM 'array' OR jsonb_array_length(p_changes) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Invalid edit batch' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.campaign_map_edit_states(campaign_id) VALUES(p_campaign_id) ON CONFLICT DO NOTHING;
  SELECT * INTO STRICT s FROM public.campaign_map_edit_states WHERE campaign_id = p_campaign_id FOR UPDATE;
  SELECT * INTO prior FROM public.campaign_map_edit_mutations WHERE campaign_id = p_campaign_id AND mutation_id = p_mutation_id;
  IF FOUND THEN
    IF prior.actor_id <> p_actor_id OR prior.changes <> p_changes THEN
      RAISE EXCEPTION 'Mutation identity reused' USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object('revision', s.revision, 'features', s.features, 'appliedRevision', prior.revision);
  END IF;
  IF s.revision <> p_base_revision THEN
    RETURN jsonb_build_object('conflict', true, 'revision', s.revision, 'features', s.features);
  END IF;
  FOR c IN SELECT value FROM jsonb_array_elements(p_changes) LOOP
    IF coalesce(c->>'kind','') NOT IN ('address','building','parcel') OR coalesce(length(c->>'id'),0) NOT BETWEEN 1 AND 256
       OR NOT (c ? 'value') OR jsonb_typeof(c->'value') NOT IN ('object','null') THEN
      RAISE EXCEPTION 'Invalid map item' USING ERRCODE = '22023';
    END IF;
    k := (c->>'kind') || ':' || lower(c->>'id');
    IF k = ANY(keys) THEN RAISE EXCEPTION 'Duplicate item' USING ERRCODE = '22023'; END IF;
    keys := array_append(keys,k);
    before_values := before_values || jsonb_build_object(k, s.features->k);
    IF c->'value' = 'null'::jsonb THEN s.features := s.features - k;
    ELSE s.features := jsonb_set(s.features, ARRAY[k], c->'value'); END IF;
  END LOOP;
  s.revision := s.revision + 1;
  UPDATE public.campaign_map_edit_states SET revision=s.revision, features=s.features, updated_at=now() WHERE campaign_id=p_campaign_id;
  INSERT INTO public.campaign_map_edit_mutations(campaign_id,mutation_id,actor_id,changes,previous_values,revision)
    VALUES(p_campaign_id,p_mutation_id,p_actor_id,p_changes,before_values,s.revision);
  RETURN jsonb_build_object('revision', s.revision, 'features', s.features, 'appliedRevision', s.revision);
END $$;
REVOKE ALL ON FUNCTION public.apply_campaign_map_edits(uuid,uuid,uuid,bigint,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_campaign_map_edits(uuid,uuid,uuid,bigint,jsonb) TO service_role;
COMMIT;
