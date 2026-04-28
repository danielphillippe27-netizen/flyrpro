ALTER TABLE public.building_address_links
DROP CONSTRAINT IF EXISTS building_address_links_match_type_check;

ALTER TABLE public.building_address_links
ADD CONSTRAINT building_address_links_match_type_check
CHECK (
  match_type IN (
    'containment_verified',
    'containment_suspect',
    'point_on_surface',
    'parcel_verified',
    'proximity_verified',
    'proximity_fallback',
    'manual',
    'orphan'
  )
);

COMMENT ON COLUMN public.building_address_links.match_type IS
'Type of spatial match: containment, point_on_surface, parcel bridge, proximity, fallback, manual, or orphan.';

CREATE OR REPLACE VIEW public.campaign_match_quality AS
SELECT
  campaign_id,
  COUNT(*) FILTER (WHERE match_type = 'containment_verified') as containment_verified,
  COUNT(*) FILTER (WHERE match_type = 'containment_suspect') as containment_suspect,
  COUNT(*) FILTER (WHERE match_type = 'point_on_surface') as point_on_surface,
  COUNT(*) FILTER (WHERE match_type = 'proximity_verified') as proximity_verified,
  COUNT(*) FILTER (WHERE match_type = 'proximity_fallback') as proximity_fallback,
  COUNT(*) FILTER (WHERE match_type = 'manual') as manual,
  COUNT(*) FILTER (WHERE match_type = 'orphan') as orphan,
  COUNT(*) as total,
  AVG(confidence) FILTER (WHERE match_type != 'orphan') as avg_confidence,
  AVG(distance_meters) FILTER (WHERE match_type != 'orphan') as avg_distance,
  COUNT(*) FILTER (WHERE match_type = 'parcel_verified') as parcel_verified
FROM public.building_address_links
GROUP BY campaign_id;
