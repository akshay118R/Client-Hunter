const { spawn, execSync } = require('child_process');
const path = require('path');
const http = require('http');
const assert = require('assert');

function httpRequest(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (e) {}
        resolve({ status: res.statusCode, data, json });
      });
    }).on('error', reject);
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function verifyPackagedApp() {
  console.log('========================================================');
  console.log('VERIFYING PACKAGED APPLICATION (.exe) FOR COLD CALL');
  console.log('========================================================\n');

  const exePath = path.join(__dirname, '../dist/win-unpacked/Client Hunter.exe');
  console.log(`Executable target: ${exePath}`);
  assert(require('fs').existsSync(exePath), 'Packaged executable must exist');

  // Launch the packaged executable
  const child = spawn(exePath, ['--remote-debugging-port=9222'], {
    detached: false,
    stdio: 'ignore'
  });

  try {
    console.log('Waiting for packaged application backend to boot...');
    let ready = false;
    let port = 3000;

    for (let i = 0; i < 40; i++) {
      await sleep(500);
      for (const p of [3000, 3001, 3002]) {
        try {
          const res = await httpRequest(`http://127.0.0.1:${p}/api/system/status`);
          if (res.status === 200) {
            ready = true;
            port = p;
            break;
          }
        } catch (e) {}
      }
      if (ready) break;
    }

    assert(ready, 'Packaged application must initialize backend services');
    console.log(`✓ Packaged application is running and responsive on port ${port}`);

    // 1. Verify HTML served by packaged executable
    const htmlRes = await httpRequest(`http://127.0.0.1:${port}/`);
    assert.strictEqual(htmlRes.status, 200, 'Packaged app must serve index.html');
    const html = htmlRes.data;

    // Verify Nav items
    assert(html.includes('data-tab="cold-call"'), 'Must contain Cold Call navigation link');
    assert(html.includes('id="nav-coldcall-badge"'), 'Must contain Cold Call badge');
    console.log('✓ [PASS] Cold Call navigation link & badge present in packaged UI');

    // Verify Saved Leads Entry Point
    assert(html.includes('id="btn-saved-action-cold-call"'), 'Must contain Saved Leads in-card Cold Call action button');
    assert(html.includes('id="btn-bulk-cold-call"'), 'Must contain Saved Leads bulk Cold Call action button');
    console.log('✓ [PASS] Saved Leads "Add to Cold Call" action entry points present');

    // Verify Outreach Entry Point
    assert(html.includes('id="btn-outreach-coldcall-batch"'), 'Must contain Outreach batch Cold Call button');
    assert(html.includes('id="ws-btn-coldcall"'), 'Must contain Outreach workspace Cold Call button');
    console.log('✓ [PASS] Outreach "Add to Cold Call" action entry points present');

    // Verify Cold Call View Container & Sections
    assert(html.includes('id="view-cold-call"'), 'Must contain #view-cold-call main container');
    assert(html.includes('id="coldcall-metric-total"'), 'Must contain Total Queue metric counter');
    assert(html.includes('id="coldcall-metric-remaining"'), 'Must contain Remaining metric counter');
    assert(html.includes('id="coldcall-metric-called"'), 'Must contain Called metric counter');
    assert(html.includes('id="coldcall-metric-interested"'), 'Must contain Interested metric counter');
    assert(html.includes('id="coldcall-metric-callback"'), 'Must contain Callback metric counter');
    console.log('✓ [PASS] Cold Call header counters & metrics grid present');

    // Verify Mobile Call Tracking Workspace & Copy Button
    assert(html.includes('id="btn-cc-copy-phone"'), 'Must contain primary phone copy button');
    assert(!html.includes('id="btn-coldcall-start-calling"'), 'Must NOT contain Start Calling Queue button');
    assert(!html.includes('href="tel:"'), 'Must NOT use tel: phone URI for dialer integration');
    assert(html.includes('Copy the number, call from your mobile'), 'Must clearly communicate mobile call tracking workspace');
    assert(html.includes('id="cc-ws-call-status"'), 'Must contain prominent lead call status badge');
    assert(html.includes('id="cc-script-opening"'), 'Must contain Call Script Opening section');
    assert(html.includes('id="cc-script-reason"'), 'Must contain Call Script Reason section');
    assert(html.includes('id="cc-script-interested"'), 'Must contain Call Script If Interested section');
    assert(html.includes('id="cc-script-not-interested"'), 'Must contain Call Script If Not Interested section');
    assert(html.includes('id="cc-script-busy"'), 'Must contain Call Script If Busy section');
    assert(html.includes('id="cc-callback-wrap"'), 'Must contain Callback scheduling container');
    assert(html.includes('id="btn-cc-save-and-next"'), 'Must contain Save & Next Lead sequential button');
    console.log('✓ [PASS] Mobile Call Tracking Workspace, Copy button, scripts, and sequential next buttons verified');

    // Verify Dedicated Recent Cold Call Activity section in Packaged UI
    assert(html.includes('class="coldcall-recent-activity-section'), 'Packaged UI must contain .coldcall-recent-activity-section');
    assert(html.includes('RECENT COLD CALL ACTIVITY'), 'Packaged UI must contain RECENT COLD CALL ACTIVITY header');
    assert(html.includes('id="coldcall-history-count"'), 'Packaged UI must contain dynamic history count badge');
    assert(html.includes('id="cc-recent-table"'), 'Packaged UI must contain recent activity table');
    assert(html.includes('id="cc-recent-empty-state"'), 'Packaged UI must contain clean empty state container');
    assert(html.includes('No Cold Call Activity Yet'), 'Packaged UI must contain empty state title');
    assert(html.includes('Recorded cold calls will appear here.'), 'Packaged UI must contain empty state subtitle');
    console.log('✓ [PASS] Dedicated Recent Cold Call Activity section verified in packaged UI');

    // 2. Verify Cold Call API endpoints in packaged backend
    const coldCallDataRes = await httpRequest(`http://127.0.0.1:${port}/api/coldcall/data`);
    assert.strictEqual(coldCallDataRes.status, 200, 'GET /api/coldcall/data must return 200');
    assert(coldCallDataRes.json?.success === true, 'GET /api/coldcall/data must return success: true');
    assert(Array.isArray(coldCallDataRes.json?.leads), 'GET /api/coldcall/data must return leads array');
    assert(coldCallDataRes.json?.metrics !== undefined, 'GET /api/coldcall/data must return metrics');
    assert(Array.isArray(coldCallDataRes.json?.history), 'GET /api/coldcall/data must return history array');
    assert(Array.isArray(coldCallDataRes.json?.recentHistory), 'GET /api/coldcall/data must return recentHistory array');
    console.log(`✓ [PASS] Packaged backend /api/coldcall/data operational (${coldCallDataRes.json.leads.length} queued leads, ${coldCallDataRes.json.history.length} history records)`);

    const countRes = await httpRequest(`http://127.0.0.1:${port}/api/leads/count`);
    assert.strictEqual(countRes.status, 200, 'GET /api/leads/count must return 200');
    assert(countRes.json?.coldCallCount !== undefined, 'Count API must include coldCallCount');
    console.log(`✓ [PASS] Packaged backend /api/leads/count operational (coldCallCount: ${countRes.json.coldCallCount})`);

    // Verify existing endpoints still functional in packaged application
    const savedLeadsRes = await httpRequest(`http://127.0.0.1:${port}/api/leads/saved`);
    assert.strictEqual(savedLeadsRes.status, 200, 'Existing /api/leads/saved must return 200');
    console.log(`✓ [PASS] Existing Saved Leads endpoint verified in packaged application (${savedLeadsRes.json?.totalCount || 0} leads preserved)`);

    const outreachRes = await httpRequest(`http://127.0.0.1:${port}/api/outreach/data`);
    assert.strictEqual(outreachRes.status, 200, 'Existing /api/outreach/data must return 200');
    console.log(`✓ [PASS] Existing Outreach endpoint verified in packaged application (${outreachRes.json?.totalCount || 0} leads preserved)`);

    console.log('\n========================================================');
    console.log('PACKAGED APPLICATION VERIFIED SUCCESSFULLY!');
    console.log('COLD CALL FEATURE ADDED — NO REAL DATA MODIFIED');
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

verifyPackagedApp().catch((err) => {
  console.error('\n❌ Packaged App Verification Failed:', err);
  process.exit(1);
});
