'use client';

type QueuedDemoEvent = {
  slug: string;
  session_id: string;
  event: string;
  beat?: number;
  t_ms: number;
  meta: Record<string, unknown>;
};

const sessionId = safeRandomUUID();
const pageLoadStart = safePerformanceNow();
const queue: QueuedDemoEvent[] = [];

let currentSlug: string | null = null;
let flushInterval: ReturnType<typeof setInterval> | null = null;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
let heartbeatCount = 0;
let listenersAttached = false;

function safeRandomUUID() {
  try {
    return crypto.randomUUID();
  } catch {
    return '00000000-0000-4000-8000-000000000000'.replace(/[018]/g, (c) =>
      (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16)
    );
  }
}

function safePerformanceNow() {
  try {
    return performance.now();
  } catch {
    return Date.now();
  }
}

function canUseBeacon() {
  try {
    return typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function';
  } catch {
    return false;
  }
}

function flush() {
  try {
    if (!currentSlug || queue.length === 0 || !canUseBeacon()) {
      return;
    }

    const events = queue.slice();
    const blob = new Blob(
      [
        JSON.stringify({
          slug: currentSlug,
          session_id: sessionId,
          events,
        }),
      ],
      { type: 'application/json' }
    );

    const sent = navigator.sendBeacon('/api/demo-events', blob);
    if (sent) {
      queue.splice(0, events.length);
      if (queue.length === 0 && flushInterval !== null) {
        clearInterval(flushInterval);
        flushInterval = null;
      }
    }
  } catch {
    // Analytics must never affect the demo experience.
  }
}

function attachListeners() {
  if (listenersAttached || typeof document === 'undefined' || typeof window === 'undefined') {
    return;
  }

  listenersAttached = true;

  try {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        flush();
      }
    });
  } catch {
    // ignore
  }

  try {
    window.addEventListener('pagehide', flush);
  } catch {
    // ignore
  }
}

function ensureFlushInterval() {
  if (flushInterval !== null) {
    return;
  }

  try {
    flushInterval = setInterval(() => {
      if (queue.length > 0) {
        flush();
      } else if (flushInterval !== null) {
        clearInterval(flushInterval);
        flushInterval = null;
      }
    }, 5000);
  } catch {
    flushInterval = null;
  }
}

function ensureHeartbeatInterval() {
  if (heartbeatInterval !== null) {
    return;
  }

  try {
    heartbeatInterval = setInterval(() => {
      try {
        if (heartbeatCount >= 20) {
          if (heartbeatInterval !== null) {
            clearInterval(heartbeatInterval);
            heartbeatInterval = null;
          }
          return;
        }

        if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
          heartbeatCount += 1;
          track('heartbeat');
        }
      } catch {
        // ignore
      }
    }, 15000);
  } catch {
    heartbeatInterval = null;
  }
}

export function initTracking(slug: string) {
  try {
    if (!slug) {
      return;
    }

    currentSlug = slug;
    attachListeners();
    ensureHeartbeatInterval();
  } catch {
    // Analytics must never affect the demo experience.
  }
}

export function track(event: string, beat?: number, meta: Record<string, unknown> = {}) {
  try {
    if (!currentSlug || !event) {
      return;
    }

    queue.push({
      slug: currentSlug,
      session_id: sessionId,
      event,
      beat,
      t_ms: Math.round(safePerformanceNow() - pageLoadStart),
      meta,
    });
    ensureFlushInterval();
  } catch {
    // Analytics must never affect the demo experience.
  }
}
