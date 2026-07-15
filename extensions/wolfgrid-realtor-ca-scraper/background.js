const DEFAULT_WOLFGRID_URL = 'https://wolfgrid.app/scraper';

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

async function findOrOpenWolfGridTab(wolfgridUrl) {
  const url = new URL(wolfgridUrl);
  const matches = await chrome.tabs.query({});
  const existing = matches.find((tab) => (tab.url || '').startsWith(url.origin) && (tab.url || '').includes('/scraper'));
  if (existing?.id) {
    await chrome.tabs.update(existing.id, { active: true, url: wolfgridUrl });
    await waitForTabComplete(existing.id);
    return existing.id;
  }

  const tab = await chrome.tabs.create({ url: wolfgridUrl, active: true });
  if (!tab.id) throw new Error('Could not open WolfGrid.');
  await waitForTabComplete(tab.id);
  return tab.id;
}

async function sendToWolfGrid(wolfgridUrl, payload) {
  const wolfgridTabId = await findOrOpenWolfGridTab(wolfgridUrl);
  const message = {
    type: 'WOLFGRID_DELIVER_REALTOR_CAPTURE',
    payload,
  };

  try {
    await chrome.tabs.sendMessage(wolfgridTabId, message);
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId: wolfgridTabId },
      files: ['content-wolfgrid.js'],
    });
    await chrome.tabs.sendMessage(wolfgridTabId, message);
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
  if (!['WOLFGRID_START_REALTOR_SCRAPE', 'FLYR_START_REALTOR_SCRAPE'].includes(message?.type)) return false;

  (async () => {
    const realtorTab = await getActiveRealtorTab();
    if (!realtorTab?.id) {
      throw new Error('Open a REALTOR.ca results tab first.');
    }

    const scrapeResponse = await sendToRealtorTab(realtorTab.id, {
      type: 'WOLFGRID_SCRAPE_REALTOR_CA',
      options: message.options,
    });
    if (!scrapeResponse?.ok) throw new Error(scrapeResponse?.error || 'REALTOR.ca scrape failed.');

    await chrome.storage.local.set({ lastRealtorCapture: scrapeResponse.payload });
    await sendToWolfGrid(message.options.wolfgridUrl || message.options.flyrUrl || DEFAULT_WOLFGRID_URL, scrapeResponse.payload);
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
