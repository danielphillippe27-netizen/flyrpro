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
  
  // Check for Period dropdown
  const periodDropdown = await page.$('text=/Period/i');
  const sortByDropdown = await page.$('text=/Sort by/i');
  
  console.log('\n=== Initial State ===');
  console.log('Period dropdown found:', !!periodDropdown);
  console.log('Sort by dropdown found:', !!sortByDropdown);
  
  if (!periodDropdown) {
    console.log('⚠️  Period dropdown not found! Checking page content...');
    const pageText = await page.textContent('body');
    console.log('Page contains "Period":', pageText.includes('Period'));
    console.log('Page contains "Timeframe":', pageText.includes('Timeframe'));
    
    // Try to find any dropdowns
    const allButtons = await page.$$('button');
    console.log(`Found ${allButtons.length} buttons on the page`);
    
    for (let i = 0; i < Math.min(allButtons.length, 10); i++) {
      const text = await allButtons[i].textContent();
      console.log(`  Button ${i + 1}: "${text.trim()}"`);
    }
    
    await browser.close();
    return;
  }
  
  // Step 4: Click Period dropdown and select "This Week"
  console.log('\nStep 4: Clicking Period dropdown...');
  await periodDropdown.click();
  await page.waitForTimeout(500);
  
  const thisWeekOption = await page.$('text=/This Week/i');
  if (thisWeekOption) {
    console.log('Selecting "This Week"...');
    await thisWeekOption.click();
    await page.waitForTimeout(2000);
    
    console.log('Step 5: Taking screenshot after selecting "This Week"...');
    await page.screenshot({ path: 'leaderboard-this-week.png', fullPage: true });
    
    // Get the data to see if it changed
    const entries = await page.$$('[role="row"], .leaderboard-row, div:has-text("flyers")');
    console.log(`Found ${entries.length} entries after selecting "This Week"`);
  } else {
    console.log('⚠️  "This Week" option not found');
  }
  
  // Step 6: Try "Today"
  console.log('\nStep 6: Clicking Period dropdown again...');
  await periodDropdown.click();
  await page.waitForTimeout(500);
  
  const todayOption = await page.$('text=/^Today$/i');
  if (todayOption) {
    console.log('Selecting "Today"...');
    await todayOption.click();
    await page.waitForTimeout(2000);
    
    console.log('Step 7: Taking screenshot after selecting "Today"...');
    await page.screenshot({ path: 'leaderboard-today.png', fullPage: true });
    
    const entries = await page.$$('[role="row"], .leaderboard-row, div:has-text("flyers")');
    console.log(`Found ${entries.length} entries after selecting "Today"`);
  } else {
    console.log('⚠️  "Today" option not found');
  }
  
  console.log('\n✅ Test complete! Screenshots saved.');
  await browser.close();
})();
