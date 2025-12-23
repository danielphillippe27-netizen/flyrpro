import { createClient } from '@/lib/supabase/client';
import type { CampaignLandingPageAnalytics } from '@/types/database';

export class LandingPageAnalyticsService {
  private static client = createClient();

  /**
   * Fetch analytics for a specific landing page
   */
  static async fetchAnalyticsByLandingPageId(
    landingPageId: string
  ): Promise<CampaignLandingPageAnalytics[]> {
    const { data, error } = await this.client
      .from('campaign_landing_page_analytics')
      .select('*')
      .eq('landing_page_id', landingPageId)
      .order('timestamp_bucket', { ascending: false });

    if (error) throw error;
    return data || [];
  }

  /**
   * Fetch analytics for a landing page within a date range
   */
  static async fetchAnalyticsByDateRange(
    landingPageId: string,
    startDate: string,
    endDate: string
  ): Promise<CampaignLandingPageAnalytics[]> {
    const { data, error } = await this.client
      .from('campaign_landing_page_analytics')
      .select('*')
      .eq('landing_page_id', landingPageId)
      .gte('timestamp_bucket', startDate)
      .lte('timestamp_bucket', endDate)
      .order('timestamp_bucket', { ascending: false });

    if (error) throw error;
    return data || [];
  }

  /**
   * Get aggregated statistics for a landing page
   */
  static async getAggregatedStats(landingPageId: string): Promise<{
    totalViews: number;
    totalUniqueViews: number;
    totalCTAClicks: number;
    conversionRate: number;
    lastUpdated?: string;
  }> {
    const analytics = await this.fetchAnalyticsByLandingPageId(landingPageId);

    const totalViews = analytics.reduce((sum, a) => sum + a.views, 0);
    const totalUniqueViews = analytics.reduce((sum, a) => sum + a.unique_views, 0);
    const totalCTAClicks = analytics.reduce((sum, a) => sum + a.cta_clicks, 0);
    const conversionRate = totalViews > 0 ? (totalCTAClicks / totalViews) * 100 : 0;
    const lastUpdated = analytics.length > 0 ? analytics[0].timestamp_bucket : undefined;

    return {
      totalViews,
      totalUniqueViews,
      totalCTAClicks,
      conversionRate: Math.round(conversionRate * 100) / 100, // Round to 2 decimal places
      lastUpdated,
    };
  }

  /**
   * Fetch analytics for multiple landing pages (for a campaign)
   */
  static async fetchAnalyticsForCampaign(campaignId: string): Promise<
    Array<{
      landingPageId: string;
      landingPageSlug: string;
      stats: {
        totalViews: number;
        totalUniqueViews: number;
        totalCTAClicks: number;
        conversionRate: number;
      };
    }>
  > {
    // First get all landing pages for the campaign
    const { data: landingPages, error: lpError } = await this.client
      .from('campaign_landing_pages')
      .select('id, slug')
      .eq('campaign_id', campaignId);

    if (lpError) throw lpError;
    if (!landingPages || landingPages.length === 0) return [];

    // Get analytics for each landing page
    const results = await Promise.all(
      landingPages.map(async (lp) => {
        const stats = await this.getAggregatedStats(lp.id);
        return {
          landingPageId: lp.id,
          landingPageSlug: lp.slug,
          stats: {
            totalViews: stats.totalViews,
            totalUniqueViews: stats.totalUniqueViews,
            totalCTAClicks: stats.totalCTAClicks,
            conversionRate: stats.conversionRate,
          },
        };
      })
    );

    return results;
  }
}






