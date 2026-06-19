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
  audio?: {
    availableInputDevices?: Map<string, MediaDeviceInfo>;
    inputDevice?: MediaDeviceInfo | null;
    setInputDevice?: (deviceId: string) => Promise<void>;
    on?: (eventName: 'deviceChange', listener: (lostActiveDevices: MediaDeviceInfo[]) => void) => void;
  };
  disconnectAll?: () => void;
  destroy?: () => void;
};

type DeviceSetupState = 'idle' | 'initializing' | 'ready' | 'error';
type CallPhase = 'idle' | 'connecting' | 'connected' | 'ended';
type MicrophoneSelectionSource = 'stored' | 'preferred' | 'current' | 'default' | 'first';

type SelectedMicrophone = {
  deviceId: string;
  label: string;
  source: MicrophoneSelectionSource;
  browserTrackDeviceId: string | null;
};

type TokenResponse = {
  token: string;
  identity: string;
  expiresAt: string;
  fromNumber: string;
  smsFromNumber: string | null;
  allowSmsFollowup: boolean;
};

const MICROPHONE_DEVICE_STORAGE_KEY = 'flyr.dialer.microphoneDeviceId';
const PREFERRED_MICROPHONE_LABELS = ['logitech zone 300', 'zone 300'];

function formatMediaDevice(device: MediaDeviceInfo) {
  return {
    deviceId: device.deviceId,
    groupId: device.groupId,
    kind: device.kind,
    label: device.label || '(unlabeled device)',
  };
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function stopMediaStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

function getTwilioErrorDetails(error: unknown) {
  if (!error || typeof error !== 'object') return error;
  const record = error as Record<string, unknown>;
  return {
    code: record.code,
    causes: record.causes,
    description: record.description,
    explanation: record.explanation,
    message: record.message,
    name: record.name,
    originalError: record.originalError,
    solutions: record.solutions,
  };
}

function getStoredMicrophoneDeviceId() {
  try {
    return window.localStorage.getItem(MICROPHONE_DEVICE_STORAGE_KEY)?.trim() || null;
  } catch {
    return null;
  }
}

function chooseMicrophone(
  audioInputs: MediaDeviceInfo[],
  browserTrackDeviceId: string | null
): SelectedMicrophone | null {
  if (audioInputs.length === 0) return null;

  const storedDeviceId = getStoredMicrophoneDeviceId();
  if (storedDeviceId) {
    const storedDevice = audioInputs.find((device) => device.deviceId === storedDeviceId);
    if (storedDevice) {
      return {
        deviceId: storedDevice.deviceId,
        label: storedDevice.label || 'Stored microphone',
        source: 'stored',
        browserTrackDeviceId,
      };
    }
  }

  const preferredDevice = audioInputs.find((device) => {
    const label = device.label.toLowerCase();
    return PREFERRED_MICROPHONE_LABELS.some((preferredLabel) => label.includes(preferredLabel));
  });
  if (preferredDevice) {
    return {
      deviceId: preferredDevice.deviceId,
      label: preferredDevice.label || 'Preferred microphone',
      source: 'preferred',
      browserTrackDeviceId,
    };
  }

  if (browserTrackDeviceId) {
    const currentDevice = audioInputs.find((device) => device.deviceId === browserTrackDeviceId);
    if (currentDevice) {
      return {
        deviceId: currentDevice.deviceId,
        label: currentDevice.label || 'Current browser microphone',
        source: 'current',
        browserTrackDeviceId,
      };
    }
  }

  const defaultDevice = audioInputs.find((device) => device.deviceId === 'default');
  const fallbackDevice = defaultDevice ?? audioInputs[0];

  return {
    deviceId: fallbackDevice.deviceId,
    label: fallbackDevice.label || (defaultDevice ? 'Default microphone' : 'First available microphone'),
    source: defaultDevice ? 'default' : 'first',
    browserTrackDeviceId,
  };
}

function getTwilioInputDevices(device: VoiceDeviceLike) {
  return Array.from(device.audio?.availableInputDevices?.values() ?? []);
}

function findTwilioInputDevice(device: VoiceDeviceLike, microphone: SelectedMicrophone) {
  const twilioInputDevices = getTwilioInputDevices(device);
  const exactDevice = twilioInputDevices.find((inputDevice) => inputDevice.deviceId === microphone.deviceId);
  if (exactDevice) return exactDevice;

  const microphoneLabel = microphone.label.toLowerCase();
  const labelMatchedDevice = twilioInputDevices.find((inputDevice) => {
    const label = inputDevice.label.toLowerCase();
    return label && (label === microphoneLabel || label.includes(microphoneLabel) || microphoneLabel.includes(label));
  });
  if (labelMatchedDevice) return labelMatchedDevice;

  return null;
}

export function useTwilioDevice() {
  const deviceRef = useRef<VoiceDeviceLike | null>(null);
  const connectionRef = useRef<VoiceConnectionLike | null>(null);
  const selectedInputStreamRef = useRef<MediaStream | null>(null);
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
  const [selectedMicrophone, setSelectedMicrophone] = useState<SelectedMicrophone | null>(null);

  const destroyDevice = () => {
    connectionRef.current = null;
    try {
      deviceRef.current?.destroy?.();
    } catch (error) {
      console.warn('[dialer/device] failed to destroy Twilio device', error);
    }
    deviceRef.current = null;
    stopMediaStream(selectedInputStreamRef.current);
    selectedInputStreamRef.current = null;
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
    setSelectedMicrophone(null);

    if (typeof window === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setSetupState('error');
      setDeviceError('This browser does not support microphone access for web calling.');
      return;
    }

    try {
      const permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const browserAudioTrack = permissionStream.getAudioTracks()[0] ?? null;
      const browserTrackSettings = browserAudioTrack?.getSettings();
      const browserTrackDeviceId =
        typeof browserTrackSettings?.deviceId === 'string' ? browserTrackSettings.deviceId : null;
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter((device) => device.kind === 'audioinput');
      const microphone = chooseMicrophone(audioInputs, browserTrackDeviceId);
      let selectedInputStream: MediaStream | null = null;

      console.info('[dialer/device] browser microphone permission granted', {
        browserTrack: browserAudioTrack
          ? {
              id: browserAudioTrack.id,
              label: browserAudioTrack.label || '(unlabeled track)',
              muted: browserAudioTrack.muted,
              readyState: browserAudioTrack.readyState,
              settings: browserTrackSettings,
            }
          : null,
        audioInputs: audioInputs.map(formatMediaDevice),
        selectedMicrophone: microphone,
      });

      if (microphone?.deviceId) {
        try {
          selectedInputStream =
            microphone.deviceId === browserTrackDeviceId
              ? permissionStream
              : await navigator.mediaDevices.getUserMedia({
                  audio: {
                    deviceId: { exact: microphone.deviceId },
                  },
                });
        } catch (error) {
          stopMediaStream(permissionStream);
          console.error('[dialer/device] failed to open selected microphone stream', {
            error: getTwilioErrorDetails(error),
            selectedMicrophone: microphone,
          });
          throw new Error(`Failed to open microphone "${microphone.label}" for browser calling: ${getErrorMessage(error, 'Unknown getUserMedia error')}`);
        }
      }

      if (selectedInputStream !== permissionStream) {
        stopMediaStream(permissionStream);
      }

      const selectedInputTrack = selectedInputStream?.getAudioTracks()[0] ?? null;
      console.info('[dialer/device] selected microphone stream opened', {
        selectedMicrophone: microphone,
        selectedTrack: selectedInputTrack
          ? {
              id: selectedInputTrack.id,
              label: selectedInputTrack.label || '(unlabeled track)',
              muted: selectedInputTrack.muted,
              readyState: selectedInputTrack.readyState,
              settings: selectedInputTrack.getSettings(),
            }
          : null,
      });

      setMicrophoneGranted(true);
      setSelectedMicrophone(microphone);

      workspaceIdRef.current = workspaceId;
      tabIdRef.current = tabId;
      destroyDevice();
      selectedInputStreamRef.current = selectedInputStream;

      const tokenData = await fetchToken(workspaceId, tabId);
      const sdk = await import('@twilio/voice-sdk');
      const DeviceCtor = sdk.Device as unknown as new (token: string, options?: Record<string, unknown>) => VoiceDeviceLike;
      const device = new DeviceCtor(tokenData.token, {
        codecPreferences: ['opus', 'pcmu'],
        ...(selectedInputStream
          ? {
              fileInputStream: selectedInputStream,
            }
          : {}),
      });

      if (microphone?.deviceId && device.audio?.setInputDevice) {
        const twilioInputDevice = findTwilioInputDevice(device, microphone);
        if (twilioInputDevice) {
          try {
            await device.audio.setInputDevice(twilioInputDevice.deviceId);
            console.info('[dialer/device] Twilio input device selected', {
              requestedMicrophone: microphone,
              twilioInputDevice: formatMediaDevice(twilioInputDevice),
              activeInputDevice: device.audio.inputDevice ? formatMediaDevice(device.audio.inputDevice) : null,
              availableInputDevices: getTwilioInputDevices(device).map(formatMediaDevice),
            });
          } catch (error) {
            console.warn('[dialer/device] Twilio setInputDevice failed; keeping selected input stream fallback', {
              error: getTwilioErrorDetails(error),
              requestedMicrophone: microphone,
              twilioInputDevice: formatMediaDevice(twilioInputDevice),
              availableInputDevices: getTwilioInputDevices(device).map(formatMediaDevice),
            });
          }
        } else {
          console.warn('[dialer/device] selected browser microphone was not present in Twilio input device list; keeping selected input stream fallback', {
            requestedMicrophone: microphone,
            availableInputDevices: getTwilioInputDevices(device).map(formatMediaDevice),
          });
        }
      } else {
        console.warn('[dialer/device] Twilio input device selection is unavailable', {
          selectedMicrophone: microphone,
          hasAudioHelper: Boolean(device.audio),
        });
      }

      device.on('error', (error) => {
        const message =
          typeof error === 'object' &&
          error &&
          'message' in error &&
          typeof error.message === 'string'
            ? error.message
            : 'A Twilio device error occurred.';
        console.error('[dialer/device] Twilio device error', getTwilioErrorDetails(error));
        setDeviceError(message);
        if (callPhase !== 'connected') {
          setSetupState('error');
        }
      });

      device.audio?.on?.('deviceChange', (lostActiveDevices) => {
        const activeInputDevice = device.audio?.inputDevice ?? null;
        console.info('[dialer/device] Twilio audio devices changed', {
          activeInputDevice: activeInputDevice ? formatMediaDevice(activeInputDevice) : null,
          lostActiveDevices: lostActiveDevices.map(formatMediaDevice),
          availableInputDevices: getTwilioInputDevices(device).map(formatMediaDevice),
        });
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
      stopMediaStream(selectedInputStreamRef.current);
      selectedInputStreamRef.current = null;
      setSetupState('error');
      setDeviceError(getErrorMessage(error, 'Failed to initialize browser calling.'));
    }
  };

  const startCall = async (callRequestId: string) => {
    if (!deviceRef.current) {
      throw new Error('Initialize the browser dialer before placing a call.');
    }

    setDeviceError(null);
    setCallPhase('connecting');
    hangUpRequestedRef.current = false;
    let connection: VoiceConnectionLike;
    try {
      console.info('[dialer/device] starting Twilio call', {
        callRequestId,
        selectedMicrophone,
        activeInputDevice: deviceRef.current.audio?.inputDevice
          ? formatMediaDevice(deviceRef.current.audio.inputDevice)
          : null,
      });
      connection = await deviceRef.current.connect({
        params: {
          To: callRequestId,
          callRequestId,
          call_request_id: callRequestId,
        },
      });
    } catch (error) {
      console.error('[dialer/device] failed to start Twilio call', getTwilioErrorDetails(error));
      setCallPhase('ended');
      setDeviceError(getErrorMessage(error, 'Failed to start browser call.'));
      throw error;
    }
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
    selectedMicrophone,
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
