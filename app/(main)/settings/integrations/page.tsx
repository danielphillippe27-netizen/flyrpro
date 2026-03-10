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
  Send
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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

export default function IntegrationsPage() {
  const router = useRouter();
  const { currentWorkspaceId } = useWorkspace();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus | null>(null);
  const [isStartingOAuth, setIsStartingOAuth] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isTestPushing, setIsTestPushing] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    const loadData = async () => {
      const supabase = createClient();
      
      // Get user
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (authUser) {
        setUser(authUser);
        await loadConnectionStatus(currentWorkspaceId ?? undefined);
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
    const callbackMessage = params.get('message');
    if (fub === 'connected') {
      setMessage({ type: 'success', text: callbackMessage || 'Follow Up Boss connected successfully.' });
      window.history.replaceState({}, '', '/settings/integrations');
      loadConnectionStatus(currentWorkspaceId ?? undefined);
    } else if (fub === 'error') {
      setMessage({ type: 'error', text: callbackMessage || 'Follow Up Boss OAuth connection failed.' });
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
    } catch (error) {
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
    } catch (error) {
      setMessage({ type: 'error', text: 'Network error. Please try again.' });
    } finally {
      setIsTesting(false);
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
    } catch (error) {
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
    } catch (error) {
      setMessage({ type: 'error', text: 'Network error. Please try again.' });
    } finally {
      setIsDisconnecting(false);
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
        </div>
      </main>
    </div>
  );
}
