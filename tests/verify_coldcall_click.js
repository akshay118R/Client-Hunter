const { app, BrowserWindow } = require('electron');
const path = require('path');
const assert = require('assert');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  const indexPath = path.join(__dirname, '../index.html');
  await win.loadFile(indexPath);
  await new Promise((r) => setTimeout(r, 1200));

  console.log('Testing Navigation Click on "Cold Call"...');

  const result = await win.webContents.executeJavaScript(`
    (function() {
      // 1. Initial view check
      const initialView = document.body.getAttribute('data-view');

      // 2. Click the desktop Cold Call nav link
      const desktopColdCallLink = document.querySelector('.nav-link[data-tab="cold-call"]');
      if (!desktopColdCallLink) {
        return { success: false, error: 'Desktop nav link for cold-call not found' };
      }
      desktopColdCallLink.click();

      // 3. Inspect view states after desktop click
      const viewColdCall = document.getElementById('view-cold-call');
      const viewFindLeads = document.getElementById('view-find-leads');
      const viewHero = document.getElementById('view-hero');

      const isColdCallVisible = viewColdCall && viewColdCall.style.display !== 'none' && !viewColdCall.classList.contains('hidden') && viewColdCall.classList.contains('active-view');
      const isFindLeadsHidden = viewFindLeads && (viewFindLeads.style.display === 'none' || viewFindLeads.classList.contains('hidden'));
      const isHeroHidden = viewHero && (viewHero.style.display === 'none' || viewHero.classList.contains('hidden'));
      const activeLinkHasClass = desktopColdCallLink.classList.contains('active');

      // 4. Click a different link (e.g. settings) and then click mobile cold-call link
      const settingsLink = document.querySelector('.nav-link[data-tab="settings"]');
      if (settingsLink) settingsLink.click();

      const mobileColdCallLink = document.querySelector('.mobile-nav-link[data-tab="cold-call"]');
      if (!mobileColdCallLink) {
        return { success: false, error: 'Mobile nav link for cold-call not found' };
      }
      mobileColdCallLink.click();

      const isColdCallVisibleAfterMobile = viewColdCall && viewColdCall.style.display !== 'none' && !viewColdCall.classList.contains('hidden') && viewColdCall.classList.contains('active-view');

      return {
        success: true,
        initialView,
        desktopClick: {
          isColdCallVisible,
          isFindLeadsHidden,
          isHeroHidden,
          activeLinkHasClass,
          currentViewAttr: document.body.getAttribute('data-view'),
          hash: window.location.hash
        },
        mobileClick: {
          isColdCallVisibleAfterMobile
        }
      };
    })()
  `);

  console.log('Result:', JSON.stringify(result, null, 2));

  assert(result.success, result.error);
  assert(result.desktopClick.isColdCallVisible, 'Cold Call view must be visible after desktop link click');
  assert(result.desktopClick.isFindLeadsHidden, 'Find Leads view must be hidden after desktop link click');
  assert(result.desktopClick.activeLinkHasClass, 'Cold Call nav link must have active class');
  assert.strictEqual(result.desktopClick.currentViewAttr, 'cold-call', 'data-view attribute must be cold-call');
  assert.strictEqual(result.desktopClick.hash, '#cold-call', 'Hash must be #cold-call');
  assert(result.mobileClick.isColdCallVisibleAfterMobile, 'Cold Call view must be visible after mobile link click');

  console.log('\n========================================================');
  console.log('✓ SUCCESS: CLICKING COLD CALL OPENS COLD CALL VIEW');
  console.log('✓ DOES NOT OPEN FIND LEADS VIEW');
  console.log('========================================================\n');

  win.close();
  app.quit();
});
