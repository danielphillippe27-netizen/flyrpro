'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { LandingPageService } from '@/lib/services/LandingPageService';
import type { CampaignLandingPage } from '@/types/database';

export default function LandingPageRoute() {
  const params = useParams();
  const slug = params.slug as string;
  const [landingPage, setLandingPage] = useState<CampaignLandingPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadLandingPage = async () => {
      try {
        setLoading(true);
        const page = await LandingPageService.fetchCampaignLandingPageBySlug(slug);
        
        if (!page) {
          setError('Landing page not found');
          return;
        }

        setLandingPage(page);
        
        // Track page view (non-blocking)
        if (page.id) {
          try {
            const { createClient } = await import('@/lib/supabase/client');
            const supabase = createClient();
            await supabase.rpc('increment_landing_page_views', {
              landing_page_id: page.id,
            });
          } catch (analyticsError) {
            console.error('Failed to track page view:', analyticsError);
            // Don't block page rendering if analytics fails
          }
        }
      } catch (err) {
        console.error('Error loading landing page:', err);
        setError('Failed to load landing page');
      } finally {
        setLoading(false);
      }
    };

    if (slug) {
      loadLandingPage();
    }
  }, [slug]);

  const handleCTAClick = async (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (!landingPage?.id) return;

    // Track CTA click (non-blocking)
    try {
      const response = await fetch('/api/landing-page/cta-click', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          landingPageId: landingPage.id,
        }),
      });

      if (!response.ok) {
        console.error('Failed to track CTA click');
      }
    } catch (err) {
      console.error('Error tracking CTA click:', err);
      // Don't block navigation if tracking fails
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (error || !landingPage) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Page Not Found</h1>
          <p className="text-gray-600">{error || 'The landing page you are looking for does not exist.'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-12">
        <div className="bg-white rounded-lg shadow-lg overflow-hidden">
          {/* Hero Image */}
          {landingPage.hero_url && (
            <div className="w-full h-64 md:h-96 bg-gray-200">
              <img
                src={landingPage.hero_url}
                alt={landingPage.headline || 'Landing page'}
                className="w-full h-full object-cover"
              />
            </div>
          )}

          {/* Content */}
          <div className="p-8 md:p-12">
            {landingPage.headline && (
              <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
                {landingPage.headline}
              </h1>
            )}

            {landingPage.subheadline && (
              <h2 className="text-xl md:text-2xl text-gray-600 mb-6">
                {landingPage.subheadline}
              </h2>
            )}

            {/* CTA Button */}
            {landingPage.cta_url && (
              <div className="mt-8">
                <a
                  href={landingPage.cta_url}
                  onClick={handleCTAClick}
                  className="inline-block bg-blue-600 text-white px-8 py-4 rounded-lg font-semibold text-lg hover:bg-blue-700 transition-colors"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {landingPage.cta_type === 'book' && 'Book Now'}
                  {landingPage.cta_type === 'home_value' && 'Get Home Value'}
                  {landingPage.cta_type === 'contact' && 'Contact Us'}
                  {landingPage.cta_type === 'custom' && 'Learn More'}
                  {!landingPage.cta_type && 'Get Started'}
                </a>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

