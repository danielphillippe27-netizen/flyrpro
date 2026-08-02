BEGIN;

CREATE OR REPLACE FUNCTION public.enqueue_campaign_territory_iq(
  p_campaign_id uuid,
  p_reason text DEFAULT 'campaign_change'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.territory_iq_score_runs (
    campaign_id, workspace_id, idempotency_key, input_hash,
    model_key, model_version, status
  )
  SELECT
    c.id, c.workspace_id,
    concat('auto:', p_reason, ':', c.id, ':', txid_current()),
    md5(concat_ws(':', p_reason, c.id::text, txid_current()::text)),
    'auto', 'grid-score-v2-toronto', 'queued'
  FROM public.campaigns c
  WHERE c.id = p_campaign_id
  ON CONFLICT (idempotency_key) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.territory_iq_source_promotion_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  campaign_row record;
BEGIN
  IF NEW.is_promoted = true AND OLD.is_promoted IS DISTINCT FROM NEW.is_promoted THEN
    FOR campaign_row IN
      SELECT c.id
      FROM public.campaigns c
      WHERE NEW.coverage IS NULL
        OR (
          c.territory_boundary IS NOT NULL
          AND ST_Intersects(NEW.coverage::geometry, c.territory_boundary::geometry)
        )
        OR EXISTS (
          SELECT 1 FROM public.campaign_addresses ca
          WHERE ca.campaign_id = c.id
            AND ca.geom IS NOT NULL
            AND ST_Intersects(NEW.coverage::geometry, ca.geom::geometry)
        )
    LOOP
      PERFORM public.enqueue_campaign_territory_iq(campaign_row.id, concat('source:', NEW.id));
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_campaign_territory_iq(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_campaign_territory_iq(uuid, text) TO service_role;

COMMIT;
