'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { CampaignsService, type CampaignStats } from '@/lib/services/CampaignsService';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CampaignDetailMapView } from '@/components/campaigns/CampaignDetailMapView';
import { OptimizedRouteView } from '@/components/campaigns/OptimizedRouteView';
import { LoadingScreen } from '@/components/LoadingScreen';
import { RecipientsTable } from '@/components/RecipientsTable';
import { StatsHeader } from '@/components/StatsHeader';
import { PaywallGuard } from '@/components/PaywallGuard';
import { MissingQRModal } from '@/components/modals/MissingQRModal';
import type { CampaignV2, CampaignAddress, CampaignContact } from '@/types/database';
import { Users, MapPin, Search, Plus, Pencil, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { createClient } from '@/lib/supabase/client';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function getStatusBadge(addr: CampaignAddress) {
  if (addr.address_status === 'hot_lead') return { label: 'Hot Lead', color: 'bg-red-500/20 text-red-400' };
  if (addr.address_status === 'appointment') return { label: 'Appointment', color: 'bg-blue-500/20 text-blue-400' };
  if (addr.address_status === 'talked') return { label: 'Talked', color: 'bg-emerald-500/20 text-emerald-400' };
  if (addr.address_status === 'delivered') return { label: 'Delivered', color: 'bg-purple-500/20 text-purple-400' };
  if (addr.address_status === 'no_answer') return { label: 'No Answer', color: 'bg-yellow-500/20 text-yellow-400' };
  if (addr.address_status === 'do_not_knock') return { label: 'Do Not Knock', color: 'bg-zinc-500/20 text-zinc-400' };
  if (addr.address_status === 'future_seller') return { label: 'Future Seller', color: 'bg-orange-500/20 text-orange-400' };
  if (addr.visited) return { label: 'Visited', color: 'bg-green-500/20 text-green-400' };
  if (addr.scans && addr.scans > 0) return { label: 'Scanned', color: 'bg-violet-500/20 text-violet-400' };
  return { label: 'New', color: 'bg-zinc-700/50 text-zinc-400' };
}

function CampaignContactsList({
  contacts,
  campaignId,
  onRefresh,
}: {
  contacts: CampaignContact[];
  campaignId: string;
  onRefresh: () => void;
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<CampaignContact | null>(null);
  const [formName, setFormName] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formAddress, setFormAddress] = useState('');
  const [formLastContacted, setFormLastContacted] = useState('');
  const [formInterestLevel, setFormInterestLevel] = useState('');
  const [saving, setSaving] = useState(false);

  const filtered = contacts.filter((c) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const name = (c.name || '').toLowerCase();
    const phone = (c.phone || '').toLowerCase();
    const email = (c.email || '').toLowerCase();
    const address = (c.address || '').toLowerCase();
    return name.includes(q) || phone.includes(q) || email.includes(q) || address.includes(q);
  });

  const openAdd = () => {
    setEditingContact(null);
    setFormName('');
    setFormPhone('');
    setFormEmail('');
    setFormAddress('');
    setFormLastContacted('');
    setFormInterestLevel('');
    setModalOpen(true);
  };

  const openEdit = (c: CampaignContact) => {
    setEditingContact(c);
    setFormName(c.name ?? '');
    setFormPhone(c.phone ?? '');
    setFormEmail(c.email ?? '');
    setFormAddress(c.address ?? '');
    setFormLastContacted(c.last_contacted_at ? c.last_contacted_at.slice(0, 10) : '');
    setFormInterestLevel(c.interest_level ?? '');
    setModalOpen(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (editingContact) {
        await CampaignsService.updateCampaignContact(editingContact.id, {
          name: formName || null,
          phone: formPhone || null,
          email: formEmail || null,
          address: formAddress || null,
          last_contacted_at: formLastContacted ? `${formLastContacted}T00:00:00Z` : null,
          interest_level: formInterestLevel || null,
        });
      } else {
        await CampaignsService.createCampaignContact(campaignId, {
          name: formName || null,
          phone: formPhone || null,
          email: formEmail || null,
          address: formAddress || null,
          last_contacted_at: formLastContacted ? `${formLastContacted}T00:00:00Z` : null,
          interest_level: formInterestLevel || null,
        });
      }
      setModalOpen(false);
      onRefresh();
    } catch (e) {
      console.error('Save contact:', e);
      alert(e instanceof Error ? e.message : 'Failed to save contact');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this contact?')) return;
    try {
      await CampaignsService.deleteCampaignContact(id);
      onRefresh();
    } catch (e) {
      console.error('Delete contact:', e);
      alert(e instanceof Error ? e.message : 'Failed to delete contact');
    }
  };

  const formatDate = (s: string | null | undefined) => {
    if (!s) return '—';
    const d = new Date(s);
    return isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
  };

  return (
    <div className="space-y-4">
      <div className="bg-card p-4 rounded-xl border border-border">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">Campaign Leads</h2>
            <Badge variant="secondary" className="text-xs">{contacts.length}</Badge>
          </div>
          <Button size="sm" onClick={openAdd}>
            <Plus className="w-4 h-4 mr-1" />
            Add contact
          </Button>
        </div>

        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by name, phone, email, or address..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-input bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        {filtered.length === 0 ? (
          <div className="text-center py-8">
            <MapPin className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">
              {searchQuery ? 'No contacts match your search.' : 'No contacts yet. Add a contact to get started.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="pb-2 pr-3 font-medium">Name</th>
                  <th className="pb-2 pr-3 font-medium">Phone</th>
                  <th className="pb-2 pr-3 font-medium">Email</th>
                  <th className="pb-2 pr-3 font-medium">Address</th>
                  <th className="pb-2 pr-3 font-medium">Last contacted</th>
                  <th className="pb-2 pr-3 font-medium">Interest level</th>
                  <th className="pb-2 w-20 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.id} className="border-b border-border/50">
                    <td className="py-2 pr-3 text-foreground">{c.name || '—'}</td>
                    <td className="py-2 pr-3 text-foreground">{c.phone || '—'}</td>
                    <td className="py-2 pr-3 text-foreground">{c.email || '—'}</td>
                    <td className="py-2 pr-3 text-foreground max-w-[180px] truncate" title={c.address || undefined}>{c.address || '—'}</td>
                    <td className="py-2 pr-3 text-foreground">{formatDate(c.last_contacted_at)}</td>
                    <td className="py-2 pr-3 text-foreground">{c.interest_level || '—'}</td>
                    <td className="py-2">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openEdit(c)}
                          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
                          aria-label="Edit"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(c.id)}
                          className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-muted"
                          aria-label="Delete"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingContact ? 'Edit contact' : 'Add contact'}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div>
              <Label htmlFor="contact-name">Name</Label>
              <Input
                id="contact-name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="Full name"
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="contact-phone">Phone</Label>
              <Input
                id="contact-phone"
                type="tel"
                value={formPhone}
                onChange={(e) => setFormPhone(e.target.value)}
                placeholder="Phone number"
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="contact-email">Email</Label>
              <Input
                id="contact-email"
                type="email"
                value={formEmail}
                onChange={(e) => setFormEmail(e.target.value)}
                placeholder="Email"
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="contact-address">Address</Label>
              <Input
                id="contact-address"
                value={formAddress}
                onChange={(e) => setFormAddress(e.target.value)}
                placeholder="Street, city, etc."
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="contact-last">Last contacted</Label>
              <Input
                id="contact-last"
                type="date"
                value={formLastContacted}
                onChange={(e) => setFormLastContacted(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="contact-interest">Interest level</Label>
              <Input
                id="contact-interest"
                value={formInterestLevel}
                onChange={(e) => setFormInterestLevel(e.target.value)}
                placeholder="e.g. High, Medium, Low"
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function CampaignDetailPage() {
  const params = useParams();
  const campaignId = params.campaignId as string;

  const [campaign, setCampaign] = useState<CampaignV2 | null>(null);
  const [addresses, setAddresses] = useState<CampaignAddress[]>([]);
  const [campaignStats, setCampaignStats] = useState<CampaignStats>({
    addresses: 0,
    contacts: 0,
    contacted: 0,
    visited: 0,
    scanned: 0,
    scan_rate: 0,
    progress_pct: 0,
  });
  const [contacts, setContacts] = useState<CampaignContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);
  const [showMissingQRModal, setShowMissingQRModal] = useState(false);
  const [missingQRFlyerId, setMissingQRFlyerId] = useState<string | null>(null);
  const [destinationUrl, setDestinationUrl] = useState('');
  const [isSavingUrl, setIsSavingUrl] = useState(false);
  const [notes, setNotes] = useState('');
  const [isSavingNotes, setIsSavingNotes] = useState(false);
  const [notesDirty, setNotesDirty] = useState(false);
  const [generatingCanva, setGeneratingCanva] = useState(false);
  const [basicQrBase64, setBasicQrBase64] = useState<string | null>(null);
  const [generatingBasicQr, setGeneratingBasicQr] = useState(false);
  const [scripts, setScripts] = useState('');
  const [scriptsDirty, setScriptsDirty] = useState(false);
  const [isSavingScripts, setIsSavingScripts] = useState(false);
  const [uploadingFlyer, setUploadingFlyer] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [campaignData, addressesData, statsData, contactsData] = await Promise.all([
        CampaignsService.fetchCampaign(campaignId),
        CampaignsService.fetchAddresses(campaignId),
        CampaignsService.fetchCampaignStats(campaignId),
        CampaignsService.fetchCampaignContacts(campaignId),
      ]);
      if (!campaignData) return;

      const contactedCount = addressesData.filter(
        (a) => a.address_status && a.address_status !== 'new' || a.visited
      ).length;
      const visitedCount = addressesData.filter((a) => a.visited).length;
      const totalAddresses = addressesData.length;
      const progressPct = totalAddresses > 0 ? Math.round((visitedCount / totalAddresses) * 100) : 0;

      setCampaign(campaignData);
      setAddresses(addressesData);
      setContacts(contactsData);
      setCampaignStats({
        ...statsData,
        addresses: totalAddresses,
        contacts: contactsData.length,
        contacted: contactedCount,
        visited: visitedCount || statsData.visited,
        progress_pct: progressPct,
      });
    } catch (error) {
      console.error('Error loading campaign:', error);
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (campaign?.video_url) setDestinationUrl(campaign.video_url);
  }, [campaign]);

  useEffect(() => {
    if (campaign?.notes !== undefined) setNotes(campaign.notes ?? '');
  }, [campaign?.notes]);

  useEffect(() => {
    if (campaign?.scripts !== undefined) setScripts(campaign.scripts ?? '');
  }, [campaign?.scripts]);

  const handleSaveScripts = async () => {
    if (!campaignId) return;
    setIsSavingScripts(true);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('campaigns')
        .update({ scripts: scripts || null })
        .eq('id', campaignId);
      if (error) throw error;
      setScriptsDirty(false);
      await loadData();
    } catch (e) {
      console.error('Error saving scripts:', e);
      alert(e instanceof Error ? e.message : 'Failed to save scripts');
    } finally {
      setIsSavingScripts(false);
    }
  };

  const handleFlyerUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !campaignId) return;
    setUploadingFlyer(true);
    try {
      const formData = new FormData();
      // Use a safe ASCII-only filename to avoid "Failed to parse body as FormData" (e.g. non-ASCII names)
      const ext = (file.name.split('.').pop() || '').replace(/[^a-zA-Z0-9]/g, '') || 'png';
      const safeName = `flyer.${ext}`;
      formData.append('file', file, safeName);
      const res = await fetch(`/api/campaigns/${campaignId}/flyer-upload`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      await loadData();
    } catch (err) {
      console.error('Flyer upload:', err);
      alert(err instanceof Error ? err.message : 'Failed to upload flyer');
    } finally {
      setUploadingFlyer(false);
      e.target.value = '';
    }
  };

  const handleGenerateQRs = async (trackable: boolean = true) => {
    setGenerating(true);
    try {
      const response = await fetch('/api/generate-qrs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId,
          trackable,
          baseUrl: typeof window !== 'undefined' ? window.location.origin : undefined,
        }),
      });
      const data = await response.json();
      if (data.needsUpgrade) {
        setShowPaywall(true);
        return;
      }
      if (!response.ok) {
        if (data.error === 'MISSING_QR') {
          setMissingQRFlyerId(data.flyerId || null);
          setShowMissingQRModal(true);
          return;
        }
        throw new Error(data.error || data.message || 'Generation failed');
      }
      await loadData();
      alert(`Generated ${data.count} QR codes!`);
    } catch (error) {
      console.error('Error generating QRs:', error);
      alert(error instanceof Error ? error.message : 'Failed to generate QR codes');
    } finally {
      setGenerating(false);
    }
  };

  const handleGenerateCanvaQRs = async () => {
    if (!addresses?.length) {
      alert('No addresses to generate QRs for');
      return;
    }

    setGeneratingCanva(true);
    try {
      const rows = addresses.map((addr) => {
        const parts = (addr.formatted || addr.address || '').split(', ');
        return {
          AddressLine: addr.address || parts[0] || '',
          City: addr.locality || parts[1] || '',
          Province: addr.region || parts[2] || '',
          PostalCode: addr.postal_code || '',
        };
      });

      const response = await fetch('/api/canva/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId,
          baseUrl: `${typeof window !== 'undefined' ? window.location.origin : 'https://flyrpro.app'}/api/scan`,
          rows,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const contentDisposition = response.headers.get('Content-Disposition') || '';
      const filenameMatch = contentDisposition.match(/filename="(.+)"/);
      const filename = filenameMatch ? filenameMatch[1] : 'canva_bulk.csv';

      const uploaded = response.headers.get('X-Canva-Uploaded') || '0';
      const existing = response.headers.get('X-Canva-Existing') || '0';
      const failed = response.headers.get('X-Canva-Failed') || '0';

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      alert(`Canva CSV generated!\n${uploaded} uploaded, ${existing} existing, ${failed} failed`);
      await loadData();
    } catch (error) {
      console.error('Error generating Canva QRs:', error);
      alert(error instanceof Error ? error.message : 'Failed to generate Canva QRs');
    } finally {
      setGeneratingCanva(false);
    }
  };

  const handleSaveUrl = async () => {
    setIsSavingUrl(true);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('campaigns')
        .update({ video_url: destinationUrl || null })
        .eq('id', campaignId);
      if (error) alert('Error saving URL: ' + error.message);
      else {
        alert('Destination URL Saved! All QR codes now point here.');
        await loadData();
      }
    } catch {
      alert('Error saving URL');
    } finally {
      setIsSavingUrl(false);
    }
  };

  const handleSaveNotes = async () => {
    if (!campaignId) return;
    setIsSavingNotes(true);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('campaigns')
        .update({ notes: notes || null })
        .eq('id', campaignId);
      if (error) throw error;
      setNotesDirty(false);
      await loadData();
    } catch (e) {
      console.error('Error saving notes:', e);
      alert(e instanceof Error ? e.message : 'Failed to save notes');
    } finally {
      setIsSavingNotes(false);
    }
  };

  const handleGenerateBasicQr = async () => {
    setGeneratingBasicQr(true);
    try {
      const baseUrl = typeof window !== 'undefined' ? window.location.origin : undefined;
      const res = await fetch(`/api/campaigns/${campaignId}/generate-basic-qr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const { qrBase64 } = await res.json();
      setBasicQrBase64(qrBase64 || null);
    } catch (e) {
      console.error('Generate basic QR:', e);
      alert(e instanceof Error ? e.message : 'Failed to generate basic QR');
    } finally {
      setGeneratingBasicQr(false);
    }
  };

  const handleDownloadBasicQr = () => {
    if (!basicQrBase64) return;
    const link = document.createElement('a');
    link.href = basicQrBase64;
    link.download = `campaign-${campaignId}-basic-qr.png`;
    link.click();
  };

  const handleBasicQrForCanva = async () => {
    setGeneratingBasicQr(true);
    try {
      const baseUrl = typeof window !== 'undefined' ? window.location.origin : undefined;
      const res = await fetch(`/api/campaigns/${campaignId}/generate-basic-qr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const { qrBase64 } = await res.json();
      if (qrBase64) {
        setBasicQrBase64(qrBase64);
        const link = document.createElement('a');
        link.href = qrBase64;
        link.download = `campaign-${campaignId}-basic-qr-canva.png`;
        link.click();
      }
    } catch (e) {
      console.error('Generate basic QR for Canva:', e);
      alert(e instanceof Error ? e.message : 'Failed to generate');
    } finally {
      setGeneratingBasicQr(false);
    }
  };

  const handleAddQR = async () => {
    if (!missingQRFlyerId) {
      setShowMissingQRModal(false);
      return;
    }
    try {
      const response = await fetch(`/api/flyers/${missingQRFlyerId}/add-qr`, { method: 'POST' });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to add QR');
      }
      setShowMissingQRModal(false);
      setMissingQRFlyerId(null);
      await handleGenerateQRs(true);
    } catch (error) {
      console.error('Error adding QR:', error);
      alert(error instanceof Error ? error.message : 'Failed to add QR element');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[320px]">
        <LoadingScreen variant="inline" />
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[320px] px-6 text-center">
        <h2 className="text-lg font-semibold text-foreground mb-2">Campaign not found</h2>
        <Button asChild variant="outline">
          <Link href="/campaigns">Back to Campaigns</Link>
        </Button>
      </div>
    );
  }

  // Dedupe by logical address: one row per (formatted + postal_code), prefer scanned
  const addressKey = (addr: CampaignAddress) =>
    `${(addr.formatted || addr.address || '').trim().toLowerCase()}|${(addr.postal_code || '').trim().toLowerCase()}`;
  const seen = new Map<string, CampaignAddress>();
  for (const addr of addresses) {
    const key = addressKey(addr);
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, addr);
    } else if (addr.visited && !existing.visited) {
      seen.set(key, addr);
    } else if (addr.visited === existing.visited && (addr.id < existing.id)) {
      seen.set(key, addr);
    }
  }
  const dedupedAddresses = Array.from(seen.values());

  const formattedRecipients = dedupedAddresses.map((addr) => ({
    id: addr.id,
    address_line: addr.formatted || addr.address || '',
    city: addr.locality || '',
    region: addr.region || '',
    postal_code: addr.postal_code || '',
    status: addr.visited ? 'scanned' : 'pending',
    qr_png_url: null,
    qr_code_base64: addr.qr_code_base64 || null,
    sent_at: null,
    scanned_at: addr.visited ? new Date().toISOString() : null,
    street_name: addr.street_name,
    house_number: addr.house_number,
    locality: addr.locality,
    seq: addr.seq,
  }));

  return (
    <div className="min-h-full bg-muted/30 dark:bg-background relative">
      {/* Progress bar only – campaign name is in layout header */}
      {campaignStats.addresses > 0 && campaignStats.progress_pct > 0 && (
        <div className="bg-card border-b border-border px-4 sm:px-6 lg:px-8 py-2">
          <div className="max-w-7xl mx-auto min-w-0 max-w-md sm:max-w-lg flex items-center gap-3">
            <span className="text-sm font-medium text-muted-foreground whitespace-nowrap">Progress</span>
            <Progress value={campaignStats.progress_pct} className="h-2 flex-1" />
            <span className="text-sm font-semibold text-foreground whitespace-nowrap">{campaignStats.progress_pct}%</span>
          </div>
        </div>
      )}

      <main className="w-full px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        <StatsHeader stats={campaignStats} />

        <Tabs defaultValue="map" className="w-full">
          <TabsList>
            <TabsTrigger value="map">Map</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
            <TabsTrigger value="addresses">Addresses</TabsTrigger>
            <TabsTrigger value="contacts">Contacts</TabsTrigger>
            <TabsTrigger value="qr">QR Codes</TabsTrigger>
            <TabsTrigger value="route">Walking route</TabsTrigger>
            <TabsTrigger value="notes">Notes</TabsTrigger>
          </TabsList>

          <TabsContent value="map" className="mt-4 space-y-4">
            <div className="bg-card rounded-xl border border-border overflow-hidden" style={{ height: '560px' }}>
              <CampaignDetailMapView campaignId={campaignId} addresses={addresses} campaign={campaign} onSnapComplete={loadData} />
            </div>
          </TabsContent>

          <TabsContent value="activity" className="mt-4">
            <div className="bg-card p-4 rounded-xl border border-border">
              <h2 className="text-sm font-semibold text-foreground mb-3">Campaign activity</h2>
              <p className="text-sm text-muted-foreground">
                Sessions, knocks, follow-ups, and scans for this campaign. View full workspace activity on the Activity page.
              </p>
              <div className="mt-4">
                <Link
                  href="/activity"
                  className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
                >
                  Open Activity
                </Link>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="addresses" className="mt-4">
            <div className="bg-card p-4 rounded-xl border border-border">
              <h2 className="text-sm font-semibold text-foreground mb-3">Addresses</h2>
              <RecipientsTable recipients={formattedRecipients} campaignId={campaignId} />
            </div>
          </TabsContent>

          <TabsContent value="contacts" className="mt-4">
            <CampaignContactsList contacts={contacts} campaignId={campaignId} onRefresh={loadData} />
          </TabsContent>

          <TabsContent value="qr" className="mt-4 space-y-4">
            <div className="bg-card p-4 rounded-xl border border-border">
              <h3 className="text-sm font-semibold text-foreground mb-3">QR Destination</h3>
              <div className="flex gap-3 flex-wrap">
                <input
                  type="url"
                  id="campaign-destination-url"
                  placeholder="https://youtube.com/watch?v=..."
                  className="flex-1 min-w-[200px] rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={destinationUrl}
                  onChange={(e) => setDestinationUrl(e.target.value)}
                />
                <Button onClick={handleSaveUrl} disabled={isSavingUrl} size="sm">
                  {isSavingUrl ? 'Saving...' : 'Link URL'}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Where users go when they scan. Leave empty to use the Welcome page.
              </p>
            </div>

            <div className="bg-card p-4 rounded-xl border border-border">
              <div className="flex flex-wrap gap-6 items-start justify-between">
                <div className="flex flex-col gap-3">
                  <h3 className="text-sm font-semibold text-foreground">Basic QR Code</h3>
                  <p className="text-xs text-muted-foreground max-w-md">
                    One QR code for the whole campaign. Scans are counted in campaign analytics but not tied to any address.
                  </p>
                  <div className="flex flex-wrap gap-3">
                    <Button
                      onClick={handleGenerateBasicQr}
                      disabled={generatingBasicQr}
                    >
                      {generatingBasicQr ? 'Generating...' : 'Generate QR'}
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={handleBasicQrForCanva}
                      disabled={generatingBasicQr}
                    >
                      {generatingBasicQr ? 'Generating...' : 'Generate for Canva'}
                    </Button>
                  </div>
                </div>
                {basicQrBase64 && (
                  <div className="flex flex-col gap-2 items-center shrink-0">
                    <img
                      src={basicQrBase64}
                      alt="Campaign basic QR code"
                      className="w-48 h-48 rounded-lg border border-border bg-white object-contain"
                    />
                    <button
                      type="button"
                      onClick={handleDownloadBasicQr}
                      className="text-sm font-medium text-red-600 hover:text-red-500 underline underline-offset-2"
                    >
                      Download PNG
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-card p-4 rounded-xl border border-border">
              <h2 className="text-sm font-semibold text-foreground mb-3">Advanced QR Code</h2>
              <p className="text-xs text-muted-foreground mb-3">
                Unique QR codes for every home in the campaign. Scans are tied to addresses and will show on the map.
              </p>
              <div className="flex flex-wrap gap-3">
                <Button
                  onClick={() => handleGenerateQRs(true)}
                  disabled={generating || formattedRecipients.length === 0}
                >
                  {generating ? 'Generating...' : 'Generate QR (In-App)'}
                </Button>
                <Button
                  variant="secondary"
                  onClick={handleGenerateCanvaQRs}
                  disabled={generatingCanva || !addresses?.length}
                >
                  {generatingCanva ? 'Generating...' : 'Generate for Canva'}
                </Button>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="route" className="mt-4">
            <OptimizedRouteView 
              campaignId={campaignId} 
              campaignName={campaign?.name ?? undefined}
              addresses={addresses} 
            />
          </TabsContent>

          <TabsContent value="notes" className="mt-4 space-y-4">
            <div className="bg-card p-4 rounded-xl border border-border">
              <h2 className="text-sm font-semibold text-foreground mb-3">Campaign notes</h2>
              <p className="text-xs text-muted-foreground mb-2">
                Free-form notes for this campaign (territory, goals, follow-ups, etc.).
              </p>
              <textarea
                className="w-full min-h-[200px] rounded-md border border-input bg-background px-3 py-2 text-sm font-mono resize-y"
                placeholder="Add notes..."
                value={notes}
                onChange={(e) => {
                  setNotes(e.target.value);
                  setNotesDirty(true);
                }}
              />
              <div className="mt-3 flex justify-end">
                <Button
                  size="sm"
                  onClick={handleSaveNotes}
                  disabled={!notesDirty || isSavingNotes}
                >
                  {isSavingNotes ? 'Saving...' : 'Save notes'}
                </Button>
              </div>
            </div>

            <div className="bg-card p-4 rounded-xl border border-border">
              <h2 className="text-sm font-semibold text-foreground mb-3">Scripts</h2>
              <p className="text-xs text-muted-foreground mb-2">
                Script or dialogue to use when door-knocking or talking to leads.
              </p>
              <textarea
                className="w-full min-h-[160px] rounded-md border border-input bg-background px-3 py-2 text-sm font-mono resize-y"
                placeholder="Add scripts..."
                value={scripts}
                onChange={(e) => {
                  setScripts(e.target.value);
                  setScriptsDirty(true);
                }}
              />
              <div className="mt-3 flex justify-end">
                <Button
                  size="sm"
                  onClick={handleSaveScripts}
                  disabled={!scriptsDirty || isSavingScripts}
                >
                  {isSavingScripts ? 'Saving...' : 'Save scripts'}
                </Button>
              </div>
            </div>

            <div className="bg-card p-4 rounded-xl border border-border">
              <h2 className="text-sm font-semibold text-foreground mb-3">Flyer used</h2>
              <p className="text-xs text-muted-foreground mb-3">
                Upload a photo or PDF of the flyer you used for this campaign.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <label className="cursor-pointer inline-block">
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
                    className="sr-only"
                    onChange={handleFlyerUpload}
                    disabled={uploadingFlyer}
                  />
                  <span className="inline-flex items-center justify-center rounded-md text-sm font-medium border border-input bg-background px-3 py-2 hover:bg-accent hover:text-accent-foreground h-9">
                    {uploadingFlyer ? 'Uploading...' : 'Choose photo or PDF'}
                  </span>
                </label>
                {campaign?.flyer_url && (
                  <a
                    href={campaign.flyer_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-primary hover:underline"
                  >
                    View current flyer
                  </a>
                )}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </main>

      <PaywallGuard open={showPaywall} onClose={() => setShowPaywall(false)} />
      <MissingQRModal
        open={showMissingQRModal}
        onClose={() => {
          setShowMissingQRModal(false);
          setMissingQRFlyerId(null);
        }}
        onAddQR={handleAddQR}
      />
    </div>
  );
}
