'use client';

import { useState, useEffect } from 'react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { BuildingService } from '@/lib/services/BuildingService';
import type { Building, BuildingInteraction, BuildingStatus } from '@/types/database';
import { Trash2, Eye, EyeOff } from 'lucide-react';

interface HouseDetailPanelProps {
  buildingId: string | null;
  campaignId: string | null;
  open: boolean;
  onClose: () => void;
  onUpdate: () => void;
}

export function HouseDetailPanel({
  buildingId,
  campaignId,
  open,
  onClose,
  onUpdate,
}: HouseDetailPanelProps) {
  const [building, setBuilding] = useState<Building | null>(null);
  const [interactions, setInteractions] = useState<BuildingInteraction[]>([]);
  const [linkedAddresses, setLinkedAddresses] = useState<Array<{
    address_id: string;
    formatted: string;
    house_number: string | null;
    street_name: string | null;
    match_source: string;
    confidence: number;
  }>>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newStatus, setNewStatus] = useState<BuildingStatus>('default');
  const [newNotes, setNewNotes] = useState('');

  // Load building and interactions when panel opens
  useEffect(() => {
    if (open && buildingId) {
      loadBuildingData();
    } else {
      setBuilding(null);
      setInteractions([]);
      setNewStatus('default');
      setNewNotes('');
    }
  }, [open, buildingId]);

  const loadBuildingData = async () => {
    if (!buildingId) return;

    setLoading(true);
    try {
      // buildingId is actually a gers_id from the map click
      const buildingData = await BuildingService.fetchBuildingByGersId(buildingId);
      
      if (!buildingData) {
        console.error('Building not found for GERS ID:', buildingId);
        return;
      }

      // Once we have the building, use its internal ID for interactions
      const interactionData = await BuildingService.fetchBuildingInteractions(buildingData.id);

      // For Gold buildings, also fetch linked addresses
      let addressData: Array<{
        address_id: string;
        formatted: string;
        house_number: string | null;
        street_name: string | null;
        match_source: string;
        confidence: number;
      }> = [];
      
      if (buildingData.source === 'gold' && campaignId) {
        addressData = await BuildingService.fetchGoldBuildingAddresses(buildingData.id, campaignId);
      }

      setBuilding(buildingData);
      setInteractions(interactionData || []);
      setLinkedAddresses(addressData);
      
      // Set new status to current status
      if (buildingData) {
        setNewStatus(buildingData.latest_status);
      }
    } catch (error) {
      console.error('Error loading building data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateInteraction = async () => {
    if (!buildingId || !building || saving) return;

    setSaving(true);
    try {
      // Use the building's internal ID for interactions
      await BuildingService.createInteraction(building.id, newStatus, newNotes || undefined);
      
      // Reload data to get updated status (trigger will update latest_status)
      await loadBuildingData();
      
      // Clear form
      setNewNotes('');
      
      // Trigger parent update
      onUpdate();
    } catch (error) {
      console.error('Error creating interaction:', error);
      alert('Failed to save interaction. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleHideBuilding = async () => {
    if (!buildingId || !building || saving) return;

    if (!confirm('Are you sure you want to hide this building? It will no longer appear on the map.')) {
      return;
    }

    setSaving(true);
    try {
      // Use the building's internal ID for hiding
      const success = await BuildingService.hideBuilding(building.id);
      if (success) {
        onUpdate();
        onClose();
      } else {
        alert('Failed to hide building. Please try again.');
      }
    } catch (error) {
      console.error('Error hiding building:', error);
      alert('Failed to hide building. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const getStatusColor = (status: BuildingStatus): string => {
    switch (status) {
      case 'interested':
        return 'text-green-600 bg-green-50 border-green-200';
      case 'dnc':
        return 'text-red-600 bg-red-50 border-red-200';
      case 'available':
        return 'text-red-600 bg-red-50 border-red-200'; // Red (for newly provisioned buildings)
      case 'not_home':
        return 'text-orange-600 bg-orange-50 border-orange-200';
      case 'default':
      default:
        return 'text-gray-600 bg-gray-50 border-gray-200';
    }
  };

  const getStatusLabel = (status: BuildingStatus): string => {
    switch (status) {
      case 'interested':
        return 'Interested';
      case 'dnc':
        return 'Do Not Contact';
      case 'available':
        return 'Available';
      case 'not_home':
        return 'Not Home';
      case 'default':
      default:
        return 'Default';
    }
  };

  if (!building && !loading) {
    return null;
  }

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent side="right" className="w-full sm:w-[500px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Building Details</SheetTitle>
          <SheetDescription>
            View and manage building interactions and status
          </SheetDescription>
        </SheetHeader>

        {loading ? (
          <div className="mt-6 text-center text-muted-foreground">Loading...</div>
        ) : building ? (
          <div className="mt-6 space-y-6">
            {/* Building Info */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Address</Label>
              {building.addr_housenumber || building.addr_street ? (
                <p className="text-sm font-medium">
                  {[building.addr_housenumber, building.addr_street, building.addr_unit]
                    .filter(Boolean)
                    .join(' ')}
                </p>
              ) : (
                <div className="bg-yellow-50 border border-yellow-200 rounded-md p-2">
                  <p className="text-xs text-yellow-800 font-medium">Unverified Door</p>
                  <p className="text-xs text-yellow-600 mt-1">Tap to confirm address</p>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium">GERS ID</Label>
              <p className="text-sm text-muted-foreground font-mono text-xs">{building.gers_id}</p>
            </div>

            {/* Linked Addresses (for Gold buildings) */}
            {linkedAddresses.length > 0 && (
              <div className="space-y-2 pt-2 border-t">
                <Label className="text-sm font-medium">
                  Linked Addresses ({linkedAddresses.length})
                </Label>
                <div className="space-y-2">
                  {linkedAddresses.map((addr) => (
                    <div
                      key={addr.address_id}
                      className="border rounded-lg p-3 space-y-1"
                    >
                      <p className="text-sm font-medium">
                        {addr.formatted}
                      </p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className={`px-2 py-0.5 rounded ${
                          addr.match_source === 'gold_exact' 
                            ? 'bg-green-100 text-green-800' 
                            : 'bg-blue-100 text-blue-800'
                        }`}>
                          {addr.match_source === 'gold_exact' ? 'Exact' : 'Proximity'}
                        </span>
                        <span>{(addr.confidence * 100).toFixed(0)}% confidence</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Overture Metadata */}
            {(building.height || building.house_name) && (
              <div className="space-y-2 pt-2 border-t">
                <Label className="text-sm font-medium">Building Details</Label>
                <div className="space-y-1 text-sm text-muted-foreground">
                  {building.height && (
                    <p>Height: {building.height.toFixed(1)}m</p>
                  )}
                  {building.house_name && (
                    <p>Name: {building.house_name}</p>
                  )}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label className="text-sm font-medium">Current Status</Label>
              <div className={`inline-flex items-center px-3 py-1 rounded-md border text-sm font-medium ${getStatusColor(building.latest_status)}`}>
                {getStatusLabel(building.latest_status)}
              </div>
            </div>

            {/* Interaction History */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Interaction History</Label>
              {interactions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No interactions yet</p>
              ) : (
                <div className="space-y-3">
                  {interactions.map((interaction) => (
                    <div
                      key={interaction.id}
                      className="border rounded-lg p-3 space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <div className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${getStatusColor(interaction.status)}`}>
                          {getStatusLabel(interaction.status)}
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {new Date(interaction.created_at).toLocaleString()}
                        </span>
                      </div>
                      {interaction.notes && (
                        <p className="text-sm text-muted-foreground">{interaction.notes}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* New Interaction Form */}
            <div className="pt-4 border-t space-y-4">
              <Label className="text-sm font-medium">Add New Interaction</Label>
              
              <div className="space-y-2">
                <Label htmlFor="status-select">Status</Label>
                <Select
                  value={newStatus}
                  onValueChange={(value) => setNewStatus(value as BuildingStatus)}
                >
                  <SelectTrigger id="status-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">Default</SelectItem>
                    <SelectItem value="not_home">Not Home</SelectItem>
                    <SelectItem value="interested">Interested</SelectItem>
                    <SelectItem value="dnc">Do Not Contact</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="notes-textarea">Notes (optional)</Label>
                <Textarea
                  id="notes-textarea"
                  placeholder="Add notes about this interaction..."
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                  rows={3}
                />
              </div>

              <Button
                onClick={handleCreateInteraction}
                disabled={saving}
                className="w-full"
              >
                {saving ? 'Saving...' : 'Save Interaction'}
              </Button>
            </div>

            {/* Hide Building Button */}
            <div className="pt-4 border-t">
              <Button
                variant="destructive"
                onClick={handleHideBuilding}
                disabled={saving || building.is_hidden}
                className="w-full"
              >
                {building.is_hidden ? (
                  <>
                    <EyeOff className="mr-2 h-4 w-4" />
                    Building Hidden
                  </>
                ) : (
                  <>
                    <Trash2 className="mr-2 h-4 w-4" />
                    Hide Building
                  </>
                )}
              </Button>
              <p className="mt-2 text-xs text-muted-foreground">
                Hiding a building removes it from the map view. This action can be reversed by updating the database directly.
              </p>
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

