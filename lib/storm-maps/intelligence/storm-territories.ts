import { z } from 'zod';
import { campaignStormSchema, type StormCampaignContext } from './model';
import { stormGeometrySchema, containedStormArea, type StormGeometry } from './geometry';
export const stormTerritorySchema = z.object({
  name: z.string().trim().min(1).max(160), boundary: stormGeometrySchema,
  context: campaignStormSchema,
}).strict();
export type SavedStormTerritory = {
  id: string; name: string; boundary: StormGeometry; context: StormCampaignContext; created_at: string; revision?: number; updated_at?: string;
};
export function campaignWithinStormTerritory(child: StormGeometry, parent: StormGeometry) {
  return containedStormArea(child,parent);
}

/** A pointer-drawn inspection area makes no measured severity claim. */
export function normalizeStormDrawingContext(context: StormCampaignContext): StormCampaignContext {
  const manual = context.selection === 'user-drawn' && context.minimumHailMM == null && context.maximumHailMM == null &&
    !context.zoneId && !context.sampling && !context.windSelection && !context.reportSelection && !context.surveySelection;
  if (manual && (context.evidenceKind === 'hail-size' || context.evidenceKind === 'user-drawn')) {
    return { ...context, evidenceKind: 'user-drawn' };
  }
  return context;
}
