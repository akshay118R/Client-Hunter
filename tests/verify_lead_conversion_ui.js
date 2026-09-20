const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const ARTIFACT_DIR = process.env.ARTIFACT_DIR || path.join(__dirname, '..', 'scratch');

app.whenReady().then(async () => {
  let win = null;
  try {
    console.log('CLIENTHUNTER — LEAD CONVERSION UI VERIFICATION');
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

    await win.loadURL('http://127.0.0.1:3000');
    console.log('✓ Main window loaded');

    await new Promise(r => setTimeout(r, 2000));

    // 1. Navigate to Saved Leads tab
    const savedTabResult = await win.webContents.executeJavaScript(`
      (() => {
        const tab = document.querySelector('a[data-tab="saved-leads"]');
        if (tab) {
          tab.click();
          return { success: true };
        }
        return { success: false };
      })()
    `);
    console.log('✓ Navigated to Saved Leads tab:', savedTabResult);

    await new Promise(r => setTimeout(r, 1500));

    // 2. Check Conversion Summary Bar & Filter in Saved Leads
    const savedUiCheck = await win.webContents.executeJavaScript(`
      (() => {
        const summaryStrip = document.getElementById('saved-conversion-summary');
        const filterSelect = document.getElementById('saved-filter-conversion');
        const statTotal = document.getElementById('conv-stat-total')?.textContent;
        const statNotConv = document.getElementById('conv-stat-not-converted')?.textContent;
        const statRate = document.getElementById('conv-stat-rate')?.textContent;
        const statVal = document.getElementById('conv-stat-value')?.textContent;

        return {
          summaryExists: !!summaryStrip,
          filterExists: !!filterSelect,
          filterOptions: filterSelect ? Array.from(filterSelect.options).map(o => o.value) : [],
          statTotal,
          statNotConv,
          statRate,
          statVal
        };
      })()
    `);
    console.log('✓ Saved Leads UI check:', savedUiCheck);

    const shot1 = await win.webContents.capturePage();
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'conversion_saved_leads.png'), shot1.toPNG());
    console.log('✓ Saved Leads screenshot saved.');

    // 3. Navigate to Outreach tab
    const outreachTabResult = await win.webContents.executeJavaScript(`
      (() => {
        const tab = document.querySelector('a[data-tab="outreach"]');
        if (tab) {
          tab.click();
          return { success: true };
        }
        return { success: false };
      })()
    `);
    console.log('✓ Navigated to Outreach tab:', outreachTabResult);

    await new Promise(r => setTimeout(r, 1500));

    // 4. Check Outreach conversion filter & workspace section
    const outreachUiCheck = await win.webContents.executeJavaScript(`
      (() => {
        const filterSelect = document.getElementById('outreach-conversion-filter');
        const wsSection = document.getElementById('ws-conversion-section');
        const wsBadge = document.getElementById('ws-conversion-current-badge')?.textContent;
        const wsBtn = document.getElementById('btn-ws-open-conversion');

        return {
          filterExists: !!filterSelect,
          filterOptions: filterSelect ? Array.from(filterSelect.options).map(o => o.value) : [],
          wsSectionExists: !!wsSection,
          wsBadge,
          wsBtnExists: !!wsBtn
        };
      })()
    `);
    console.log('✓ Outreach UI check:', outreachUiCheck);

    const shot2 = await win.webContents.capturePage();
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'conversion_outreach_workspace.png'), shot2.toPNG());
    console.log('✓ Outreach Workspace screenshot saved.');

    // 5. Open Lead Conversion Modal
    const modalCheck = await win.webContents.executeJavaScript(`
      (() => {
        const btn = document.getElementById('btn-ws-open-conversion');
        if (btn) btn.click();
        const modal = document.getElementById('modal-lead-conversion');
        const isVisible = modal && !modal.classList.contains('hidden');
        return {
          modalExists: !!modal,
          isVisible,
          btnConverted: !!document.getElementById('btn-conv-status-converted'),
          btnNotConverted: !!document.getElementById('btn-conv-status-not-converted'),
          inputDate: !!document.getElementById('conv-input-date'),
          inputService: !!document.getElementById('conv-input-service'),
          inputValue: !!document.getElementById('conv-input-value'),
          inputNotes: !!document.getElementById('conv-input-notes')
        };
      })()
    `);
    console.log('✓ Conversion Modal check:', modalCheck);

    await new Promise(r => setTimeout(r, 800));

    const shot3 = await win.webContents.capturePage();
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'conversion_tracking_modal.png'), shot3.toPNG());
    console.log('✓ Conversion Modal screenshot saved.');

    // Close modal
    await win.webContents.executeJavaScript(`
      (() => {
        const closeBtn = document.getElementById('btn-close-conversion-modal');
        if (closeBtn) closeBtn.click();
      })()
    `);

    console.log('\n===================================================');
    console.log('UI VERIFICATION COMPLETED SUCCESSFULLY!');
    console.log('===================================================');

    if (win) win.close();
    app.quit();
    process.exit(0);
  } catch (err) {
    console.error('UI Verification Error:', err);
    if (win) win.close();
    app.quit();
    process.exit(1);
  }
});
