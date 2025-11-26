import { createClient } from '@/lib/supabase/client';
import type { LandingPageData, LandingPageTemplate, CampaignLandingPage } from '@/types/database';
import type { CreateLandingPagePayload } from '@/types/landing-pages';

export class LandingPageService {
  private static client = createClient();

  // Campaign Landing Pages (campaign_landing_pages table)
  static async fetchCampaignLandingPageBySlug(slug: string): Promise<CampaignLandingPage | null> {
    const { data, error } = await this.client
      .from('campaign_landing_pages')
      .select('*')
      .eq('slug', slug)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data || null;
  }

  static async fetchCampaignLandingPage(id: string): Promise<CampaignLandingPage | null> {
    const { data, error } = await this.client
      .from('campaign_landing_pages')
      .select('*')
      .eq('id', id)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data || null;
  }

  static async fetchCampaignLandingPages(campaignId: string): Promise<CampaignLandingPage[]> {
    const { data, error } = await this.client
      .from('campaign_landing_pages')
      .select('*')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  }

  // Legacy methods (for backward compatibility with landing_pages table)
  static async fetchLandingPages(userId: string): Promise<LandingPageData[]> {
    const { data, error } = await this.client
      .from('landing_pages')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  }

  static async fetchLandingPage(id: string): Promise<LandingPageData | null> {
    const { data, error } = await this.client
      .from('landing_pages')
      .select('*')
      .eq('id', id)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data || null;
  }

  static async fetchLandingPageBySlug(slug: string): Promise<LandingPageData | null> {
    const { data, error } = await this.client
      .from('landing_pages')
      .select('*')
      .eq('slug', slug)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data || null;
  }

  static async createLandingPage(userId: string, payload: CreateLandingPagePayload): Promise<LandingPageData> {
    const { data, error } = await this.client
      .from('landing_pages')
      .insert({
        user_id: userId,
        campaign_id: payload.campaign_id,
        template_id: payload.template_id,
        title: payload.title,
        subtitle: payload.subtitle,
        description: payload.description,
        cta_text: payload.cta_text,
        cta_url: payload.cta_url,
        image_url: payload.image_url,
        video_url: payload.video_url,
        dynamic_data: payload.dynamic_data,
        slug: payload.title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  static async updateLandingPage(id: string, updates: Partial<LandingPageData>): Promise<void> {
    const { error } = await this.client
      .from('landing_pages')
      .update(updates)
      .eq('id', id);

    if (error) throw error;
  }

  static async deleteLandingPage(id: string): Promise<void> {
    const { error } = await this.client
      .from('landing_pages')
      .delete()
      .eq('id', id);

    if (error) throw error;
  }

  static async fetchTemplates(): Promise<LandingPageTemplate[]> {
    const { data, error } = await this.client
      .from('landing_page_templates')
      .select('*');

    if (error) throw error;
    return data || [];
  }
}

