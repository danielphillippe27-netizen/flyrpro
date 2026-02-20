'use client';

import { useState } from 'react';
import { useBuildingData } from '@/lib/hooks/useBuildingData';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  X,
  Navigation,
  ClipboardList,
  UserPlus,
  Users,
  QrCode,
  Check,
  AlertCircle,
  MapPin,
  ChevronLeft,
} from 'lucide-react';
import type { Contact } from '@/types/contacts';

interface LocationCardProps {
  gersId: string;
  campaignId: string;
  preferredAddressId?: string | null; // For unit slices - show specific address
  onSelectAddress?: (addressId: string | null) => void; // Pick address from dropdown or Back to list (null)
  onClose: () => void;
  onNavigate?: () => void;
  onLogVisit?: () => void;
  onEditContact?: (contactId: string) => void;
  onAddContact?: (addressId?: string, addressText?: string, notes?: string) => void;
  className?: string;
}

/**
 * Apple Maps / Linear inspired location card that appears when clicking a building.
 * Displays address info, residents, and QR status using the gers_id -> address_id bridge.
 */
export function LocationCard({
  gersId,
  campaignId,
  preferredAddressId,
  onSelectAddress,
  onClose,
  onNavigate,
  onLogVisit,
  onEditContact,
  onAddContact,
  className = '',
}: LocationCardProps) {
  const {
    isLoading,
    error,
    address,
    addresses,
    residents,
    qrStatus,
    addressLinked,
  } = useBuildingData(gersId, campaignId, preferredAddressId);
  const [manualAddress, setManualAddress] = useState('');
  const [newContactNotes, setNewContactNotes] = useState('');

  const isMultiAddress = addresses.length > 1;
  const isListMode =
    isMultiAddress &&
    (!preferredAddressId || !addresses.some((a) => a.id === preferredAddressId));

  // Format residents display text
  const getResidentsText = (contacts: Contact[]): string => {
    if (contacts.length === 0) return 'No residents';
    if (contacts.length === 1) return contacts[0].full_name;
    return `${contacts[0].full_name} + ${contacts.length - 1} other${contacts.length > 2 ? 's' : ''}`;
  };

  // Get status badge variant and text
  const getStatusBadge = () => {
    if (qrStatus.totalScans > 0) {
      return { variant: 'default' as const, text: 'Scanned' };
    }
    if (qrStatus.hasFlyer) {
      return { variant: 'secondary' as const, text: 'Target' };
    }
    return { variant: 'outline' as const, text: 'New' };
  };

  const statusBadge = getStatusBadge();

  return (
    <div
      className={`
        w-[320px] rounded-2xl border overflow-hidden shadow-2xl backdrop-blur-xl
        bg-white/95 border-gray-100
        dark:bg-black/85 dark:border-white/10
        transform transition-all duration-200 ease-out
        ${className}
      `}
    >
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-3 right-3 z-10 rounded-full p-1.5 transition-colors bg-gray-100/80 hover:bg-gray-200/80 dark:bg-white/10 dark:hover:bg-white/20"
        aria-label="Close"
      >
        <X className="w-4 h-4 text-gray-600 dark:text-gray-300" />
      </button>

      {/* Loading State */}
      {isLoading && (
        <div className="p-5 space-y-4">
          <div className="space-y-2">
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
          <div className="space-y-3 pt-2">
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-10 w-full rounded-lg" />
          </div>
          <div className="flex gap-2 pt-2">
            <Skeleton className="h-9 flex-1 rounded-lg" />
            <Skeleton className="h-9 flex-1 rounded-lg" />
            <Skeleton className="h-9 flex-1 rounded-lg" />
          </div>
        </div>
      )}

      {/* Error State */}
      {!isLoading && error && (
        <div className="p-5">
          <div className="flex items-center gap-3 text-red-600">
            <AlertCircle className="w-5 h-5" />
            <div>
              <p className="font-medium">Error loading data</p>
              <p className="text-sm text-red-500">{error.message}</p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            className="mt-4 w-full"
          >
            Close
          </Button>
        </div>
      )}

      {/* No Address Linked State */}
      {!isLoading && !error && !addressLinked && (
        <div className="p-5">
          <div className="flex items-center gap-3 text-gray-600 dark:text-gray-400">
            <MapPin className="w-5 h-5 text-gray-500 dark:text-gray-400" />
            <div>
              <p className="font-medium text-gray-900 dark:text-white">Unlinked Building</p>
              <p className="text-sm text-gray-600 dark:text-gray-400">No address data found for this building</p>
            </div>
          </div>
          <div className="mt-4">
            <Input
              value={manualAddress}
              onChange={(e) => setManualAddress(e.target.value)}
              placeholder="Add address (required to link)"
              className="h-10 bg-white dark:bg-white/5 dark:text-white dark:placeholder:text-gray-500 dark:border-white/20"
              aria-label="Address to link building"
            />
          </div>
          <div className="flex gap-2 mt-4">
            <Button
              variant="outline"
              size="sm"
              onClick={onClose}
              className="flex-1 dark:bg-white/10 dark:border-white/25 dark:text-white dark:hover:bg-white/20"
            >
              Close
            </Button>
            {onAddContact && (
              <Button
                size="sm"
                onClick={() => onAddContact(undefined, manualAddress.trim())}
                disabled={!manualAddress.trim()}
                className="flex-1"
              >
                <UserPlus className="w-4 h-4 mr-1" />
                Link
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Main Content - Address Found */}
      {!isLoading && !error && addressLinked && address && (
        <>
          {/* Multi-address list mode: count + clickable list of all addresses */}
          {isListMode && (
            <div className="px-5 pt-5 pb-5">
              <h2 className="text-lg font-semibold text-gray-900 pr-8">
                {addresses.length} addresses
              </h2>
              <p className="text-xs text-gray-500 mt-1 mb-2">Tap an address for details</p>
              <ul className="space-y-1 max-h-64 overflow-y-auto">
                {addresses.map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => onSelectAddress?.(a.id)}
                      className="w-full flex items-center gap-2 p-2.5 rounded-lg text-left text-sm text-gray-700 hover:bg-gray-100 hover:text-gray-900 transition-colors border border-transparent hover:border-gray-200"
                    >
                      <MapPin className="w-4 h-4 text-gray-400 shrink-0" />
                      <span className="truncate flex-1">{a.formatted || a.street}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Single-address mode: full card (multi with Back to list, or single address) */}
          {!isListMode && (
            <>
              {/* Header */}
              <div className="px-5 pt-5 pb-3">
                {isMultiAddress && onSelectAddress && (
                  <button
                    type="button"
                    onClick={() => onSelectAddress(null)}
                    className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 mb-2"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                    Back to list
                  </button>
                )}
                <div className="flex items-start justify-between pr-8">
                  <div className="min-w-0 flex-1">
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white truncate">
                      {address.formatted || address.street}
                    </h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
                      {isMultiAddress
                        ? `${addresses.length} addresses at this building`
                        : [address.locality, address.region, address.postalCode]
                            .filter(Boolean)
                            .join(', ') || 'Location details unavailable'}
                    </p>
                  </div>
                  <Badge variant={statusBadge.variant} className="ml-2 shrink-0">
                    {statusBadge.text}
                  </Badge>
                </div>
              </div>

              {/* Content Rows - only for single-address view */}
              <div className="px-5 pb-4 space-y-2">
                {/* Residents Row */}
                <button
                  onClick={() => {
                    if (residents.length > 0 && onEditContact) {
                      onEditContact(residents[0].id);
                    } else if (onAddContact) {
                      onAddContact(address.id, address.formatted, newContactNotes.trim() || undefined);
                    }
                  }}
                  className="w-full flex items-center gap-3 p-3 rounded-xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800/80 dark:hover:bg-zinc-700 transition-colors text-left"
                >
                  <div className="w-9 h-9 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center shrink-0">
                    <Users className="w-4 h-4 text-red-600 dark:text-red-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {getResidentsText(residents)}
                    </p>
                    <p className="text-xs text-gray-500">
                      {residents.length === 0 ? 'Add a resident' : `${residents.length} resident${residents.length !== 1 ? 's' : ''}`}
                    </p>
                  </div>
                  {residents.length === 0 && (
                    <UserPlus className="w-4 h-4 text-gray-400 shrink-0" />
                  )}
                </button>

                {residents.length === 0 && (
                  <div className="p-3 rounded-xl bg-zinc-100 dark:bg-zinc-800/80">
                    <p className="text-xs font-medium text-gray-700 dark:text-gray-200 mb-2">Notes</p>
                    <Textarea
                      value={newContactNotes}
                      onChange={(e) => setNewContactNotes(e.target.value)}
                      placeholder="Add notes for this contact..."
                      rows={2}
                      className="resize-none bg-white/90 dark:bg-zinc-900/80 border-gray-300 dark:border-zinc-600 text-gray-900 dark:text-gray-100 placeholder:text-gray-500 dark:placeholder:text-gray-400"
                    />
                  </div>
                )}

                {/* Resident Notes */}
                {residents.length > 0 && residents.some((r) => r.notes) && (
                  <div className="p-3 rounded-xl bg-amber-50 border border-amber-100">
                    <p className="text-xs font-medium text-amber-700 mb-1">Notes</p>
                    {residents.filter((r) => r.notes).map((resident) => (
                      <p key={resident.id} className="text-sm text-amber-900">
                        {residents.length > 1 && <span className="font-medium">{resident.full_name}: </span>}
                        {resident.notes}
                      </p>
                    ))}
                  </div>
                )}

                {/* QR Status Row */}
                {(qrStatus.hasFlyer || qrStatus.totalScans > 0) && (
                <div className="flex items-center gap-3 p-3 rounded-xl bg-zinc-100 dark:bg-zinc-800/80">
                  <div
                    className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
                      qrStatus.hasFlyer
                        ? qrStatus.totalScans > 0
                          ? 'bg-green-100'
                          : 'bg-orange-100'
                        : 'bg-gray-100'
                    }`}
                  >
                    <QrCode
                      className={`w-4 h-4 ${
                        qrStatus.hasFlyer
                          ? qrStatus.totalScans > 0
                            ? 'text-green-600'
                            : 'text-orange-600'
                          : 'text-gray-400'
                      }`}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900">
                      {qrStatus.hasFlyer
                        ? qrStatus.totalScans > 0
                          ? `Scanned ${qrStatus.totalScans}x`
                          : 'Flyer delivered'
                        : ''}
                    </p>
                    <p className="text-xs text-gray-500">
                      {qrStatus.lastScannedAt
                        ? `Last: ${qrStatus.lastScannedAt.toLocaleDateString()}`
                        : qrStatus.hasFlyer
                          ? 'Not scanned yet'
                          : ''}
                    </p>
                  </div>
                  {qrStatus.totalScans > 0 && (
                    <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center shrink-0">
                      <Check className="w-3.5 h-3.5 text-white" />
                    </div>
                  )}
                </div>
                )}
              </div>

              {/* Action Footer */}
              <div className="px-5 pb-5 pt-2 border-t border-gray-100">
                <div className="flex gap-2">
                  {onNavigate && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={onNavigate}
                      className="flex-1 gap-1.5"
                    >
                      <Navigation className="w-4 h-4" />
                      Navigate
                    </Button>
                  )}
                  {onLogVisit && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={onLogVisit}
                      className="flex-1 gap-1.5"
                    >
                      <ClipboardList className="w-4 h-4" />
                      Log Visit
                    </Button>
                  )}
                  {onAddContact && (
                    <Button
                      size="sm"
                      onClick={() => onAddContact(address?.id, address?.formatted, newContactNotes.trim() || undefined)}
                      className="flex-1 gap-1.5"
                    >
                      <UserPlus className="w-4 h-4" />
                      Add
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

export default LocationCard;
