import type { SupabaseClient } from '@supabase/supabase-js';
import type { SpatialJoinSummary } from '@/lib/services/StableLinkerService';

export type LinkQualityStatus = 'unknown' | 'healthy' | 'degraded' | 'repairing' | 'failed';

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
  reason: string | null;
  metrics: LinkQualityMetrics;
  repairRecommended: boolean;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
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

    const score = clamp(
      Math.round(
        coveragePercent
          - orphanRate * 40
          - suspectRate * 20
          - conflictCount * 5
          - densityWarningCount * 5
      ),
      0,
      100
    );

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

    const reasons: string[] = [];
    if (coveragePercent < 95) reasons.push(`coverage ${coveragePercent.toFixed(1)}%`);
    if (orphanRate > 0.05) reasons.push(`orphans ${(orphanRate * 100).toFixed(1)}%`);
    if (suspectRate > 0.1) reasons.push(`suspect ${(suspectRate * 100).toFixed(1)}%`);
    if (conflictCount > 0) reasons.push(`${conflictCount} conflicts`);
    if (densityWarningCount > 0) reasons.push(`${densityWarningCount} density warnings`);

    return {
      status,
      score,
      reason: reasons.length > 0 ? reasons.join(', ') : null,
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
        avg_confidence: summary.avgConfidence,
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
      })
      .eq('id', campaignId);

    if (error) {
      throw new Error(`Failed to persist link quality: ${error.message}`);
    }
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
