const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const artifactDir = process.env.ARTIFACT_DIR || path.join(__dirname, '..', 'scratch');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // Load app at #settings
  await win.loadURL('http://127.0.0.1:3000/#settings');
  await new Promise(r => setTimeout(r, 2000));

  await win.webContents.executeJavaScript(`
    (function() {
      SettingsModule.switchSettingsTab('whatsapp');
    })()
  `);
  await new Promise(r => setTimeout(r, 800));

  const imgSettings = await win.webContents.capturePage();
  fs.writeFileSync(path.join(artifactDir, 'settings_auto_timer.png'), imgSettings.toPNG());
  console.log('Saved settings_auto_timer.png');

  app.quit();
  process.exit(0);
});
