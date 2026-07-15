BEGIN;

CREATE OR REPLACE FUNCTION public.invalidate_campaign_map_bundle_for_field_manual_pin()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campaign_id UUID;
  v_was_pin BOOLEAN := FALSE;
  v_is_pin BOOLEAN := FALSE;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    v_was_pin := OLD.match_source = 'field_manual_pin';
  END IF;
  IF TG_OP <> 'DELETE' THEN
    v_is_pin := NEW.match_source = 'field_manual_pin';
  END IF;

  IF NOT v_was_pin AND NOT v_is_pin THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    v_campaign_id := OLD.campaign_id;
  ELSE
    v_campaign_id := NEW.campaign_id;
  END IF;
  UPDATE public.campaign_map_bundles
  SET expires_at = NOW()
  WHERE campaign_id = v_campaign_id
    AND is_current = TRUE;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS invalidate_map_bundle_for_field_manual_pin
  ON public.campaign_addresses;
CREATE TRIGGER invalidate_map_bundle_for_field_manual_pin
  AFTER INSERT OR UPDATE OR DELETE ON public.campaign_addresses
  FOR EACH ROW
  EXECUTE FUNCTION public.invalidate_campaign_map_bundle_for_field_manual_pin();

COMMIT;
