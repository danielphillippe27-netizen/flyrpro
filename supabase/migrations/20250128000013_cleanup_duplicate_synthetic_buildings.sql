-- Cleanup duplicate synthetic buildings
-- Removes synthetic buildings when a real Overture building is linked to the same address
-- This ensures the map shows only one building per address (preferring real buildings over synthetic)

-- Remove synthetic buildings if a real overture building is linked to the same address
DELETE FROM public.buildings 
WHERE gers_id LIKE 'synthetic-%' 
AND address_id IN (
    SELECT address_id 
    FROM public.buildings 
    WHERE gers_id NOT LIKE 'synthetic-%'
    AND address_id IS NOT NULL
);

-- Note: This cleanup ensures one building per address, preferring real Overture buildings
-- over synthetic placeholders. Synthetic buildings are only kept when no real building
-- exists for that address.
