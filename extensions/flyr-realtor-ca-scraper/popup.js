const flyrUrlInput = document.getElementById('flyrUrl');
const scrapeButton = document.getElementById('scrape');
const statusEl = document.getElementById('status');

async function loadSettings() {
  const settings = await chrome.storage.sync.get({
    flyrUrl: 'https://www.flyr.software/scraper',
  });
  flyrUrlInput.value = settings.flyrUrl;
}

async function saveSettings() {
  await chrome.storage.sync.set({
    flyrUrl: flyrUrlInput.value.trim() || 'https://www.flyr.software/scraper',
  });
}

scrapeButton.addEventListener('click', async () => {
  scrapeButton.disabled = true;
  statusEl.textContent = 'Scraping all REALTOR.ca pages...';
  await saveSettings();

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'FLYR_START_REALTOR_SCRAPE',
      options: {
        flyrUrl: flyrUrlInput.value.trim() || 'https://www.flyr.software/scraper',
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
