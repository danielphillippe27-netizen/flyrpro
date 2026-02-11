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
  ExternalLink,
  Shield,
  AlertCircle,
  Send
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';

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
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [apiKey, setApiKey] = useState('');
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isTestPushing, setIsTestPushing] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      const supabase = createClient();
      
      // Get user
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (authUser) {
        setUser(authUser);
        // Load connection status
        await loadConnectionStatus();
      } else {
        router.push('/login');
      }
      
      setLoading(false);
    };

    loadData();
  }, [router]);

  const loadConnectionStatus = async () => {
    try {
      const response = await fetch('/api/integrations/followupboss/status');
      if (response.ok) {
        const data = await response.json();
        setConnectionStatus(data);
      }
    } catch (error) {
      console.error('Error loading connection status:', error);
    }
  };

  const handleConnect = async () => {
    if (!apiKey.trim()) {
      setMessage({ type: 'error', text: 'Please enter an API key' });
      return;
    }

    setIsConnecting(true);
    setMessage(null);

    try {
      const response = await fetch('/api/integrations/followupboss/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      });

      const data = await response.json();

      if (response.ok) {
        setMessage({ type: 'success', text: data.message });
        setApiKey('');
        await loadConnectionStatus();
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to connect' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Network error. Please try again.' });
    } finally {
      setIsConnecting(false);
    }
  };

  const handleTest = async () => {
    setIsTesting(true);
    setMessage(null);

    try {
      const response = await fetch('/api/integrations/followupboss/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      const data = await response.json();

      if (response.ok) {
        setMessage({ type: 'success', text: data.message });
        await loadConnectionStatus();
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
      });

      const data = await response.json();

      if (response.ok) {
        setMessage({ 
          type: 'success', 
          text: `${data.message} Test lead: ${data.testLead.name} (${data.testLead.email})` 
        });
        await loadConnectionStatus();
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
        <div className="max-w-4xl px-4 sm:px-6 lg:px-8 py-4">
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
      
      <main className="max-w-4xl px-4 sm:px-6 lg:px-8 py-6">
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
                          Your API key is encrypted and stored securely. We only use it to send 
                          leads to your Follow Up Boss account.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="api-key">Follow Up Boss API Key</Label>
                    <div className="flex gap-2">
                      <Input
                        id="api-key"
                        type={showApiKey ? 'text' : 'password'}
                        placeholder="Enter your API key..."
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        className="flex-1"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setShowApiKey(!showApiKey)}
                      >
                        {showApiKey ? 'Hide' : 'Show'}
                      </Button>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      You can find your API key in Follow Up Boss under Admin → API
                    </p>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Switch
                        id="show-key"
                        checked={showApiKey}
                        onCheckedChange={setShowApiKey}
                      />
                      <Label htmlFor="show-key" className="text-sm cursor-pointer">
                        Show API key
                      </Label>
                    </div>
                    
                    <a
                      href="https://developer.followupboss.com/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                    >
                      Get API key
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>

                  <Button
                    onClick={handleConnect}
                    disabled={isConnecting || !apiKey.trim()}
                    className="w-full gap-2"
                  >
                    <Plug className="w-4 h-4" />
                    {isConnecting ? 'Connecting...' : 'Connect Follow Up Boss'}
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
