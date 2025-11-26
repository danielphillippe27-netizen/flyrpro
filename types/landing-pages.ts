// Landing page-specific types

import type { LandingPageData, LandingPageTemplate } from './database';

export { type LandingPageData, type LandingPageTemplate };

export interface CreateLandingPagePayload {
  title: string;
  subtitle: string;
  description?: string;
  cta_text: string;
  cta_url: string;
  image_url?: string;
  video_url?: string;
  template_id?: string;
  campaign_id?: string;
  dynamic_data?: Record<string, any>;
}

