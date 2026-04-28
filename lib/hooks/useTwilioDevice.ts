'use client';

import { useEffect, useRef, useState } from 'react';

type VoiceConnectionLike = {
  disconnect: () => void;
  mute: (shouldMute?: boolean) => void;
  isMuted?: () => boolean;
};

type VoiceDeviceLike = {
  connect: (options: { params: Record<string, string> }) => Promise<VoiceConnectionLike>;
  updateToken: (token: string) => Promise<void>;
  on: (eventName: string, listener: (...args: unknown[]) => void) => void;
  disconnectAll?: () => void;
  destroy?: () => void;
};

type DeviceSetupState = 'idle' | 'initializing' | 'ready' | 'error';
type CallPhase = 'idle' | 'connecting' | 'connected' | 'ended';

type TokenResponse = {
  token: string;
  identity: string;
  expiresAt: string;
  fromNumber: string;
  smsFromNumber: string | null;
  allowSmsFollowup: boolean;
};

export function useTwilioDevice() {
  const deviceRef = useRef<VoiceDeviceLike | null>(null);
  const connectionRef = useRef<VoiceConnectionLike | null>(null);
  const workspaceIdRef = useRef<string | null>(null);
  const tabIdRef = useRef<string | null>(null);
  const hangUpRequestedRef = useRef(false);

  const [setupState, setSetupState] = useState<DeviceSetupState>('idle');
  const [callPhase, setCallPhase] = useState<CallPhase>('idle');
  const [isMuted, setIsMuted] = useState(false);
  const [microphoneGranted, setMicrophoneGranted] = useState(false);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [tokenExpiresAt, setTokenExpiresAt] = useState<string | null>(null);
  const [endedCount, setEndedCount] = useState(0);
  const [fromNumber, setFromNumber] = useState<string | null>(null);
  const [smsFromNumber, setSmsFromNumber] = useState<string | null>(null);
  const [allowSmsFollowup, setAllowSmsFollowup] = useState(false);

  const destroyDevice = () => {
    connectionRef.current = null;
    try {
      deviceRef.current?.destroy?.();
    } catch (error) {
      console.warn('[dialer/device] failed to destroy Twilio device', error);
    }
    deviceRef.current = null;
    setCallPhase('idle');
    setIsMuted(false);
  };

  useEffect(() => {
    return () => {
      destroyDevice();
    };
  }, []);

  const fetchToken = async (workspaceId: string, tabId: string): Promise<TokenResponse> => {
    const response = await fetch(
      `/api/dialer/token?workspaceId=${encodeURIComponent(workspaceId)}&tabId=${encodeURIComponent(tabId)}`,
      { credentials: 'include' }
    );
    const data = (await response.json().catch(() => ({}))) as Partial<TokenResponse> & { error?: string };
    if (!response.ok || !data.token || !data.expiresAt) {
      throw new Error(data.error || 'Failed to fetch a Twilio browser token');
    }
    return data as TokenResponse;
  };

  const initialize = async (workspaceId: string, tabId: string) => {
    setSetupState('initializing');
    setDeviceError(null);

    if (typeof window === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setSetupState('error');
      setDeviceError('This browser does not support microphone access for web calling.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      setMicrophoneGranted(true);

      workspaceIdRef.current = workspaceId;
      tabIdRef.current = tabId;
      destroyDevice();

      const tokenData = await fetchToken(workspaceId, tabId);
      const sdk = await import('@twilio/voice-sdk');
      const DeviceCtor = sdk.Device as unknown as new (token: string, options?: Record<string, unknown>) => VoiceDeviceLike;
      const device = new DeviceCtor(tokenData.token, {
        codecPreferences: ['opus', 'pcmu'],
      });

      device.on('error', (error) => {
        const message =
          typeof error === 'object' &&
          error &&
          'message' in error &&
          typeof error.message === 'string'
            ? error.message
            : 'A Twilio device error occurred.';
        setDeviceError(message);
        if (callPhase !== 'connected') {
          setSetupState('error');
        }
      });

      device.on('connect', (connection) => {
        connectionRef.current = (connection as VoiceConnectionLike) ?? connectionRef.current;
        setCallPhase('connected');
        setIsMuted(Boolean(connectionRef.current?.isMuted?.()));
      });

      device.on('disconnect', () => {
        connectionRef.current = null;
        setCallPhase('ended');
        setIsMuted(false);
        setEndedCount((count) => count + 1);
      });

      device.on('cancel', () => {
        connectionRef.current = null;
        setCallPhase('ended');
        setEndedCount((count) => count + 1);
      });

      device.on('tokenWillExpire', async () => {
        if (!workspaceIdRef.current || !tabIdRef.current) return;
        try {
          const refreshed = await fetchToken(workspaceIdRef.current, tabIdRef.current);
          await device.updateToken(refreshed.token);
          setTokenExpiresAt(refreshed.expiresAt);
          setFromNumber(refreshed.fromNumber);
          setSmsFromNumber(refreshed.smsFromNumber);
          setAllowSmsFollowup(refreshed.allowSmsFollowup);
        } catch (error) {
          console.error('[dialer/device] failed to refresh browser token', error);
          setDeviceError('Your browser calling token expired. Reinitialize the device to keep dialing.');
          setSetupState('error');
        }
      });

      deviceRef.current = device;
      setTokenExpiresAt(tokenData.expiresAt);
      setFromNumber(tokenData.fromNumber);
      setSmsFromNumber(tokenData.smsFromNumber);
      setAllowSmsFollowup(tokenData.allowSmsFollowup);
      setSetupState('ready');
      setCallPhase('idle');
    } catch (error) {
      console.error('[dialer/device] failed to initialize', error);
      setSetupState('error');
      setDeviceError(error instanceof Error ? error.message : 'Failed to initialize browser calling.');
    }
  };

  const startCall = async (callRequestId: string) => {
    if (!deviceRef.current) {
      throw new Error('Initialize the browser dialer before placing a call.');
    }

    setDeviceError(null);
    setCallPhase('connecting');
    hangUpRequestedRef.current = false;
    const connection = await deviceRef.current.connect({
      params: {
        To: callRequestId,
        callRequestId,
        call_request_id: callRequestId,
      },
    });
    connectionRef.current = connection;
    if (hangUpRequestedRef.current) {
      connection.disconnect();
      connectionRef.current = null;
      setCallPhase('ended');
      setEndedCount((count) => count + 1);
      return;
    }
    setIsMuted(Boolean(connection.isMuted?.()));
  };

  const hangUp = () => {
    hangUpRequestedRef.current = true;
    try {
      connectionRef.current?.disconnect();
      deviceRef.current?.disconnectAll?.();
    } finally {
      connectionRef.current = null;
      setCallPhase('ended');
      setIsMuted(false);
      setEndedCount((count) => count + 1);
    }
  };

  const toggleMute = () => {
    if (!connectionRef.current) return;
    const nextMuted = !Boolean(connectionRef.current.isMuted?.());
    connectionRef.current.mute(nextMuted);
    setIsMuted(nextMuted);
  };

  const resetEndedPhase = () => {
    if (callPhase === 'ended') {
      setCallPhase('idle');
    }
  };

  return {
    setupState,
    callPhase,
    isMuted,
    microphoneGranted,
    deviceError,
    tokenExpiresAt,
    endedCount,
    fromNumber,
    smsFromNumber,
    allowSmsFollowup,
    initialize,
    startCall,
    hangUp,
    toggleMute,
    resetEndedPhase,
    isReady: setupState === 'ready',
    isConnecting: callPhase === 'connecting',
    isInCall: callPhase === 'connecting' || callPhase === 'connected',
  };
}
