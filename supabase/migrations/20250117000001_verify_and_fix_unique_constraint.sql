-- Verify and fix unique constraint on campaign_addresses
-- This migration checks for duplicates and creates the constraint safely

-- Step 1: Check for existing duplicates that would prevent constraint creation
DO $$
DECLARE
  duplicate_count integer;
BEGIN
  -- Count duplicates (excluding NULL source_ids)
  SELECT COUNT(*) INTO duplicate_count
  FROM (
    SELECT campaign_id, source_id, COUNT(*) as cnt
    FROM public.campaign_addresses
    WHERE source_id IS NOT NULL
    GROUP BY campaign_id, source_id
    HAVING COUNT(*) > 1
  ) duplicates;
  
  IF duplicate_count > 0 THEN
    RAISE NOTICE 'Found % duplicate (campaign_id, source_id) pairs. Removing duplicates...', duplicate_count;
    
    -- Delete duplicates, keeping the first one (lowest id)
    DELETE FROM public.campaign_addresses
    WHERE id IN (
      SELECT id
      FROM (
        SELECT id,
               ROW_NUMBER() OVER (PARTITION BY campaign_id, source_id ORDER BY id) as rn
        FROM public.campaign_addresses
        WHERE source_id IS NOT NULL
      ) ranked
      WHERE rn > 1
    );
    
    RAISE NOTICE 'Removed duplicate rows';
  ELSE
    RAISE NOTICE 'No duplicates found';
  END IF;
END $$;

-- Step 2: Drop existing constraint/index if they exist
DROP INDEX IF EXISTS public.idx_campaign_addresses_campaign_source_id;
ALTER TABLE public.campaign_addresses
DROP CONSTRAINT IF EXISTS campaign_addresses_campaign_source_id_unique;

-- Step 3: Create the full unique constraint
ALTER TABLE public.campaign_addresses
ADD CONSTRAINT campaign_addresses_campaign_source_id_unique 
UNIQUE (campaign_id, source_id);

-- Step 4: Recreate the partial index for performance
CREATE UNIQUE INDEX IF NOT EXISTS idx_campaign_addresses_campaign_source_id 
ON public.campaign_addresses(campaign_id, source_id)
WHERE source_id IS NOT NULL;

-- Step 5: Verify the constraint exists
DO $$
DECLARE
  constraint_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 
    FROM information_schema.table_constraints 
    WHERE constraint_schema = 'public' 
    AND table_name = 'campaign_addresses' 
    AND constraint_name = 'campaign_addresses_campaign_source_id_unique'
  ) INTO constraint_exists;
  
  IF constraint_exists THEN
    RAISE NOTICE '✅ Unique constraint campaign_addresses_campaign_source_id_unique created successfully';
  ELSE
    RAISE EXCEPTION '❌ Failed to create unique constraint';
  END IF;
END $$;
