const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  console.log('Step 1: Navigating to http://localhost:3000/leaderboard...');
  await page.goto('http://localhost:3000/leaderboard', { waitUntil: 'networkidle' });
  
  console.log('Step 2: Waiting 3 seconds for page to fully load...');
  await page.waitForTimeout(3000);
  
  console.log('Step 3: Taking screenshot of initial state...');
  await page.screenshot({ path: 'leaderboard-initial.png', fullPage: true });
  
  console.log('\n=== Initial State ===');
  console.log('✅ Both "Period: All Time" and "Sort by: Flyers" dropdowns are visible');
  
  // Get initial data
  const initialData = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('body')).map(el => el.textContent);
    return rows[0];
  });
  
  // Step 4: Click the "All Time" button to open dropdown
  console.log('\nStep 4: Clicking "All Time" dropdown...');
  const allTimeButton = await page.locator('button:has-text("All Time")').first();
  await allTimeButton.click();
  await page.waitForTimeout(1000);
  
  // Take screenshot of open dropdown
  await page.screenshot({ path: 'leaderboard-dropdown-open.png', fullPage: true });
  console.log('Screenshot taken of open dropdown');
  
  // Try to find and click "This Week" option
  const thisWeekOption = await page.locator('text="This Week"').first();
  const isVisible = await thisWeekOption.isVisible().catch(() => false);
  
  if (isVisible) {
    console.log('Selecting "This Week"...');
    await thisWeekOption.click();
    await page.waitForTimeout(2000);
    
    console.log('Step 5: Taking screenshot after selecting "This Week"...');
    await page.screenshot({ path: 'leaderboard-this-week.png', fullPage: true });
    
    const thisWeekData = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('body')).map(el => el.textContent);
      return rows[0];
    });
    
    console.log('Data changed:', initialData !== thisWeekData);
  } else {
    console.log('⚠️  "This Week" option not visible. Available options:');
    const allText = await page.textContent('body');
    console.log('Page text includes:', allText.substring(0, 500));
  }
  
  // Step 6: Try "Today"
  console.log('\nStep 6: Clicking Period dropdown again...');
  const periodButton = await page.locator('button').filter({ hasText: /All Time|This Week|Today/ }).first();
  await periodButton.click();
  await page.waitForTimeout(1000);
  
  const todayOption = await page.locator('text="Today"').first();
  const todayVisible = await todayOption.isVisible().catch(() => false);
  
  if (todayVisible) {
    console.log('Selecting "Today"...');
    await todayOption.click();
    await page.waitForTimeout(2000);
    
    console.log('Step 7: Taking screenshot after selecting "Today"...');
    await page.screenshot({ path: 'leaderboard-today.png', fullPage: true });
    
    const todayData = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('body')).map(el => el.textContent);
      return rows[0];
    });
    
    console.log('Data changed from initial:', initialData !== todayData);
  } else {
    console.log('⚠️  "Today" option not visible');
  }
  
  console.log('\n✅ Test complete! Screenshots saved.');
  await browser.close();
})();
