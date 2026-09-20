const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const asar = require('@electron/asar');
const assert = require('assert');

const TEST_PORT = 3098;
const ASAR_PATH = path.join(__dirname, '../dist/win-unpacked/resources/app.asar');

// Verify that the packaged app.asar contains the new feature
function verifyAsarContents() {
  console.log('Verifying packaged app.asar at:', ASAR_PATH);
  assert(fs.existsSync(ASAR_PATH), 'app.asar must exist in dist/win-unpacked/resources/');

  const html = asar.extractFile(ASAR_PATH, 'index.html').toString('utf8');
  assert(html.includes('id="btn-go-to-top"'), 'app.asar index.html must contain id="btn-go-to-top"');
  assert(html.includes('btn-go-to-top-arrow'), 'app.asar index.html must contain arrow');
  assert(html.includes('btn-go-to-top-text'), 'app.asar index.html must contain text');
  assert(html.includes('Top'), 'app.asar index.html must contain Top');
  console.log('✓ [PASS] app.asar index.html contains "↑ Top" button');

  const css = asar.extractFile(ASAR_PATH, 'styles.css').toString('utf8');
  assert(css.includes('.btn-go-to-top'), 'app.asar styles.css must contain .btn-go-to-top');
  assert(css.includes('.btn-go-to-top.visible'), 'app.asar styles.css must contain .btn-go-to-top.visible');
  console.log('✓ [PASS] app.asar styles.css contains .btn-go-to-top styles');

  const js = asar.extractFile(ASAR_PATH, 'main.js').toString('utf8');
  assert(js.includes('initGoToTop'), 'app.asar main.js must contain initGoToTop');
  assert(js.includes('updateGoToTopVisibility'), 'app.asar main.js must contain updateGoToTopVisibility');
  console.log('✓ [PASS] app.asar main.js contains Go To Top controller');
}

// Serve directly from the packaged app.asar
function createPackagedAsarServer() {
  const server = http.createServer((req, res) => {
    let reqPath = req.url.split('?')[0].split('#')[0];
    if (reqPath === '/') reqPath = '/index.html';

    if (reqPath.startsWith('/api/')) {
      const proxyReq = http.request({
        hostname: '127.0.0.1',
        port: 3000,
        path: req.url,
        method: req.method,
        headers: req.headers
      }, (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
      });
      proxyReq.on('error', () => {
        res.writeHead(502);
        res.end(JSON.stringify({ error: 'Proxy error' }));
      });
      req.pipe(proxyReq);
      return;
    }

    const cleanPath = reqPath.replace(/^\//, '');
    try {
      const fileBuffer = asar.extractFile(ASAR_PATH, cleanPath);
      const ext = path.extname(cleanPath);
      const mimeTypes = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.ico': 'image/x-icon',
        '.svg': 'image/svg+xml'
      };
      res.writeHead(200, {
        'Content-Type': mimeTypes[ext] || 'application/octet-stream',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      });
      res.end(fileBuffer);
    } catch (e) {
      // Fallback to index.html from asar
      const htmlBuffer = asar.extractFile(ASAR_PATH, 'index.html');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(htmlBuffer);
    }
  });

  return new Promise((resolve) => {
    server.listen(TEST_PORT, '127.0.0.1', () => {
      console.log(`Packaged ASAR server running at http://127.0.0.1:${TEST_PORT}`);
      resolve(server);
    });
  });
}

app.whenReady().then(async () => {
  let server = null;
  let win = null;

  try {
    verifyAsarContents();
    server = await createPackagedAsarServer();

    win = new BrowserWindow({
      width: 1400,
      height: 900,
      show: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    console.log('Loading packaged application bundle in Electron...');
    await win.loadURL(`http://127.0.0.1:${TEST_PORT}/#dashboard`);
    await new Promise(r => setTimeout(r, 2000));

    async function exec(code) {
      return await win.webContents.executeJavaScript(code);
    }

    console.log('\n--- Verifying Packaged Button in Runtime DOM ---');
    const btnInfo = await exec(`
      (() => {
        const btn = document.getElementById('btn-go-to-top');
        if (!btn) return null;
        return {
          id: btn.id,
          arrow: btn.querySelector('.btn-go-to-top-arrow').textContent.trim(),
          text: btn.querySelector('.btn-go-to-top-text').textContent.trim(),
          display: window.getComputedStyle(btn).display
        };
      })()
    `);

    assert(btnInfo !== null, 'Button must exist in packaged DOM');
    assert.strictEqual(btnInfo.arrow, '↑', 'Arrow must be ↑');
    assert.strictEqual(btnInfo.text, 'Top', 'Text must be Top');
    console.log('✓ [PASS] Packaged button verified in runtime DOM:', btnInfo);

    // Test Dashboard scroll and return
    console.log('\n--- Testing Scroll & Return on Packaged Dashboard ---');
    await exec(`
      (() => {
        window.scrollTo({ top: 600, behavior: 'instant' });
        window.dispatchEvent(new Event('scroll'));
      })()
    `);
    await new Promise(r => setTimeout(r, 400));

    const isScrolledVisible = await exec(`
      (() => {
        const btn = document.getElementById('btn-go-to-top');
        return btn.classList.contains('visible') && window.getComputedStyle(btn).opacity === '1';
      })()
    `);
    assert.strictEqual(isScrolledVisible, true, 'Packaged app button must be visible when scrolled');
    console.log('✓ [PASS] Packaged button becomes visible upon scrolling down');

    // Click to scroll top
    await exec(`
      (() => {
        document.getElementById('btn-go-to-top').click();
      })()
    `);
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 100));
      const y = await exec(`window.scrollY || document.documentElement.scrollTop`);
      if (y === 0) break;
    }
    await new Promise(r => setTimeout(r, 400));

    const isTopHidden = await exec(`
      (() => {
        const btn = document.getElementById('btn-go-to-top');
        const y = window.scrollY || document.documentElement.scrollTop;
        return y === 0 && !btn.classList.contains('visible') && window.getComputedStyle(btn).opacity === '0';
      })()
    `);
    assert.strictEqual(isTopHidden, true, 'Packaged app button must smoothly return to top and hide');
    console.log('✓ [PASS] Packaged button smoothly returns to top and hides');

    console.log('\n========================================================');
    console.log('PACKAGED APPLICATION VERIFIED 100% SUCCESSFULLY!');
    console.log('========================================================');

  } catch (err) {
    console.error('Packaged app test failed:', err);
    process.exit(1);
  } finally {
    if (win) win.close();
    if (server) server.close();
    app.quit();
  }
});
