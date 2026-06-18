ALTER TABLE public.salespeople
  ADD COLUMN IF NOT EXISTS demo_email_handle text;

ALTER TABLE public.salespeople
  ADD COLUMN IF NOT EXISTS demo_email_reply_to text;

CREATE UNIQUE INDEX IF NOT EXISTS salespeople_demo_email_handle_lower_idx
  ON public.salespeople ((lower(demo_email_handle)))
  WHERE demo_email_handle IS NOT NULL;
