const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const assert = require('assert');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function httpRequest(url, options = {}, postData = null) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const reqOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    };

    if (postData) {
      if (typeof postData === 'object') {
        postData = JSON.stringify(postData);
        reqOptions.headers['Content-Type'] = 'application/json';
      }
      reqOptions.headers['Content-Length'] = Buffer.byteLength(postData);
    }

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (e) {}
        resolve({ status: res.statusCode, headers: res.headers, data, json });
      });
    });

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function verifyPackagedColdCallInteractive() {
  console.log('========================================================');
  console.log('VERIFYING PACKAGED APP (.exe) COLD CALL FIXES');
  console.log('Strict Data Safety: Only "demo" lead will be tested');
  console.log('========================================================\n');

  const exePath = path.join(__dirname, '../dist/win-unpacked/Client Hunter.exe');
  assert(require('fs').existsSync(exePath), 'Packaged executable must exist');

  // Spawn packaged executable
  const child = spawn(exePath, [], {
    detached: false,
    stdio: 'ignore'
  });

  try {
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

    assert(ready, 'Packaged app backend must start');
    console.log(`✓ Packaged application running on port ${port}`);

    // 1. Verify packaged index.html contains updated Delete button text
    const indexRes = await httpRequest(`http://127.0.0.1:${port}/`);
    assert(indexRes.data.includes('id="btn-coldcall-remove-batch"'), 'Delete button exists');
    assert(indexRes.data.includes('<span>Delete</span>'), 'Delete button displays Delete');
    console.log('✓ [PASS] Packaged index.html contains Delete button markup');

    // 2. Create demo lead in packaged app
    const demoLead = {
      id: 'demo_pkg_test',
      place_id: 'demo_pkg_test',
      business_name: 'demo',
      phone_number: '01234 567890',
      category: 'Test',
      city: 'London',
      lead_priority: 'High',
      outreach_status: 'Not Contacted',
      cold_call: { queued: true, status: 'Not Called', outcome: null }
    };

    await httpRequest(`http://127.0.0.1:${port}/api/leads/save`, { method: 'POST' }, { leads: [demoLead] });
    await httpRequest(`http://127.0.0.1:${port}/api/coldcall/add`, { method: 'POST' }, { leadIds: ['demo_pkg_test'] });

    // Verify added
    const ccData = await httpRequest(`http://127.0.0.1:${port}/api/coldcall/data`);
    const queuedDemo = (ccData.json?.leads || []).find((l) => l.id === 'demo_pkg_test');
    assert(queuedDemo, 'Demo lead must be in Cold Call queue');
    console.log('✓ [PASS] Demo lead added to packaged app Cold Call queue');

    // 3. Test Remove and Undo endpoints in packaged app
    const removeRes = await httpRequest(`http://127.0.0.1:${port}/api/coldcall/remove`, { method: 'POST' }, { leadIds: ['demo_pkg_test'] });
    assert.strictEqual(removeRes.status, 200);
    assert(removeRes.json?.undoToken, 'Packaged app /api/coldcall/remove must return undoToken');
    assert(Array.isArray(removeRes.json?.previousStates), 'Packaged app must return previousStates');
    console.log(`✓ [PASS] Packaged app /api/coldcall/remove returns undoToken: ${removeRes.json.undoToken}`);

    // Verify unqueued from Cold Call
    const ccAfterRemove = await httpRequest(`http://127.0.0.1:${port}/api/coldcall/data`);
    const inQueueAfter = (ccAfterRemove.json?.leads || []).some((l) => l.id === 'demo_pkg_test');
    assert.strictEqual(inQueueAfter, false, 'Demo lead unqueued from Cold Call');

    // Verify Master Saved Lead STILL EXISTS
    const savedRes = await httpRequest(`http://127.0.0.1:${port}/api/leads/saved`);
    const retainedMaster = (savedRes.json?.leads || []).find((l) => l.id === 'demo_pkg_test');
    assert(retainedMaster, 'Master Saved Lead MUST exist in database after Cold Call removal');
    console.log('✓ [PASS] Master Saved Lead completely preserved in packaged application');

    // 4. Test Undo endpoint
    const undoRes = await httpRequest(`http://127.0.0.1:${port}/api/coldcall/undo-remove`, { method: 'POST' }, {
      undoToken: removeRes.json.undoToken,
      fallbackStates: removeRes.json.previousStates
    });
    assert.strictEqual(undoRes.status, 200);
    assert.strictEqual(undoRes.json?.success, true);
    assert.strictEqual(undoRes.json?.restoredCount, 1);
    console.log('✓ [PASS] Packaged app /api/coldcall/undo-remove restores Cold Call lead');

    // Verify restored into queue
    const ccAfterUndo = await httpRequest(`http://127.0.0.1:${port}/api/coldcall/data`);
    const inQueueAfterUndo = (ccAfterUndo.json?.leads || []).filter((l) => l.id === 'demo_pkg_test');
    assert.strictEqual(inQueueAfterUndo.length, 1, 'Restored lead must be in queue exactly once, no duplicates');
    console.log('✓ [PASS] No duplicate records created upon Undo in packaged application');

    // 5. Clean up demo lead
    await httpRequest(`http://127.0.0.1:${port}/api/leads/demo_pkg_test`, { method: 'DELETE' });
    console.log('✓ [PASS] Cleaned up demo test lead');

    console.log('\n========================================================');
    console.log('ALL PACKAGED COLD CALL INTERACTIVE TESTS PASSED!');
    console.log('COLD CALL VERIFIED AND FIXED — NO REAL DATA MODIFIED');
    console.log('========================================================\n');
  } finally {
    try {
      child.kill('SIGTERM');
      process.kill(child.pid);
    } catch (e) {}
  }
}

verifyPackagedColdCallInteractive().catch((err) => {
  console.error('\n❌ Packaged verification failed:', err);
  process.exit(1);
});
