const { contextBridge, ipcRenderer } = require('electron');

// Secure context bridge: Expose only minimal, safe desktop metadata & file export/backup
contextBridge.exposeInMainWorld('desktopApp', {
  isDesktop: true,
  platform: process.platform,
  version: '2.2.0',
  saveFileDialog: (options) => ipcRenderer.invoke('show-save-dialog', options),
  saveExportFile: (options) => ipcRenderer.invoke('save-export-file', options),
  openFileDialog: (options) => ipcRenderer.invoke('show-open-dialog', options),
  readBackupFile: (filePath) => ipcRenderer.invoke('read-backup-file', filePath),
  saveBackupFile: (payload) => ipcRenderer.invoke('save-backup-file', payload),
  onBackendReconnected: (callback) => {
    if (typeof callback === 'function') {
      ipcRenderer.on('backend-reconnected', (event, data) => callback(data));
    }
  }
});


