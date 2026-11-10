const { chromium } = require('playwright');
const assert = require('node:assert/strict');

const base = process.env.ROOFING_TEST_URL || 'http://127.0.0.1:4322';
const id = n => '00000000-0000-0000-0000-' + String(n).padStart(12, '0');
const dateInput = (date, seconds = false) => new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}),
}).format(date).replace(' ', 'T');

(async () => {
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
  const page = await browser.newPage({ timezoneId: 'America/Toronto' });
  page.setDefaultTimeout(9_000);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  async function actor(n, path) {
    if (!page.url().startsWith(base)) await page.goto(base);
    await page.evaluate(actor => localStorage.setItem('actor', String(actor)), n);
    await page.goto(base + path);
  }
  async function runRpc(name, action, click) {
    const [response] = await Promise.all([
      page.waitForResponse(response => response.url().endsWith('/rpc/' + name)
        && response.request().postDataJSON()?.p_action === action),
      click(),
    ]);
    const body = await response.json();
    assert.equal(body.error, null, JSON.stringify(body.error));
    return body.data;
  }
  try {
    await actor(2, '/appointments');
    await page.getByRole('button', { name: 'Book appointment', exact: true }).click();
    let dialog = page.getByRole('dialog');
    await dialog.getByRole('combobox', { name: 'Contact' }).selectOption(id(30));
    await dialog.getByLabel('Date and time').fill(dateInput(new Date(Date.now() - 15 * 60_000)));
    const booking = await runRpc('field_appointment_command', 'book', () =>
      dialog.getByRole('button', { name: 'Save appointment' }).click());
    await page.getByRole('button', { name: /Private customer/ }).waitFor();

    await actor(1, '/appointments');
    await page.getByRole('button', { name: 'View team' }).click();
    await page.getByRole('button', { name: /Private customer/ }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Reassign' }).click();
    await dialog.getByLabel('Representative').selectOption(id(3));
    await runRpc('field_appointment_command', 'assign', () => dialog.getByRole('button', { name: 'Save', exact: true }).click());

    await actor(3, '/appointments?booking=' + booking.id);
    dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Mark held' }).waitFor();
    await runRpc('field_appointment_command', 'held', () => dialog.getByRole('button', { name: 'Mark held' }).click());
    await dialog.getByRole('link', { name: 'Record sale' }).click();
    await page.getByLabel(/Contract amount/).fill('20000');
    const sale = await runRpc('field_sales_command', 'submit', () => page.getByRole('button', { name: 'Save sale', exact: true }).click());
    await page.getByText('Sale saved.', { exact: false }).first().waitFor();

    await actor(1, '/sales/' + sale.id);
    await page.getByRole('heading', { name: 'Attribution' }).waitFor();
    await runRpc('field_sales_command', 'verify', () => page.getByRole('button', { name: 'Verify sale' }).click());
    await page.getByRole('combobox', { name: 'Sale action' }).selectOption('collect');
    await page.getByLabel(/Amount \(CAD\)/).fill('8000');
    await page.getByLabel(/Payment time/).fill(dateInput(new Date(Date.now() - 60_000)));
    await runRpc('field_sales_command', 'collect', () => page.getByRole('button', { name: 'Record payment', exact: true }).click());

    await actor(2, '/sales/earnings');
    await page.getByText('Credited', { exact: false }).first().waitFor();
    assert.ok((await page.locator('main').innerText()).includes('100.00'));
    await actor(3, '/sales/earnings');
    await page.getByText('Credited', { exact: false }).first().waitFor();
    assert.ok((await page.locator('main').innerText()).includes('400.00'));

    await actor(1, '/sales/earnings');
    await page.getByRole('button', { name: 'Manage team earnings' }).click();
    const fee = page.locator('details').filter({ has: page.locator('summary').filter({ hasText: 'Held fee · Pending' }) });
    await fee.locator('summary').click();
    await runRpc('field_earnings_command', 'approve', () => fee.getByRole('button', { name: 'Approve', exact: true }).click());
    const approvedFee = page.locator('details').filter({ has: page.locator('summary').filter({ hasText: 'Held fee · Approved' }) });
    await approvedFee.waitFor();
    if (!(await approvedFee.evaluate(element => element.open))) await approvedFee.locator('summary').click();
    await approvedFee.getByLabel('External payment reference').fill('Fixture pay run 42');
    await runRpc('field_earnings_command', 'settle', () => approvedFee.getByRole('button', { name: 'Mark paid' }).click());
    await page.locator('summary').filter({ hasText: 'Held fee · Paid' }).waitFor();
    assert.deepEqual(pageErrors, []);
    console.log('PASS web fixture: book, reassign, hold, convert, verify, record cash, view both earnings, approve and settle');
  } catch (error) {
    console.error((await page.locator('body').innerText()).slice(-4000));
    throw error;
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
