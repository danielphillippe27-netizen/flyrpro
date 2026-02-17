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
  locality: string;     // City (not in simplified schema)
  region: string;       // State/Province (not in simplified schema)
  postalCode: string;   // Postal/ZIP code (not in simplified schema)
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
  /** All addresses linked to this building (e.g. 6 units). Same as [address] when only one. */
  addresses: ResolvedAddress[];
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
  campaignId: string | null,
  preferredAddressId?: string | null  // For unit slices - fetch specific address
): BuildingData {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [address, setAddress] = useState<ResolvedAddress | null>(null);
  const [addresses, setAddresses] = useState<ResolvedAddress[]>([]);
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
      setAddresses([]);
      setResidents([]);
      setQrStatus({ hasFlyer: false, totalScans: 0, lastScannedAt: null });
      setBuildingExists(false);
      setAddressLinked(false);
      return;
    }

    setIsLoading(true);
    setError(null);
    
    console.log('[useBuildingData] Fetching:', { gersId, campaignId, preferredAddressId });

    try {
      const supabase = createClient();

      const toResolved = (raw: { id: string; house_number?: string | null; street_name?: string | null; formatted?: string | null; gers_id?: string | null }): ResolvedAddress => {
        const street = [raw.house_number, raw.street_name].filter(Boolean).join(' ') || raw.formatted || 'Unknown Address';
        return {
          id: raw.id,
          street,
          formatted: raw.formatted || street,
          locality: '',
          region: '',
          postalCode: '',
          houseNumber: raw.house_number || '',
          streetName: raw.street_name || '',
          gersId: raw.gers_id || gersId,
        };
      };

      let resolvedAddress: { id: string; house_number?: string | null; street_name?: string | null; formatted?: string | null; gers_id?: string | null } | null = null;
      let resolvedList: ResolvedAddress[] | null = null;

      // When the map passes address_id (Gold/Silver linked feature), fetch that address first so the card always shows it
      if (preferredAddressId) {
        const { data: preferredRow, error: preferredErr } = await supabase
          .from('campaign_addresses')
          .select('id, house_number, street_name, formatted, gers_id')
          .eq('id', preferredAddressId)
          .eq('campaign_id', campaignId)
          .maybeSingle();
        if (!preferredErr && preferredRow) {
          resolvedAddress = preferredRow;
          setBuildingExists(true);
        }
      }

      // Fetch ALL address IDs linked to this building (e.g. 6 for a townhouse).
      // Two-step query: get address_ids from links, then fetch addresses.
      // Try Silver path: building_address_links table (building_id = GERS id text)
      const { data: linkRows, error: linkError } = await supabase
        .from('building_address_links')
        .select('address_id')
        .eq('campaign_id', campaignId)
        .eq('building_id', gersId);

      if (linkError) {
        console.error('[useBuildingData] Link query error:', linkError);
      }

      let addressIds = (linkRows || []).map((r: { address_id: string }) => r.address_id).filter(Boolean);
      
      // If no links found, try Gold path: campaign_addresses.building_id
      if (addressIds.length === 0) {
        console.log('[useBuildingData] No links found, trying Gold path for building:', gersId);
        const { data: goldAddresses, error: goldError } = await supabase
          .from('campaign_addresses')
          .select('id')
          .eq('campaign_id', campaignId)
          .eq('building_id', gersId);
        
        if (goldError) {
          console.error('[useBuildingData] Gold query error:', goldError);
        } else if (goldAddresses && goldAddresses.length > 0) {
          console.log('[useBuildingData] Found Gold addresses:', goldAddresses.length);
          addressIds = goldAddresses.map((a: { id: string }) => a.id);
        }
      }

      // Final fallback: gersId might BE a campaign_addresses.id itself
      // (happens when features come from address-point fallback where id = campaign_addresses.id)
      if (addressIds.length === 0) {
        console.log('[useBuildingData] Trying direct address lookup for id:', gersId);
        const { data: directAddress, error: directError } = await supabase
          .from('campaign_addresses')
          .select('id')
          .eq('campaign_id', campaignId)
          .eq('id', gersId)
          .maybeSingle();
        
        if (!directError && directAddress) {
          console.log('[useBuildingData] Found direct address match:', directAddress.id);
          addressIds = [directAddress.id];
        }
      }
      
      if (addressIds.length > 0) {
        setBuildingExists(true);
        const { data: addressRows, error: addrError } = await supabase
          .from('campaign_addresses')
          .select('id, house_number, street_name, formatted, gers_id')
          .eq('campaign_id', campaignId)
          .in('id', addressIds);

        if (addrError) {
          console.error('[useBuildingData] Address fetch error:', addrError);
        } else if (addressRows && addressRows.length > 0) {
          // Preserve order from links (first linked = first in list)
          const orderMap = new Map(addressIds.map((id, i) => [id, i]));
          const sorted = [...addressRows].sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0));
          resolvedList = sorted.map((raw) => toResolved(raw));
        }
      }

      // If we have multiple links, use them (primary = preferred address if in list, else first)
      if (resolvedList && resolvedList.length > 0) {
        let primary = resolvedList[0];
        if (preferredAddressId) {
          const preferred = resolvedList.find((a) => a.id === preferredAddressId);
          if (preferred) primary = preferred;
        }
        setAddress(primary);
        setAddresses(resolvedList);
        setAddressLinked(true);
        setQrStatus({ hasFlyer: false, totalScans: 0, lastScannedAt: null });

        const { data: contactsData, error: contactsError } = await supabase
          .from('contacts')
          .select('*')
          .eq('address_id', primary.id)
          .order('created_at', { ascending: false });
        if (contactsError) setResidents([]);
        else setResidents((contactsData || []) as Contact[]);
      } else {
        // No links: use address from preferredAddressId (already fetched above) or resolve by gers_id
        if (!resolvedAddress) {
          // Try gers_id column first
          const { data: addressData, error: addressError } = await supabase
            .from('campaign_addresses')
            .select('id, house_number, street_name, formatted, gers_id')
            .eq('campaign_id', campaignId)
            .eq('gers_id', gersId)
            .maybeSingle();
          
          if (!addressError && addressData) {
            resolvedAddress = addressData;
          } else {
            // Final fallback: try gersId as campaign_addresses.id directly
            const { data: directData } = await supabase
              .from('campaign_addresses')
              .select('id, house_number, street_name, formatted, gers_id')
              .eq('campaign_id', campaignId)
              .eq('id', gersId)
              .maybeSingle();
            if (directData) resolvedAddress = directData;
          }
          if (resolvedAddress) setBuildingExists(true);
        }
        if (resolvedAddress) {
          const resolved = toResolved(resolvedAddress);
          setAddress(resolved);
          setAddresses([resolved]);
          setAddressLinked(true);
          setQrStatus({ hasFlyer: false, totalScans: 0, lastScannedAt: null });
          const { data: contactsData, error: contactsError } = await supabase
            .from('contacts')
            .select('*')
            .eq('address_id', resolvedAddress.id)
            .order('created_at', { ascending: false });
          if (contactsError) setResidents([]);
          else setResidents((contactsData || []) as Contact[]);
        } else {
          setAddressLinked(false);
          setAddress(null);
          setAddresses([]);
          setResidents([]);
          setQrStatus({ hasFlyer: false, totalScans: 0, lastScannedAt: null });
        }
      }
    } catch (err) {
      console.error('Error in useBuildingData:', err);
      setError(err instanceof Error ? err : new Error('Failed to fetch building data'));
    } finally {
      setIsLoading(false);
    }
  }, [gersId, campaignId, preferredAddressId]);

  // Fetch data when gersId or campaignId changes
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Note: Realtime subscriptions disabled - replication not available
  // Card will refresh when closed and reopened

  return {
    isLoading,
    error,
    address,
    addresses,
    residents,
    qrStatus,
    buildingExists,
    addressLinked,
    refetch: fetchData,
  };
}
