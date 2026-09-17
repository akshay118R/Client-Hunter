const { app, BrowserWindow, shell, dialog, Menu } = require('electron');
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

if (!gotSingleInstanceLock) {
  console.log('[ClientHunter] Another instance is already running. Exiting.');
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  setupAppLifecycle();
}

function setupAppLifecycle() {
  // Disable default application menu for a sleek native application experience
  Menu.setApplicationMenu(null);

  app.whenReady().then(async () => {
    try {
      console.log('[ClientHunter] Desktop application initializing...');
      const port = await resolvePort(process.env.PORT || 3000);
      serverPort = port;
      console.log(`[ClientHunter] Designated backend port: ${port}`);

      await startBackendServer(port);
      await waitForBackendReady(port, 30000);
      createMainWindow(port);
    } catch (err) {
      console.error('[ClientHunter] Critical startup error:', err);
      dialog.showErrorBox(
        'Client Hunter Startup Error',
        `Failed to launch Client Hunter local services:\n\n${err.message}\n\nPlease verify system permissions and relaunch.`
      );
      cleanUpAndQuit();
    }
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
      .listen(port, '127.0.0.1');
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

    if (process.resourcesPath) {
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
        if (!isShuttingDown) {
          reject(err);
        }
      });

      serverProcess.on('exit', (code, signal) => {
        console.log(`[ClientHunter] Backend server process exited with code=${code}, signal=${signal}`);
        serverProcess = null;
        if (!isShuttingDown) {
          console.error('[ClientHunter] Server exited unexpectedly while application was running.');
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

  mainWindow.loadURL(`http://127.0.0.1:${port}`);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    console.log('[ClientHunter] Desktop window presented successfully.');
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
