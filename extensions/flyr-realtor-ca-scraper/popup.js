const flyrUrlInput = document.getElementById('flyrUrl');
const scrapeButton = document.getElementById('scrape');
const statusEl = document.getElementById('status');
const DEFAULT_FLYR_URL = 'https://www.flyrpro.app/scraper';

function normalizeFlyrUrl(value) {
  const candidate = String(value || '').trim();
  if (!candidate) return DEFAULT_FLYR_URL;

  try {
    const url = new URL(candidate);
    if (
      url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' ||
      url.hostname === 'flyr.software' ||
      url.hostname === 'www.flyr.software'
    ) {
      return DEFAULT_FLYR_URL;
    }
    return url.toString();
  } catch {
    return DEFAULT_FLYR_URL;
  }
}

async function loadSettings() {
  const settings = await chrome.storage.sync.get({
    flyrUrl: DEFAULT_FLYR_URL,
  });
  const flyrUrl = normalizeFlyrUrl(settings.flyrUrl);
  flyrUrlInput.value = flyrUrl;
  if (flyrUrl !== settings.flyrUrl) {
    await chrome.storage.sync.set({ flyrUrl });
  }
}

async function saveSettings() {
  const flyrUrl = normalizeFlyrUrl(flyrUrlInput.value);
  flyrUrlInput.value = flyrUrl;
  await chrome.storage.sync.set({
    flyrUrl,
  });
  return flyrUrl;
}

scrapeButton.addEventListener('click', async () => {
  scrapeButton.disabled = true;
  statusEl.textContent = 'Scraping all REALTOR.ca pages...';
  const flyrUrl = await saveSettings();

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'FLYR_START_REALTOR_SCRAPE',
      options: {
        flyrUrl,
      },
    });

    if (!response?.ok) throw new Error(response?.error || 'Scrape failed.');
    statusEl.textContent = `Sent ${response.count} leads from ${response.pages} page(s) to FLYR.`;
  } catch (error) {
    statusEl.textContent = error instanceof Error ? error.message : 'Scrape failed.';
  } finally {
    scrapeButton.disabled = false;
  }
});

void loadSettings();
