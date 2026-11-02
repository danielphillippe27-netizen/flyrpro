BEGIN;
CREATE TABLE IF NOT EXISTS public.campaign_hidden_parcels (
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  parcel_id uuid NOT NULL,
  external_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id, parcel_id)
);
ALTER TABLE public.campaign_hidden_parcels ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaign_hidden_parcels TO service_role;
CREATE OR REPLACE FUNCTION public.hide_and_delete_campaign_parcel(p_campaign_id uuid, p_parcel_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE parcel_external_id text;
BEGIN
  SELECT external_id INTO parcel_external_id FROM public.campaign_parcels
    WHERE campaign_id = p_campaign_id AND id = p_parcel_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO public.campaign_hidden_parcels (campaign_id, parcel_id, external_id)
    VALUES (p_campaign_id, p_parcel_id, parcel_external_id)
    ON CONFLICT (campaign_id, parcel_id) DO UPDATE SET external_id = EXCLUDED.external_id;
  DELETE FROM public.campaign_parcels WHERE campaign_id = p_campaign_id AND id = p_parcel_id;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.hide_and_delete_campaign_parcel(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hide_and_delete_campaign_parcel(uuid, uuid) TO service_role;
COMMIT;
