const wolfgridUrlInput = document.getElementById('wolfgridUrl');
const scrapeButton = document.getElementById('scrape');
const statusEl = document.getElementById('status');
const DEFAULT_WOLFGRID_URL = 'https://wolfgrid.app/scraper';

function normalizeWolfGridUrl(value) {
  const candidate = String(value || '').trim();
  if (!candidate) return DEFAULT_WOLFGRID_URL;

  try {
    const url = new URL(candidate);
    if (
      url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' ||
      url.hostname === 'flyr.software' ||
      url.hostname === 'www.flyr.software' ||
      url.hostname === 'flyrpro.app' ||
      url.hostname === 'www.flyrpro.app'
    ) {
      return DEFAULT_WOLFGRID_URL;
    }
    return url.toString();
  } catch {
    return DEFAULT_WOLFGRID_URL;
  }
}

async function loadSettings() {
  const settings = await chrome.storage.sync.get({
    wolfgridUrl: DEFAULT_WOLFGRID_URL,
    flyrUrl: null,
  });
  const wolfgridUrl = normalizeWolfGridUrl(settings.wolfgridUrl || settings.flyrUrl);
  wolfgridUrlInput.value = wolfgridUrl;
  if (wolfgridUrl !== settings.wolfgridUrl) {
    await chrome.storage.sync.set({ wolfgridUrl });
  }
}

async function saveSettings() {
  const wolfgridUrl = normalizeWolfGridUrl(wolfgridUrlInput.value);
  wolfgridUrlInput.value = wolfgridUrl;
  await chrome.storage.sync.set({
    wolfgridUrl,
  });
  return wolfgridUrl;
}

scrapeButton.addEventListener('click', async () => {
  scrapeButton.disabled = true;
  statusEl.textContent = 'Scraping all REALTOR.ca pages...';
  const wolfgridUrl = await saveSettings();

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'WOLFGRID_START_REALTOR_SCRAPE',
      options: {
        wolfgridUrl,
      },
    });

    if (!response?.ok) throw new Error(response?.error || 'Scrape failed.');
    statusEl.textContent = `Sent ${response.count} leads from ${response.pages} page(s) to WolfGrid.`;
  } catch (error) {
    statusEl.textContent = error instanceof Error ? error.message : 'Scrape failed.';
  } finally {
    scrapeButton.disabled = false;
  }
});

void loadSettings();
