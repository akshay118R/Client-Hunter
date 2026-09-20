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

  await win.loadURL('http://127.0.0.1:3000/#settings');
  await new Promise(r => setTimeout(r, 2500));

  const debug = await win.webContents.executeJavaScript(`
    (function() {
      switchView('settings');
      SettingsModule.switchSettingsTab('whatsapp');
      const panel = document.getElementById('panel-settings-whatsapp');
      const r = panel ? panel.getBoundingClientRect() : null;
      return {
        panelFound: Boolean(panel),
        panelActive: panel ? panel.classList.contains('active') : false,
        rect: r ? { top: r.top, left: r.left, width: r.width, height: r.height } : null,
        selectVal: document.getElementById('set-wa-auto-timer')?.value
      };
    })()
  `);
  console.log('DEBUG:', debug);

  await new Promise(r => setTimeout(r, 500));
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(artifactDir, 'settings_auto_timer.png'), img.toPNG());
  console.log('Saved settings_auto_timer.png');

  app.quit();
  process.exit(0);
});
