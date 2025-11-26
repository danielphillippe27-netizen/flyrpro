-- RPC Functions for Landing Page Analytics
-- Run this in Supabase SQL Editor

-- Function to increment landing page views
CREATE OR REPLACE FUNCTION public.increment_landing_page_views(
    landing_page_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.campaign_landing_page_analytics (
        landing_page_id,
        views,
        timestamp_bucket
    )
    VALUES (
        landing_page_id,
        1,
        CURRENT_DATE
    )
    ON CONFLICT (landing_page_id, timestamp_bucket)
    DO UPDATE SET
        views = campaign_landing_page_analytics.views + 1;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.increment_landing_page_views(UUID) TO anon, authenticated;

-- Function to increment CTA clicks
CREATE OR REPLACE FUNCTION public.increment_landing_page_cta_clicks(
    landing_page_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.campaign_landing_page_analytics (
        landing_page_id,
        cta_clicks,
        timestamp_bucket
    )
    VALUES (
        landing_page_id,
        1,
        CURRENT_DATE
    )
    ON CONFLICT (landing_page_id, timestamp_bucket)
    DO UPDATE SET
        cta_clicks = campaign_landing_page_analytics.cta_clicks + 1;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.increment_landing_page_cta_clicks(UUID) TO anon, authenticated;

