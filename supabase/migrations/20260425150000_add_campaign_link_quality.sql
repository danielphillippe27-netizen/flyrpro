ALTER TABLE public.campaigns
ADD COLUMN IF NOT EXISTS link_quality_status text DEFAULT 'unknown',
ADD COLUMN IF NOT EXISTS link_quality_score integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS link_quality_reason text,
ADD COLUMN IF NOT EXISTS link_quality_checked_at timestamptz,
ADD COLUMN IF NOT EXISTS link_quality_metrics jsonb DEFAULT '{}'::jsonb;

ALTER TABLE public.campaigns
DROP CONSTRAINT IF EXISTS campaigns_link_quality_status_check;

ALTER TABLE public.campaigns
ADD CONSTRAINT campaigns_link_quality_status_check
CHECK (
  link_quality_status IN ('unknown', 'healthy', 'degraded', 'repairing', 'failed')
);

CREATE INDEX IF NOT EXISTS idx_campaigns_link_quality_status
ON public.campaigns(link_quality_status)
WHERE link_quality_status IS NOT NULL;

COMMENT ON COLUMN public.campaigns.link_quality_status IS
'Current health state of persisted campaign building/address links.';

COMMENT ON COLUMN public.campaigns.link_quality_score IS
'0-100 quality score for campaign linking, derived from coverage, orphan rate, suspect rate, conflicts, and density warnings.';

COMMENT ON COLUMN public.campaigns.link_quality_reason IS
'Short human-readable explanation for degraded or failed link quality.';

COMMENT ON COLUMN public.campaigns.link_quality_metrics IS
'Structured link QA metrics including coverage, orphan rate, suspect rate, parcel bridge usage, and warning counts.';

CREATE OR REPLACE VIEW public.campaign_link_quality_dashboard AS
WITH address_counts AS (
  SELECT campaign_id, COUNT(*)::integer AS total_addresses
  FROM public.campaign_addresses
  GROUP BY campaign_id
),
link_counts AS (
  SELECT
    campaign_id,
    COUNT(*)::integer AS total_links,
    COUNT(*) FILTER (WHERE match_type = 'parcel_verified')::integer AS parcel_bridge_links,
    COUNT(*) FILTER (WHERE match_type IN ('containment_suspect', 'proximity_fallback'))::integer AS suspect_links
  FROM public.building_address_links
  GROUP BY campaign_id
),
orphan_counts AS (
  SELECT
    campaign_id,
    COUNT(*) FILTER (WHERE status IN ('pending', 'pending_review', 'ambiguous_match'))::integer AS open_orphans
  FROM public.address_orphans
  GROUP BY campaign_id
)
SELECT
  c.id AS campaign_id,
  c.name,
  c.workspace_id,
  c.owner_id,
  c.provision_status,
  c.parcel_enrichment_status,
  c.parcel_source_id,
  c.parcel_count,
  c.link_quality_status,
  c.link_quality_score,
  c.link_quality_reason,
  c.link_quality_checked_at,
  COALESCE(a.total_addresses, 0) AS total_addresses,
  COALESCE(l.total_links, 0) AS total_links,
  COALESCE(o.open_orphans, 0) AS open_orphans,
  COALESCE(l.suspect_links, 0) AS suspect_links,
  COALESCE(l.parcel_bridge_links, 0) AS parcel_bridge_links,
  CASE
    WHEN COALESCE(a.total_addresses, 0) = 0 THEN 0::numeric
    ELSE ROUND((COALESCE(l.total_links, 0)::numeric / a.total_addresses::numeric) * 100, 2)
  END AS coverage_percent,
  CASE
    WHEN COALESCE(a.total_addresses, 0) = 0 THEN 0::numeric
    ELSE ROUND((COALESCE(o.open_orphans, 0)::numeric / a.total_addresses::numeric) * 100, 2)
  END AS orphan_rate_percent,
  CASE
    WHEN COALESCE(a.total_addresses, 0) = 0 THEN 0::numeric
    ELSE ROUND((COALESCE(l.suspect_links, 0)::numeric / a.total_addresses::numeric) * 100, 2)
  END AS suspect_rate_percent,
  CASE
    WHEN COALESCE(l.total_links, 0) = 0 THEN 0::numeric
    ELSE ROUND((COALESCE(l.parcel_bridge_links, 0)::numeric / l.total_links::numeric) * 100, 2)
  END AS parcel_bridge_usage_percent,
  c.link_quality_metrics
FROM public.campaigns c
LEFT JOIN address_counts a ON a.campaign_id = c.id
LEFT JOIN link_counts l ON l.campaign_id = c.id
LEFT JOIN orphan_counts o ON o.campaign_id = c.id;

COMMENT ON VIEW public.campaign_link_quality_dashboard IS
'Operational QA dashboard view for campaign linking health, coverage, orphan rate, suspect rate, and parcel bridge usage.';
