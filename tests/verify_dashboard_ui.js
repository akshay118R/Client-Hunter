const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const ARTIFACT_DIR = process.env.ARTIFACT_DIR || path.join(__dirname, '..', 'scratch');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1400,
    height: 950,
    show: false
  });

  await win.loadURL('http://127.0.0.1:3000/#dashboard');
  await new Promise(r => setTimeout(r, 2000));

  // 1. All Time Overview
  const imgAll = await win.capturePage();
  fs.writeFileSync(path.join(ARTIFACT_DIR, 'dashboard_analytics_overview.png'), imgAll.toPNG());
  console.log('Captured All Time overview');

  // 2. Click Today and wait until today is active
  await win.webContents.executeJavaScript(`
    (async () => {
      const btn = document.getElementById('btn-filter-today');
      if (btn) {
        btn.click();
      }
      // Wait for fetch to finish
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 100));
        if (btn && btn.classList.contains('active') && !AppState.analyticsLoading) break;
      }
    })()
  `);
  await new Promise(r => setTimeout(r, 600));

  const imgToday = await win.capturePage();
  fs.writeFileSync(path.join(ARTIFACT_DIR, 'dashboard_analytics_today.png'), imgToday.toPNG());
  console.log('Captured Today view');

  app.quit();
});
