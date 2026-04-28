'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Phone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useWorkspace } from '@/lib/workspace-context';

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
    numberStatus: 'unassigned' | 'active' | 'released';
    usesSharedDefaultNumber: boolean;
  } | null;
};

export function PowerDialerSettingsCard() {
  const { currentWorkspaceId } = useWorkspace();
  const [dialerSettingsStatus, setDialerSettingsStatus] = useState<DialerSettingsStatus | null>(null);
  const [dialerAreaCode, setDialerAreaCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [isEnablingDialerAddon, setIsEnablingDialerAddon] = useState(false);
  const [isProvisioningDialerNumber, setIsProvisioningDialerNumber] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const dialerOfferLabel = dialerSettingsStatus?.offer
    ? `${dialerSettingsStatus.offer.currency === 'CAD' ? 'CA$' : '$'}${dialerSettingsStatus.offer.amount}${dialerSettingsStatus.offer.currency === 'USD' ? ' USD' : ''}${dialerSettingsStatus.offer.period}`
    : 'CA$19.99/month';

  const loadDialerSettingsStatus = async (workspaceId?: string) => {
    try {
      const qs = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : '';
      const response = await fetch(`/api/dialer/settings${qs}`);
      if (response.ok) {
        const data = await response.json();
        setDialerSettingsStatus(data);
      }
    } catch (error) {
      console.error('Error loading dialer settings:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    void loadDialerSettingsStatus(currentWorkspaceId ?? undefined);
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
                  {dialerSettingsStatus?.settings.dedicatedFromNumber ??
                    dialerSettingsStatus?.settings.defaultFromNumber ??
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

        <div className="rounded-lg border border-gray-200 p-4 text-sm text-gray-600 space-y-1 dark:border-gray-700 dark:text-gray-300">
          <p>1. Set `TWILIO_ACCOUNT_SID`, `TWILIO_API_KEY_SID`, `TWILIO_API_KEY_SECRET`, `TWILIO_AUTH_TOKEN`, and `TWILIO_TWIML_APP_SID`.</p>
          <p>2. Set `TWILIO_DEFAULT_FROM_NUMBER` as the shared fallback caller ID until each workspace claims its own number.</p>
          <p>3. Optional: set `TWILIO_DEFAULT_SMS_FROM_NUMBER` if you want post-call SMS follow-up from the dialer.</p>
          <p>4. Optional: set `TWILIO_INBOUND_FORWARD_TO` if you want a global inbound fallback when a workspace does not set its own forward target.</p>
          <p>5. Optional: set `TWILIO_VOICEMAIL_DROP_AUDIO_URL` to enable one-tap prerecorded voicemail drop.</p>
          <p>6. Point your TwiML App Voice URL at `/api/twilio/voice/outgoing`.</p>
          <p>7. Workspace-claimed numbers are automatically pointed at `/api/twilio/voice/incoming` when provisioned.</p>
          <p>8. Open Leads, send a list to the dialer, initialize microphone access, and start a workspace queue.</p>
        </div>
      </CardContent>
    </Card>
  );
}
