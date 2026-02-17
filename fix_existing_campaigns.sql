-- ============================================================================
-- FIX: Run Gold linker on existing campaigns with 0 linked addresses
-- ============================================================================

-- Run linker on campaign: 0201b1b6-fadc-4f65-9e0d-42fef8d07595 (294 addresses)
SELECT * FROM link_campaign_addresses_gold(
  '0201b1b6-fadc-4f65-9e0d-42fef8d07595'::UUID,
  NULL
);

-- Run linker on campaign: 5faee5d8-4eb3-4adb-ad66-17baf802eee6 (271 addresses)
SELECT * FROM link_campaign_addresses_gold(
  '5faee5d8-4eb3-4adb-ad66-17baf802eee6'::UUID,
  NULL
);

-- Run linker on campaign: 66ff3339-cf42-4d60-a874-ea7a98a01685 (56 addresses)
SELECT * FROM link_campaign_addresses_gold(
  '66ff3339-cf42-4d60-a874-ea7a98a01685'::UUID,
  NULL
);

-- Run linker on campaign: 47f890ef-9e6c-44b1-a3fe-10351d39d88d (309 addresses)
SELECT * FROM link_campaign_addresses_gold(
  '47f890ef-9e6c-44b1-a3fe-10351d39d88d'::UUID,
  NULL
);

-- Verify results
SELECT 
  campaign_id,
  COUNT(*) as total,
  COUNT(building_id) as linked
FROM campaign_addresses
WHERE campaign_id IN (
  '0201b1b6-fadc-4f65-9e0d-42fef8d07595',
  '5faee5d8-4eb3-4adb-ad66-17baf802eee6',
  '66ff3339-cf42-4d60-a874-ea7a98a01685',
  '47f890ef-9e6c-44b1-a3fe-10351d39d88d'
)
GROUP BY campaign_id;
