if (!globalThis.__flyrRealtorCaptureReceiverInstalled) {
  globalThis.__flyrRealtorCaptureReceiverInstalled = true;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== 'FLYR_DELIVER_REALTOR_CAPTURE') return false;

    const payload = {
      type: 'FLYR_REALTOR_CA_CAPTURE',
      payload: message.payload,
    };

    window.postMessage(payload, window.location.origin);
    window.setTimeout(() => window.postMessage(payload, window.location.origin), 750);
    window.setTimeout(() => window.postMessage(payload, window.location.origin), 2000);
    window.setTimeout(() => window.postMessage(payload, window.location.origin), 4000);

    sendResponse({ ok: true });
    return false;
  });
}
