import type { SupabaseClient } from '@supabase/supabase-js';
import type { SpatialJoinSummary } from '@/lib/services/StableLinkerService';

export type LinkQualityStatus = 'unknown' | 'healthy' | 'degraded' | 'repairing' | 'failed';
export type CampaignDataQuality = 'strong' | 'usable' | 'weak';

export interface LinkQualityMetrics {
  total_addresses: number;
  matched: number;
  orphan_count: number;
  orphan_rate: number;
  suspect_count: number;
  suspect_rate: number;
  parcel_bridge_count: number;
  parcel_bridge_rate: number;
  avg_confidence: number;
  coverage_percent: number;
  street_mismatch_count: number;
  conflict_count: number;
  density_warning_count: number;
}

export interface LinkQualityAssessment {
  status: LinkQualityStatus;
  score: number;
  coverageScore: number;
  dataQuality: CampaignDataQuality;
  standardModeRecommended: boolean;
  reason: string | null;
  metrics: LinkQualityMetrics;
  repairRecommended: boolean;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function roundScore(value: number): number {
  return Math.round(clamp(value, 0, 100));
}

export class CampaignLinkQualityService {
  constructor(private readonly supabase: SupabaseClient) {}

  static assess(summary: SpatialJoinSummary, totalAddresses: number): LinkQualityAssessment {
    const coveragePercent = Number.isFinite(summary.coveragePercent) ? summary.coveragePercent : 0;
    const orphanCount = summary.orphans || Math.max(totalAddresses - summary.matched, 0);
    const suspectCount = summary.suspect || 0;
    const parcelBridgeCount = summary.matchBreakdown.parcelVerified || 0;
    const streetMismatchCount = summary.processing_metadata?.street_mismatch_count || 0;
    const conflictCount = summary.processing_metadata?.conflict_count || 0;
    const densityWarningCount = summary.processing_metadata?.density_warning_count || 0;

    const orphanRate = totalAddresses > 0 ? orphanCount / totalAddresses : 0;
    const suspectRate = totalAddresses > 0 ? suspectCount / totalAddresses : 0;
    const parcelBridgeRate = summary.matched > 0 ? parcelBridgeCount / summary.matched : 0;
    const avgConfidence = Number.isFinite(summary.avgConfidence) ? summary.avgConfidence : 0;
    const confidencePenalty = Math.max(0, 0.85 - avgConfidence) * 60;

    const coverageScore = roundScore(
        coveragePercent
          - orphanRate * 40
          - suspectRate * 20
          - confidencePenalty
          - conflictCount * 5
          - densityWarningCount * 5
    );
    const score = coverageScore;

    let status: LinkQualityStatus = 'healthy';
    if (summary.matched === 0 && totalAddresses > 0) {
      status = 'failed';
    } else if (
      coveragePercent < 95 ||
      orphanRate > 0.05 ||
      suspectRate > 0.1 ||
      conflictCount > 0 ||
      densityWarningCount > 0
    ) {
      status = 'degraded';
    }

    let dataQuality: CampaignDataQuality = 'strong';
    if (summary.matched === 0 && totalAddresses > 0) {
      dataQuality = 'weak';
    } else if (
      coverageScore < 60 ||
      coveragePercent < 60 ||
      avgConfidence < 0.6 ||
      orphanRate > 0.25
    ) {
      dataQuality = 'weak';
    } else if (
      coverageScore < 90 ||
      coveragePercent < 90 ||
      avgConfidence < 0.8 ||
      orphanRate > 0.1 ||
      suspectRate > 0.15 ||
      conflictCount > 0 ||
      densityWarningCount > 0
    ) {
      dataQuality = 'usable';
    }

    const reasons: string[] = [];
    const primaryReasons: string[] = [];
    if (summary.matched === 0 && totalAddresses > 0) primaryReasons.push('no building-address links');
    if (coveragePercent < 95) reasons.push(`coverage ${coveragePercent.toFixed(1)}%`);
    if (coveragePercent < 90) primaryReasons.push('low building-address coverage');
    if (avgConfidence < 0.8) primaryReasons.push('low building-address confidence');
    if (orphanRate > 0.05) reasons.push(`orphans ${(orphanRate * 100).toFixed(1)}%`);
    if (orphanRate > 0.1) primaryReasons.push('high building-address orphan rate');
    if (suspectRate > 0.1) reasons.push(`suspect ${(suspectRate * 100).toFixed(1)}%`);
    if (suspectRate > 0.15) primaryReasons.push('high suspect building-address matches');
    if (conflictCount > 0) reasons.push(`${conflictCount} conflicts`);
    if (conflictCount > 0) primaryReasons.push('ambiguous building-address matches');
    if (densityWarningCount > 0) reasons.push(`${densityWarningCount} density warnings`);
    if (densityWarningCount > 0) primaryReasons.push('dense building cluster warning');

    const reason = primaryReasons[0] ?? (reasons.length > 0 ? reasons.join(', ') : null);

    return {
      status,
      score,
      coverageScore,
      dataQuality,
      standardModeRecommended: dataQuality === 'weak',
      reason,
      repairRecommended: status === 'degraded' || status === 'failed',
      metrics: {
        total_addresses: totalAddresses,
        matched: summary.matched,
        orphan_count: orphanCount,
        orphan_rate: Math.round(orphanRate * 10000) / 10000,
        suspect_count: suspectCount,
        suspect_rate: Math.round(suspectRate * 10000) / 10000,
        parcel_bridge_count: parcelBridgeCount,
        parcel_bridge_rate: Math.round(parcelBridgeRate * 10000) / 10000,
        avg_confidence: avgConfidence,
        coverage_percent: Math.round(coveragePercent * 100) / 100,
        street_mismatch_count: streetMismatchCount,
        conflict_count: conflictCount,
        density_warning_count: densityWarningCount,
      },
    };
  }

  async persist(campaignId: string, assessment: LinkQualityAssessment): Promise<void> {
    const { error } = await this.supabase
      .from('campaigns')
      .update({
        link_quality_status: assessment.status,
        link_quality_score: assessment.score,
        link_quality_reason: assessment.reason,
        link_quality_checked_at: new Date().toISOString(),
        link_quality_metrics: assessment.metrics,
        coverage_score: assessment.coverageScore,
        data_quality: assessment.dataQuality,
        standard_mode_recommended: assessment.standardModeRecommended,
        data_quality_reason: assessment.reason,
      })
      .eq('id', campaignId);

    if (error) {
      throw new Error(`Failed to persist link quality: ${error.message}`);
    }
  }

  async assessPersistedLinks(campaignId: string): Promise<LinkQualityAssessment> {
    const [
      { count: totalAddresses, error: totalError },
      { data: campaignAddressLinks, error: campaignAddressLinksError },
      { data: buildingAddressLinks, error: buildingAddressLinksError },
    ] = await Promise.all([
      this.supabase
        .from('campaign_addresses')
        .select('id', { count: 'exact', head: true })
        .eq('campaign_id', campaignId),
      this.supabase
        .from('campaign_addresses')
        .select('id, confidence')
        .eq('campaign_id', campaignId)
        .not('building_id', 'is', null),
      this.supabase
        .from('building_address_links')
        .select('address_id, confidence, match_type')
        .eq('campaign_id', campaignId),
    ]);

    if (totalError) {
      throw new Error(`Failed to count campaign addresses: ${totalError.message}`);
    }
    if (campaignAddressLinksError) {
      throw new Error(`Failed to count directly linked campaign addresses: ${campaignAddressLinksError.message}`);
    }
    if (buildingAddressLinksError) {
      throw new Error(`Failed to count building address links: ${buildingAddressLinksError.message}`);
    }

    const total = totalAddresses ?? 0;
    const linkedAddressIds = new Set<string>();
    const confidences: number[] = [];
    let parcelBridgeCount = 0;

    for (const row of campaignAddressLinks ?? []) {
      if (typeof row.id === 'string') {
        linkedAddressIds.add(row.id);
      }
      if (typeof row.confidence === 'number') {
        confidences.push(row.confidence);
      }
    }

    for (const row of buildingAddressLinks ?? []) {
      if (typeof row.address_id === 'string') {
        linkedAddressIds.add(row.address_id);
      }
      if (typeof row.confidence === 'number') {
        confidences.push(row.confidence);
      }
      if (row.match_type === 'parcel_verified') {
        parcelBridgeCount += 1;
      }
    }

    const matched = linkedAddressIds.size;
    const coveragePercent = total > 0 ? Math.round((matched / total) * 10000) / 100 : 0;
    const avgConfidence = confidences.length > 0
      ? Math.round((confidences.reduce((sum, value) => sum + value, 0) / confidences.length) * 100) / 100
      : matched > 0 ? 1 : 0;

    return CampaignLinkQualityService.assess(
      {
        matched,
        orphans: Math.max(total - matched, 0),
        suspect: 0,
        avgConfidence,
        coveragePercent,
        matchBreakdown: {
          containmentVerified: 0,
          containmentSuspect: 0,
          pointOnSurface: 0,
          parcelVerified: parcelBridgeCount,
          proximityVerified: 0,
          proximityFallback: 0,
        },
      },
      total
    );
  }

  async updateStatus(
    campaignId: string,
    status: Extract<LinkQualityStatus, 'repairing' | 'failed' | 'healthy' | 'degraded'>,
    reason?: string | null
  ): Promise<void> {
    const update: Record<string, unknown> = {
      link_quality_status: status,
      link_quality_checked_at: new Date().toISOString(),
    };
    if (reason !== undefined) {
      update.link_quality_reason = reason;
    }

    const { error } = await this.supabase
      .from('campaigns')
      .update(update)
      .eq('id', campaignId);

    if (error) {
      throw new Error(`Failed to update link quality status: ${error.message}`);
    }
  }
}
