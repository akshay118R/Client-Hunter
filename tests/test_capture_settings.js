const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const artifactDir = process.env.ARTIFACT_DIR || path.join(__dirname, '..', 'scratch');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // 1. Load Settings directly
  await win.loadURL('http://127.0.0.1:3000/#settings');
  await new Promise(r => setTimeout(r, 2500));

  const clickInfo = await win.webContents.executeJavaScript(`
    (function() {
      const btn = document.getElementById('tab-btn-whatsapp');
      if (btn) {
        btn.click();
        return { clicked: true };
      }
      return { clicked: false, allBtns: Array.from(document.querySelectorAll('.settings-tab-btn')).map(b => b.id) };
    })()
  `);
  console.log('Click info:', clickInfo);
  await new Promise(r => setTimeout(r, 1000));

  const imgSettings = await win.webContents.capturePage();
  fs.writeFileSync(path.join(artifactDir, 'settings_auto_timer.png'), imgSettings.toPNG());
  console.log('Saved settings_auto_timer.png');

  // 2. Load Outreach and open Composer
  await win.webContents.executeJavaScript(`
    (async function() {
      switchView('outreach');
      await new Promise(r => setTimeout(r, 800));
      const lead = AppState.savedLeads?.[0] || {
        id: 'capture_lead_1',
        business_name: 'Radiant Dental Care',
        category: 'Dental Clinic',
        city: 'Hyderabad',
        state: 'Telangana',
        phone: '+91 98765 11111',
        website_status: 'YES',
        opportunity_score: 95
      };
      await openOutreachComposer(lead);
    })()
  `);
  await new Promise(r => setTimeout(r, 1000));

  const imgComposer = await win.webContents.capturePage();
  fs.writeFileSync(path.join(artifactDir, 'composer_timer_countdown.png'), imgComposer.toPNG());
  console.log('Saved composer_timer_countdown.png');

  app.quit();
  process.exit(0);
});
