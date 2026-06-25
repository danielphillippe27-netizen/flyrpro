const DEFAULT_FLYR_URL = 'https://www.flyrpro.app/scraper';

async function getActiveRealtorTab() {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (activeTab?.id && /^https:\/\/(www\.)?realtor\.ca\//i.test(activeTab.url || '')) return activeTab;

  const realtorTabs = [
    ...(await chrome.tabs.query({ url: 'https://www.realtor.ca/*' })),
    ...(await chrome.tabs.query({ url: 'https://realtor.ca/*' })),
  ];
  return realtorTabs[0] || null;
}

async function waitForTabComplete(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (tab.status === 'complete') return;

  await new Promise((resolve) => {
    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function findOrOpenFlyrTab(flyrUrl) {
  const url = new URL(flyrUrl);
  const matches = await chrome.tabs.query({});
  const existing = matches.find((tab) => (tab.url || '').startsWith(url.origin) && (tab.url || '').includes('/scraper'));
  if (existing?.id) {
    await chrome.tabs.update(existing.id, { active: true, url: flyrUrl });
    await waitForTabComplete(existing.id);
    return existing.id;
  }

  const tab = await chrome.tabs.create({ url: flyrUrl, active: true });
  if (!tab.id) throw new Error('Could not open FLYR.');
  await waitForTabComplete(tab.id);
  return tab.id;
}

async function sendToFlyr(flyrUrl, payload) {
  const flyrTabId = await findOrOpenFlyrTab(flyrUrl);
  const message = {
    type: 'FLYR_DELIVER_REALTOR_CAPTURE',
    payload,
  };

  try {
    await chrome.tabs.sendMessage(flyrTabId, message);
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId: flyrTabId },
      files: ['content-flyr.js'],
    });
    await chrome.tabs.sendMessage(flyrTabId, message);
  }
}

async function sendToRealtorTab(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content-realtor.js'],
    });
    return await chrome.tabs.sendMessage(tabId, message);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'FLYR_START_REALTOR_SCRAPE') return false;

  (async () => {
    const realtorTab = await getActiveRealtorTab();
    if (!realtorTab?.id) {
      throw new Error('Open a REALTOR.ca results tab first.');
    }

    const scrapeResponse = await sendToRealtorTab(realtorTab.id, {
      type: 'FLYR_SCRAPE_REALTOR_CA',
      options: message.options,
    });
    if (!scrapeResponse?.ok) throw new Error(scrapeResponse?.error || 'REALTOR.ca scrape failed.');

    await chrome.storage.local.set({ lastRealtorCapture: scrapeResponse.payload });
    await sendToFlyr(message.options.flyrUrl || DEFAULT_FLYR_URL, scrapeResponse.payload);
    sendResponse({
      ok: true,
      count: scrapeResponse.payload?.leads?.length ?? 0,
      pages: scrapeResponse.payload?.capturedPages?.length ?? 0,
    });
  })().catch((error) => {
    sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Scrape failed.' });
  });

  return true;
});
