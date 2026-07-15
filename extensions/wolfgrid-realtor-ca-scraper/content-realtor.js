const compact = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const phoneRe = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/;
const phoneGlobalRe = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g;
const postcodeRe = /\b[A-Z]\d[A-Z]\s?\d[A-Z]\d\b/i;
const roleRe = /\b(salesperson|sales representative|broker of record|associate broker|broker|representative|realtor)\b/i;
const roleOnlyRe = /^(salesperson|sales representative|broker of record|associate broker|broker|representative|realtor)$/i;
const ignoredLineRe = /^(email|website|realtor.? website|office website|brokerage|contact)$/i;
const mobileLabelRe = /\b(mobile|cell(?:ular)?|direct)\b|(^|\s)[mc]\s*[:.-]/i;
const excludedPhoneLabelRe = /\b(fax|toll[-\s]?free)\b/i;

function multilineText(element) {
  return String(element?.innerText || element?.textContent || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function linesFrom(text) {
  return String(text ?? '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(compact)
    .filter(Boolean)
    .filter((line) => !ignoredLineRe.test(line));
}

function normalizePhoneDigits(value) {
  const match = compact(value).match(phoneRe)?.[0] || '';
  let digits = match.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  return digits.length === 10 ? digits : '';
}

function formatPhone(digits) {
  return digits ? `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}` : '';
}

function isPlaceholderAgentName(value) {
  const clean = compact(value).replace(/[®]/g, '');
  return /^(realtor\s*\.?\s*ca|\.ca)\s+agent$/i.test(clean) || /^agent$/i.test(clean);
}

function titleCaseAllCapsName(value) {
  if (!value || !/[A-Z]/.test(value) || /[a-z]/.test(value)) return value;
  return value
    .toLowerCase()
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
    .replace(/\bMc([a-z])/g, (_, letter) => `Mc${letter.toUpperCase()}`);
}

function cleanAgentName(value) {
  if (isPlaceholderAgentName(value)) return '';
  let clean = compact(value)
    .replace(phoneGlobalRe, ' ')
    .replace(postcodeRe, ' ')
    .replace(/\b(REALTOR(?:\.ca)?(?:®|\(R\))?|website|email)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const boundary = clean.search(
    /\b(salesperson|sales representative|broker of record|associate broker|broker|representative|realtor|royal lepage|re\/max|keller williams|century 21|right at home|sutton|exp realty|realty|inc\.?|ltd\.?|brokerage|unit|suite|street|st\.?|road|rd\.?|avenue|ave\.?|drive|dr\.?|boulevard|blvd\.?|ontario)\b|\d{1,6}\s+[A-Za-z]/i
  );
  if (boundary > 1) clean = compact(clean.slice(0, boundary));

  clean = clean.replace(/[^A-Za-z'. -]/g, ' ').replace(/\s+/g, ' ').trim();
  const parts = clean.split(' ').filter(Boolean);
  if (parts.length > 5) clean = parts.slice(0, 5).join(' ');
  if (!clean || isPlaceholderAgentName(clean) || roleOnlyRe.test(clean) || clean.length < 3) return '';
  return titleCaseAllCapsName(clean);
}

function textAround(text, index, length) {
  return compact(text.slice(Math.max(0, index - 55), Math.min(text.length, index + length + 55)));
}

function isMobilePhoneContext(context) {
  return mobileLabelRe.test(context) && !excludedPhoneLabelRe.test(context);
}

function findMobilePhoneInText(text) {
  const raw = String(text ?? '');
  for (const match of raw.matchAll(phoneGlobalRe)) {
    const context = textAround(raw, match.index || 0, match[0].length);
    if (isMobilePhoneContext(context)) {
      return formatPhone(normalizePhoneDigits(match[0]));
    }
  }
  return '';
}

function findAnyPhoneInText(text) {
  const raw = String(text ?? '');
  for (const match of raw.matchAll(phoneGlobalRe)) {
    const context = textAround(raw, match.index || 0, match[0].length);
    if (excludedPhoneLabelRe.test(context)) continue;
    const phone = formatPhone(normalizePhoneDigits(match[0]));
    if (phone) return phone;
  }
  return '';
}

function contextForPhoneLink(link) {
  const chunks = [
    link.getAttribute('aria-label'),
    link.getAttribute('title'),
    link.textContent,
  ];
  let element = link;
  for (let depth = 0; depth < 4 && element; depth += 1) {
    chunks.push(multilineText(element));
    element = element.parentElement;
  }
  return compact(chunks.filter(Boolean).join(' '));
}

function extractPreferredPhone(cardElement, text) {
  const links = Array.from(cardElement?.querySelectorAll?.('a[href^="tel:"]') || []);
  const fallbackPhones = [];
  for (const link of links) {
    const digits = normalizePhoneDigits(decodeURIComponent(link.getAttribute('href') || ''));
    if (!digits) continue;
    const context = contextForPhoneLink(link);
    if (excludedPhoneLabelRe.test(context)) continue;
    const phone = formatPhone(digits);
    if (isMobilePhoneContext(context)) return { phone, mobilePhone: phone, workPhone: '' };
    fallbackPhones.push(phone);
  }

  const mobilePhone = findMobilePhoneInText(text);
  if (mobilePhone) return { phone: mobilePhone, mobilePhone, workPhone: '' };

  const phone = fallbackPhones[0] || findAnyPhoneInText(text);
  return { phone, mobilePhone: '', workPhone: phone };
}

function cleanOffice(value, name) {
  let clean = compact(value)
    .replace(phoneGlobalRe, ' ')
    .replace(postcodeRe, ' ')
    .replace(/\b(email|website|realtor(?:®|\(R\))?)\b/gi, ' ')
    .trim();
  if (name) clean = compact(clean.replace(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), ' '));
  const boundary = clean.search(/\b(unit|suite|street|st\.?|road|rd\.?|avenue|ave\.?|drive|dr\.?|boulevard|blvd\.?|ontario)\b|\d{1,6}\s+[A-Za-z]/i);
  if (boundary > 1) clean = compact(clean.slice(0, boundary));
  return clean;
}

function bestCardForLink(link) {
  let best = multilineText(link);
  let bestElement = link;
  let element = link;
  for (let depth = 0; depth < 9 && element; depth += 1) {
    const text = multilineText(element);
    const compactText = compact(text);
    if (compactText.length > compact(best).length && compactText.length < 2600 && (phoneRe.test(text) || roleRe.test(text))) {
      best = text;
      bestElement = element;
    }
    element = element.parentElement;
  }
  return { text: best, element: bestElement };
}

function leadFromLink(link, index, pageNumber) {
  const href = link.href || '';
  const best = bestCardForLink(link);
  const text = best.text;
  const lines = linesFrom(text);
  const phoneDetails = extractPreferredPhone(best.element, text);
  const phone = phoneDetails.phone;
  const roleIndex = lines.findIndex((line) => roleRe.test(line));
  const role = roleIndex >= 0 ? compact(lines[roleIndex].match(roleRe)?.[0] || lines[roleIndex]) : '';
  const rawName =
    lines.find((line) => !phoneRe.test(line) && !postcodeRe.test(line) && !isPlaceholderAgentName(line) && cleanAgentName(line)) ||
    (!isPlaceholderAgentName(link.textContent) ? compact(link.textContent) : '');
  const name = cleanAgentName(rawName);
  const address = lines.find((line) => postcodeRe.test(line)) || '';
  const officeStart = roleIndex >= 0 ? roleIndex + 1 : 1;
  const rawOffice =
    lines
      .slice(officeStart)
      .find((line) => !phoneRe.test(line) && !postcodeRe.test(line) && line !== name && !roleRe.test(line)) || '';
  const office = cleanOffice(rawOffice, name);

  return {
    name,
    role,
    office,
    phone,
    mobilePhone: phoneDetails.mobilePhone,
    workPhone: phoneDetails.workPhone,
    address,
    profileUrl: href,
    sourceUrl: href,
    pageUrl: location.href,
    capturedAt: new Date().toISOString(),
    pageNumber,
    pageIndex: index + 1,
  };
}

function captureCurrentPage(pageNumber) {
  return Array.from(document.querySelectorAll('a[href*="/agent/"]'))
    .filter((link) => /\/agent\/\d+\//i.test(link.href || ''))
    .map((link, index) => leadFromLink(link, index, pageNumber))
    .filter((lead) => lead.name && lead.phone);
}

function findNextButton() {
  const selectors = [
    '[aria-label="Go to the next page"]',
    'a[rel="next"]',
    'button[aria-label*="next" i]',
    'a[aria-label*="next" i]',
  ];

  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element && !element.disabled && element.getAttribute('aria-disabled') !== 'true') return element;
  }

  return Array.from(document.querySelectorAll('a,button')).find((element) => {
    const label = compact(element.getAttribute('aria-label') || element.textContent);
    return /next|›|»/i.test(label) && !element.disabled && element.getAttribute('aria-disabled') !== 'true';
  });
}

async function waitForPageChange(beforeUrl, beforeText) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await wait(500);
    const text = compact(document.body.innerText).slice(0, 4000);
    if (location.href !== beforeUrl || text !== beforeText) return true;
  }
  return false;
}

function dedupe(leads) {
  const byKey = new Map();
  leads.forEach((lead) => {
    const phoneKey = normalizePhoneDigits(lead.mobilePhone || lead.phone);
    const key = phoneKey ? `phone:${phoneKey}` : '';
    if (key && !byKey.has(key)) byKey.set(key, lead);
  });
  return Array.from(byKey.values());
}

function readLocationFromUrl() {
  const match = location.pathname.match(/\/realtors\/([a-z]{2})\/([^/?#]+)/i);
  return {
    provinceCode: match?.[1]?.toLowerCase() || 'on',
    city: match?.[2] ? decodeURIComponent(match[2]).replace(/-/g, ' ') : '',
  };
}

async function scrapeRealtorCa() {
  const capturedPages = [];
  const allLeads = [];
  let pageNumber = 1;

  while (true) {
    window.scrollTo(0, document.body.scrollHeight);
    await wait(700);
    window.scrollTo(0, 0);
    await wait(500);

    const pageLeads = captureCurrentPage(pageNumber);
    capturedPages.push({ pageUrl: location.href, count: pageLeads.length });
    allLeads.push(...pageLeads);

    const next = findNextButton();
    if (!next) break;

    const beforeUrl = location.href;
    const beforeText = compact(document.body.innerText).slice(0, 4000);
    next.click();
    const moved = await waitForPageChange(beforeUrl, beforeText);
    if (!moved) break;

    await wait(1200);
    pageNumber += 1;
  }

  const locationParts = readLocationFromUrl();
  return {
    source: 'realtor.ca',
    mode: 'wolfgrid_chrome_extension',
    city: locationParts.city,
    provinceCode: locationParts.provinceCode,
    pageUrl: location.href,
    capturedAt: new Date().toISOString(),
    allPages: true,
    capturedPages,
    rawLeadCount: allLeads.length,
    leads: dedupe(allLeads),
  };
}

if (!globalThis.__wolfGridRealtorScraperInstalled) {
  globalThis.__wolfGridRealtorScraperInstalled = true;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!['WOLFGRID_SCRAPE_REALTOR_CA', 'FLYR_SCRAPE_REALTOR_CA'].includes(message?.type)) return false;

    scrapeRealtorCa(message.options)
      .then((payload) => sendResponse({ ok: true, payload }))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : 'REALTOR.ca scrape failed.',
        })
      );

    return true;
  });
}
