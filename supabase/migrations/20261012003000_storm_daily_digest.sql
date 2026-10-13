BEGIN;
CREATE TABLE IF NOT EXISTS public.storm_digest_subscriptions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 phone text NOT NULL UNIQUE CHECK (phone ~ '^\+[1-9][0-9]{7,14}$'),
 enabled boolean NOT NULL DEFAULT false,
 timezone text NOT NULL DEFAULT 'America/Toronto' CHECK (timezone='America/Toronto'),
 local_hour integer NOT NULL DEFAULT 9 CHECK (local_hour BETWEEN 0 AND 23),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.storm_digest_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 subscription_id uuid NOT NULL REFERENCES public.storm_digest_subscriptions(id) ON DELETE CASCADE,
 local_date date NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','failed')),
 summary jsonb,
 provider_message_id text,
 created_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz,
 UNIQUE(subscription_id,local_date)
);
ALTER TABLE public.storm_digest_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.storm_digest_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.storm_digest_subscriptions,public.storm_digest_runs FROM anon,authenticated;
GRANT ALL ON public.storm_digest_subscriptions,public.storm_digest_runs TO service_role;
COMMIT;
