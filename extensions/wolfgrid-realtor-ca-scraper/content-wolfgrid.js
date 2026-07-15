if (!globalThis.__wolfGridRealtorCaptureReceiverInstalled) {
  globalThis.__wolfGridRealtorCaptureReceiverInstalled = true;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!['WOLFGRID_DELIVER_REALTOR_CAPTURE', 'FLYR_DELIVER_REALTOR_CAPTURE'].includes(message?.type)) return false;

    const payload = {
      type: 'WOLFGRID_REALTOR_CA_CAPTURE',
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
