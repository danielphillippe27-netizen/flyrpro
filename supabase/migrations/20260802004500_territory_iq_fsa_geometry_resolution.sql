BEGIN;

CREATE OR REPLACE FUNCTION public.get_territory_iq_enrichments_for_campaign(
  p_campaign_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH campaign_shape AS (
    SELECT COALESCE(
      c.territory_boundary::geometry,
      ST_ConvexHull(ST_Collect(ca.geom::geometry))
    ) AS geom
    FROM public.campaigns c
    LEFT JOIN public.campaign_addresses ca ON ca.campaign_id = c.id
    WHERE c.id = p_campaign_id
    GROUP BY c.id, c.territory_boundary
  ),
  campaign_fsas AS (
    SELECT DISTINCT upper(left(replace(ca.postal_code, ' ', ''), 3)) AS fsa
    FROM public.campaign_addresses ca
    WHERE ca.campaign_id = p_campaign_id
      AND ca.postal_code IS NOT NULL
      AND length(replace(ca.postal_code, ' ', '')) >= 3
    UNION
    SELECT DISTINCT s.area_key AS fsa
    FROM public.territory_iq_area_signals s
    JOIN public.territory_iq_source_versions sv
      ON sv.id = s.source_version_id AND sv.is_promoted
    CROSS JOIN campaign_shape c
    WHERE s.geography_level = 'fsa'
      AND s.geom IS NOT NULL
      AND c.geom IS NOT NULL
      AND ST_Intersects(s.geom::geometry, c.geom)
  ),
  permits AS (
    SELECT jsonb_agg(jsonb_build_object(
      'id', p.id, 'permit_category', p.permit_category,
      'service_category', p.service_category, 'status', p.status,
      'issued_at', p.issued_at, 'completed_at', p.completed_at,
      'confidence', p.confidence, 'longitude', ST_X(p.geom::geometry),
      'latitude', ST_Y(p.geom::geometry)
    )) AS rows
    FROM public.territory_iq_permits p
    JOIN public.territory_iq_source_versions sv
      ON sv.id = p.source_version_id AND sv.is_promoted
    CROSS JOIN campaign_shape c
    WHERE c.geom IS NOT NULL AND ST_Intersects(p.geom::geometry, c.geom)
  ),
  weather AS (
    SELECT jsonb_agg(jsonb_build_object(
      'id', w.id, 'event_type', w.event_type, 'occurred_at', w.occurred_at,
      'severity', w.severity, 'confidence', w.confidence,
      'geometry', ST_AsGeoJSON(w.geom::geometry)::jsonb
    )) AS rows
    FROM public.territory_iq_weather_events w
    JOIN public.territory_iq_source_versions sv
      ON sv.id = w.source_version_id AND sv.is_promoted
    CROSS JOIN campaign_shape c
    WHERE c.geom IS NOT NULL AND ST_Intersects(w.geom::geometry, c.geom)
  ),
  signals AS (
    SELECT jsonb_agg(jsonb_build_object(
      'id', s.id, 'signal_key', s.signal_key,
      'geography_level', s.geography_level, 'area_key', s.area_key,
      'industry_keys', s.industry_keys, 'score', s.score,
      'raw_value', s.raw_value, 'raw_unit', s.raw_unit,
      'observed_at', s.observed_at, 'confidence', s.confidence,
      'sample_size', s.sample_size,
      'geometry', CASE WHEN s.geom IS NULL THEN NULL
        ELSE ST_AsGeoJSON(s.geom::geometry)::jsonb END,
      'metrics', s.metrics, 'source_key', sv.source_key,
      'provider', sv.provider, 'dataset', sv.dataset_name,
      'version', sv.dataset_version, 'release_date', sv.release_date
    ) ORDER BY s.signal_key, s.area_key) AS rows
    FROM public.territory_iq_area_signals s
    JOIN public.territory_iq_source_versions sv
      ON sv.id = s.source_version_id AND sv.is_promoted
    CROSS JOIN campaign_shape c
    WHERE c.geom IS NOT NULL
      AND (
        (s.geom IS NOT NULL AND ST_Intersects(s.geom::geometry, c.geom))
        OR (s.geography_level = 'fsa' AND s.area_key IN (SELECT fsa FROM campaign_fsas))
      )
  )
  SELECT jsonb_build_object(
    'permits', COALESCE(permits.rows, '[]'::jsonb),
    'weather', COALESCE(weather.rows, '[]'::jsonb),
    'signals', COALESCE(signals.rows, '[]'::jsonb)
  )
  FROM permits CROSS JOIN weather CROSS JOIN signals;
$$;

REVOKE ALL ON FUNCTION public.get_territory_iq_enrichments_for_campaign(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_territory_iq_enrichments_for_campaign(uuid) TO service_role;

COMMIT;
