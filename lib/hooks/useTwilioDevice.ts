'use client';

import { useEffect, useRef, useState } from 'react';

type VoiceConnectionLike = {
  disconnect: () => void;
  getLocalStream?: () => MediaStream | undefined;
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

type TelnyxCallLike = {
  id?: string;
  state?: string;
  direction?: string;
  localStream?: MediaStream;
  remoteStream?: MediaStream;
  options?: {
    callerName?: string;
    callerNumber?: string;
    remoteCallerName?: string;
    remoteCallerNumber?: string;
    destinationNumber?: string;
  };
  telnyxIDs?: {
    telnyxCallControlId?: string;
    telnyxSessionId?: string;
    telnyxLegId?: string;
  };
  answer?: (params?: { video?: boolean }) => Promise<void>;
  hangup: () => Promise<void>;
  muteAudio: () => void;
  unmuteAudio: () => void;
  isAudioMuted?: boolean;
};

type TelnyxClientLike = {
  connect: () => Promise<void> | void;
  disconnect: () => void;
  newCall: (options: {
    destinationNumber: string;
    callerNumber?: string;
    id?: string;
    clientState?: string;
    localStream?: MediaStream;
    remoteElement?: HTMLMediaElement | string;
    audio?: boolean | MediaTrackConstraints;
  }) => TelnyxCallLike;
  on: (eventName: string, listener: (...args: unknown[]) => void) => void;
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

type MicTrackState = 'idle' | 'live' | 'muted' | 'ended' | 'error';

type TokenResponse = {
  provider?: 'twilio' | 'telnyx';
  token: string;
  identity: string;
  expiresAt: string;
  fromNumber: string;
  smsFromNumber: string | null;
  allowSmsFollowup: boolean;
};

type StartCallOptions = {
  toNumber?: string | null;
  fromNumber?: string | null;
};

type IncomingCallInfo = {
  name: string | null;
  number: string | null;
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

function createTelnyxClientState(callRequestId: string) {
  const payload = JSON.stringify({
    callRequestId,
    call_request_id: callRequestId,
    role: 'lead',
    direction: 'outbound',
  });
  return window.btoa(payload);
}

function getTelnyxNotificationCall(notification: unknown): TelnyxCallLike | null {
  if (!notification || typeof notification !== 'object') return null;
  const record = notification as Record<string, unknown>;
  return record.call && typeof record.call === 'object' ? (record.call as TelnyxCallLike) : null;
}

function getTelnyxNotificationType(notification: unknown) {
  if (!notification || typeof notification !== 'object') return null;
  const type = (notification as Record<string, unknown>).type;
  return typeof type === 'string' ? type : null;
}

function getTelnyxNotificationField(notification: unknown, field: 'displayName' | 'displayNumber' | 'displayDirection') {
  if (!notification || typeof notification !== 'object') return null;
  const value = (notification as Record<string, unknown>)[field];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
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

export function useDialerDevice() {
  const deviceRef = useRef<VoiceDeviceLike | null>(null);
  const connectionRef = useRef<VoiceConnectionLike | null>(null);
  const telnyxClientRef = useRef<TelnyxClientLike | null>(null);
  const telnyxCallRef = useRef<TelnyxCallLike | null>(null);
  const telnyxRemoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const telnyxTokenTimerRef = useRef<number | null>(null);
  const selectedInputStreamRef = useRef<MediaStream | null>(null);
  const micMeterRef = useRef<{ audioContext: AudioContext; intervalId: number } | null>(null);
  const workspaceIdRef = useRef<string | null>(null);
  const tabIdRef = useRef<string | null>(null);
  const hangUpRequestedRef = useRef(false);
  const providerRef = useRef<'twilio' | 'telnyx'>('twilio');
  const incomingCallRef = useRef<IncomingCallInfo | null>(null);

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
  const [provider, setProvider] = useState<'twilio' | 'telnyx'>('twilio');
  const [incomingCall, setIncomingCall] = useState<IncomingCallInfo | null>(null);
  const [selectedMicrophone, setSelectedMicrophone] = useState<SelectedMicrophone | null>(null);
  const [micLevel, setMicLevel] = useState(0);
  const [micTrackLabel, setMicTrackLabel] = useState<string | null>(null);
  const [micTrackState, setMicTrackState] = useState<MicTrackState>('idle');

  const updateIncomingCall = (nextIncomingCall: IncomingCallInfo | null) => {
    incomingCallRef.current = nextIncomingCall;
    setIncomingCall(nextIncomingCall);
  };

  const stopMicMeter = () => {
    if (micMeterRef.current) {
      window.clearInterval(micMeterRef.current.intervalId);
      void micMeterRef.current.audioContext.close().catch(() => undefined);
      micMeterRef.current = null;
    }
    setMicLevel(0);
    setMicTrackLabel(null);
    setMicTrackState('idle');
  };

  const startMicMeter = (stream: MediaStream | null, fallbackLabel?: string | null) => {
    stopMicMeter();
    const track = stream?.getAudioTracks()[0] ?? null;
    if (!stream || !track) {
      setMicTrackLabel(fallbackLabel ?? null);
      setMicTrackState(stream ? 'error' : 'idle');
      return;
    }

    try {
      const AudioContextCtor =
        window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) {
        setMicTrackLabel(track.label || fallbackLabel || 'Selected microphone');
        setMicTrackState(track.readyState === 'ended' ? 'ended' : track.muted ? 'muted' : 'live');
        return;
      }

      const audioContext = new AudioContextCtor();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      const data = new Uint8Array(analyser.fftSize);
      source.connect(analyser);
      void audioContext.resume().catch(() => undefined);

      const updateMeter = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const sample of data) {
          const value = (sample - 128) / 128;
          sum += value * value;
        }
        const rms = Math.sqrt(sum / data.length);
        setMicLevel(Math.min(1, rms * 6));
        setMicTrackLabel(track.label || fallbackLabel || 'Selected microphone');
        setMicTrackState(track.readyState === 'ended' ? 'ended' : track.muted ? 'muted' : 'live');
      };

      updateMeter();
      micMeterRef.current = {
        audioContext,
        intervalId: window.setInterval(updateMeter, 200),
      };
    } catch (error) {
      console.warn('[dialer/device] failed to start microphone meter', error);
      setMicLevel(0);
      setMicTrackLabel(track.label || fallbackLabel || 'Selected microphone');
      setMicTrackState('error');
    }
  };

  const clearTelnyxTokenTimer = () => {
    if (telnyxTokenTimerRef.current) {
      window.clearTimeout(telnyxTokenTimerRef.current);
      telnyxTokenTimerRef.current = null;
    }
  };

  const getTelnyxRemoteAudioElement = () => {
    if (typeof document === 'undefined') return null;
    if (telnyxRemoteAudioRef.current) return telnyxRemoteAudioRef.current;

    const audio = document.createElement('audio');
    audio.id = 'flyr-telnyx-remote-audio';
    audio.autoplay = true;
    (audio as HTMLAudioElement & { playsInline?: boolean }).playsInline = true;
    audio.style.display = 'none';
    document.body.appendChild(audio);
    telnyxRemoteAudioRef.current = audio;
    return audio;
  };

  const playTelnyxRemoteAudio = () => {
    const audio = telnyxRemoteAudioRef.current;
    if (!audio) return;
    void audio.play().catch((error) => {
      console.warn('[dialer/device] Telnyx remote audio autoplay was blocked', error);
    });
  };

  const scheduleTelnyxTokenRefresh = (expiresAt: string, workspaceId: string, tabId: string) => {
    clearTelnyxTokenTimer();
    const expiresAtMs = Date.parse(expiresAt);
    if (!Number.isFinite(expiresAtMs)) return;

    const refreshInMs = Math.max(30_000, expiresAtMs - Date.now() - 5 * 60_000);
    telnyxTokenTimerRef.current = window.setTimeout(() => {
      if (providerRef.current !== 'telnyx') return;
      if (telnyxCallRef.current || incomingCallRef.current) {
        setDeviceError('Telnyx browser token is nearing expiry. Finish this call, then reinitialize the softphone.');
        return;
      }
      void initialize(workspaceId, tabId);
    }, refreshInMs);
  };

  const destroyDevice = () => {
    connectionRef.current = null;
    telnyxCallRef.current = null;
    updateIncomingCall(null);
    clearTelnyxTokenTimer();
    try {
      deviceRef.current?.destroy?.();
    } catch (error) {
      console.warn('[dialer/device] failed to destroy Twilio device', error);
    }
    deviceRef.current = null;
    try {
      telnyxClientRef.current?.disconnect();
    } catch (error) {
      console.warn('[dialer/device] failed to disconnect Telnyx client', error);
    }
    telnyxClientRef.current = null;
    telnyxRemoteAudioRef.current?.remove();
    telnyxRemoteAudioRef.current = null;
    stopMicMeter();
    stopMediaStream(selectedInputStreamRef.current);
    selectedInputStreamRef.current = null;
    setCallPhase('idle');
    setIsMuted(false);
  };

  useEffect(() => {
    return () => {
      destroyDevice();
    };
    // Device instances live in refs; cleanup should run only on unmount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchToken = async (workspaceId: string, tabId: string): Promise<TokenResponse> => {
    const response = await fetch(
      `/api/dialer/token?workspaceId=${encodeURIComponent(workspaceId)}&tabId=${encodeURIComponent(tabId)}`,
      { credentials: 'include' }
    );
    const data = (await response.json().catch(() => ({}))) as Partial<TokenResponse> & { error?: string };
    if (!response.ok || !data.token || !data.expiresAt) {
      throw new Error(data.error || 'Failed to fetch a browser calling token');
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
      startMicMeter(selectedInputStream, microphone?.label ?? null);

      const tokenData = await fetchToken(workspaceId, tabId);
      if (tokenData.provider === 'telnyx') {
        providerRef.current = 'telnyx';
        setProvider('telnyx');
        getTelnyxRemoteAudioElement();
        const sdk = await import('@telnyx/webrtc');
        const TelnyxRTCCtor = (sdk.TelnyxRTC ?? sdk.default) as unknown as new (
          options: Record<string, unknown>
        ) => TelnyxClientLike;
        const client = new TelnyxRTCCtor({
          login_token: tokenData.token,
          debug: false,
          enableCallReports: true,
          hangupOnBeforeUnload: true,
        });

        const readyPromise = new Promise<void>((resolve, reject) => {
          let settled = false;
          const timerId = window.setTimeout(() => {
            if (settled) return;
            settled = true;
            reject(new Error('Timed out connecting the Telnyx browser softphone.'));
          }, 15000);

          client.on('telnyx.ready', () => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timerId);
            resolve();
          });

          client.on('telnyx.error', (error) => {
            const message = getErrorMessage(error, 'A Telnyx browser softphone error occurred.');
            console.error('[dialer/device] Telnyx client error', error);
            setDeviceError(message);
            if (!settled) {
              settled = true;
              window.clearTimeout(timerId);
              reject(new Error(message));
            }
          });
        });

        client.on('telnyx.warning', (warning) => {
          const message = getErrorMessage(warning, 'Telnyx browser softphone warning.');
          console.warn('[dialer/device] Telnyx client warning', warning);
          setDeviceError(message);
        });

        client.on('telnyx.notification', (notification) => {
          const call = getTelnyxNotificationCall(notification);
          const notificationType = getTelnyxNotificationType(notification);
          const state = (call?.state ?? notificationType ?? '').toLowerCase();
          const displayName =
            getTelnyxNotificationField(notification, 'displayName') ??
            call?.options?.remoteCallerName ??
            call?.options?.callerName ??
            null;
          const displayNumber =
            getTelnyxNotificationField(notification, 'displayNumber') ??
            call?.options?.remoteCallerNumber ??
            call?.options?.callerNumber ??
            call?.options?.destinationNumber ??
            null;
          const direction = (
            getTelnyxNotificationField(notification, 'displayDirection') ??
            call?.direction ??
            ''
          ).toLowerCase();
          const isInbound = direction.includes('inbound') || direction === 'in';
          if (call) {
            telnyxCallRef.current = call;
          }

          console.info('[dialer/device] Telnyx notification', {
            type: notificationType,
            state: call?.state,
            direction,
            displayName,
            displayNumber,
            telnyxIDs: call?.telnyxIDs,
          });

          if (state.includes('active') || state.includes('answer')) {
            updateIncomingCall(null);
            setCallPhase('connected');
            startMicMeter(call?.localStream ?? selectedInputStreamRef.current, microphone?.label ?? null);
            playTelnyxRemoteAudio();
            setIsMuted(Boolean(call?.isAudioMuted));
            return;
          }

          if (state.includes('ring') || state.includes('early') || state.includes('trying') || state.includes('requesting')) {
            if (isInbound) {
              updateIncomingCall({ name: displayName, number: displayNumber });
              setCallPhase('idle');
              return;
            }
            setCallPhase('connecting');
            return;
          }

          if (state.includes('hangup') || state.includes('destroy') || state.includes('done')) {
            telnyxCallRef.current = null;
            updateIncomingCall(null);
            setCallPhase('ended');
            setIsMuted(false);
            setEndedCount((count) => count + 1);
          }
        });

        telnyxClientRef.current = client;
        await Promise.resolve(client.connect());
        await readyPromise;
        setTokenExpiresAt(tokenData.expiresAt);
        setFromNumber(tokenData.fromNumber);
        setSmsFromNumber(tokenData.smsFromNumber);
        setAllowSmsFollowup(tokenData.allowSmsFollowup);
        scheduleTelnyxTokenRefresh(tokenData.expiresAt, workspaceId, tabId);
        setSetupState('ready');
        setCallPhase('idle');
        return;
      }

      providerRef.current = 'twilio';
      setProvider('twilio');
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
        startMicMeter(connectionRef.current?.getLocalStream?.() ?? selectedInputStreamRef.current, microphone?.label ?? null);
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
      stopMicMeter();
      stopMediaStream(selectedInputStreamRef.current);
      selectedInputStreamRef.current = null;
      setSetupState('error');
      setDeviceError(getErrorMessage(error, 'Failed to initialize browser calling.'));
    }
  };

  const startCall = async (callRequestId: string, options: StartCallOptions = {}) => {
    if (providerRef.current === 'telnyx') {
      if (!telnyxClientRef.current) {
        throw new Error('Initialize the Telnyx browser softphone before placing a call.');
      }
      const destinationNumber = options.toNumber?.trim();
      if (!destinationNumber) {
        throw new Error('A destination phone number is required for Telnyx browser calling.');
      }

      setDeviceError(null);
      setCallPhase('connecting');
      hangUpRequestedRef.current = false;
      try {
        console.info('[dialer/device] starting Telnyx WebRTC call', {
          callRequestId,
          destinationNumber,
          callerNumber: options.fromNumber ?? fromNumber,
          selectedMicrophone,
        });
        const call = telnyxClientRef.current.newCall({
          destinationNumber,
          callerNumber: options.fromNumber ?? fromNumber ?? undefined,
          id: callRequestId,
          clientState: createTelnyxClientState(callRequestId),
          localStream: selectedInputStreamRef.current ?? undefined,
          remoteElement: getTelnyxRemoteAudioElement() ?? undefined,
          audio: true,
        });
        telnyxCallRef.current = call;
        startMicMeter(call.localStream ?? selectedInputStreamRef.current, selectedMicrophone?.label ?? null);
        playTelnyxRemoteAudio();
        if (hangUpRequestedRef.current) {
          await call.hangup().catch(() => undefined);
          telnyxCallRef.current = null;
          setCallPhase('ended');
          setEndedCount((count) => count + 1);
          return;
        }
        setIsMuted(Boolean(call.isAudioMuted));
      } catch (error) {
        console.error('[dialer/device] failed to start Telnyx call', error);
        setCallPhase('ended');
        setDeviceError(getErrorMessage(error, 'Failed to start Telnyx browser call.'));
        throw error;
      }
      return;
    }

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
    startMicMeter(connection.getLocalStream?.() ?? selectedInputStreamRef.current, selectedMicrophone?.label ?? null);
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
    if (providerRef.current === 'telnyx') {
      const activeCall = telnyxCallRef.current;
      try {
        void activeCall?.hangup().catch((error) => {
          console.warn('[dialer/device] failed to hang up Telnyx call', error);
        });
      } finally {
        telnyxCallRef.current = null;
        setCallPhase('ended');
        setIsMuted(false);
        setEndedCount((count) => count + 1);
      }
      return;
    }

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

  const answerIncomingCall = async () => {
    if (providerRef.current !== 'telnyx' || !telnyxCallRef.current?.answer) return;
    setDeviceError(null);
    setCallPhase('connecting');
    try {
      getTelnyxRemoteAudioElement();
      await telnyxCallRef.current.answer({ video: false });
      updateIncomingCall(null);
      startMicMeter(telnyxCallRef.current.localStream ?? selectedInputStreamRef.current, selectedMicrophone?.label ?? null);
      playTelnyxRemoteAudio();
    } catch (error) {
      console.error('[dialer/device] failed to answer Telnyx call', error);
      setCallPhase('ended');
      setDeviceError(getErrorMessage(error, 'Failed to answer Telnyx browser call.'));
      throw error;
    }
  };

  const rejectIncomingCall = () => {
    if (providerRef.current !== 'telnyx') return;
    const activeCall = telnyxCallRef.current;
    updateIncomingCall(null);
    telnyxCallRef.current = null;
    setCallPhase('ended');
    void activeCall?.hangup().catch((error) => {
      console.warn('[dialer/device] failed to reject Telnyx incoming call', error);
    });
  };

  const toggleMute = () => {
    if (providerRef.current === 'telnyx') {
      const activeCall = telnyxCallRef.current;
      if (!activeCall) return;
      const nextMuted = !Boolean(activeCall.isAudioMuted);
      if (nextMuted) {
        activeCall.muteAudio();
      } else {
        activeCall.unmuteAudio();
      }
      setIsMuted(nextMuted);
      return;
    }

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
    micLevel,
    micTrackLabel,
    micTrackState,
    deviceError,
    tokenExpiresAt,
    endedCount,
    fromNumber,
    smsFromNumber,
    allowSmsFollowup,
    provider,
    incomingCall,
    hasIncomingCall: Boolean(incomingCall),
    initialize,
    startCall,
    answerIncomingCall,
    rejectIncomingCall,
    hangUp,
    toggleMute,
    resetEndedPhase,
    isReady: setupState === 'ready',
    isConnecting: callPhase === 'connecting',
    isInCall: callPhase === 'connecting' || callPhase === 'connected',
  };
}

export const useTwilioDevice = useDialerDevice;
