'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, Mail, Phone, Save, Trash2, Upload, Voicemail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useWorkspace } from '@/lib/workspace-context';
import type { DialerVoicemailDrop } from '@/types/database';

type DialerSettingsStatus = {
  workspaceId: string;
  canManage: boolean;
  featureEnabled: boolean;
  sharedDefaultDialingEnabled: boolean;
  offer?: {
    priceId?: string | null;
    amount: string;
    currency: 'USD' | 'CAD';
    period: string;
  };
  addon: {
    status: 'inactive' | 'active' | 'past_due' | 'canceled';
    isActive: boolean;
  } | null;
  settings: {
    defaultFromNumber: string;
    defaultSmsFromNumber: string | null;
    dedicatedFromNumber: string | null;
    inboundForwardTo: string | null;
    numberStatus: 'unassigned' | 'active' | 'released';
    usesSharedDefaultNumber: boolean;
  } | null;
  salesperson?: {
    id: string | null;
    fullName: string | null;
    email: string | null;
    demoEmailHandle: string | null;
    demoEmailAddress: string | null;
    demoEmailReplyTo: string | null;
    demoEmailDomain: string;
  } | null;
};

const inFlightDialerSettingsWorkspaceIds = new Set<string>();

export function PowerDialerSettingsCard() {
  const { currentWorkspaceId } = useWorkspace();
  const voicemailFileInputRef = useRef<HTMLInputElement | null>(null);
  const [dialerSettingsStatus, setDialerSettingsStatus] = useState<DialerSettingsStatus | null>(null);
  const [dialerAreaCode, setDialerAreaCode] = useState('');
  const [inboundForwardTo, setInboundForwardTo] = useState('');
  const [demoEmailHandle, setDemoEmailHandle] = useState('');
  const [demoEmailReplyTo, setDemoEmailReplyTo] = useState('');
  const [voicemailDrops, setVoicemailDrops] = useState<DialerVoicemailDrop[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingVoicemails, setLoadingVoicemails] = useState(false);
  const [isEnablingDialerAddon, setIsEnablingDialerAddon] = useState(false);
  const [isProvisioningDialerNumber, setIsProvisioningDialerNumber] = useState(false);
  const [isSavingInboundForward, setIsSavingInboundForward] = useState(false);
  const [isSavingDemoEmail, setIsSavingDemoEmail] = useState(false);
  const [isUploadingVoicemail, setIsUploadingVoicemail] = useState(false);
  const [activatingVoicemailId, setActivatingVoicemailId] = useState<string | null>(null);
  const [deletingVoicemailId, setDeletingVoicemailId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const dialerOfferLabel = dialerSettingsStatus?.offer
    ? `${dialerSettingsStatus.offer.currency === 'CAD' ? 'CA$' : '$'}${dialerSettingsStatus.offer.amount}${dialerSettingsStatus.offer.currency === 'USD' ? ' USD' : ''}${dialerSettingsStatus.offer.period}`
    : 'CA$19.99/month';
  const activeVoicemailDrop = voicemailDrops.find((drop) => drop.is_active) ?? null;

  const loadDialerSettingsStatus = async (workspaceId?: string) => {
    const requestKey = workspaceId ?? 'default';
    if (inFlightDialerSettingsWorkspaceIds.has(requestKey)) {
      setLoading(false);
      return;
    }
    inFlightDialerSettingsWorkspaceIds.add(requestKey);

    try {
      const qs = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : '';
      const response = await fetch(`/api/dialer/settings${qs}`);
      if (response.ok) {
        const data = await response.json();
        setDialerSettingsStatus(data);
        setInboundForwardTo(data.settings?.inboundForwardTo ?? '');
        setDemoEmailHandle(data.salesperson?.demoEmailHandle ?? '');
        setDemoEmailReplyTo(data.salesperson?.demoEmailReplyTo ?? data.salesperson?.email ?? '');
      }
    } catch (error) {
      console.error('Error loading dialer settings:', error);
    } finally {
      inFlightDialerSettingsWorkspaceIds.delete(requestKey);
      setLoading(false);
    }
  };

  const loadVoicemailDrops = async (workspaceId?: string) => {
    if (!workspaceId) {
      setVoicemailDrops([]);
      return;
    }

    setLoadingVoicemails(true);
    try {
      const response = await fetch(`/api/dialer/voicemail-drops?workspaceId=${encodeURIComponent(workspaceId)}`, {
        credentials: 'include',
      });
      const data = (await response.json().catch(() => ({}))) as {
        recordings?: DialerVoicemailDrop[];
        error?: string;
      };
      if (!response.ok) {
        setMessage({ type: 'error', text: data.error || 'Failed to load voicemail recordings.' });
        return;
      }
      setVoicemailDrops(data.recordings ?? []);
    } catch (error) {
      console.error('Error loading voicemail recordings:', error);
      setMessage({ type: 'error', text: 'Network error while loading voicemail recordings.' });
    } finally {
      setLoadingVoicemails(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    void loadDialerSettingsStatus(currentWorkspaceId ?? undefined);
    void loadVoicemailDrops(currentWorkspaceId ?? undefined);
  }, [currentWorkspaceId]);

  const handleEnableDialerAddon = async () => {
    setIsEnablingDialerAddon(true);
    setMessage(null);
    try {
      const response = await fetch('/api/billing/stripe/dialer-addon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId: currentWorkspaceId,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage({
          type: 'error',
          text: data.error || 'Failed to enable the Power Dialer add-on.',
        });
        return;
      }

      setMessage({
        type: 'success',
        text: 'Power Dialer add-on enabled for this workspace.',
      });
      await loadDialerSettingsStatus(currentWorkspaceId ?? undefined);
    } catch (error) {
      console.error(error);
      setMessage({
        type: 'error',
        text: 'Network error while enabling the Power Dialer add-on.',
      });
    } finally {
      setIsEnablingDialerAddon(false);
    }
  };

  const handleProvisionDialerNumber = async () => {
    setIsProvisioningDialerNumber(true);
    setMessage(null);
    try {
      const response = await fetch('/api/dialer/numbers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId: currentWorkspaceId,
          areaCode: dialerAreaCode.trim() || undefined,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage({ type: 'error', text: data.error || 'Failed to provision a Twilio number.' });
        return;
      }
      setMessage({
        type: 'success',
        text: `Workspace number ${data.phoneNumber} is now assigned to the power dialer.`,
      });
      await loadDialerSettingsStatus(currentWorkspaceId ?? undefined);
    } catch (error) {
      console.error(error);
      setMessage({ type: 'error', text: 'Network error while provisioning the Twilio number.' });
    } finally {
      setIsProvisioningDialerNumber(false);
    }
  };

  const handleSaveInboundForward = async () => {
    if (!currentWorkspaceId) return;

    setIsSavingInboundForward(true);
    setMessage(null);
    try {
      const response = await fetch('/api/dialer/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          workspaceId: currentWorkspaceId,
          inboundForwardTo: inboundForwardTo.trim(),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage({ type: 'error', text: data.error || 'Failed to save inbound forwarding number.' });
        return;
      }

      setMessage({
        type: 'success',
        text: inboundForwardTo.trim()
          ? 'Inbound calls will forward to this phone number.'
          : 'Inbound call forwarding cleared.',
      });
      await loadDialerSettingsStatus(currentWorkspaceId);
    } catch (error) {
      console.error(error);
      setMessage({ type: 'error', text: 'Network error while saving inbound forwarding.' });
    } finally {
      setIsSavingInboundForward(false);
    }
  };

  const handleSaveDemoEmail = async () => {
    if (!currentWorkspaceId) return;

    setIsSavingDemoEmail(true);
    setMessage(null);
    try {
      const response = await fetch('/api/dialer/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          workspaceId: currentWorkspaceId,
          demoEmailHandle: demoEmailHandle.trim(),
          demoEmailReplyTo: demoEmailReplyTo.trim(),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage({ type: 'error', text: data.error || 'Failed to save demo email sender.' });
        return;
      }

      setDialerSettingsStatus(data);
      setDemoEmailHandle(data.salesperson?.demoEmailHandle ?? '');
      setDemoEmailReplyTo(data.salesperson?.demoEmailReplyTo ?? data.salesperson?.email ?? '');
      setMessage({ type: 'success', text: 'Demo email sender saved.' });
    } catch (error) {
      console.error(error);
      setMessage({ type: 'error', text: 'Network error while saving demo email sender.' });
    } finally {
      setIsSavingDemoEmail(false);
    }
  };

  const handleVoicemailFileSelected = async (file: File | null) => {
    if (!file || !currentWorkspaceId) return;

    setIsUploadingVoicemail(true);
    setMessage(null);
    try {
      const formData = new FormData();
      formData.set('workspaceId', currentWorkspaceId);
      formData.set('file', file);

      const response = await fetch('/api/dialer/voicemail-drops', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      const data = (await response.json().catch(() => ({}))) as {
        recording?: DialerVoicemailDrop;
        error?: string;
      };
      if (!response.ok || !data.recording) {
        setMessage({ type: 'error', text: data.error || 'Failed to upload voicemail recording.' });
        return;
      }

      setMessage({ type: 'success', text: 'Voicemail recording uploaded and set active.' });
      await loadVoicemailDrops(currentWorkspaceId);
    } catch (error) {
      console.error(error);
      setMessage({ type: 'error', text: 'Network error while uploading voicemail recording.' });
    } finally {
      setIsUploadingVoicemail(false);
      if (voicemailFileInputRef.current) voicemailFileInputRef.current.value = '';
    }
  };

  const handleActivateVoicemail = async (id: string) => {
    if (!currentWorkspaceId) return;

    setActivatingVoicemailId(id);
    setMessage(null);
    try {
      const response = await fetch('/api/dialer/voicemail-drops', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          workspaceId: currentWorkspaceId,
          id,
          isActive: true,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        recording?: DialerVoicemailDrop;
        error?: string;
      };
      if (!response.ok || !data.recording) {
        setMessage({ type: 'error', text: data.error || 'Failed to activate voicemail recording.' });
        return;
      }

      setVoicemailDrops((currentDrops) =>
        currentDrops.map((drop) => ({ ...drop, is_active: drop.id === data.recording!.id }))
      );
      setMessage({ type: 'success', text: 'Active voicemail recording updated.' });
    } catch (error) {
      console.error(error);
      setMessage({ type: 'error', text: 'Network error while activating voicemail recording.' });
    } finally {
      setActivatingVoicemailId(null);
    }
  };

  const handleDeleteVoicemail = async (id: string) => {
    if (!currentWorkspaceId) return;

    setDeletingVoicemailId(id);
    setMessage(null);
    try {
      const response = await fetch('/api/dialer/voicemail-drops', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          workspaceId: currentWorkspaceId,
          id,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { deletedId?: string; error?: string };
      if (!response.ok || !data.deletedId) {
        setMessage({ type: 'error', text: data.error || 'Failed to delete voicemail recording.' });
        return;
      }

      setVoicemailDrops((currentDrops) => currentDrops.filter((drop) => drop.id !== data.deletedId));
      setMessage({ type: 'success', text: 'Voicemail recording deleted.' });
    } catch (error) {
      console.error(error);
      setMessage({ type: 'error', text: 'Network error while deleting voicemail recording.' });
    } finally {
      setDeletingVoicemailId(null);
    }
  };

  if (!loading && dialerSettingsStatus && !dialerSettingsStatus.featureEnabled) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-950">
              <Phone className="h-5 w-5 text-emerald-700 dark:text-emerald-200" />
            </div>
            <div>
              <CardTitle>Power Dialer</CardTitle>
              <CardDescription>
                Purchase the add-on, claim a workspace number, and manage dialer setup from Settings.
              </CardDescription>
            </div>
          </div>
          <Badge variant="outline">Web only</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {message && (
          <div
            className={`flex items-start gap-3 rounded-lg border p-4 text-sm ${
              message.type === 'success'
                ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-400'
                : 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400'
            }`}
          >
            {message.type === 'success' ? (
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
            ) : (
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
            )}
            <p>{message.text}</p>
          </div>
        )}

        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
          Configure the Twilio environment values for this deployment, then launch the dialer from Leads when you are ready to call.
        </div>

        {loading ? (
          <div className="rounded-lg border border-gray-200 p-4 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
            Loading dialer settings…
          </div>
        ) : (
          <div className="rounded-lg border border-gray-200 p-4 space-y-3 dark:border-gray-700">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium dark:text-white">Dialer Add-On</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Purchase this workspace add-on here. Current offer: {dialerOfferLabel}.
                </p>
              </div>
              <Badge variant={dialerSettingsStatus?.addon?.isActive ? 'default' : 'outline'}>
                {dialerSettingsStatus?.addon?.isActive ? 'Active' : 'Inactive'}
              </Badge>
            </div>

            <div className="space-y-1 text-sm text-gray-600 dark:text-gray-300">
              <p>
                Caller ID:{' '}
                <span className="font-medium text-gray-900 dark:text-white">
                  {dialerSettingsStatus?.settings?.dedicatedFromNumber ??
                    dialerSettingsStatus?.settings?.defaultFromNumber ??
                    'Not configured'}
                </span>
              </p>
              {dialerSettingsStatus?.settings?.usesSharedDefaultNumber && (
                <p className="text-amber-600 dark:text-amber-400">
                  {dialerSettingsStatus.sharedDefaultDialingEnabled
                    ? 'This workspace can use the shared deployment default caller ID while you test the dialer.'
                    : 'This workspace is still using the shared deployment default caller ID.'}
                </p>
              )}
            </div>

            {dialerSettingsStatus?.canManage && (
              <div className="space-y-2 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                <Label htmlFor="settings-inbound-forward-to">Forward inbound calls</Label>
                <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                  <Input
                    id="settings-inbound-forward-to"
                    inputMode="tel"
                    placeholder="+1 555 123 4567"
                    value={inboundForwardTo}
                    onChange={(event) => setInboundForwardTo(event.target.value)}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void handleSaveInboundForward()}
                    disabled={isSavingInboundForward || !currentWorkspaceId}
                  >
                    {isSavingInboundForward ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Save forwarding
                  </Button>
                </div>
              </div>
            )}

            <div className="space-y-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
              <div className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                <Label htmlFor="settings-demo-email-handle">Demo email sender</Label>
              </div>
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                <div className="flex min-w-0 overflow-hidden rounded-md border border-input bg-background dark:bg-card">
                  <Input
                    id="settings-demo-email-handle"
                    value={demoEmailHandle}
                    onChange={(event) => setDemoEmailHandle(event.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ''))}
                    placeholder="firstname"
                    className="h-10 min-w-0 border-0 focus-visible:ring-0"
                  />
                  <span className="flex h-10 shrink-0 items-center border-l border-input px-3 text-sm text-gray-500 dark:text-gray-400">
                    @{dialerSettingsStatus?.salesperson?.demoEmailDomain ?? 'flyr.software'}
                  </span>
                </div>
                <Input
                  type="email"
                  inputMode="email"
                  value={demoEmailReplyTo}
                  onChange={(event) => setDemoEmailReplyTo(event.target.value)}
                  placeholder="forward replies to"
                  className="h-10"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void handleSaveDemoEmail()}
                  disabled={isSavingDemoEmail || !currentWorkspaceId || !dialerSettingsStatus?.salesperson?.id}
                >
                  {isSavingDemoEmail ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Save sender
                </Button>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Sends from {demoEmailHandle || 'demo'}@{dialerSettingsStatus?.salesperson?.demoEmailDomain ?? 'flyr.software'}, saves replies in FLYR Inbox, and forwards replies to {demoEmailReplyTo || 'the rep email'}.
              </p>
            </div>

            {!dialerSettingsStatus?.addon?.isActive && dialerSettingsStatus?.canManage && (
              <Button
                variant="outline"
                onClick={handleEnableDialerAddon}
                disabled={isEnablingDialerAddon}
              >
                {isEnablingDialerAddon
                  ? 'Enabling dialer add-on…'
                  : `Enable dialer add-on (${dialerOfferLabel})`}
              </Button>
            )}

            {!dialerSettingsStatus?.addon?.isActive && !dialerSettingsStatus?.canManage && (
              <p className="text-sm text-amber-600 dark:text-amber-400">
                An owner or admin needs to purchase the Power Dialer add-on for this workspace.
              </p>
            )}

            {dialerSettingsStatus?.addon?.isActive &&
              !dialerSettingsStatus?.settings?.dedicatedFromNumber &&
              !dialerSettingsStatus.sharedDefaultDialingEnabled &&
              dialerSettingsStatus.canManage && (
                <div className="space-y-3 rounded-lg border border-dashed border-emerald-300 p-3">
                  <div className="space-y-1">
                    <Label htmlFor="settings-dialer-area-code">Claim a workspace number</Label>
                    <Input
                      id="settings-dialer-area-code"
                      inputMode="numeric"
                      maxLength={3}
                      placeholder="Optional area code (e.g. 305)"
                      value={dialerAreaCode}
                      onChange={(event) => setDialerAreaCode(event.target.value.replace(/\D/g, '').slice(0, 3))}
                    />
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Leave blank to grab the first available local Twilio number.
                    </p>
                  </div>
                  <Button
                    onClick={handleProvisionDialerNumber}
                    disabled={isProvisioningDialerNumber}
                  >
                    {isProvisioningDialerNumber ? 'Claiming number…' : 'Claim Twilio number'}
                  </Button>
                </div>
              )}
          </div>
        )}

        <div className="rounded-lg border border-gray-200 p-4 space-y-4 dark:border-gray-700">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-100 dark:bg-red-950/50">
                <Voicemail className="h-5 w-5 text-red-600 dark:text-red-300" />
              </div>
              <div>
                <p className="text-sm font-medium dark:text-white">Voicemail Drop Audio</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {activeVoicemailDrop?.filename
                    ? `Active recording: ${activeVoicemailDrop.filename}`
                    : 'No workspace recording selected yet.'}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Input
                ref={voicemailFileInputRef}
                type="file"
                accept="audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/wave,audio/vnd.wave,audio/mp4,audio/m4a,audio/x-m4a,audio/aac,audio/*"
                className="hidden"
                onChange={(event) => void handleVoicemailFileSelected(event.target.files?.[0] ?? null)}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => voicemailFileInputRef.current?.click()}
                disabled={isUploadingVoicemail || loadingVoicemails || !currentWorkspaceId}
              >
                {isUploadingVoicemail ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {isUploadingVoicemail ? 'Uploading…' : 'Upload audio'}
              </Button>
            </div>
          </div>

          {activeVoicemailDrop?.public_url && (
            <audio
              controls
              src={activeVoicemailDrop.public_url}
              className="h-10 w-full"
            />
          )}

          {loadingVoicemails ? (
            <div className="flex items-center gap-2 rounded-md border border-dashed border-gray-200 p-3 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading recordings…
            </div>
          ) : voicemailDrops.length > 0 ? (
            <div className="space-y-2">
              {voicemailDrops.map((drop) => (
                <div
                  key={drop.id}
                  className="flex flex-col gap-3 rounded-md border border-gray-200 p-3 dark:border-gray-700 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium dark:text-white">
                        {drop.filename || 'Voicemail recording'}
                      </p>
                      {drop.is_active && <Badge>Active</Badge>}
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {new Date(drop.created_at).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {!drop.is_active && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void handleActivateVoicemail(drop.id)}
                        disabled={Boolean(activatingVoicemailId) || Boolean(deletingVoicemailId)}
                      >
                        {activatingVoicemailId === drop.id && <Loader2 className="h-4 w-4 animate-spin" />}
                        Set active
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void handleDeleteVoicemail(drop.id)}
                      disabled={Boolean(activatingVoicemailId) || Boolean(deletingVoicemailId)}
                      aria-label={`Delete ${drop.filename || 'voicemail recording'}`}
                    >
                      {deletingVoicemailId === drop.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-gray-200 p-3 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
              Upload an MP3, WAV, or M4A recording. The active recording is what the dialler plays.
            </div>
          )}
        </div>

        <div className="rounded-lg border border-gray-200 p-4 text-sm text-gray-600 space-y-1 dark:border-gray-700 dark:text-gray-300">
          <p>1. Set `TWILIO_ACCOUNT_SID`, `TWILIO_API_KEY_SID`, `TWILIO_API_KEY_SECRET`, `TWILIO_AUTH_TOKEN`, and `TWILIO_TWIML_APP_SID`.</p>
          <p>2. Set `TWILIO_DEFAULT_FROM_NUMBER` as the shared fallback caller ID until each workspace claims its own number.</p>
          <p>3. Optional: set `TWILIO_DEFAULT_SMS_FROM_NUMBER` if you want post-call SMS follow-up from the dialer.</p>
          <p>4. Optional: set `TWILIO_INBOUND_FORWARD_TO` if you want a global inbound fallback when a workspace does not set its own forward target.</p>
          <p>5. Upload voicemail audio here, or set `TWILIO_VOICEMAIL_DROP_AUDIO_URL` as a fallback.</p>
          <p>6. Point your TwiML App Voice URL at `/api/twilio/voice/outgoing`.</p>
          <p>7. Workspace-claimed numbers are automatically pointed at `/api/twilio/voice/incoming` when provisioned.</p>
          <p>8. Open Leads, send a list to the dialer, initialize microphone access, and start a workspace queue.</p>
        </div>
      </CardContent>
    </Card>
  );
}
