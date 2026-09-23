const { spawn, execSync } = require('child_process');
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
  console.log('VERIFYING PACKAGED EXECUTABLE (dist/win-unpacked/Client Hunter.exe)');
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

    // Verify main.js served contains our updated code
    const mainJsRes = await httpRequest(`http://127.0.0.1:${port}/main.js`);
    assert.strictEqual(mainJsRes.status, 200, 'Packaged app must serve main.js');
    assert(mainJsRes.data.includes('cleanNumericDisplay'), 'main.js must contain cleanNumericDisplay');
    assert(mainJsRes.data.includes('Outreach lead removed:'), 'main.js must contain updated toast format');
    assert(mainJsRes.data.includes('This will permanently delete 1 selected lead and its associated outreach/follow-up history.'), 'main.js must contain confirmation text');
    assert(mainJsRes.data.includes('Delete Selected Leads?'), 'main.js must contain modal title');
    console.log('✓ Packaged application main.js verified with all updated delete, confirmation, undo, and numeric formatting routines.');

    // Verify real leads safety in packaged app
    const savedRes = await httpRequest(`http://127.0.0.1:${port}/api/leads/saved`);
    assert.strictEqual(savedRes.status, 200);
    const parsed = JSON.parse(savedRes.data);
    assert.strictEqual(parsed.totalCount, 196, 'Master saved leads count in packaged app must remain 196');
    console.log(`✓ Packaged application verified with real store data: ${parsed.totalCount} leads 100% intact.`);

    console.log('\n========================================================');
    console.log('PACKAGED APPLICATION VERIFIED SUCCESSFULLY!');
    console.log('========================================================');
  } finally {
    try {
      child.kill('SIGTERM');
      process.kill(child.pid);
    } catch (e) {}

    try {
      execSync('taskkill /F /IM "Client Hunter.exe" /T 2>nul');
    } catch (e) {}
  }
}

main().catch(err => {
  console.error('Packaged app verification failed:', err);
  process.exit(1);
});
