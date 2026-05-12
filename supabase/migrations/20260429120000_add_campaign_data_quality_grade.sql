BEGIN;

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS link_quality_status TEXT,
  ADD COLUMN IF NOT EXISTS link_quality_score INTEGER,
  ADD COLUMN IF NOT EXISTS link_quality_reason TEXT,
  ADD COLUMN IF NOT EXISTS link_quality_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS link_quality_metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS coverage_score INTEGER
    CHECK (coverage_score IS NULL OR (coverage_score >= 0 AND coverage_score <= 100)),
  ADD COLUMN IF NOT EXISTS data_quality TEXT
    CHECK (data_quality IN ('strong', 'usable', 'weak')),
  ADD COLUMN IF NOT EXISTS standard_mode_recommended BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS data_quality_reason TEXT;

UPDATE public.campaigns
SET
  coverage_score = COALESCE(coverage_score, ROUND(link_quality_score)::integer, ROUND(building_link_confidence)::integer, 0),
  data_quality = COALESCE(
    data_quality,
    CASE
      WHEN COALESCE(link_quality_score, building_link_confidence, 0) >= 90 THEN 'strong'
      WHEN COALESCE(link_quality_score, building_link_confidence, 0) >= 60 THEN 'usable'
      ELSE 'weak'
    END
  ),
  standard_mode_recommended = COALESCE(link_quality_score, building_link_confidence, 0) < 60,
  data_quality_reason = COALESCE(data_quality_reason, link_quality_reason)
WHERE
  coverage_score IS NULL
  OR data_quality IS NULL
  OR data_quality_reason IS NULL;

COMMENT ON COLUMN public.campaigns.coverage_score IS
'Campaign-level building-address link quality score from 0-100, including coverage, confidence, orphan, suspect, conflict, and density penalties.';

COMMENT ON COLUMN public.campaigns.data_quality IS
'Campaign-level spatial data quality grade: strong, usable, or weak.';

COMMENT ON COLUMN public.campaigns.standard_mode_recommended IS
'True when weak building-address link quality means standard pin mode is safer than building-first map modes.';

COMMENT ON COLUMN public.campaigns.data_quality_reason IS
'Primary human-readable reason for the current campaign data quality grade.';

COMMIT;
