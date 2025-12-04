import { useCallback } from 'react';
import { BuildingColorService } from '@/lib/services/BuildingColorService';
import { ThreeHouseLayer } from '@/components/map/ThreeHouseLayer';

interface UseBuildingColorOptions {
  threeLayer: ThreeHouseLayer | null;
  onColorUpdate?: (addressId: string, color: string) => void;
}

export function useBuildingColor({ threeLayer, onColorUpdate }: UseBuildingColorOptions) {
  const updateColor = useCallback(
    async (addressId: string, color: string) => {
      // Update local model immediately
      if (threeLayer) {
        threeLayer.updateHouseColor(addressId, color);
      }

      // Persist to database
      try {
        await BuildingColorService.updateBuildingColor(addressId, color);
        onColorUpdate?.(addressId, color);
      } catch (error) {
        console.error('Failed to update building color:', error);
        // Optionally revert the local change on error
      }
    },
    [threeLayer, onColorUpdate]
  );

  const batchUpdateColors = useCallback(
    async (updates: Array<{ addressId: string; color: string }>) => {
      // Update local models immediately
      if (threeLayer) {
        updates.forEach(({ addressId, color }) => {
          threeLayer.updateHouseColor(addressId, color);
        });
      }

      // Batch persist to database
      try {
        await BuildingColorService.batchUpdateBuildingColors(updates);
        updates.forEach(({ addressId, color }) => {
          onColorUpdate?.(addressId, color);
        });
      } catch (error) {
        console.error('Failed to batch update building colors:', error);
      }
    },
    [threeLayer, onColorUpdate]
  );

  return {
    updateColor,
    batchUpdateColors,
  };
}

