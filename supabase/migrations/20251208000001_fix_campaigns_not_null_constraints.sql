-- Fix NOT NULL constraints on campaigns table
-- Make description nullable or set default to avoid constraint violations

DO $$
BEGIN
  -- Check if description column exists and has NOT NULL constraint
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'campaigns' 
    AND column_name = 'description'
    AND is_nullable = 'NO'
  ) THEN
    -- Make description nullable
    ALTER TABLE campaigns
    ALTER COLUMN description DROP NOT NULL;
    
    -- Set default empty string for description
    ALTER TABLE campaigns
    ALTER COLUMN description SET DEFAULT '';
    
    -- Update existing null descriptions
    UPDATE campaigns
    SET description = ''
    WHERE description IS NULL;
  END IF;
END $$;
