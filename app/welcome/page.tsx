'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useState, Suspense } from 'react';
import { LoadingScreen } from '@/components/LoadingScreen';
import { createClient } from '@/lib/supabase/client';
import type { CampaignAddress } from '@/types/database';

function WelcomeContent() {
  const searchParams = useSearchParams();
  const addressId = searchParams.get('id');
  const campaignId = searchParams.get('campaignId');
  const addressLine = searchParams.get('address');
  const city = searchParams.get('city');
  const province = searchParams.get('province');
  
  const supabase = createClient();
  const [data, setData] = useState<CampaignAddress | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [debugInfo, setDebugInfo] = useState<string>('');

  useEffect(() => {
    // Debug: log all received params
    const allParams = Array.from(searchParams.entries()).map(([k,v]) => `${k}=${v.substring(0,30)}`).join('&');
    console.log('Welcome page received params:', allParams);
    console.log('Parsed:', { addressId, campaignId, addressLine, city, province });
    // Try to load address data - either by ID or by resolving from Canva-style params
    loadAddressData();
  }, [addressId, campaignId, addressLine]);

  const loadAddressData = async () => {
    try {
      setLoading(true);
      
      // If we have an address ID, fetch directly
      if (addressId) {
        console.log('Welcome page: Fetching by address ID:', addressId);
        const { data: address, error: fetchError } = await supabase
          .from('campaign_addresses')
          .select('*')
          .eq('id', addressId)
          .single();

        if (fetchError) {
          console.error('Error fetching address by ID:', fetchError);
          setDebugInfo(`ID lookup failed: ${fetchError.message}`);
          setError('Address not found');
          return;
        }

        if (address) {
          setData(address);
          return;
        }
      }
      
      // If no ID but have campaignId + address, resolve via API (server has permissions)
      if (!addressId && campaignId && addressLine) {
        setDebugInfo(`Resolving: campaign=${campaignId}, address=${addressLine}`);
        const params = new URLSearchParams({ campaignId, address: addressLine });
        if (city) params.set('city', city);
        if (province) params.set('province', province);
        const postal = searchParams.get('postalCode') || searchParams.get('PostalCode');
        if (postal) params.set('postalCode', postal);
        const res = await fetch(`/api/welcome/resolve?${params}`);
        if (res.ok) {
          const addressData = await res.json();
          setData(addressData as CampaignAddress);
          return;
        }
        setDebugInfo(`Could not resolve. Campaign: ${campaignId}, Address: ${addressLine}`);
        setError('This address wasn’t found in our system. The flyer may be for a different campaign or the address may not be loaded yet.');
      } else {
        // No ID and no resolution params - show exactly what's missing
        const missing = [];
        if (!addressId) missing.push('id');
        if (!campaignId) missing.push('campaignId');
        if (!addressLine) missing.push('address');
        const urlParams = Array.from(searchParams.entries()).map(([k,v]) => `${k}=${v.substring(0,20)}`).join('&');
        setDebugInfo(`Missing: ${missing.join(', ')} | URL params: ${urlParams}`);
        setError(`QR code missing: ${missing.join(', ')}. Please check the QR code URL.`);
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
      <LoadingScreen variant="fullScreen" message="Loading your home's report..." />
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center p-10 max-w-md">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
            Invalid QR Code
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            {error || 'This QR code is not valid or has expired.'}
          </p>
          {process.env.NODE_ENV === 'development' && debugInfo && (
            <div className="mt-4 p-3 bg-gray-100 dark:bg-gray-800 rounded text-left">
              <p className="text-xs text-gray-500 dark:text-gray-400 font-mono">
                Debug: {debugInfo}
              </p>
            </div>
          )}
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
    <Suspense fallback={<LoadingScreen variant="fullScreen" />}>
      <WelcomeContent />
    </Suspense>
  );
}
