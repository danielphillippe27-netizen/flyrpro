import { buildRealtorCaUrl } from '@/lib/scraper/realtorCaLeadSearch';
import {
  extractRealtorCaScreenshotLeads,
  type RealtorCaScreenshotLead,
} from '@/lib/scraper/realtorCaScreenshotExtraction';

export type RealtorCaScreenshotPageSearchResult = {
  startedAt: string;
  completedAt: string;
  queryCount: number;
  rawResultCount: number;
  uniqueResultCount: number;
  prospects: RealtorCaScreenshotLead[];
  profileUrls: string[];
  startUrl: string;
  screenshotCount: number;
  screenshotNames: string[];
};

type RealtorCaScreenshotPageSearchOptions = {
  city: string;
  provinceCode?: string;
  maxPages?: number;
  maxProfiles?: number;
  delayMs?: number;
};

type BrowserPage = Awaited<ReturnType<Awaited<ReturnType<typeof import('playwright').chromium.launch>>['newPage']>>;

function compactSpaces(value: string | null | undefined): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function slugify(value: string): string {
  return value.trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'city';
}

async function waitForPageSettle(page: BrowserPage): Promise<void> {
  try {
    await page.waitForLoadState('networkidle', { timeout: 10_000 });
  } catch {
    // REALTOR.ca can keep analytics requests open after the visual result page is ready.
  }
  await page.waitForTimeout(1500);
}

async function dismissCookies(page: BrowserPage): Promise<void> {
  const buttons = [
    page.getByRole('button', { name: /^dismiss$/i }),
    page.getByRole('button', { name: /^accept/i }),
    page.getByRole('button', { name: /^i agree/i }),
  ];

  for (const button of buttons) {
    if ((await button.count().catch(() => 0)) === 0) continue;
    await button.first().click({ timeout: 2500 }).catch(() => undefined);
    return;
  }
}

async function assertNotBlocked(page: BrowserPage): Promise<void> {
  const content = await page.content().catch(() => '');
  if (/Incapsula|Request unsuccessful|_Incapsula_Resource|Access Denied/i.test(content)) {
    throw new Error(
      'REALTOR.ca blocked the automated screenshot browser. Use the Upload tab with screenshots from your normal browser session.'
    );
  }
}

async function preparePageForScreenshot(page: BrowserPage): Promise<void> {
  await assertNotBlocked(page);
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      let totalHeight = 0;
      const distance = 700;
      const timer = window.setInterval(() => {
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= document.body.scrollHeight - window.innerHeight) {
          window.clearInterval(timer);
          window.scrollTo(0, 0);
          resolve();
        }
      }, 120);
    });
  }).catch(() => undefined);
  await page.waitForTimeout(800);
}

async function captureResultScreenshot(page: BrowserPage, filename: string): Promise<{
  filename: string;
  mediaType: string;
  base64: string;
}> {
  await preparePageForScreenshot(page);
  const buffer = await page.screenshot({
    type: 'jpeg',
    quality: 82,
    fullPage: true,
    animations: 'disabled',
  });

  return {
    filename,
    mediaType: 'image/jpeg',
    base64: buffer.toString('base64'),
  };
}

async function goToNextPage(page: BrowserPage, delayMs: number): Promise<boolean> {
  const beforeUrl = page.url();
  const beforeText = compactSpaces(await page.locator('body').innerText({ timeout: 8000 }).catch(() => ''));
  const next = page.locator('[aria-label="Go to the next page"], a[rel="next"]').first();
  if ((await next.count().catch(() => 0)) === 0) return false;

  await page.waitForTimeout(delayMs);
  await next.click({ timeout: 5000 }).catch(async () => {
    await page.evaluate(() => {
      const nextLink = document.querySelector('[aria-label="Go to the next page"], a[rel="next"]') as HTMLElement | null;
      nextLink?.click();
    });
  });
  await waitForPageSettle(page);
  await assertNotBlocked(page);

  const afterUrl = page.url();
  const afterText = compactSpaces(await page.locator('body').innerText({ timeout: 8000 }).catch(() => ''));
  return beforeUrl !== afterUrl || beforeText !== afterText;
}

export async function captureAndExtractRealtorCaScreenshots(
  options: RealtorCaScreenshotPageSearchOptions
): Promise<RealtorCaScreenshotPageSearchResult> {
  const startedAt = new Date().toISOString();
  const provinceCode = (options.provinceCode || 'on').toLowerCase();
  const startUrl = buildRealtorCaUrl(options.city, provinceCode);
  const maxPages = options.maxPages ?? 1;
  const maxProfiles = options.maxProfiles ?? 100;
  const delayMs = options.delayMs ?? 1500;
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36',
      viewport: { width: 1440, height: 1400 },
      deviceScaleFactor: 1,
    });

    await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await waitForPageSettle(page);
    await dismissCookies(page);
    await assertNotBlocked(page);

    const images: Array<{ filename: string; mediaType: string; base64: string }> = [];
    let pageNumber = 1;

    while (pageNumber <= maxPages) {
      images.push(
        await captureResultScreenshot(
          page,
          `realtor-ca-${slugify(options.city)}-${provinceCode}-page-${pageNumber}.jpg`
        )
      );

      if (pageNumber >= maxPages) break;
      const moved = await goToNextPage(page, delayMs);
      if (!moved) break;
      pageNumber += 1;
    }

    const extraction = await extractRealtorCaScreenshotLeads({
      city: options.city,
      provinceCode,
      images,
    });
    const prospects = extraction.prospects.slice(0, maxProfiles);

    return {
      startedAt,
      completedAt: new Date().toISOString(),
      queryCount: images.length,
      rawResultCount: extraction.rawResultCount,
      uniqueResultCount: prospects.length,
      prospects,
      profileUrls: prospects.map((lead) => lead.sourceUrl).filter(Boolean) as string[],
      startUrl,
      screenshotCount: images.length,
      screenshotNames: images.map((image) => image.filename),
    };
  } finally {
    await browser.close();
  }
}
