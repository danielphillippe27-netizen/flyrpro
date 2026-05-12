import type { LinkQualityAssessment } from '@/lib/services/CampaignLinkQualityService';

export const CAMPAIGN_LINKING_PENDING_REASON = 'building-address linking pending';

export function buildPendingCampaignDataQualityPatch() {
  return {
    coverage_score: 0,
    data_quality: 'weak' as const,
    standard_mode_recommended: true,
    data_quality_reason: CAMPAIGN_LINKING_PENDING_REASON,
  };
}

export function buildCampaignDataQualityResponse(linkQuality?: LinkQualityAssessment | null) {
  return {
    coverage_score: linkQuality?.coverageScore ?? 0,
    data_quality: linkQuality?.dataQuality ?? 'weak',
    standard_mode_recommended: linkQuality?.standardModeRecommended ?? true,
    reason: linkQuality ? linkQuality.reason : CAMPAIGN_LINKING_PENDING_REASON,
  };
}
