const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const ARTIFACT_DIR = process.env.ARTIFACT_DIR || path.join(__dirname, '..', 'scratch');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1400, height: 900, show: false });
  try {
    await win.loadURL('http://127.0.0.1:3000');
    await new Promise(r => setTimeout(r, 2000));

    await win.webContents.executeJavaScript(`
      (() => {
        document.querySelector('a[data-tab="outreach"]').click();
      })()
    `);
    await new Promise(r => setTimeout(r, 1000));

    // Scroll workspace right panel to activity section
    await win.webContents.executeJavaScript(`
      (() => {
        const panel = document.getElementById('conversation-workspace-panel');
        const sec = document.getElementById('ws-activity-section');
        if (panel && sec) {
          panel.scrollTop = sec.offsetTop - 30;
        }
      })()
    `);
    await new Promise(r => setTimeout(r, 500));

    // Type "WhatsApp" into search
    await win.webContents.executeJavaScript(`
      (() => {
        const searchInput = document.getElementById('ws-activity-search');
        if (searchInput) {
          searchInput.value = 'WhatsApp';
          searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
      })()
    `);
    await new Promise(r => setTimeout(r, 300));

    // Capture screenshot with active search filter
    const activeSearchImg = await win.webContents.capturePage();
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'activity_search_filtered.png'), activeSearchImg.toPNG());
    console.log('✓ Captured activity_search_filtered.png');

    // Open Lead Detail Modal with active lead
    await win.webContents.executeJavaScript(`
      (() => {
        const viewLeadBtn = document.getElementById('ws-btn-view-lead');
        if (viewLeadBtn) viewLeadBtn.click();
      })()
    `);
    await new Promise(r => setTimeout(r, 1000));

    // Scroll modal to detail-activity-card
    await win.webContents.executeJavaScript(`
      (() => {
        const modal = document.getElementById('modal-lead-details');
        const card = document.getElementById('detail-activity-card');
        if (card) card.scrollIntoView({ behavior: 'instant', block: 'center' });
      })()
    `);
    await new Promise(r => setTimeout(r, 500));

    const modalImg = await win.webContents.capturePage();
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'lead_detail_modal_activity_search.png'), modalImg.toPNG());
    console.log('✓ Captured lead_detail_modal_activity_search.png');

  } finally {
    win.close();
    app.quit();
  }
});
