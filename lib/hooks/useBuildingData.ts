'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Contact } from '@/types/contacts';

/**
 * Address data resolved from a building's gers_id
 */
export interface ResolvedAddress {
  id: string;           // UUID (campaign_addresses.id)
  street: string;       // house_number + street_name combined
  formatted: string;    // Full formatted address
  locality: string;     // City
  region: string;       // State/Province
  postalCode: string;   // Postal/ZIP code
  houseNumber: string;  // Just the house number
  streetName: string;   // Just the street name
  gersId: string;       // The building's GERS ID
}

/**
 * QR code and scan tracking status
 */
export interface QrStatus {
  hasFlyer: boolean;      // Whether a QR code/flyer has been generated
  totalScans: number;     // Number of times the QR code has been scanned
  lastScannedAt: Date | null; // Most recent scan timestamp
}

/**
 * Return type for the useBuildingData hook
 */
export interface BuildingData {
  isLoading: boolean;
  error: Error | null;
  address: ResolvedAddress | null;
  residents: Contact[];
  qrStatus: QrStatus;
  buildingExists: boolean;  // Whether we found a building with this gers_id
  addressLinked: boolean;   // Whether the building has a linked address
  refetch: () => Promise<void>;
}

/**
 * Hook to bridge building gers_id (from map click) to internal address data.
 * 
 * The map uses Overture's gers_id for buildings, while business data
 * (contacts, QR codes) is linked to campaign_addresses.id (UUID).
 * This hook resolves that relationship.
 * 
 * @param gersId - The building's GERS ID from the map click
 * @param campaignId - The current campaign ID to scope the query
 * @returns BuildingData with address, residents, and QR status
 */
export function useBuildingData(
  gersId: string | null,
  campaignId: string | null
): BuildingData {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [address, setAddress] = useState<ResolvedAddress | null>(null);
  const [residents, setResidents] = useState<Contact[]>([]);
  const [qrStatus, setQrStatus] = useState<QrStatus>({
    hasFlyer: false,
    totalScans: 0,
    lastScannedAt: null,
  });
  const [buildingExists, setBuildingExists] = useState(false);
  const [addressLinked, setAddressLinked] = useState(false);

  const fetchData = useCallback(async () => {
    if (!gersId || !campaignId) {
      setAddress(null);
      setResidents([]);
      setQrStatus({ hasFlyer: false, totalScans: 0, lastScannedAt: null });
      setBuildingExists(false);
      setAddressLinked(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const supabase = createClient();

      // Step 1: Check if building exists with this gers_id
      // Try to find address directly via gers_id match on campaign_addresses
      const { data: addressData, error: addressError } = await supabase
        .from('campaign_addresses')
        .select(`
          id,
          house_number,
          street_name,
          formatted,
          locality,
          region,
          postal_code,
          gers_id,
          scans,
          last_scanned_at,
          qr_code_base64
        `)
        .eq('campaign_id', campaignId)
        .or(`gers_id.eq.${gersId},building_gers_id.eq.${gersId}`)
        .maybeSingle();

      if (addressError) {
        throw new Error(`Failed to fetch address: ${addressError.message}`);
      }

      // If no direct match, try via building_address_links
      let resolvedAddress = addressData;
      if (!resolvedAddress) {
        // First find the building
        const { data: buildingData } = await supabase
          .from('buildings')
          .select('id, gers_id')
          .eq('gers_id', gersId)
          .maybeSingle();

        if (buildingData) {
          setBuildingExists(true);

          // Then find linked address via building_address_links
          const { data: linkData } = await supabase
            .from('building_address_links')
            .select(`
              address_id,
              campaign_addresses!inner (
                id,
                house_number,
                street_name,
                formatted,
                locality,
                region,
                postal_code,
                gers_id,
                scans,
                last_scanned_at,
                qr_code_base64
              )
            `)
            .eq('campaign_id', campaignId)
            .eq('building_id', buildingData.id)
            .eq('is_primary', true)
            .maybeSingle();

          if (linkData?.campaign_addresses) {
            // Handle both array and single object responses from Supabase
            const addrData = Array.isArray(linkData.campaign_addresses)
              ? linkData.campaign_addresses[0]
              : linkData.campaign_addresses;
            resolvedAddress = addrData;
          }
        } else {
          // Also check map_buildings table
          const { data: mapBuildingData } = await supabase
            .from('map_buildings')
            .select('id, gers_id, address_id')
            .eq('gers_id', gersId)
            .maybeSingle();

          if (mapBuildingData) {
            setBuildingExists(true);

            if (mapBuildingData.address_id) {
              // Fetch the linked address
              const { data: linkedAddr } = await supabase
                .from('campaign_addresses')
                .select(`
                  id,
                  house_number,
                  street_name,
                  formatted,
                  locality,
                  region,
                  postal_code,
                  gers_id,
                  scans,
                  last_scanned_at,
                  qr_code_base64
                `)
                .eq('id', mapBuildingData.address_id)
                .maybeSingle();

              resolvedAddress = linkedAddr;
            }
          }
        }
      } else {
        setBuildingExists(true);
      }

      // Process the resolved address
      if (resolvedAddress) {
        setAddressLinked(true);

        // Build the street string
        const street = [resolvedAddress.house_number, resolvedAddress.street_name]
          .filter(Boolean)
          .join(' ') || resolvedAddress.formatted || 'Unknown Address';

        setAddress({
          id: resolvedAddress.id,
          street,
          formatted: resolvedAddress.formatted || street,
          locality: resolvedAddress.locality || '',
          region: resolvedAddress.region || '',
          postalCode: resolvedAddress.postal_code || '',
          houseNumber: resolvedAddress.house_number || '',
          streetName: resolvedAddress.street_name || '',
          gersId: resolvedAddress.gers_id || gersId,
        });

        // Set QR status
        setQrStatus({
          hasFlyer: !!(resolvedAddress.qr_code_base64 || (resolvedAddress.scans && resolvedAddress.scans > 0)),
          totalScans: resolvedAddress.scans || 0,
          lastScannedAt: resolvedAddress.last_scanned_at
            ? new Date(resolvedAddress.last_scanned_at)
            : null,
        });

        // Step 2: Fetch contacts linked to this address
        const { data: contactsData, error: contactsError } = await supabase
          .from('contacts')
          .select('*')
          .eq('address_id', resolvedAddress.id)
          .order('created_at', { ascending: false });

        if (contactsError) {
          console.warn('Failed to fetch contacts:', contactsError.message);
          setResidents([]);
        } else {
          setResidents((contactsData || []) as Contact[]);
        }
      } else {
        // No address found
        setAddressLinked(false);
        setAddress(null);
        setResidents([]);
        setQrStatus({ hasFlyer: false, totalScans: 0, lastScannedAt: null });
      }
    } catch (err) {
      console.error('Error in useBuildingData:', err);
      setError(err instanceof Error ? err : new Error('Failed to fetch building data'));
    } finally {
      setIsLoading(false);
    }
  }, [gersId, campaignId]);

  // Fetch data when gersId or campaignId changes
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return {
    isLoading,
    error,
    address,
    residents,
    qrStatus,
    buildingExists,
    addressLinked,
    refetch: fetchData,
  };
}
