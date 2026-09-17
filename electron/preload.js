const { contextBridge } = require('electron');

// Secure context bridge: Expose only minimal, safe desktop metadata
contextBridge.exposeInMainWorld('desktopApp', {
  isDesktop: true,
  platform: process.platform,
  version: '2.0.0'
});
