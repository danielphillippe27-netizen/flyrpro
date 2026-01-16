'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useState, Suspense } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { CampaignAddress } from '@/types/database';

function WelcomeContent() {
  const searchParams = useSearchParams();
  const addressId = searchParams.get('id');
  const supabase = createClient();
  const [data, setData] = useState<CampaignAddress | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (addressId) {
      // Fetch the house data to show them "Welcome 123 Main St"
      // Note: Scan tracking is handled server-side by /api/scan route
      fetchHouseData();
    } else {
      setError('Invalid QR Code - Missing address ID');
      setLoading(false);
    }
  }, [addressId]);

  const fetchHouseData = async () => {
    if (!addressId) return;

    try {
      setLoading(true);
      const { data, error: fetchError } = await supabase
        .from('campaign_addresses')
        .select('*')
        .eq('id', addressId)
        .single();

      if (fetchError) {
        console.error('Error fetching address:', fetchError);
        setError('Address not found');
        return;
      }

      if (data) {
        setData(data);
      } else {
        setError('Address not found');
      }
    } catch (err) {
      console.error('Error loading address data:', err);
      setError('Failed to load address information');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="mb-4 h-10 w-10 rounded-full border-4 border-gray-300 border-t-black animate-spin mx-auto" />
          <p className="text-gray-600 dark:text-gray-400">Loading your home's report...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center p-10">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
            Invalid QR Code
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            {error || 'This QR code is not valid or has expired.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-4xl mx-auto px-4 py-12">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg dark:shadow-gray-900/50 overflow-hidden">
          <div className="p-10 text-center">
            <h1 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white mb-4">
              Welcome Home!
            </h1>
            <p className="mt-4 text-xl text-gray-600 dark:text-gray-300">
              We have prepared a report for:
            </p>
            <p className="mt-2 text-2xl font-semibold text-blue-600 dark:text-blue-400">
              {data.formatted || data.address}
            </p>
            {data.postal_code && (
              <p className="mt-1 text-lg text-gray-500 dark:text-gray-400">
                {data.postal_code}
              </p>
            )}
            {/* Optional: Show scan count for testing (can be removed in production) */}
            {process.env.NODE_ENV === 'development' && (
              <p className="mt-6 text-sm text-gray-500 dark:text-gray-400">
                This page has been scanned {data.scans || 0} time{data.scans !== 1 ? 's' : ''}.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function WelcomePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="mb-4 h-10 w-10 rounded-full border-4 border-gray-300 border-t-black animate-spin mx-auto" />
          <p className="text-gray-600 dark:text-gray-400">Loading...</p>
        </div>
      </div>
    }>
      <WelcomeContent />
    </Suspense>
  );
}
