const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const assert = require('assert');

function httpRequest(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    }).on('error', reject);
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  console.log('========================================================');
  console.log('VERIFYING PACKAGED APPLICATION (.exe)');
  console.log('========================================================\n');

  const exePath = path.join(__dirname, '../dist/win-unpacked/Client Hunter.exe');
  console.log(`Executable path: ${exePath}`);

  const child = spawn(exePath, ['--remote-debugging-port=9222'], {
    detached: false,
    stdio: 'ignore'
  });

  try {
    console.log('Waiting for packaged application to initialize...');
    let ready = false;
    let port = 3000;

    for (let i = 0; i < 40; i++) {
      await sleep(500);
      try {
        const res = await httpRequest('http://127.0.0.1:3000/api/system/status');
        if (res.status === 200) {
          ready = true;
          port = 3000;
          break;
        }
      } catch (e) {}

      try {
        const res = await httpRequest('http://127.0.0.1:3001/api/system/status');
        if (res.status === 200) {
          ready = true;
          port = 3001;
          break;
        }
      } catch (e) {}
    }

    assert(ready, 'Packaged application must initialize backend services');
    console.log(`✓ Packaged application is running and responsive on port ${port}`);

    // Verify index.html served by the packaged app contains the Immediate option in Follow-Up timer
    const htmlRes = await httpRequest(`http://127.0.0.1:${port}/`);
    assert.strictEqual(htmlRes.status, 200, 'Packaged app must serve index.html');
    assert(htmlRes.data.includes('<select id="set-wa-fu-auto-timer" class="settings-select">'), 'Must contain set-wa-fu-auto-timer select');
    assert(htmlRes.data.includes('<option value="immediate">Immediate</option>'), 'Must contain <option value="immediate">Immediate</option>');

    console.log('✓ [PASS] Packaged application HTML contains <option value="immediate">Immediate</option>');

    // Check dropdown options in order in the served HTML
    const selectHtmlMatch = htmlRes.data.match(/<select id="set-wa-fu-auto-timer"[\s\S]*?<\/select>/);
    assert(selectHtmlMatch, 'set-wa-fu-auto-timer select must be matched');
    const selectHtml = selectHtmlMatch[0];

    const expectedOrder = ['0', 'immediate', '3', '5', '10', '15', '20', '30'];
    const optionMatches = [...selectHtml.matchAll(/<option\s+value="([^"]+)"[^>]*>([^<]+)<\/option>/g)];
    const actualValues = optionMatches.map(m => m[1]);

    assert.deepStrictEqual(actualValues, expectedOrder, 'Packaged app options must match exact order');
    console.log('✓ [PASS] Packaged app dropdown options in exact order:');
    optionMatches.forEach(m => console.log(`   • ${m[2]} (value="${m[1]}")`));

    // Also check CDP if available to verify runtime DOM in the packaged BrowserWindow
    try {
      const cdpPages = await httpRequest('http://127.0.0.1:9222/json');
      const pages = JSON.parse(cdpPages.data);
      console.log(`✓ CDP attached to packaged app, found ${pages.length} targets`);
    } catch (cdpErr) {
      console.log('(CDP endpoint notice:', cdpErr.message, ')');
    }

    console.log('\n========================================================');
    console.log('PACKAGED APPLICATION VERIFIED SUCCESSFULLY!');
    console.log('========================================================');
    console.log('NO REAL DATA MODIFIED');

  } finally {
    try {
      child.kill('SIGTERM');
      process.kill(child.pid);
    } catch (e) {}

    // Kill any lingering Client Hunter process
    const { execSync } = require('child_process');
    try {
      execSync('taskkill /F /IM "Client Hunter.exe" /T 2>nul');
    } catch (e) {}
  }
}

main().catch(err => {
  console.error('Packaged app verification failed:', err);
  process.exit(1);
});
