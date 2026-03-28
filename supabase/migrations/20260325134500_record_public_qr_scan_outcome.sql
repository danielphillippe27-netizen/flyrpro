-- Public QR scans need to persist canonical house outcomes without an authenticated web user.
-- This wrapper impersonates the campaign owner inside the transaction, then delegates to
-- record_campaign_address_outcome so the write path stays canonical.

CREATE OR REPLACE FUNCTION public.record_public_qr_scan_outcome(
  p_campaign_address_id UUID,
  p_status TEXT DEFAULT 'delivered',
  p_notes TEXT DEFAULT NULL,
  p_occurred_at TIMESTAMPTZ DEFAULT now()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campaign_id UUID;
  v_owner_id UUID;
  v_result JSONB;
BEGIN
  SELECT ca.campaign_id, c.owner_id
  INTO v_campaign_id, v_owner_id
  FROM public.campaign_addresses ca
  JOIN public.campaigns c ON c.id = ca.campaign_id
  WHERE ca.id = p_campaign_address_id;

  IF v_campaign_id IS NULL OR v_owner_id IS NULL THEN
    RAISE EXCEPTION 'Campaign address not found';
  END IF;

  PERFORM set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', v_owner_id,
      'role', 'authenticated'
    )::text,
    true
  );
  PERFORM set_config('request.jwt.claim.sub', v_owner_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  SELECT public.record_campaign_address_outcome(
    p_campaign_id => v_campaign_id,
    p_campaign_address_id => p_campaign_address_id,
    p_status => p_status,
    p_notes => p_notes,
    p_occurred_at => p_occurred_at
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.record_public_qr_scan_outcome(UUID, TEXT, TEXT, TIMESTAMPTZ)
IS 'Server-side wrapper for public QR scans that delegates canonical address outcome persistence to record_campaign_address_outcome.';

GRANT EXECUTE ON FUNCTION public.record_public_qr_scan_outcome(UUID, TEXT, TEXT, TIMESTAMPTZ) TO service_role;
