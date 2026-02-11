-- Daily Content Cache Table
-- Stores quote of the day and daily riddle with 24h caching

CREATE TABLE IF NOT EXISTS daily_content_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_type text NOT NULL CHECK (content_type IN ('quote', 'riddle')),
  
  -- Quote fields
  quote_text text,
  quote_author text,
  quote_category text,
  
  -- Riddle fields
  riddle_question text,
  riddle_answer text,
  riddle_difficulty text CHECK (riddle_difficulty IN ('easy', 'medium', 'hard')),
  
  -- Metadata
  source text, -- 'api_ninja', 'fallback', 'manual'
  fetched_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  
  -- For date-based lookup (YYYYMMDD)
  cache_date text NOT NULL,
  
  UNIQUE(content_type, cache_date)
);

-- Index for efficient date-based queries
CREATE INDEX IF NOT EXISTS idx_daily_content_date ON daily_content_cache(cache_date);
CREATE INDEX IF NOT EXISTS idx_daily_content_expires ON daily_content_cache(expires_at);

-- Function to get or create daily quote
CREATE OR REPLACE FUNCTION get_daily_quote()
RETURNS TABLE (
  quote_text text,
  quote_author text,
  quote_category text,
  source text,
  is_fresh boolean
) AS $$
DECLARE
  today text := to_char(now(), 'YYYYMMDD');
  cached record;
BEGIN
  -- Check for valid cached quote
  SELECT * INTO cached
  FROM daily_content_cache
  WHERE content_type = 'quote'
    AND cache_date = today
    AND expires_at > now();
  
  IF FOUND THEN
    RETURN QUERY
    SELECT 
      cached.quote_text,
      cached.quote_author,
      cached.quote_category,
      cached.source,
      false as is_fresh;
    RETURN;
  END IF;
  
  -- Return empty if no cache (API route should fetch and populate)
  RETURN QUERY
  SELECT 
    null::text,
    null::text,
    null::text,
    null::text,
    true as is_fresh;
END;
$$ LANGUAGE plpgsql;

-- Function to get or create daily riddle
CREATE OR REPLACE FUNCTION get_daily_riddle()
RETURNS TABLE (
  riddle_question text,
  riddle_answer text,
  riddle_difficulty text,
  source text,
  is_fresh boolean
) AS $$
DECLARE
  today text := to_char(now(), 'YYYYMMDD');
  cached record;
BEGIN
  -- Check for valid cached riddle
  SELECT * INTO cached
  FROM daily_content_cache
  WHERE content_type = 'riddle'
    AND cache_date = today
    AND expires_at > now();
  
  IF FOUND THEN
    RETURN QUERY
    SELECT 
      cached.riddle_question,
      cached.riddle_answer,
      cached.riddle_difficulty,
      cached.source,
      false as is_fresh;
    RETURN;
  END IF;
  
  -- Return empty if no cache (API route should fetch and populate)
  RETURN QUERY
  SELECT 
    null::text,
    null::text,
    null::text,
    null::text,
    true as is_fresh;
END;
$$ LANGUAGE plpgsql;

COMMENT ON TABLE daily_content_cache IS 'Caches daily quote and riddle from API Ninja with 24h TTL';
