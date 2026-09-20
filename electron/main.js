const { app, BrowserWindow, shell, dialog, Menu, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const net = require('net');
const { fork, exec } = require('child_process');

// 1. Single-Instance Enforcement
const gotSingleInstanceLock = app.requestSingleInstanceLock();
let mainWindow = null;
let serverProcess = null;
let serverPort = null;
let isShuttingDown = false;
let isRestartingBackend = false;
let isCrashDialogOpen = false;
let consecutiveRestartAttempts = 0;
const MAX_RESTART_ATTEMPTS = 3;

if (!gotSingleInstanceLock) {
  console.log('[ClientHunter] Another instance is already running. Exiting.');
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isMaximized()) mainWindow.maximize();
      mainWindow.focus();
    }
  });

  setupAppLifecycle();
}

function setupAppLifecycle() {
  // Disable default application menu for a sleek native application experience
  Menu.setApplicationMenu(null);

  app.whenReady().then(async () => {
    await initializeApplicationServices();
  });

  app.on('window-all-closed', () => {
    // On Windows, closing all windows quits the application
    cleanUpAndQuit();
  });

  app.on('before-quit', () => {
    isShuttingDown = true;
    terminateServerProcess();
  });

  app.on('will-quit', () => {
    terminateServerProcess();
  });

  process.on('exit', () => {
    terminateServerProcess();
  });
}

async function initializeApplicationServices() {
  try {
    console.log('[ClientHunter] Desktop application initializing...');
    const port = await resolvePort(process.env.PORT || 3000);
    serverPort = port;
    console.log(`[ClientHunter] Designated backend port: ${port}`);

    await startBackendServer(port);
    await waitForBackendReady(port, 30000);
    consecutiveRestartAttempts = 0;

    if (!mainWindow) {
      createMainWindow(port);
    } else {
      mainWindow.webContents.send('backend-reconnected', { port });
    }
  } catch (err) {
    console.error('[ClientHunter] Critical startup error:', err);
    if (!isShuttingDown) {
      const choice = dialog.showMessageBoxSync({
        type: 'warning',
        title: 'Client Hunter Startup Notice',
        message: 'Failed to launch Client Hunter local services.\n\nYour data has not been modified.\n\nWould you like to retry starting local services?',
        detail: `Error detail: ${err.message || 'Server timeout or startup failure'}`,
        buttons: ['Retry Starting Services', 'Close Application'],
        defaultId: 0,
        cancelId: 1,
        noLink: true
      });

      if (choice === 0) {
        terminateServerProcess();
        setTimeout(() => initializeApplicationServices(), 500);
      } else {
        cleanUpAndQuit();
      }
    }
  }
}

// 2. Port Management & Conflict Detection
function checkPortAvailable(port) {
  return new Promise((resolve) => {
    const tester = net.createServer()
      .once('error', (err) => {
        resolve(false);
      })
      .once('listening', () => {
        tester.close(() => resolve(true));
      })
      .listen(port);
  });
}

async function resolvePort(preferredPort) {
  const pref = parseInt(preferredPort, 10);
  const isPrefFree = await checkPortAvailable(pref);
  if (isPrefFree) {
    return pref;
  }
  console.warn(`[ClientHunter] Preferred port ${pref} is occupied. Locating alternate available port...`);
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

// 3. Backend Server Process Management
function getBackendScriptPath() {
  if (app.isPackaged) {
    return path.join(app.getAppPath(), 'server.js');
  }
  return path.join(__dirname, '..', 'server.js');
}

function getAppIconPath() {
  const iconNames = ['logo.png', 'icon.ico', 'icon.png', 'logo.webp'];
  for (const name of iconNames) {
    const p = app.isPackaged
      ? path.join(process.resourcesPath, 'assets', name)
      : path.join(__dirname, '..', 'assets', name);
    if (fs.existsSync(p)) return p;
    const directPath = path.join(__dirname, '..', 'assets', name);
    if (fs.existsSync(directPath)) return directPath;
  }
  return undefined;
}

function startBackendServer(port) {
  return new Promise((resolve, reject) => {
    const serverScript = getBackendScriptPath();
    if (!fs.existsSync(serverScript)) {
      return reject(new Error(`Backend server script not found at: ${serverScript}`));
    }

    const userDataDir = app.getPath('userData');
    console.log(`[ClientHunter] Runtime user data directory: ${userDataDir}`);

    // Prepare environment variables
    const childEnv = {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      CLIENTHUNTER_USER_DATA: userDataDir,
      PORT: String(port)
    };

    const rootEnv = path.join(__dirname, '..', '.env');
    if (fs.existsSync(rootEnv)) {
      childEnv.CLIENTHUNTER_ENV_PATH = rootEnv;
    } else if (process.resourcesPath) {
      const resourceEnv = path.join(process.resourcesPath, '.env');
      if (fs.existsSync(resourceEnv)) {
        childEnv.CLIENTHUNTER_ENV_PATH = resourceEnv;
      }
    }

    try {
      serverProcess = fork(serverScript, [], {
        execPath: process.execPath,
        env: childEnv,
        silent: true,
        stdio: ['pipe', 'pipe', 'pipe', 'ipc']
      });

      serverProcess.stdout.on('data', (data) => {
        const text = data.toString();
        // Safe logging without secrets
        process.stdout.write(`[Server stdout] ${text}`);
      });

      serverProcess.stderr.on('data', (data) => {
        const text = data.toString();
        process.stderr.write(`[Server stderr] ${text}`);
      });

      serverProcess.on('error', (err) => {
        console.error('[ClientHunter] Server process encounter error:', err);
        if (!isShuttingDown && !isRestartingBackend) {
          handleUnexpectedBackendCrash(null, null, err);
        }
      });

      serverProcess.on('exit', (code, signal) => {
        console.log(`[ClientHunter] Backend server process exited with code=${code}, signal=${signal}`);
        serverProcess = null;
        if (!isShuttingDown && !isRestartingBackend) {
          console.error('[ClientHunter] Server exited unexpectedly while application was running.');
          handleUnexpectedBackendCrash(code, signal, null);
        }
      });

      serverProcess.on('message', (msg) => {
        if (msg && msg.type === 'server-ready') {
          console.log(`[ClientHunter] Server reported readiness on port ${msg.port}`);
          resolve();
        }
      });

      // Also resolve when readiness polling confirms HTTP response
      resolve();
    } catch (spawnErr) {
      reject(spawnErr);
    }
  });
}

// 3.1 Backend Crash Detection & Recovery Routines
function handleUnexpectedBackendCrash(code, signal, err) {
  if (isShuttingDown || isRestartingBackend) return;
  if (isCrashDialogOpen) return;
  isCrashDialogOpen = true;

  const detailInfo = err
    ? err.message
    : (code !== null ? `Process exit code: ${code}` : `Signal: ${signal}`);
  console.log(`[ClientHunter] Presenting recovery notice to user (Details: ${detailInfo})`);

  const dialogOptions = {
    type: 'warning',
    title: 'ClientHunter Services Notice',
    message: 'ClientHunter services stopped unexpectedly.\n\nYour data has not been deleted.\n\nYou can restart the ClientHunter services without closing the application.',
    detail: `Details: ${detailInfo}\n\nClick "Restart Services" to reconnect immediately, or "Close Application" to exit safely.`,
    buttons: ['Restart Services', 'Close Application'],
    defaultId: 0,
    cancelId: 1,
    noLink: true
  };

  const choice = mainWindow && !mainWindow.isDestroyed()
    ? dialog.showMessageBoxSync(mainWindow, dialogOptions)
    : dialog.showMessageBoxSync(dialogOptions);

  isCrashDialogOpen = false;

  if (choice === 0) {
    recoverBackendServices();
  } else {
    cleanUpAndQuit();
  }
}

async function recoverBackendServices() {
  if (isRestartingBackend) return;
  isRestartingBackend = true;

  consecutiveRestartAttempts++;
  console.log(`[ClientHunter] Initiating safe backend recovery (Attempt ${consecutiveRestartAttempts}/${MAX_RESTART_ATTEMPTS})...`);

  if (consecutiveRestartAttempts > MAX_RESTART_ATTEMPTS) {
    console.error(`[ClientHunter] Max consecutive restart attempts (${MAX_RESTART_ATTEMPTS}) reached. Halting auto-recovery.`);
    dialog.showMessageBoxSync({
      type: 'error',
      title: 'ClientHunter Recovery Notice',
      message: 'ClientHunter services could not be restarted automatically.\n\nYour existing data has not been modified.\n\nPlease restart ClientHunter manually.',
      buttons: ['Close Application'],
      defaultId: 0,
      noLink: true
    });
    cleanUpAndQuit();
    return;
  }

  try {
    // 1. Confirm previous server process is terminated
    terminateServerProcess();
    await new Promise((r) => setTimeout(r, 600));

    // 2. Resolve port safely
    const targetPort = serverPort || 3000;
    const resolvedPort = await resolvePort(targetPort);
    console.log(`[ClientHunter] Re-launching backend on port: ${resolvedPort}`);

    // 3. Start backend process
    await startBackendServer(resolvedPort);

    // 4. Wait for readiness probe
    await waitForBackendReady(resolvedPort, 30000);

    const portChanged = serverPort !== resolvedPort;
    serverPort = resolvedPort;
    consecutiveRestartAttempts = 0;
    isRestartingBackend = false;

    console.log('[ClientHunter] Backend services recovered and verified ready.');

    // 5. Notify frontend or reload URL if port changed
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (portChanged) {
        console.log(`[ClientHunter] Port changed from previous session. Reloading window to: http://127.0.0.1:${resolvedPort}`);
        mainWindow.loadURL(`http://127.0.0.1:${resolvedPort}`);
      } else {
        console.log('[ClientHunter] Port retained. Sending "backend-reconnected" IPC signal to frontend.');
        mainWindow.webContents.send('backend-reconnected', { port: resolvedPort });
      }
    }
  } catch (recoverErr) {
    console.error('[ClientHunter] Backend recovery attempt failed:', recoverErr);
    isRestartingBackend = false;
    handleUnexpectedBackendCrash(null, null, recoverErr);
  }
}

// 4. HTTP Readiness Verification
function waitForBackendReady(port, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const probeUrl = `http://127.0.0.1:${port}/api/system/status`;

    const poll = () => {
      if (Date.now() - startTime > timeoutMs) {
        return reject(new Error(`Backend server did not respond at ${probeUrl} within ${timeoutMs / 1000}s.`));
      }

      const req = http.get(probeUrl, (res) => {
        if (res.statusCode >= 200 && res.statusCode < 500) {
          console.log(`[ClientHunter] Backend verified ready at ${probeUrl} (status: ${res.statusCode})`);
          resolve();
        } else {
          setTimeout(poll, 150);
        }
      });

      req.on('error', () => {
        setTimeout(poll, 150);
      });

      req.setTimeout(1000, () => {
        req.destroy();
        setTimeout(poll, 150);
      });
    };

    poll();
  });
}

// 5. Desktop Application Window
function createMainWindow(port) {
  const iconPath = getAppIconPath();

  mainWindow = new BrowserWindow({
    title: 'Client Hunter',
    width: 1366,
    height: 860,
    minWidth: 1024,
    minHeight: 680,
    icon: iconPath,
    backgroundColor: '#0a0d14',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.webContents.session.clearCache().catch(() => {});
  mainWindow.loadURL(`http://127.0.0.1:${port}`);

  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
    console.log('[ClientHunter] Desktop window presented successfully in maximized state.');
  });

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.insertCSS(`
      html, body, * {
        scrollbar-width: none !important;
        -ms-overflow-style: none !important;
      }
      ::-webkit-scrollbar, *::-webkit-scrollbar {
        display: none !important;
        width: 0px !important;
        height: 0px !important;
        background: transparent !important;
      }
    `);
  });

  // Handle external link clicks (WhatsApp wa.me, Google Maps, external documentation)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    console.log(`[ClientHunter] Delegating external URL to default browser: ${url}`);
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Prevent in-window navigation away from local ClientHunter application
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const isLocal = url.startsWith(`http://127.0.0.1:${port}`) || url.startsWith(`http://localhost:${port}`);
    if (!isLocal) {
      event.preventDefault();
      console.log(`[ClientHunter] Intercepted navigation away from app. Opening externally: ${url}`);
      shell.openExternal(url);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// 6. Windows Process Cleanup & Orphan Prevention
function terminateServerProcess() {
  if (!serverProcess) return;

  const proc = serverProcess;
  serverProcess = null;

  try {
    console.log('[ClientHunter] Initiating clean backend termination...');
    if (proc.connected) {
      proc.send('shutdown');
      proc.disconnect();
    }
    proc.kill('SIGTERM');

    // On Windows, enforce process tree termination using taskkill to eliminate any orphan processes
    if (process.platform === 'win32' && proc.pid) {
      exec(`taskkill /pid ${proc.pid} /T /F`, (err) => {
        if (err && !err.message.includes('not found')) {
          // Process might have already exited cleanly
        }
      });
    }
  } catch (err) {
    console.warn('[ClientHunter] Error during process cleanup:', err.message);
  }
}

function cleanUpAndQuit() {
  isShuttingDown = true;
  terminateServerProcess();
  setTimeout(() => {
    app.quit();
  }, 300);
}

// 7. Desktop Native Export IPC Handlers
ipcMain.handle('show-save-dialog', async (event, options = {}) => {
  if (!mainWindow) return { canceled: true };
  return await dialog.showSaveDialog(mainWindow, options);
});

ipcMain.handle('save-export-file', async (event, payload = {}) => {
  if (!mainWindow) {
    return { success: false, error: 'Desktop main window is not available.' };
  }

  const { defaultFileName = 'ClientHunter_Export.csv', content = '', filters } = payload;

  // Derive initial save directory: user's Downloads or Documents directory (never C:\ root)
  let baseFolder = '';
  try {
    baseFolder = app.getPath('downloads') || app.getPath('documents');
  } catch (_) {
    baseFolder = app.getPath('userData');
  }

  // Ensure unique initial filename if file already exists in default folder
  let targetFileName = defaultFileName;
  const ext = path.extname(defaultFileName) || '.csv';
  const nameBase = path.basename(defaultFileName, ext);
  let counter = 1;
  while (fs.existsSync(path.join(baseFolder, targetFileName))) {
    targetFileName = `${nameBase}_${counter}${ext}`;
    counter++;
  }

  const defaultPath = path.join(baseFolder, targetFileName);

  const defaultFilters = ext.toLowerCase() === '.json'
    ? [{ name: 'JSON Files (*.json)', extensions: ['json'] }, { name: 'All Files (*.*)', extensions: ['*'] }]
    : [{ name: 'CSV Files (*.csv)', extensions: ['csv'] }, { name: 'All Files (*.*)', extensions: ['*'] }];

  const saveResult = await dialog.showSaveDialog(mainWindow, {
    title: 'Export ClientHunter Lead Data',
    defaultPath,
    filters: filters || defaultFilters,
    properties: ['showOverwriteConfirmation']
  });

  if (saveResult.canceled || !saveResult.filePath) {
    return { canceled: true };
  }

  try {
    fs.writeFileSync(saveResult.filePath, content, 'utf8');
    console.log(`[ClientHunter] Export saved successfully to: ${saveResult.filePath}`);
    return {
      success: true,
      filePath: saveResult.filePath,
      fileName: path.basename(saveResult.filePath)
    };
  } catch (writeErr) {
    console.error('[ClientHunter] Failed to write export file:', writeErr);
    return {
      success: false,
      error: `Export failed. Could not save file: ${writeErr.message}`
    };
  }
});

// 8. Desktop Native Backup & Restore IPC Handlers
ipcMain.handle('show-open-dialog', async (event, options = {}) => {
  if (!mainWindow) return { canceled: true };
  const defaultOptions = {
    title: 'Select ClientHunter Backup File',
    filters: [
      { name: 'JSON Backup Files (*.json)', extensions: ['json'] },
      { name: 'All Files (*.*)', extensions: ['*'] }
    ],
    properties: ['openFile']
  };
  return await dialog.showOpenDialog(mainWindow, { ...defaultOptions, ...options });
});

ipcMain.handle('read-backup-file', async (event, filePath) => {
  if (!filePath || typeof filePath !== 'string') {
    return { success: false, error: 'Invalid file path specified.' };
  }
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return { success: true, content, fileName: path.basename(filePath), filePath };
  } catch (err) {
    console.error('[ClientHunter] Error reading backup file:', err);
    return { success: false, error: `Could not read file: ${err.message}` };
  }
});

ipcMain.handle('save-backup-file', async (event, payload = {}) => {
  if (!mainWindow) {
    return { success: false, error: 'Desktop main window is not available.' };
  }

  const { defaultFileName = 'ClientHunter_Backup.json', content = '' } = payload;

  let baseFolder = '';
  try {
    baseFolder = app.getPath('documents') || app.getPath('downloads');
  } catch (_) {
    baseFolder = app.getPath('userData');
  }

  const defaultPath = path.join(baseFolder, defaultFileName);

  const saveResult = await dialog.showSaveDialog(mainWindow, {
    title: 'Save ClientHunter Backup File',
    defaultPath,
    filters: [
      { name: 'JSON Backup Files (*.json)', extensions: ['json'] },
      { name: 'All Files (*.*)', extensions: ['*'] }
    ],
    properties: ['showOverwriteConfirmation']
  });

  if (saveResult.canceled || !saveResult.filePath) {
    return { canceled: true };
  }

  try {
    fs.writeFileSync(saveResult.filePath, content, 'utf8');
    console.log(`[ClientHunter] Backup saved successfully to: ${saveResult.filePath}`);
    return {
      success: true,
      filePath: saveResult.filePath,
      fileName: path.basename(saveResult.filePath)
    };
  } catch (writeErr) {
    console.error('[ClientHunter] Failed to write backup file:', writeErr);
    return {
      success: false,
      error: `Could not save backup file: ${writeErr.message}`
    };
  }
});


