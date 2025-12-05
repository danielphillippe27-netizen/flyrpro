import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { db } from '@/lib/editor-db/drizzle';
import { editorProjects } from '@/lib/editor-db/schema';
import { eq, and } from 'drizzle-orm';

/**
 * Get linked resources for an editor project
 * Returns campaign, landing page, and QR code information
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const cookieStore = await cookies();
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kfnsnwqylsdsbgnwgxva.supabase.co';
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
    
    const supabase = createServerClient(
      supabaseUrl,
      supabaseAnonKey,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          },
        },
      }
    );

    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
      // Get project
      const [project] = await db
        .select()
        .from(editorProjects)
        .where(and(
          eq(editorProjects.id, id),
          eq(editorProjects.userId, user.id)
        ))
        .limit(1);

      if (!project) {
        return NextResponse.json({ error: 'Project not found' }, { status: 404 });
      }

      const resources: {
        campaign: { id: string; name: string } | null;
        landingPage: { id: string; slug: string; headline?: string } | null;
        qrCodes: { id: string; slug?: string }[];
      } = {
        campaign: null,
        landingPage: null,
        qrCodes: [],
      };

      // Fetch campaign if linked
      if (project.campaignId) {
        const { data: campaign } = await supabase
          .from('campaigns')
          .select('id, name')
          .eq('id', project.campaignId)
          .single();

        if (campaign) {
          resources.campaign = {
            id: campaign.id,
            name: campaign.name || 'Unnamed Campaign',
          };

          // Fetch QR codes for this campaign
          // Check both qr_codes table and campaign_recipients with QR codes
          const { data: qrCodes } = await supabase
            .from('qr_codes')
            .select('id, slug')
            .eq('campaign_id', campaign.id);

          // Also check campaign_recipients for QR codes
          const { data: recipients } = await supabase
            .from('campaign_recipients')
            .select('id, qr_png_url')
            .eq('campaign_id', campaign.id)
            .not('qr_png_url', 'is', null);

          if (qrCodes && qrCodes.length > 0) {
            resources.qrCodes = qrCodes.map((qr) => ({
              id: qr.id,
              slug: qr.slug || undefined,
            }));
          } else if (recipients && recipients.length > 0) {
            // Use recipient IDs as QR code indicators
            resources.qrCodes = recipients.map((rec) => ({
              id: rec.id,
              slug: undefined,
            }));
          }
        }
      }

      // Fetch landing page if linked
      if (project.landingPageId) {
        const { data: landingPage } = await supabase
          .from('campaign_landing_pages')
          .select('id, slug, headline')
          .eq('id', project.landingPageId)
          .single();

        if (landingPage) {
          resources.landingPage = {
            id: landingPage.id,
            slug: landingPage.slug,
            headline: landingPage.headline || undefined,
          };
        }
      }

      // If no direct landing page link but campaign exists, check for campaign landing page
      if (!resources.landingPage && resources.campaign) {
        const { data: campaignLandingPage } = await supabase
          .from('campaign_landing_pages')
          .select('id, slug, headline')
          .eq('campaign_id', resources.campaign.id)
          .limit(1)
          .single();

        if (campaignLandingPage) {
          resources.landingPage = {
            id: campaignLandingPage.id,
            slug: campaignLandingPage.slug,
            headline: campaignLandingPage.headline || undefined,
          };
        }
      }

      return NextResponse.json({ data: resources });
    } catch (dbError: any) {
      // If database is not configured, return empty resources
      if (dbError.message?.includes('DATABASE_URL') || dbError.message?.includes('must be set')) {
        return NextResponse.json({ 
          data: {
            campaign: null,
            landingPage: null,
            qrCodes: [],
          }
        });
      }
      throw dbError;
    }
  } catch (error) {
    console.error('Error fetching project resources:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

