'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { 
  ArrowLeft, 
  Plug, 
  CheckCircle2, 
  XCircle, 
  RefreshCw,
  Shield,
  AlertCircle,
  Send,
  LayoutGrid,
  KeyRound,
  Eye,
  EyeOff,
  Clipboard
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useWorkspace } from '@/lib/workspace-context';

interface ConnectionStatus {
  connected: boolean;
  status: string;
  createdAt?: string;
  updatedAt?: string;
  lastTestedAt?: string;
  lastPushAt?: string;
  lastError?: string;
}

interface MondayStatus {
  connected: boolean;
  accountId?: string | null;
  accountName?: string | null;
  selectedBoardId?: string | null;
  selectedBoardName?: string | null;
  needsBoardSelection?: boolean;
  updatedAt?: string | null;
}

interface MondayBoard {
  id: string;
  name: string;
  workspaceId?: string | null;
  workspaceName?: string | null;
}

export default function IntegrationsPage() {
  const router = useRouter();
  const { currentWorkspaceId } = useWorkspace();
  const [loading, setLoading] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus | null>(null);
  const [isStartingOAuth, setIsStartingOAuth] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isTestPushing, setIsTestPushing] = useState(false);
  const [isSendingBottomTestLead, setIsSendingBottomTestLead] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [boldTrailStatus, setBoldTrailStatus] = useState<ConnectionStatus | null>(null);
  const [showBoldTrailDialog, setShowBoldTrailDialog] = useState(false);
  const [boldTrailToken, setBoldTrailToken] = useState('');
  const [showBoldTrailToken, setShowBoldTrailToken] = useState(false);
  const [isTestingBoldTrail, setIsTestingBoldTrail] = useState(false);
  const [isSavingBoldTrail, setIsSavingBoldTrail] = useState(false);
  const [isDisconnectingBoldTrail, setIsDisconnectingBoldTrail] = useState(false);
  const [boldTrailDialogMessage, setBoldTrailDialogMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [lastBoldTrailTestedToken, setLastBoldTrailTestedToken] = useState<string | null>(null);
  const [lastBoldTrailTestSucceeded, setLastBoldTrailTestSucceeded] = useState(false);
  const [hubSpotStatus, setHubSpotStatus] = useState<ConnectionStatus | null>(null);
  const [isStartingHubSpotOAuth, setIsStartingHubSpotOAuth] = useState(false);
  const [isTestingHubSpot, setIsTestingHubSpot] = useState(false);
  const [isDisconnectingHubSpot, setIsDisconnectingHubSpot] = useState(false);
  const [zapierStatus, setZapierStatus] = useState<ConnectionStatus | null>(null);
  const [showZapierDialog, setShowZapierDialog] = useState(false);
  const [zapierWebhookUrl, setZapierWebhookUrl] = useState('');
  const [showZapierWebhookUrl, setShowZapierWebhookUrl] = useState(false);
  const [isTestingZapier, setIsTestingZapier] = useState(false);
  const [isSavingZapier, setIsSavingZapier] = useState(false);
  const [isDisconnectingZapier, setIsDisconnectingZapier] = useState(false);
  const [zapierDialogMessage, setZapierDialogMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [lastZapierTestedWebhookUrl, setLastZapierTestedWebhookUrl] = useState<string | null>(null);
  const [lastZapierTestSucceeded, setLastZapierTestSucceeded] = useState(false);
  const [mondayStatus, setMondayStatus] = useState<MondayStatus | null>(null);
  const [mondayBoards, setMondayBoards] = useState<MondayBoard[]>([]);
  const [showMondayBoards, setShowMondayBoards] = useState(false);
  const [isStartingMondayOAuth, setIsStartingMondayOAuth] = useState(false);
  const [isLoadingMondayBoards, setIsLoadingMondayBoards] = useState(false);
  const [isSavingMondayBoard, setIsSavingMondayBoard] = useState(false);
  const [isDisconnectingMonday, setIsDisconnectingMonday] = useState(false);
  const trimmedBoldTrailToken = boldTrailToken.trim();
  const hasStoredBoldTrailToken = !!boldTrailStatus?.connected;
  const canSaveBoldTrail =
    !!trimmedBoldTrailToken &&
    lastBoldTrailTestSucceeded &&
    lastBoldTrailTestedToken === trimmedBoldTrailToken;
  const trimmedZapierWebhookUrl = zapierWebhookUrl.trim();
  const hasStoredZapierWebhook = !!zapierStatus?.connected;
  const canSaveZapier =
    !!trimmedZapierWebhookUrl &&
    lastZapierTestSucceeded &&
    lastZapierTestedWebhookUrl === trimmedZapierWebhookUrl;

  useEffect(() => {
    const loadData = async () => {
      const supabase = createClient();
      
      // Get user
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (authUser) {
        await Promise.all([
          loadConnectionStatus(currentWorkspaceId ?? undefined),
          loadBoldTrailStatus(currentWorkspaceId ?? undefined),
          loadHubSpotStatus(currentWorkspaceId ?? undefined),
          loadZapierStatus(currentWorkspaceId ?? undefined),
          loadMondayStatus(),
        ]);
      } else {
        router.push('/login');
      }
      
      setLoading(false);
    };

    loadData();
  }, [router, currentWorkspaceId]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fub = params.get('fub');
    const hubspot = params.get('hubspot');
    const monday = params.get('monday');
    const callbackMessage = params.get('message');
    if (fub === 'connected') {
      setMessage({ type: 'success', text: callbackMessage || 'Follow Up Boss connected successfully.' });
      window.history.replaceState({}, '', '/settings/integrations');
      loadConnectionStatus(currentWorkspaceId ?? undefined);
    } else if (fub === 'error') {
      setMessage({ type: 'error', text: callbackMessage || 'Follow Up Boss OAuth connection failed.' });
      window.history.replaceState({}, '', '/settings/integrations');
    } else if (hubspot === 'connected') {
      setMessage({ type: 'success', text: callbackMessage || 'HubSpot connected successfully.' });
      window.history.replaceState({}, '', '/settings/integrations');
      loadHubSpotStatus(currentWorkspaceId ?? undefined);
    } else if (hubspot === 'error') {
      setMessage({ type: 'error', text: callbackMessage || 'HubSpot OAuth connection failed.' });
      window.history.replaceState({}, '', '/settings/integrations');
    } else if (monday === 'connected') {
      setMessage({ type: 'success', text: callbackMessage || 'Monday connected. Select a board to finish setup.' });
      window.history.replaceState({}, '', '/settings/integrations');
      loadMondayStatus().then(() => handleLoadMondayBoards());
    } else if (monday === 'error') {
      setMessage({ type: 'error', text: callbackMessage || 'Monday OAuth connection failed.' });
      window.history.replaceState({}, '', '/settings/integrations');
    }
  }, [currentWorkspaceId]);

  const loadConnectionStatus = async (workspaceId?: string) => {
    try {
      const qs = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : '';
      const response = await fetch(`/api/integrations/followupboss/status${qs}`);
      if (response.ok) {
        const data = await response.json();
        setConnectionStatus(data);
      }
    } catch (error) {
      console.error('Error loading connection status:', error);
    }
  };

  const loadMondayStatus = async () => {
    try {
      const response = await fetch('/api/integrations/monday/status');
      if (response.ok) {
        const data = await response.json();
        setMondayStatus(data);
      }
    } catch (error) {
      console.error('Error loading monday status:', error);
    }
  };

  const loadBoldTrailStatus = async (workspaceId?: string) => {
    try {
      const qs = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : '';
      const response = await fetch(`/api/integrations/boldtrail/status${qs}`);
      if (response.ok) {
        const data = await response.json();
        setBoldTrailStatus(data);
      }
    } catch (error) {
      console.error('Error loading BoldTrail status:', error);
    }
  };

  const loadZapierStatus = async (workspaceId?: string) => {
    try {
      const qs = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : '';
      const response = await fetch(`/api/integrations/zapier/status${qs}`);
      if (response.ok) {
        const data = await response.json();
        setZapierStatus(data);
      }
    } catch (error) {
      console.error('Error loading Zapier status:', error);
    }
  };

  const loadHubSpotStatus = async (workspaceId?: string) => {
    try {
      const qs = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : '';
      const response = await fetch(`/api/integrations/hubspot/status${qs}`);
      if (response.ok) {
        const data = await response.json();
        setHubSpotStatus(data);
      }
    } catch (error) {
      console.error('Error loading HubSpot status:', error);
    }
  };

  const handleStartOAuth = async () => {
    setIsStartingOAuth(true);
    setMessage(null);

    try {
      const params = new URLSearchParams({ platform: 'web' });
      if (currentWorkspaceId) {
        params.set('workspaceId', currentWorkspaceId);
      }
      const response = await fetch(`/api/integrations/fub/oauth/start?${params.toString()}`, {
        method: 'GET',
      });

      const data = await response.json();

      if (response.ok && data.authorizeUrl) {
        window.location.assign(String(data.authorizeUrl));
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to start OAuth flow' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Network error. Please try again.' });
    } finally {
      setIsStartingOAuth(false);
    }
  };

  const handleTest = async () => {
    setIsTesting(true);
    setMessage(null);

    try {
      const response = await fetch('/api/integrations/followupboss/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: currentWorkspaceId }),
      });

      const data = await response.json();

      if (response.ok) {
        setMessage({ type: 'success', text: data.message });
        await loadConnectionStatus(currentWorkspaceId ?? undefined);
      } else {
        setMessage({ type: 'error', text: data.error || 'Connection test failed' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Network error. Please try again.' });
    } finally {
      setIsTesting(false);
    }
  };

  const handleStartMondayOAuth = async () => {
    setIsStartingMondayOAuth(true);
    setMessage(null);

    try {
      const params = new URLSearchParams({ platform: 'web' });
      if (currentWorkspaceId) {
        params.set('workspaceId', currentWorkspaceId);
      }
      const response = await fetch(`/api/integrations/monday/oauth/start?${params.toString()}`);
      const data = await response.json();

      if (response.ok && data.authorizeUrl) {
        window.location.assign(String(data.authorizeUrl));
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to start monday OAuth flow.' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Network error. Please try again.' });
    } finally {
      setIsStartingMondayOAuth(false);
    }
  };

  const handleLoadMondayBoards = async () => {
    setIsLoadingMondayBoards(true);
    setMessage(null);

    try {
      const response = await fetch('/api/integrations/monday/boards');
      const data = await response.json();
      if (response.ok) {
        setMondayBoards(data.boards ?? []);
        setShowMondayBoards(true);
        if (!data.boards?.length) {
          setMessage({ type: 'error', text: 'No monday boards were found for this account.' });
        }
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to load monday boards.' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Network error while loading monday boards.' });
    } finally {
      setIsLoadingMondayBoards(false);
    }
  };

  const handleSelectMondayBoard = async (boardId: string) => {
    setIsSavingMondayBoard(true);
    setMessage(null);

    try {
      const response = await fetch('/api/integrations/monday/select-board', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ boardId }),
      });
      const data = await response.json();

      if (response.ok) {
        setMessage({ type: 'success', text: `Monday board selected: ${data.selectedBoardName}` });
        setShowMondayBoards(false);
        await loadMondayStatus();
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to save monday board.' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Network error while saving monday board.' });
    } finally {
      setIsSavingMondayBoard(false);
    }
  };

  const handleTestPush = async () => {
    setIsTestPushing(true);
    setMessage(null);

    try {
      const response = await fetch('/api/integrations/followupboss/test-push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: currentWorkspaceId }),
      });

      const data = await response.json();

      if (response.ok) {
        setMessage({ 
          type: 'success', 
          text: `${data.message} Test lead: ${data.testLead.name} (${data.testLead.email})` 
        });
        await loadConnectionStatus(currentWorkspaceId ?? undefined);
      } else {
        setMessage({ type: 'error', text: data.error || 'Test push failed' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Network error. Please try again.' });
    } finally {
      setIsTestPushing(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm('Are you sure you want to disconnect from Follow Up Boss?')) {
      return;
    }

    setIsDisconnecting(true);
    setMessage(null);

    try {
      const response = await fetch('/api/integrations/followupboss/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: currentWorkspaceId }),
      });

      const data = await response.json();

      if (response.ok) {
        setMessage({ type: 'success', text: data.message });
        setConnectionStatus({ connected: false, status: 'disconnected' });
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to disconnect' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Network error. Please try again.' });
    } finally {
      setIsDisconnecting(false);
    }
  };

  const handleDisconnectMonday = async () => {
    if (!confirm('Are you sure you want to disconnect from Monday.com?')) {
      return;
    }

    setIsDisconnectingMonday(true);
    setMessage(null);

    try {
      const response = await fetch('/api/integrations/monday/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await response.json();

      if (response.ok) {
        setMessage({ type: 'success', text: data.message });
        setMondayStatus({ connected: false });
        setMondayBoards([]);
        setShowMondayBoards(false);
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to disconnect Monday.com.' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Network error. Please try again.' });
    } finally {
      setIsDisconnectingMonday(false);
    }
  };

  const handleOpenBoldTrailDialog = () => {
    setShowBoldTrailDialog(true);
    setBoldTrailDialogMessage(null);
    setBoldTrailToken('');
    setShowBoldTrailToken(false);
    setLastBoldTrailTestedToken(null);
    setLastBoldTrailTestSucceeded(false);
  };

  const handleTestBoldTrail = async () => {
    if (!trimmedBoldTrailToken && !hasStoredBoldTrailToken) {
      return;
    }

    setIsTestingBoldTrail(true);
    setBoldTrailDialogMessage(null);

    try {
      const response = await fetch('/api/integrations/boldtrail/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId: currentWorkspaceId,
          apiToken: trimmedBoldTrailToken || undefined,
        }),
      });

      const data = await response.json();
      setLastBoldTrailTestedToken(trimmedBoldTrailToken);

      if (response.ok) {
        setLastBoldTrailTestSucceeded(true);
        setBoldTrailDialogMessage({
          type: 'success',
          text: data.message || 'Connection successful',
        });
        await loadBoldTrailStatus(currentWorkspaceId ?? undefined);
      } else {
        setLastBoldTrailTestSucceeded(false);
        setBoldTrailDialogMessage({
          type: 'error',
          text: data.error || 'Connection test failed',
        });
      }
    } catch {
      setLastBoldTrailTestedToken(trimmedBoldTrailToken);
      setLastBoldTrailTestSucceeded(false);
      setBoldTrailDialogMessage({
        type: 'error',
        text: 'Network error. Please try again.',
      });
    } finally {
      setIsTestingBoldTrail(false);
    }
  };

  const handleSaveBoldTrail = async () => {
    if (!canSaveBoldTrail) {
      return;
    }

    setIsSavingBoldTrail(true);
    setBoldTrailDialogMessage(null);

    try {
      const response = await fetch('/api/integrations/boldtrail/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId: currentWorkspaceId,
          apiToken: trimmedBoldTrailToken,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setMessage({ type: 'success', text: data.message || 'BoldTrail connected successfully.' });
        setShowBoldTrailDialog(false);
        setBoldTrailToken('');
        setLastBoldTrailTestSucceeded(false);
        setLastBoldTrailTestedToken(null);
        await loadBoldTrailStatus(currentWorkspaceId ?? undefined);
      } else {
        setBoldTrailDialogMessage({
          type: 'error',
          text: data.error || 'Failed to save BoldTrail token',
        });
      }
    } catch {
      setBoldTrailDialogMessage({
        type: 'error',
        text: 'Network error. Please try again.',
      });
    } finally {
      setIsSavingBoldTrail(false);
    }
  };

  const handleDisconnectBoldTrail = async () => {
    if (!confirm('Are you sure you want to disconnect from BoldTrail?')) {
      return;
    }

    setIsDisconnectingBoldTrail(true);
    setBoldTrailDialogMessage(null);
    setMessage(null);

    try {
      const response = await fetch('/api/integrations/boldtrail/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: currentWorkspaceId }),
      });

      const data = await response.json();

      if (response.ok) {
        setMessage({ type: 'success', text: data.message || 'BoldTrail disconnected successfully.' });
        setShowBoldTrailDialog(false);
        setBoldTrailStatus({ connected: false, status: 'disconnected' });
      } else {
        setBoldTrailDialogMessage({
          type: 'error',
          text: data.error || 'Failed to disconnect BoldTrail',
        });
      }
    } catch {
      setBoldTrailDialogMessage({
        type: 'error',
        text: 'Network error. Please try again.',
      });
    } finally {
      setIsDisconnectingBoldTrail(false);
    }
  };

  const handleStartHubSpotOAuth = async () => {
    setIsStartingHubSpotOAuth(true);
    setMessage(null);

    try {
      const params = new URLSearchParams({ platform: 'web' });
      if (currentWorkspaceId) {
        params.set('workspaceId', currentWorkspaceId);
      }
      const response = await fetch(`/api/integrations/hubspot/oauth/start?${params.toString()}`, {
        method: 'GET',
      });

      const data = await response.json();

      if (response.ok && data.authorizeUrl) {
        window.location.assign(String(data.authorizeUrl));
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to start HubSpot OAuth flow' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Network error. Please try again.' });
    } finally {
      setIsStartingHubSpotOAuth(false);
    }
  };

  const handleTestHubSpot = async () => {
    setIsTestingHubSpot(true);
    setMessage(null);

    try {
      const response = await fetch('/api/integrations/hubspot/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId: currentWorkspaceId,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setMessage({
          type: 'success',
          text: data.message || 'Connection successful',
        });
        await loadHubSpotStatus(currentWorkspaceId ?? undefined);
      } else {
        setMessage({
          type: 'error',
          text: data.error || 'Connection test failed',
        });
      }
    } catch {
      setMessage({
        type: 'error',
        text: 'Network error. Please try again.',
      });
    } finally {
      setIsTestingHubSpot(false);
    }
  };

  const handleDisconnectHubSpot = async () => {
    if (!confirm('Are you sure you want to disconnect from HubSpot?')) {
      return;
    }

    setIsDisconnectingHubSpot(true);
    setMessage(null);

    try {
      const response = await fetch('/api/integrations/hubspot/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: currentWorkspaceId }),
      });

      const data = await response.json();

      if (response.ok) {
        setMessage({ type: 'success', text: data.message || 'HubSpot disconnected successfully.' });
        setHubSpotStatus({ connected: false, status: 'disconnected' });
      } else {
        setMessage({
          type: 'error',
          text: data.error || 'Failed to disconnect HubSpot',
        });
      }
    } catch {
      setMessage({
        type: 'error',
        text: 'Network error. Please try again.',
      });
    } finally {
      setIsDisconnectingHubSpot(false);
    }
  };

  const handleOpenZapierDialog = () => {
    setShowZapierDialog(true);
    setZapierDialogMessage(null);
    setZapierWebhookUrl('');
    setShowZapierWebhookUrl(false);
    setLastZapierTestedWebhookUrl(null);
    setLastZapierTestSucceeded(false);
  };

  const handleTestZapier = async () => {
    if (!trimmedZapierWebhookUrl && !hasStoredZapierWebhook) {
      return;
    }

    setIsTestingZapier(true);
    setZapierDialogMessage(null);

    try {
      const response = await fetch('/api/integrations/zapier/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId: currentWorkspaceId,
          webhookUrl: trimmedZapierWebhookUrl || undefined,
        }),
      });

      const data = await response.json();
      setLastZapierTestedWebhookUrl(trimmedZapierWebhookUrl);

      if (response.ok) {
        setLastZapierTestSucceeded(true);
        setZapierDialogMessage({
          type: 'success',
          text: data.message || 'Webhook test sent successfully',
        });
        await loadZapierStatus(currentWorkspaceId ?? undefined);
      } else {
        setLastZapierTestSucceeded(false);
        setZapierDialogMessage({
          type: 'error',
          text: data.error || 'Webhook test failed',
        });
      }
    } catch {
      setLastZapierTestedWebhookUrl(trimmedZapierWebhookUrl);
      setLastZapierTestSucceeded(false);
      setZapierDialogMessage({
        type: 'error',
        text: 'Network error. Please try again.',
      });
    } finally {
      setIsTestingZapier(false);
    }
  };

  const handleSaveZapier = async () => {
    if (!canSaveZapier) {
      return;
    }

    setIsSavingZapier(true);
    setZapierDialogMessage(null);

    try {
      const response = await fetch('/api/integrations/zapier/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId: currentWorkspaceId,
          webhookUrl: trimmedZapierWebhookUrl,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setMessage({ type: 'success', text: data.message || 'Zapier connected successfully.' });
        setShowZapierDialog(false);
        setZapierWebhookUrl('');
        setLastZapierTestSucceeded(false);
        setLastZapierTestedWebhookUrl(null);
        await loadZapierStatus(currentWorkspaceId ?? undefined);
      } else {
        setZapierDialogMessage({
          type: 'error',
          text: data.error || 'Failed to save Zapier webhook',
        });
      }
    } catch {
      setZapierDialogMessage({
        type: 'error',
        text: 'Network error. Please try again.',
      });
    } finally {
      setIsSavingZapier(false);
    }
  };

  const handleDisconnectZapier = async () => {
    if (!confirm('Are you sure you want to disconnect from Zapier?')) {
      return;
    }

    setIsDisconnectingZapier(true);
    setZapierDialogMessage(null);
    setMessage(null);

    try {
      const response = await fetch('/api/integrations/zapier/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: currentWorkspaceId }),
      });

      const data = await response.json();

      if (response.ok) {
        setMessage({ type: 'success', text: data.message || 'Zapier disconnected successfully.' });
        setShowZapierDialog(false);
        setZapierStatus({ connected: false, status: 'disconnected' });
      } else {
        setZapierDialogMessage({
          type: 'error',
          text: data.error || 'Failed to disconnect Zapier',
        });
      }
    } catch {
      setZapierDialogMessage({
        type: 'error',
        text: 'Network error. Please try again.',
      });
    } finally {
      setIsDisconnectingZapier(false);
    }
  };

  const handlePasteZapierWebhookUrl = async () => {
    try {
      const clipboardValue = await navigator.clipboard.readText();
      setZapierWebhookUrl(clipboardValue.trim());
    } catch {
      setZapierDialogMessage({
        type: 'error',
        text: 'Clipboard access is not available in this browser.',
      });
    }
  };

  const handlePasteBoldTrailToken = async () => {
    try {
      const clipboardValue = await navigator.clipboard.readText();
      setBoldTrailToken(clipboardValue.trim());
    } catch {
      setBoldTrailDialogMessage({
        type: 'error',
        text: 'Clipboard access is not available in this browser.',
      });
    }
  };

  const handleSendBottomTestLead = async () => {
    setIsSendingBottomTestLead(true);
    setMessage(null);

    try {
      const response = await fetch('/api/integrations/test-lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: currentWorkspaceId }),
      });

      const data = await response.json();

      if (response.ok) {
        setMessage({
          type: 'success',
          text: data.message || `Test lead sent: ${data.testLead?.name} (${data.testLead?.email})`,
        });
        await Promise.all([
          loadConnectionStatus(currentWorkspaceId ?? undefined),
          loadBoldTrailStatus(currentWorkspaceId ?? undefined),
          loadHubSpotStatus(currentWorkspaceId ?? undefined),
          loadZapierStatus(currentWorkspaceId ?? undefined),
          loadMondayStatus(),
        ]);
      } else {
        setMessage({
          type: 'error',
          text: data.error || 'Failed to send test lead',
        });
      }
    } catch {
      setMessage({
        type: 'error',
        text: 'Network error. Please try again.',
      });
    } finally {
      setIsSendingBottomTestLead(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="text-gray-600 dark:text-foreground/80">Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-background">
      <header className="bg-white dark:bg-card border-b border-border sticky top-0 z-10">
        <div className="mx-auto w-full max-w-4xl px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push('/settings')}
              className="gap-2"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </Button>
            <h1 className="text-2xl font-bold dark:text-white">Integrations</h1>
          </div>
        </div>
      </header>
      
      <main className="mx-auto w-full max-w-4xl px-4 sm:px-6 lg:px-8 py-6">
        <div className="space-y-6">
          {message && (
            <div className={`p-4 rounded-lg flex items-start gap-3 ${
              message.type === 'success'
                ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800'
                : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800'
            }`}>
              {message.type === 'success' ? (
                <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              )}
              <p className="text-sm">{message.text}</p>
            </div>
          )}

          {/* Follow Up Boss Integration */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900 rounded-lg flex items-center justify-center">
                    <Plug className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <CardTitle>Follow Up Boss</CardTitle>
                    <CardDescription>
                      Sync your leads directly to Follow Up Boss CRM
                    </CardDescription>
                  </div>
                </div>
                {connectionStatus?.connected ? (
                  <Badge className="bg-green-500 hover:bg-green-600 gap-1">
                    <CheckCircle2 className="w-3 h-3" />
                    Connected
                  </Badge>
                ) : (
                  <Badge variant="outline">Not Connected</Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {connectionStatus?.connected ? (
                // Connected state
                <div className="space-y-6">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between py-3 border-b border-gray-200 dark:border-gray-700">
                      <div>
                        <p className="text-sm font-medium dark:text-white">Connection Status</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          Last tested: {connectionStatus.lastTestedAt 
                            ? new Date(connectionStatus.lastTestedAt).toLocaleString()
                            : 'Never'
                          }
                        </p>
                      </div>
                      <Badge variant={connectionStatus.status === 'connected' ? 'default' : 'destructive'}>
                        {connectionStatus.status}
                      </Badge>
                    </div>
                    
                    {connectionStatus.lastPushAt && (
                      <div className="flex items-center justify-between py-3 border-b border-gray-200 dark:border-gray-700">
                        <div>
                          <p className="text-sm font-medium dark:text-white">Last Lead Push</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            {new Date(connectionStatus.lastPushAt).toLocaleString()}
                          </p>
                        </div>
                      </div>
                    )}

                    {connectionStatus.lastError && (
                      <div className="flex items-center justify-between py-3 border-b border-gray-200 dark:border-gray-700">
                        <div>
                          <p className="text-sm font-medium text-red-600 dark:text-red-400">Last Error</p>
                          <p className="text-xs text-red-500 dark:text-red-400">
                            {connectionStatus.lastError}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <Button
                      variant="outline"
                      onClick={handleTest}
                      disabled={isTesting}
                      className="gap-2"
                    >
                      <RefreshCw className={`w-4 h-4 ${isTesting ? 'animate-spin' : ''}`} />
                      {isTesting ? 'Testing...' : 'Test Connection'}
                    </Button>
                    
                    <Button
                      variant="outline"
                      onClick={handleTestPush}
                      disabled={isTestPushing}
                      className="gap-2"
                    >
                      <Send className={`w-4 h-4 ${isTestPushing ? 'animate-pulse' : ''}`} />
                      {isTestPushing ? 'Sending...' : 'Send Test Lead'}
                    </Button>
                    
                    <Button
                      variant="destructive"
                      onClick={handleDisconnect}
                      disabled={isDisconnecting}
                      className="gap-2"
                    >
                      <XCircle className="w-4 h-4" />
                      {isDisconnecting ? 'Disconnecting...' : 'Disconnect'}
                    </Button>
                  </div>
                </div>
              ) : (
                // Not connected state
                <div className="space-y-4">
                  <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                    <div className="flex items-start gap-3">
                      <Shield className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                      <div className="text-sm text-blue-700 dark:text-blue-300">
                        <p className="font-medium mb-1">Secure Connection</p>
                        <p>
                          Connect with OAuth. You will sign in to Follow Up Boss and approve access.
                          FLYR stores tokens securely on the backend.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 text-sm text-gray-600 dark:text-gray-300 space-y-1">
                    <p>1. Click Connect Follow Up Boss</p>
                    <p>2. Sign in to Follow Up Boss</p>
                    <p>3. Approve FLYR access</p>
                    <p>4. Return to FLYR automatically</p>
                  </div>

                  <Button
                    onClick={handleStartOAuth}
                    disabled={isStartingOAuth}
                    className="w-full gap-2"
                  >
                    <Plug className="w-4 h-4" />
                    {isStartingOAuth ? 'Redirecting...' : 'Connect Follow Up Boss'}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-orange-100 dark:bg-orange-950 rounded-lg flex items-center justify-center">
                    <Send className="w-5 h-5 text-orange-700 dark:text-orange-300" />
                  </div>
                  <div>
                    <CardTitle>Zapier</CardTitle>
                    <CardDescription>
                      Send each FLYR lead to a Zapier Catch Hook so you can route it anywhere
                    </CardDescription>
                  </div>
                </div>
                {zapierStatus?.connected ? (
                  <Badge className="bg-green-500 hover:bg-green-600 gap-1">
                    <CheckCircle2 className="w-3 h-3" />
                    Connected
                  </Badge>
                ) : (
                  <Badge variant="outline">Not Connected</Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {zapierStatus?.connected ? (
                <div className="space-y-6">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between py-3 border-b border-gray-200 dark:border-gray-700">
                      <div>
                        <p className="text-sm font-medium dark:text-white">Connection Status</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          Last tested: {zapierStatus.lastTestedAt
                            ? new Date(zapierStatus.lastTestedAt).toLocaleString()
                            : 'Never'}
                        </p>
                      </div>
                      <Badge variant={zapierStatus.status === 'connected' ? 'default' : 'destructive'}>
                        {zapierStatus.status}
                      </Badge>
                    </div>

                    {zapierStatus.lastPushAt && (
                      <div className="flex items-center justify-between py-3 border-b border-gray-200 dark:border-gray-700">
                        <div>
                          <p className="text-sm font-medium dark:text-white">Last Webhook Delivery</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            {new Date(zapierStatus.lastPushAt).toLocaleString()}
                          </p>
                        </div>
                      </div>
                    )}

                    {zapierStatus.lastError && (
                      <div className="flex items-center justify-between py-3 border-b border-gray-200 dark:border-gray-700">
                        <div>
                          <p className="text-sm font-medium text-red-600 dark:text-red-400">Last Error</p>
                          <p className="text-xs text-red-500 dark:text-red-400">
                            {zapierStatus.lastError}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <Button
                      variant="outline"
                      onClick={handleOpenZapierDialog}
                      className="gap-2"
                    >
                      <Send className="w-4 h-4" />
                      Manage Webhook
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-900 rounded-lg p-4">
                    <div className="flex items-start gap-3">
                      <Shield className="w-5 h-5 text-orange-700 dark:text-orange-300 shrink-0 mt-0.5" />
                      <div className="text-sm text-orange-800 dark:text-orange-200">
                        <p className="font-medium mb-1">Webhook-Based Delivery</p>
                        <p>
                          Paste a Zapier Catch Hook URL, test it with a sample lead, and FLYR will post
                          leads to that webhook from the shared CRM sync workflow.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 text-sm text-gray-600 dark:text-gray-300 space-y-1">
                    <p>1. Create a Zap with Webhooks by Zapier using Catch Hook</p>
                    <p>2. Copy the `hooks.zapier.com` URL into FLYR</p>
                    <p>3. Send a test payload and confirm Zapier catches it</p>
                    <p>4. Save the webhook and start syncing leads</p>
                  </div>

                  <Button
                    onClick={handleOpenZapierDialog}
                    className="w-full gap-2"
                  >
                    <Send className="w-4 h-4" />
                    Connect Zapier
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-orange-100 dark:bg-orange-900 rounded-lg flex items-center justify-center">
                    <Plug className="w-5 h-5 text-orange-700 dark:text-orange-300" />
                  </div>
                  <div>
                    <CardTitle>HubSpot</CardTitle>
                    <CardDescription>
                      Connect with OAuth and sync FLYR leads directly into HubSpot contacts
                    </CardDescription>
                  </div>
                </div>
                {hubSpotStatus?.connected ? (
                  <Badge className="bg-green-500 hover:bg-green-600 gap-1">
                    <CheckCircle2 className="w-3 h-3" />
                    Connected
                  </Badge>
                ) : (
                  <Badge variant="outline">Not Connected</Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {hubSpotStatus?.connected ? (
                <div className="space-y-6">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between py-3 border-b border-gray-200 dark:border-gray-700">
                      <div>
                        <p className="text-sm font-medium dark:text-white">Connection Status</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          Last tested: {hubSpotStatus.lastTestedAt
                            ? new Date(hubSpotStatus.lastTestedAt).toLocaleString()
                            : 'Never'}
                        </p>
                      </div>
                      <Badge variant={hubSpotStatus.status === 'connected' ? 'default' : 'destructive'}>
                        {hubSpotStatus.status}
                      </Badge>
                    </div>

                    {hubSpotStatus.lastPushAt && (
                      <div className="flex items-center justify-between py-3 border-b border-gray-200 dark:border-gray-700">
                        <div>
                          <p className="text-sm font-medium dark:text-white">Last Lead Push</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            {new Date(hubSpotStatus.lastPushAt).toLocaleString()}
                          </p>
                        </div>
                      </div>
                    )}

                    {hubSpotStatus.lastError && (
                      <div className="flex items-center justify-between py-3 border-b border-gray-200 dark:border-gray-700">
                        <div>
                          <p className="text-sm font-medium text-red-600 dark:text-red-400">Last Error</p>
                          <p className="text-xs text-red-500 dark:text-red-400">
                            {hubSpotStatus.lastError}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <Button
                      variant="outline"
                      onClick={handleTestHubSpot}
                      disabled={isTestingHubSpot}
                      className="gap-2"
                    >
                      <RefreshCw className={`w-4 h-4 ${isTestingHubSpot ? 'animate-spin' : ''}`} />
                      {isTestingHubSpot ? 'Testing...' : 'Test Connection'}
                    </Button>

                    <Button
                      variant="destructive"
                      onClick={handleDisconnectHubSpot}
                      disabled={isDisconnectingHubSpot}
                      className="gap-2"
                    >
                      <XCircle className="w-4 h-4" />
                      {isDisconnectingHubSpot ? 'Disconnecting...' : 'Disconnect'}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg p-4">
                    <div className="flex items-start gap-3">
                      <Shield className="w-5 h-5 text-orange-700 dark:text-orange-300 shrink-0 mt-0.5" />
                      <div className="text-sm text-orange-700 dark:text-orange-300">
                        <p className="font-medium mb-1">OAuth Sign-In</p>
                        <p>
                          Sign in to HubSpot, approve the contact scopes, and FLYR will store the
                          OAuth tokens securely on the backend like Follow Up Boss.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 text-sm text-gray-600 dark:text-gray-300 space-y-1">
                    <p>1. Click Connect HubSpot</p>
                    <p>2. Sign in to HubSpot</p>
                    <p>3. Approve contact read/write access for FLYR</p>
                    <p>4. Return to FLYR automatically</p>
                  </div>

                  <Button
                    onClick={handleStartHubSpotOAuth}
                    disabled={isStartingHubSpotOAuth}
                    className="w-full gap-2"
                  >
                    <Plug className="w-4 h-4" />
                    {isStartingHubSpotOAuth ? 'Redirecting...' : 'Connect HubSpot'}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-emerald-100 dark:bg-emerald-950 rounded-lg flex items-center justify-center">
                    <KeyRound className="w-5 h-5 text-emerald-700 dark:text-emerald-300" />
                  </div>
                  <div>
                    <CardTitle>BoldTrail / kvCORE</CardTitle>
                    <CardDescription>
                      Token-based BoldTrail lead sync from FLYR into your CRM
                    </CardDescription>
                  </div>
                </div>
                {boldTrailStatus?.connected ? (
                  <Badge className="bg-green-500 hover:bg-green-600 gap-1">
                    <CheckCircle2 className="w-3 h-3" />
                    Connected
                  </Badge>
                ) : (
                  <Badge variant="outline">Not Connected</Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {boldTrailStatus?.connected ? (
                <div className="space-y-6">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between py-3 border-b border-gray-200 dark:border-gray-700">
                      <div>
                        <p className="text-sm font-medium dark:text-white">Connection Status</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          Last tested: {boldTrailStatus.lastTestedAt
                            ? new Date(boldTrailStatus.lastTestedAt).toLocaleString()
                            : 'Never'}
                        </p>
                      </div>
                      <Badge variant={boldTrailStatus.status === 'connected' ? 'default' : 'destructive'}>
                        {boldTrailStatus.status}
                      </Badge>
                    </div>

                    {boldTrailStatus.lastPushAt && (
                      <div className="flex items-center justify-between py-3 border-b border-gray-200 dark:border-gray-700">
                        <div>
                          <p className="text-sm font-medium dark:text-white">Last Lead Push</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            {new Date(boldTrailStatus.lastPushAt).toLocaleString()}
                          </p>
                        </div>
                      </div>
                    )}

                    {boldTrailStatus.lastError && (
                      <div className="flex items-center justify-between py-3 border-b border-gray-200 dark:border-gray-700">
                        <div>
                          <p className="text-sm font-medium text-red-600 dark:text-red-400">Last Error</p>
                          <p className="text-xs text-red-500 dark:text-red-400">
                            {boldTrailStatus.lastError}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <Button
                      variant="outline"
                      onClick={handleOpenBoldTrailDialog}
                      className="gap-2"
                    >
                      <KeyRound className="w-4 h-4" />
                      Manage Token
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 rounded-lg p-4">
                    <div className="flex items-start gap-3">
                      <Shield className="w-5 h-5 text-emerald-700 dark:text-emerald-300 shrink-0 mt-0.5" />
                      <div className="text-sm text-emerald-800 dark:text-emerald-200">
                        <p className="font-medium mb-1">Secure Token Storage</p>
                        <p>
                          Paste your BoldTrail or kvCORE API token, test it, and save it securely on
                          the backend before FLYR starts syncing leads.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 text-sm text-gray-600 dark:text-gray-300 space-y-1">
                    <p>1. Generate an API token in BoldTrail or kvCORE</p>
                    <p>2. Paste it into FLYR and test the connection</p>
                    <p>3. Save the token once validation succeeds</p>
                    <p>4. FLYR syncs contacts from the CRM sync workflow</p>
                  </div>

                  <Button
                    onClick={handleOpenBoldTrailDialog}
                    className="w-full gap-2"
                  >
                    <KeyRound className="w-4 h-4" />
                    Connect BoldTrail
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-yellow-100 dark:bg-yellow-900 rounded-lg flex items-center justify-center">
                    <LayoutGrid className="w-5 h-5 text-yellow-700 dark:text-yellow-300" />
                  </div>
                  <div>
                    <CardTitle>Monday.com</CardTitle>
                    <CardDescription>
                      Connect a monday account, choose one board, and sync FLYR leads into board items
                    </CardDescription>
                  </div>
                </div>
                {mondayStatus?.connected ? (
                  <Badge className={`gap-1 ${mondayStatus.needsBoardSelection ? 'bg-amber-500 hover:bg-amber-600' : 'bg-green-500 hover:bg-green-600'}`}>
                    <CheckCircle2 className="w-3 h-3" />
                    {mondayStatus.needsBoardSelection ? 'Board Required' : 'Connected'}
                  </Badge>
                ) : (
                  <Badge variant="outline">Not Connected</Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {mondayStatus?.connected ? (
                <div className="space-y-4">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between py-3 border-b border-gray-200 dark:border-gray-700">
                      <div>
                        <p className="text-sm font-medium dark:text-white">Account</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {mondayStatus.accountName || 'Connected monday account'}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between py-3 border-b border-gray-200 dark:border-gray-700">
                      <div>
                        <p className="text-sm font-medium dark:text-white">Selected Board</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {mondayStatus.selectedBoardName || 'No board selected yet'}
                        </p>
                      </div>
                    </div>

                    {mondayStatus.updatedAt && (
                      <div className="flex items-center justify-between py-3 border-b border-gray-200 dark:border-gray-700">
                        <div>
                          <p className="text-sm font-medium dark:text-white">Last Updated</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            {new Date(mondayStatus.updatedAt).toLocaleString()}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <Button
                      variant="outline"
                      onClick={handleLoadMondayBoards}
                      disabled={isLoadingMondayBoards || isSavingMondayBoard}
                      className="gap-2"
                    >
                      <LayoutGrid className={`w-4 h-4 ${isLoadingMondayBoards ? 'animate-pulse' : ''}`} />
                      {isLoadingMondayBoards
                        ? 'Loading Boards...'
                        : mondayStatus.selectedBoardId
                          ? 'Change Board'
                          : 'Select Board'}
                    </Button>

                    <Button
                      variant="destructive"
                      onClick={handleDisconnectMonday}
                      disabled={isDisconnectingMonday}
                      className="gap-2"
                    >
                      <XCircle className="w-4 h-4" />
                      {isDisconnectingMonday ? 'Disconnecting...' : 'Disconnect'}
                    </Button>
                  </div>

                  {showMondayBoards && (
                    <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-3">
                      <div className="text-sm font-medium dark:text-white">Choose a board for FLYR sync</div>
                      {mondayBoards.length === 0 ? (
                        <p className="text-sm text-gray-500 dark:text-gray-400">No boards available.</p>
                      ) : (
                        <div className="space-y-2">
                          {mondayBoards.map((board) => (
                            <button
                              key={board.id}
                              type="button"
                              onClick={() => handleSelectMondayBoard(board.id)}
                              disabled={isSavingMondayBoard}
                              className="w-full rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-900 disabled:opacity-60"
                            >
                              <div className="font-medium dark:text-white">{board.name}</div>
                              {board.workspaceName && (
                                <div className="text-xs text-gray-500 dark:text-gray-400">{board.workspaceName}</div>
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
                    <div className="flex items-start gap-3">
                      <Shield className="w-5 h-5 text-yellow-700 dark:text-yellow-300 shrink-0 mt-0.5" />
                      <div className="text-sm text-yellow-700 dark:text-yellow-300">
                        <p className="font-medium mb-1">OAuth + Board Selection</p>
                        <p>
                          Connect your monday account, then choose one board for FLYR lead sync. Notes,
                          follow-ups, and appointments stay on the same item for this MVP.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 text-sm text-gray-600 dark:text-gray-300 space-y-1">
                    <p>1. Click Connect Monday.com</p>
                    <p>2. Sign in to monday and approve access</p>
                    <p>3. Pick a board for FLYR sync</p>
                    <p>4. FLYR creates or updates one item per lead</p>
                  </div>

                  <Button
                    onClick={handleStartMondayOAuth}
                    disabled={isStartingMondayOAuth}
                    className="w-full gap-2"
                  >
                    <LayoutGrid className="w-4 h-4" />
                    {isStartingMondayOAuth ? 'Redirecting...' : 'Connect Monday.com'}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Future integrations placeholder */}
          <Card className="opacity-60">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gray-100 dark:bg-gray-800 rounded-lg flex items-center justify-center">
                    <Plug className="w-5 h-5 text-gray-400" />
                  </div>
                  <div>
                    <CardTitle className="text-gray-500">More Integrations</CardTitle>
                    <CardDescription>
                      Additional CRM integrations coming soon
                    </CardDescription>
                  </div>
                </div>
                <Badge variant="outline">Coming Soon</Badge>
              </div>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-slate-100 dark:bg-slate-900 rounded-lg flex items-center justify-center">
                  <Send className="w-5 h-5 text-slate-700 dark:text-slate-300" />
                </div>
                <div>
                  <CardTitle>Test Lead</CardTitle>
                  <CardDescription>
                    Send a sample lead to your connected CRM integrations to verify everything is working
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 text-sm text-gray-600 dark:text-gray-300">
                The test lead will go to every connected CRM for this workspace, including BoldTrail, Follow Up Boss, HubSpot, Zapier, and Monday.com when available.
              </div>

              <Button
                onClick={handleSendBottomTestLead}
                disabled={isSendingBottomTestLead}
                className="w-full gap-2"
              >
                <Send className={`w-4 h-4 ${isSendingBottomTestLead ? 'animate-pulse' : ''}`} />
                {isSendingBottomTestLead ? 'Sending Test Lead...' : 'Send Test Lead'}
              </Button>
            </CardContent>
          </Card>
        </div>
      </main>

      <Dialog
        open={showZapierDialog}
        onOpenChange={(open) => {
          setShowZapierDialog(open);
          if (!open) {
            setZapierDialogMessage(null);
            setZapierWebhookUrl('');
            setShowZapierWebhookUrl(false);
            setLastZapierTestedWebhookUrl(null);
            setLastZapierTestSucceeded(false);
          }
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Zapier</DialogTitle>
            <DialogDescription>
              Paste your Zapier Catch Hook URL, send a live sample payload, then save it for secure outbound lead delivery.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {hasStoredZapierWebhook && (
              <div className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-800 dark:border-orange-900 dark:bg-orange-950/30 dark:text-orange-200">
                A Zapier webhook is already saved for this workspace.
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="zapier-webhook-url">Catch Hook URL</Label>
              <div className="flex gap-2">
                <Input
                  id="zapier-webhook-url"
                  type={showZapierWebhookUrl ? 'text' : 'password'}
                  value={zapierWebhookUrl}
                  onChange={(event) => setZapierWebhookUrl(event.target.value)}
                  placeholder="https://hooks.zapier.com/hooks/catch/..."
                  autoComplete="off"
                  disabled={isTestingZapier || isSavingZapier || isDisconnectingZapier}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowZapierWebhookUrl((value) => !value)}
                  disabled={isTestingZapier || isSavingZapier || isDisconnectingZapier}
                >
                  {showZapierWebhookUrl ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handlePasteZapierWebhookUrl}
                  disabled={isTestingZapier || isSavingZapier || isDisconnectingZapier}
                  className="gap-2"
                >
                  <Clipboard className="w-4 h-4" />
                  Paste
                </Button>
              </div>
            </div>

            <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 text-sm text-gray-600 dark:text-gray-300 space-y-1">
              <p className="font-medium text-gray-900 dark:text-white">MVP sync scope</p>
              <p>1. Secure storage of one Zapier Catch Hook per workspace</p>
              <p>2. One-way FLYR to Zapier lead delivery</p>
              <p>3. Test payloads fire your Zap immediately, so use a safe test step in Zapier</p>
            </div>

            {zapierDialogMessage && (
              <div className={`rounded-lg border px-3 py-2 text-sm ${
                zapierDialogMessage.type === 'success'
                  ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950/30 dark:text-green-300'
                  : 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300'
              }`}>
                {zapierDialogMessage.text}
              </div>
            )}

            <p className="text-xs text-gray-500 dark:text-gray-400">
              The raw webhook URL never comes back to the client after you save it.
            </p>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowZapierDialog(false)}
              disabled={isTestingZapier || isSavingZapier || isDisconnectingZapier}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleTestZapier}
              disabled={isTestingZapier || isSavingZapier || isDisconnectingZapier || (!trimmedZapierWebhookUrl && !hasStoredZapierWebhook)}
              className="gap-2"
            >
              <RefreshCw className={`w-4 h-4 ${isTestingZapier ? 'animate-spin' : ''}`} />
              {isTestingZapier ? 'Testing...' : trimmedZapierWebhookUrl ? 'Send Test Payload' : 'Test Saved Webhook'}
            </Button>
            <Button
              type="button"
              onClick={handleSaveZapier}
              disabled={!canSaveZapier || isTestingZapier || isSavingZapier || isDisconnectingZapier}
              className="gap-2"
            >
              <Send className="w-4 h-4" />
              {isSavingZapier ? 'Saving...' : hasStoredZapierWebhook ? 'Save Replacement Webhook' : 'Save'}
            </Button>
          </DialogFooter>

          {hasStoredZapierWebhook && (
            <Button
              type="button"
              variant="destructive"
              onClick={handleDisconnectZapier}
              disabled={isTestingZapier || isSavingZapier || isDisconnectingZapier}
              className="w-full gap-2"
            >
              <XCircle className="w-4 h-4" />
              {isDisconnectingZapier ? 'Disconnecting...' : 'Disconnect Zapier'}
            </Button>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={showBoldTrailDialog}
        onOpenChange={(open) => {
          setShowBoldTrailDialog(open);
          if (!open) {
            setBoldTrailDialogMessage(null);
            setBoldTrailToken('');
            setShowBoldTrailToken(false);
            setLastBoldTrailTestedToken(null);
            setLastBoldTrailTestSucceeded(false);
          }
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>BoldTrail / kvCORE</DialogTitle>
            <DialogDescription>
              Generate your API token in BoldTrail or kvCORE, test it here, then save it for secure outbound lead sync.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {hasStoredBoldTrailToken && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
                A BoldTrail token is already saved for this workspace.
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="boldtrail-token">API Token</Label>
              <div className="flex gap-2">
                <Input
                  id="boldtrail-token"
                  type={showBoldTrailToken ? 'text' : 'password'}
                  value={boldTrailToken}
                  onChange={(event) => setBoldTrailToken(event.target.value)}
                  placeholder="Paste your BoldTrail API token"
                  autoComplete="off"
                  disabled={isTestingBoldTrail || isSavingBoldTrail || isDisconnectingBoldTrail}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowBoldTrailToken((value) => !value)}
                  disabled={isTestingBoldTrail || isSavingBoldTrail || isDisconnectingBoldTrail}
                >
                  {showBoldTrailToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handlePasteBoldTrailToken}
                  disabled={isTestingBoldTrail || isSavingBoldTrail || isDisconnectingBoldTrail}
                  className="gap-2"
                >
                  <Clipboard className="w-4 h-4" />
                  Paste
                </Button>
              </div>
            </div>

            <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 text-sm text-gray-600 dark:text-gray-300 space-y-1">
              <p className="font-medium text-gray-900 dark:text-white">MVP sync scope</p>
              <p>1. Secure token validation and backend storage</p>
              <p>2. One-way FLYR to BoldTrail contact sync</p>
              <p>3. Stored remote contact IDs for later updates</p>
            </div>

            {boldTrailDialogMessage && (
              <div className={`rounded-lg border px-3 py-2 text-sm ${
                boldTrailDialogMessage.type === 'success'
                  ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950/30 dark:text-green-300'
                  : 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300'
              }`}>
                {boldTrailDialogMessage.text}
              </div>
            )}

            <p className="text-xs text-gray-500 dark:text-gray-400">
              The raw token never comes back to the client after you save it.
            </p>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowBoldTrailDialog(false)}
              disabled={isTestingBoldTrail || isSavingBoldTrail || isDisconnectingBoldTrail}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleTestBoldTrail}
              disabled={isTestingBoldTrail || isSavingBoldTrail || isDisconnectingBoldTrail || (!trimmedBoldTrailToken && !hasStoredBoldTrailToken)}
              className="gap-2"
            >
              <RefreshCw className={`w-4 h-4 ${isTestingBoldTrail ? 'animate-spin' : ''}`} />
              {isTestingBoldTrail ? 'Testing...' : trimmedBoldTrailToken ? 'Test Connection' : 'Test Saved Token'}
            </Button>
            <Button
              type="button"
              onClick={handleSaveBoldTrail}
              disabled={!canSaveBoldTrail || isTestingBoldTrail || isSavingBoldTrail || isDisconnectingBoldTrail}
              className="gap-2"
            >
              <KeyRound className="w-4 h-4" />
              {isSavingBoldTrail ? 'Saving...' : hasStoredBoldTrailToken ? 'Save Replacement Token' : 'Save'}
            </Button>
          </DialogFooter>

          {hasStoredBoldTrailToken && (
            <Button
              type="button"
              variant="destructive"
              onClick={handleDisconnectBoldTrail}
              disabled={isTestingBoldTrail || isSavingBoldTrail || isDisconnectingBoldTrail}
              className="w-full gap-2"
            >
              <XCircle className="w-4 h-4" />
              {isDisconnectingBoldTrail ? 'Disconnecting...' : 'Disconnect BoldTrail'}
            </Button>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
