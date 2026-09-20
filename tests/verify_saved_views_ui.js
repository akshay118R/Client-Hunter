const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const ARTIFACT_DIR = process.env.ARTIFACT_DIR || path.join(__dirname, '..', 'scratch');

app.whenReady().then(async () => {
  let win = null;
  try {
    console.log('CLIENTHUNTER — SAVED VIEWS UI VERIFICATION');
    console.log('===================================================');

    win = new BrowserWindow({
      width: 1400,
      height: 900,
      show: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    });

    await win.loadURL('http://127.0.0.1:3000/#saved-leads');
    console.log('✓ Main window loaded at #saved-leads');
    await new Promise((r) => setTimeout(r, 2500));

    // Ensure Saved Leads tab is active
    await win.webContents.executeJavaScript(`
      (() => {
        const tab = document.querySelector('a[data-tab="saved-leads"]');
        if (tab) tab.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 1500));

    // 1. Verify Saved Views control elements & capture control screenshot
    const controlCheck = await win.webContents.executeJavaScript(`
      (() => {
        const wrap = document.getElementById('saved-views-control-wrap');
        const select = document.getElementById('saved-views-select');
        const btnSave = document.getElementById('btn-save-current-view');
        return {
          wrapExists: !!wrap,
          selectExists: !!select,
          btnSaveExists: !!btnSave,
          selectText: select ? select.options[0]?.text : ''
        };
      })()
    `);
    console.log('✓ Saved Views controls check:', controlCheck);

    const shot1 = await win.webContents.capturePage();
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'saved_views_control.png'), shot1.toPNG());
    console.log('✓ Saved Views control screenshot captured.');

    // 2. Set filters (Priority: High, Website: No Website) and click Save View
    const modalOpened = await win.webContents.executeJavaScript(`
      (() => {
        const priFilter = document.getElementById('saved-filter-priority');
        const webFilter = document.getElementById('saved-filter-website');
        if (priFilter) {
          priFilter.value = 'High';
          AppState.savedFilters.priority = 'High';
        }
        if (webFilter) {
          webFilter.value = 'NO';
          AppState.savedFilters.website = 'NO';
        }

        // Trigger Save View button
        const btn = document.getElementById('btn-save-current-view');
        if (btn) {
          btn.click();
          const modal = document.getElementById('modal-saved-view');
          const input = document.getElementById('saved-view-name-input');
          if (input) input.value = 'High Priority — No Website';
          return {
            modalVisible: modal && !modal.classList.contains('hidden'),
            previewChipsCount: document.querySelectorAll('#saved-view-preview-list .saved-view-badge-chip').length
          };
        }
        return { error: 'btn not found' };
      })()
    `);
    console.log('✓ Save View modal opened check:', modalOpened);
    await new Promise((r) => setTimeout(r, 1000));

    const shot2 = await win.webContents.capturePage();
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'saved_views_modal.png'), shot2.toPNG());
    console.log('✓ Saved Views modal screenshot captured.');

    // 3. Submit view creation
    const createdResult = await win.webContents.executeJavaScript(`
      (() => {
        const submitBtn = document.getElementById('btn-submit-saved-view-modal');
        if (submitBtn) {
          submitBtn.click();
          return { submitted: true };
        }
        return { submitted: false };
      })()
    `);
    console.log('✓ Submit modal check:', createdResult);
    await new Promise((r) => setTimeout(r, 1500));

    // 4. Verify active view actions visible & capture applied screenshot
    const activeCheck = await win.webContents.executeJavaScript(`
      (() => {
        const actionsBox = document.getElementById('saved-views-active-actions');
        const select = document.getElementById('saved-views-select');
        return {
          actionsVisible: actionsBox && !actionsBox.classList.contains('hidden'),
          selectedVal: select ? select.value : '',
          activeViewId: AppState.activeSavedViewId,
          activeViewText: select ? select.options[select.selectedIndex]?.text : ''
        };
      })()
    `);
    console.log('✓ Active Saved View UI check:', activeCheck);

    const shot3 = await win.webContents.capturePage();
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'saved_views_applied.png'), shot3.toPNG());
    console.log('✓ Applied Saved View screenshot captured.');

    // 5. Cleanup test view
    if (activeCheck.activeViewId) {
      console.log(`[Cleanup] Deleting test view ${activeCheck.activeViewId}...`);
      await fetch(`http://localhost:3000/api/saved-views/${encodeURIComponent(activeCheck.activeViewId)}`, {
        method: 'DELETE'
      });
      console.log('✓ Test view cleaned up.');
    }

    console.log('\n===================================================');
    console.log('ALL SAVED VIEWS UI VERIFICATIONS COMPLETED!');
    console.log('===================================================');
  } catch (err) {
    console.error('UI verification error:', err);
  } finally {
    if (win) win.close();
    app.quit();
  }
});
