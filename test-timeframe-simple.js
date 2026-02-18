const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    
    console.log('Step 1: Navigating to http://localhost:3000/leaderboard...');
    await page.goto('http://localhost:3000/leaderboard', { waitUntil: 'domcontentloaded', timeout: 10000 });
    
    console.log('Step 2: Waiting 3 seconds for page to fully load...');
    await page.waitForTimeout(3000);
    
    console.log('Step 3: Taking screenshot of initial state...');
    await page.screenshot({ path: 'leaderboard-initial.png', fullPage: true });
    
    console.log('\n=== Initial State ===');
    
    // Check for both dropdowns
    const periodText = await page.textContent('body');
    console.log('✅ Period dropdown visible:', periodText.includes('Period'));
    console.log('✅ Sort by dropdown visible:', periodText.includes('Sort by'));
    console.log('✅ "All Time" text visible:', periodText.includes('All Time'));
    console.log('✅ "Flyers" text visible:', periodText.includes('Flyers'));
    
    // Get initial leaderboard data
    const initialText = await page.textContent('body');
    const initialHasAlex = initialText.includes('Alex Rivera');
    const initialHas420 = initialText.includes('420');
    console.log('Initial data shows Alex Rivera:', initialHasAlex);
    console.log('Initial data shows 420 flyers:', initialHas420);
    
    // Step 4: Click "All Time" to open dropdown
    console.log('\nStep 4: Clicking "All Time" dropdown...');
    await page.click('button:has-text("All Time")');
    await page.waitForTimeout(1000);
    
    await page.screenshot({ path: 'leaderboard-dropdown-open.png', fullPage: true });
    console.log('Screenshot saved: leaderboard-dropdown-open.png');
    
    // Check what options are available
    const dropdownText = await page.textContent('body');
    const hasToday = dropdownText.includes('Today');
    const hasThisWeek = dropdownText.includes('This Week');
    const hasThisMonth = dropdownText.includes('This Month');
    const hasThisYear = dropdownText.includes('This Year');
    
    console.log('\nDropdown options found:');
    console.log('  - Today:', hasToday);
    console.log('  - This Week:', hasThisWeek);
    console.log('  - This Month:', hasThisMonth);
    console.log('  - This Year:', hasThisYear);
    console.log('  - All Time:', dropdownText.includes('All Time'));
    
    if (hasThisWeek) {
      console.log('\nStep 5: Selecting "This Week"...');
      await page.click('text="This Week"');
      await page.waitForTimeout(2000);
      
      await page.screenshot({ path: 'leaderboard-this-week.png', fullPage: true });
      console.log('Screenshot saved: leaderboard-this-week.png');
      
      const weekText = await page.textContent('body');
      const weekHasAlex = weekText.includes('Alex Rivera');
      const weekHas420 = weekText.includes('420');
      console.log('After "This Week" - Alex Rivera visible:', weekHasAlex);
      console.log('After "This Week" - 420 flyers visible:', weekHas420);
      console.log('Data changed:', initialText !== weekText);
    }
    
    if (hasToday) {
      console.log('\nStep 6: Clicking dropdown again...');
      await page.click('button');
      await page.waitForTimeout(500);
      
      console.log('Step 7: Selecting "Today"...');
      await page.click('text="Today"');
      await page.waitForTimeout(2000);
      
      await page.screenshot({ path: 'leaderboard-today.png', fullPage: true });
      console.log('Screenshot saved: leaderboard-today.png');
      
      const todayText = await page.textContent('body');
      const todayHasAlex = todayText.includes('Alex Rivera');
      const todayHas420 = todayText.includes('420');
      console.log('After "Today" - Alex Rivera visible:', todayHasAlex);
      console.log('After "Today" - 420 flyers visible:', todayHas420);
      console.log('Data changed from initial:', initialText !== todayText);
    }
    
    console.log('\n✅ Test complete!');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
})();
