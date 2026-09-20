const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const assert = require('assert');

const TEST_PORT = 3099;

// Lightweight static server that serves local workspace files, and proxies API calls to 3000
function createStaticServer() {
  const server = http.createServer((req, res) => {
    let reqPath = req.url.split('?')[0].split('#')[0];
    if (reqPath === '/') reqPath = '/index.html';

    // If it's an API request, proxy to port 3000
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

    const filePath = path.join(__dirname, '..', reqPath.replace(/^\//, ''));
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath);
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
      fs.createReadStream(filePath).pipe(res);
    } else {
      // Fallback to index.html for SPA routes
      const indexPath = path.join(__dirname, '..', 'index.html');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      fs.createReadStream(indexPath).pipe(res);
    }
  });

  return new Promise((resolve) => {
    server.listen(TEST_PORT, '127.0.0.1', () => {
      console.log(`Test static server running at http://127.0.0.1:${TEST_PORT}`);
      resolve(server);
    });
  });
}

app.whenReady().then(async () => {
  let staticServer = null;
  let win = null;

  try {
    staticServer = await createStaticServer();

    win = new BrowserWindow({
      width: 1400,
      height: 500,
      show: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    console.log('Loading app on test port...');
    await win.loadURL(`http://127.0.0.1:${TEST_PORT}/#dashboard`);
    await new Promise(r => setTimeout(r, 2000));

    async function exec(code) {
      return await win.webContents.executeJavaScript(code);
    }

    console.log('\n--- 1. Testing Button DOM Existence and Structure ---');
    const btnInfo = await exec(`
      (() => {
        const btn = document.getElementById('btn-go-to-top');
        if (!btn) return null;
        const arrow = btn.querySelector('.btn-go-to-top-arrow');
        const text = btn.querySelector('.btn-go-to-top-text');
        return {
          id: btn.id,
          tagName: btn.tagName,
          arrowText: arrow ? arrow.textContent.trim() : '',
          btnText: text ? text.textContent.trim() : '',
          fullText: btn.textContent.trim().replace(/\\s+/g, ' '),
          initialVisible: btn.classList.contains('visible'),
          displayStyle: window.getComputedStyle(btn).display,
          opacity: window.getComputedStyle(btn).opacity,
          buttonCount: document.querySelectorAll('#btn-go-to-top').length
        };
      })()
    `);

    assert(btnInfo !== null, 'Button #btn-go-to-top must exist in DOM');
    assert.strictEqual(btnInfo.buttonCount, 1, 'Exactly one button #btn-go-to-top must exist');
    assert.strictEqual(btnInfo.arrowText, '↑', 'Arrow must be ↑');
    assert.strictEqual(btnInfo.btnText, 'Top', 'Text must be Top');
    assert.strictEqual(btnInfo.fullText, '↑ Top', 'Full display must be ↑ Top');
    assert.strictEqual(btnInfo.initialVisible, false, 'Button must not be visible at top of page');
    assert.strictEqual(btnInfo.opacity, '0', 'Button opacity must be 0 at top');
    console.log('✓ Button DOM and initial state verified:', btnInfo);

    // Test the 6 allowed sections:
    // 1. Dashboard, 2. Saved Leads, 3. Favorites, 4. Outreach, 5. Follow-Up, 6. History
    const allowedSections = [
      { name: 'Dashboard', hash: 'dashboard' },
      { name: 'Saved Leads', hash: 'saved-leads' },
      { name: 'Favorites', hash: 'favorites' },
      { name: 'Outreach', hash: 'outreach' },
      { name: 'Follow-Up', hash: 'followup' },
      { name: 'History', hash: 'history' }
    ];

    for (const sec of allowedSections) {
      console.log(`\n--- Testing ${sec.name} (#${sec.hash}) ---`);
      
      // Navigate to section
      await exec(`
        (() => {
          switchView('${sec.hash}');
        })()
      `);
      await new Promise(r => setTimeout(r, 600));

      // Verify at top, button is NOT visible
      const atTop = await exec(`
        (() => {
          const btn = document.getElementById('btn-go-to-top');
          const style = window.getComputedStyle(btn);
          return {
            scrollY: window.scrollY || document.documentElement.scrollTop,
            hasVisibleClass: btn.classList.contains('visible'),
            opacity: style.opacity,
            visibility: style.visibility
          };
        })()
      `);
      assert.strictEqual(atTop.hasVisibleClass, false, `Button should NOT have visible class at top in ${sec.name}`);
      assert.strictEqual(atTop.opacity, '0', `Button should be transparent at top in ${sec.name}`);
      console.log(`  ✓ Hidden at top (scrollY=${atTop.scrollY}, opacity=${atTop.opacity})`);

      // Scroll down 600px instantly
      await exec(`
        (() => {
          window.scrollTo({ top: 600, behavior: 'instant' });
          window.dispatchEvent(new Event('scroll'));
        })()
      `);
      // Wait for CSS transition (0.22s)
      await new Promise(r => setTimeout(r, 400));

      // Verify button IS visible now and has clean minimal styling
      const scrolled = await exec(`
        (() => {
          const btn = document.getElementById('btn-go-to-top');
          const arrow = btn.querySelector('.btn-go-to-top-arrow');
          const text = btn.querySelector('.btn-go-to-top-text');
          const style = window.getComputedStyle(btn);
          const arrowStyle = window.getComputedStyle(arrow);
          const textStyle = window.getComputedStyle(text);
          const rect = btn.getBoundingClientRect();
          return {
            scrollY: window.scrollY || document.documentElement.scrollTop,
            hasVisibleClass: btn.classList.contains('visible'),
            opacity: style.opacity,
            visibility: style.visibility,
            pointerEvents: style.pointerEvents,
            background: style.backgroundColor,
            boxShadow: style.boxShadow,
            borderStyle: style.borderStyle,
            arrowText: arrow ? arrow.textContent.trim() : '',
            btnText: text ? text.textContent.trim() : '',
            arrowColor: arrowStyle.color,
            textColor: textStyle.color,
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            w: Math.round(rect.width),
            h: Math.round(rect.height)
          };
        })()
      `);
      assert(scrolled.scrollY >= 80, `Must be scrolled down >= 80px in ${sec.name} (was ${scrolled.scrollY})`);
      assert.strictEqual(scrolled.hasVisibleClass, true, `Button must have visible class when scrolled in ${sec.name}`);
      assert.strictEqual(scrolled.opacity, '1', `Button opacity must be 1 when scrolled in ${sec.name}`);
      assert.strictEqual(scrolled.visibility, 'visible', `Button must be visible in ${sec.name}`);
      assert.strictEqual(scrolled.background, 'rgba(0, 0, 0, 0)', `Button must have transparent background (NO background box) in ${sec.name}`);
      assert.strictEqual(scrolled.boxShadow, 'none', `Button must have NO shadow in ${sec.name}`);
      assert(scrolled.borderStyle === 'none' || scrolled.borderStyle === '', `Button must have NO border in ${sec.name}`);
      assert.strictEqual(scrolled.arrowText, '↑', `Arrow must be ↑ in ${sec.name}`);
      assert.strictEqual(scrolled.btnText, 'Top', `Text must be Top in ${sec.name}`);
      console.log(`  ✓ Visible when scrolled (scrollY=${scrolled.scrollY}, opacity=${scrolled.opacity}, pos=[${scrolled.x}, ${scrolled.y}])`);
      console.log(`  ✓ Clean minimal styling verified (bg: ${scrolled.background}, shadow: ${scrolled.boxShadow}, border: ${scrolled.borderStyle})`);

      // Save screenshot for visual inspection
      const scrDir = 'C:\\Users\\Akshay\\.gemini\\antigravity-ide\\brain\\864d727a-1a33-44e9-abbb-875eabe0abe0\\scratch\\screenshots';
      if (!fs.existsSync(scrDir)) fs.mkdirSync(scrDir, { recursive: true });
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(scrDir, `view_${sec.hash}.png`), img.toPNG());

      // Click the button
      await exec(`
        (() => {
          const btn = document.getElementById('btn-go-to-top');
          btn.click();
        })()
      `);
      // Wait for smooth scroll to finish (wait up to 1.5s for smooth scroll)
      let finalY = 600;
      for (let waitCount = 0; waitCount < 15; waitCount++) {
        await new Promise(r => setTimeout(r, 100));
        finalY = await exec(`window.scrollY || document.documentElement.scrollTop`);
        if (finalY === 0) break;
      }

      // Wait for CSS transition fade out
      await new Promise(r => setTimeout(r, 400));

      // Verify returned to top
      const afterClick = await exec(`
        (() => {
          const btn = document.getElementById('btn-go-to-top');
          const style = window.getComputedStyle(btn);
          return {
            scrollY: window.scrollY || document.documentElement.scrollTop,
            hasVisibleClass: btn.classList.contains('visible'),
            opacity: style.opacity
          };
        })()
      `);
      assert.strictEqual(afterClick.scrollY, 0, `Page must return to scrollY 0 in ${sec.name} (was ${afterClick.scrollY})`);
      assert.strictEqual(afterClick.hasVisibleClass, false, `Button must hide again at top in ${sec.name}`);
      console.log(`  ✓ Click smoothly returned to top (scrollY=${afterClick.scrollY}, opacity=${afterClick.opacity})`);

      // Verify button count is still 1
      const count = await exec(`document.querySelectorAll('#btn-go-to-top').length`);
      assert.strictEqual(count, 1, 'Must not create duplicate buttons');
    }

    console.log('\n--- Testing Disallowed Views (Find Leads, Settings, Hero) ---');
    const disallowed = ['find-leads', 'settings', 'hero'];
    for (const view of disallowed) {
      await exec(`
        (() => {
          switchView('${view}');
          window.scrollTo({ top: 600, behavior: 'instant' });
          window.dispatchEvent(new Event('scroll'));
        })()
      `);
      await new Promise(r => setTimeout(r, 400));

      const res = await exec(`
        (() => {
          const btn = document.getElementById('btn-go-to-top');
          const style = window.getComputedStyle(btn);
          return {
            hasVisibleClass: btn.classList.contains('visible'),
            display: style.display,
            opacity: style.opacity
          };
        })()
      `);
      assert.strictEqual(res.hasVisibleClass, false, `Button must not have visible class in disallowed view ${view}`);
      assert.strictEqual(res.display, 'none', `Button display must be none in disallowed view ${view}`);
      console.log(`  ✓ Correctly suppressed on ${view} (display: ${res.display})`);
    }

    console.log('\n========================================================');
    console.log('ALL GO TO TOP BUTTON TESTS PASSED SUCCESSFULLY!');
    console.log('========================================================\n');

  } catch (err) {
    console.error('TEST FAILED:', err);
    process.exit(1);
  } finally {
    if (win) win.close();
    if (staticServer) staticServer.close();
    app.quit();
  }
});
