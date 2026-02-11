-- Fix building_split_errors schema (add missing columns)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'building_split_errors' 
                   AND column_name = 'address_count') THEN
        ALTER TABLE building_split_errors ADD COLUMN address_count INTEGER;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'building_split_errors' 
                   AND column_name = 'address_ids') THEN
        ALTER TABLE building_split_errors ADD COLUMN address_ids uuid[];
    END IF;
END $$;
