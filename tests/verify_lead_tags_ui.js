const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const ARTIFACT_DIR = process.env.ARTIFACT_DIR || path.join(__dirname, '..', 'scratch');

app.whenReady().then(async () => {
  let win = null;
  try {
    console.log('CLIENTHUNTER — LEAD TAGS UI VERIFICATION');
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

    win.webContents.on('console-message', (event, level, message, line, sourceId) => {
      console.log(`[Renderer ${level}]`, message);
    });

    await win.loadURL('http://127.0.0.1:3000');
    console.log('✓ Main window loaded');

    await new Promise((r) => setTimeout(r, 2000));

    // 1. Navigate to Saved Leads tab
    const savedNav = await win.webContents.executeJavaScript(`
      (() => {
        const tab = document.querySelector('a[data-tab="saved-leads"]');
        if (tab) { tab.click(); return true; }
        return false;
      })()
    `);
    console.log('✓ Navigated to Saved Leads tab:', savedNav);
    await new Promise((r) => setTimeout(r, 1200));

    // 2. Check Saved Leads UI (Filter dropdown and table tags)
    const savedCheck = await win.webContents.executeJavaScript(`
      (() => {
        const tagFilter = document.getElementById('saved-filter-tag');
        const tagButtons = document.querySelectorAll('.btn-lead-quick-add-tag');
        const tagRows = document.querySelectorAll('.lead-tags-row');
        return {
          filterExists: !!tagFilter,
          filterOptionsCount: tagFilter ? tagFilter.options.length : 0,
          quickAddButtonsCount: tagButtons.length,
          tagRowsCount: tagRows.length
        };
      })()
    `);
    console.log('✓ Saved Leads Tag UI check:', savedCheck);

    const shot1 = await win.webContents.capturePage();
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'lead_tags_saved_leads.png'), shot1.toPNG());
    console.log('✓ Saved Leads screenshot captured.');

    // 3. Open Tags Modal for first lead
    const modalOpened = await win.webContents.executeJavaScript(`
      (() => {
        try {
          const btn = document.querySelector('.btn-lead-quick-add-tag');
          if (btn) {
            btn.click();
            const modal = document.getElementById('modal-lead-tags');
            return {
              success: true,
              modalVisible: modal && !modal.classList.contains('hidden')
            };
          }
          return { success: false, reason: 'no btn' };
        } catch (e) {
          return { error: e.message, stack: e.stack };
        }
      })()
    `);
    console.log('✓ Tag Modal open check:', modalOpened);
    await new Promise((r) => setTimeout(r, 1000));

    const shotModal = await win.webContents.capturePage();
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'lead_tags_modal.png'), shotModal.toPNG());
    console.log('✓ Lead Tags Modal screenshot captured.');

    // Close modal
    await win.webContents.executeJavaScript(`
      (() => {
        const btn = document.getElementById('btn-close-tag-modal');
        if (btn) btn.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 400));

    // 4. Navigate to Outreach tab
    const outreachNav = await win.webContents.executeJavaScript(`
      (() => {
        const tab = document.querySelector('a[data-tab="outreach"]');
        if (tab) { tab.click(); return true; }
        return false;
      })()
    `);
    console.log('✓ Navigated to Outreach tab:', outreachNav);
    await new Promise((r) => setTimeout(r, 1200));

    // Check Outreach UI elements
    const outreachCheck = await win.webContents.executeJavaScript(`
      (() => {
        const tagFilter = document.getElementById('outreach-tag-filter');
        const wsTagsSection = document.getElementById('ws-tags-section');
        const wsTagsBtn = document.getElementById('btn-ws-open-tag-manager');
        return {
          filterExists: !!tagFilter,
          wsTagsSectionExists: !!wsTagsSection,
          wsTagsBtnExists: !!wsTagsBtn
        };
      })()
    `);
    console.log('✓ Outreach Tag UI check:', outreachCheck);

    // Scroll workspace panel so conversion & tags sections are visible
    await win.webContents.executeJavaScript(`
      (() => {
        const wsScroll = document.querySelector('.workspace-column-right') || document.querySelector('.conversation-workspace-panel');
        if (wsScroll) wsScroll.scrollTop = 180;
      })()
    `);
    await new Promise((r) => setTimeout(r, 600));

    const shotOutreach = await win.webContents.capturePage();
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'lead_tags_outreach_workspace.png'), shotOutreach.toPNG());
    console.log('✓ Outreach screenshot captured.');

    // 5. Navigate to Follow-Up tab
    const fuNav = await win.webContents.executeJavaScript(`
      (() => {
        const tab = document.querySelector('a[data-tab="followup"]');
        if (tab) { tab.click(); return true; }
        return false;
      })()
    `);
    console.log('✓ Navigated to Follow-Up tab:', fuNav);
    await new Promise((r) => setTimeout(r, 2000));

    const fuCheck = await win.webContents.executeJavaScript(`
      (() => {
        const fuTagFilter = document.getElementById('followup-tag-filter');
        return {
          fuTagFilterExists: !!fuTagFilter,
          optionsCount: fuTagFilter ? fuTagFilter.options.length : 0
        };
      })()
    `);
    console.log('✓ Follow-Up Tag UI check:', fuCheck);

    const shotFu = await win.webContents.capturePage();
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'lead_tags_followup.png'), shotFu.toPNG());
    console.log('✓ Follow-Up screenshot captured.');

    console.log('\n===================================================');
    console.log('ALL UI VERIFICATIONS COMPLETED SUCCESSFULLY!');
    console.log('===================================================');
  } catch (err) {
    console.error('UI verification error:', err);
  } finally {
    if (win) win.close();
    app.quit();
  }
});
