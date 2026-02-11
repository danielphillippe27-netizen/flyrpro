-- Extend public.user_stats with columns for doors knocked, QR stats, rates, and streak_days.
-- Safe to run if table already exists with a subset of columns (adds only missing columns).
-- If user_stats does not exist, this migration does nothing.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'user_stats'
  ) THEN
    RETURN;
  END IF;

  -- Add doors_knocked if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_stats' AND column_name = 'doors_knocked'
  ) THEN
    ALTER TABLE public.user_stats ADD COLUMN doors_knocked integer NOT NULL DEFAULT 0;
  END IF;

  -- Add qr_codes_scanned if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_stats' AND column_name = 'qr_codes_scanned'
  ) THEN
    ALTER TABLE public.user_stats ADD COLUMN qr_codes_scanned integer NOT NULL DEFAULT 0;
  END IF;

  -- Add conversation_per_door if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_stats' AND column_name = 'conversation_per_door'
  ) THEN
    ALTER TABLE public.user_stats ADD COLUMN conversation_per_door numeric NOT NULL DEFAULT 0;
  END IF;

  -- Add conversation_lead_rate if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_stats' AND column_name = 'conversation_lead_rate'
  ) THEN
    ALTER TABLE public.user_stats ADD COLUMN conversation_lead_rate numeric NOT NULL DEFAULT 0;
  END IF;

  -- Add qr_code_scan_rate if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_stats' AND column_name = 'qr_code_scan_rate'
  ) THEN
    ALTER TABLE public.user_stats ADD COLUMN qr_code_scan_rate numeric NOT NULL DEFAULT 0;
  END IF;

  -- Add qr_code_lead_rate if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_stats' AND column_name = 'qr_code_lead_rate'
  ) THEN
    ALTER TABLE public.user_stats ADD COLUMN qr_code_lead_rate numeric NOT NULL DEFAULT 0;
  END IF;

  -- Add streak_days if missing (array of dates as text, e.g. ['2025-02-01', '2025-02-02'])
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_stats' AND column_name = 'streak_days'
  ) THEN
    ALTER TABLE public.user_stats ADD COLUMN streak_days text[] DEFAULT NULL;
  END IF;

  -- Add created_at if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_stats' AND column_name = 'created_at'
  ) THEN
    ALTER TABLE public.user_stats ADD COLUMN created_at timestamptz DEFAULT now();
  END IF;
END
$$;
