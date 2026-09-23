const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const assert = require('assert');
const fs = require('fs');

const TEST_PORT = 3899;

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
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch (e) {}
        resolve({ status: res.statusCode, headers: res.headers, data, json });
      });
    });

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runSuite() {
  console.log('========================================================');
  console.log('STARTING COLD CALL FEATURE TEST SUITE');
  console.log('Strict Data Safety: Only "demo" lead will be used');
  console.log('========================================================\n');

  // Spawn test server on isolated port
  const serverProcess = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: TEST_PORT },
    stdio: 'pipe'
  });

  serverProcess.stderr.on('data', (d) => {
    const errStr = d.toString();
    if (!errStr.includes('ExperimentalWarning')) {
      console.error('[Server STDERR]', errStr);
    }
  });

  try {
    console.log(`Waiting for server on port ${TEST_PORT}...`);
    let ready = false;
    for (let i = 0; i < 30; i++) {
      await sleep(400);
      try {
        const res = await httpRequest(`http://127.0.0.1:${TEST_PORT}/api/system/status`);
        if (res.status === 200) {
          ready = true;
          break;
        }
      } catch (e) {}
    }
    assert(ready, 'Test server must start and answer /api/system/status');
    console.log(`✓ Test server running on http://127.0.0.1:${TEST_PORT}`);

    // Create a demo lead
    const demoLeadId = `demo_test_${Date.now()}`;
    const demoLead = {
      id: demoLeadId,
      place_id: demoLeadId,
      business_name: 'demo',
      phone_number: '+91 98765 43210',
      phone: '+91 98765 43210',
      category: 'Dental Clinic',
      city: 'Mumbai',
      state: 'Maharashtra',
      website: 'https://demo-dental.example.com',
      rating: 4.8,
      lead_priority: 'High',
      priority: 'High',
      outreach_status: 'Not Contacted',
      activities: [],
      notes: []
    };

    console.log('\n--- 1. Injecting test lead named "demo" ---');
    const addLeadRes = await httpRequest(`http://127.0.0.1:${TEST_PORT}/api/leads/save`, {
      method: 'POST'
    }, { leads: [demoLead] });
    assert(addLeadRes.status === 200, 'Saving demo lead must succeed');
    console.log(`✓ Demo lead "${demoLead.business_name}" created with ID ${demoLeadId}`);

    console.log('\n--- 2. Test "Add to Cold Call" from Saved Leads ---');
    const addToColdCallRes = await httpRequest(`http://127.0.0.1:${TEST_PORT}/api/coldcall/add`, {
      method: 'POST'
    }, { leadIds: [demoLeadId], source: 'Saved Leads' });
    assert.strictEqual(addToColdCallRes.status, 200, 'POST /api/coldcall/add should return 200');
    assert.strictEqual(addToColdCallRes.json?.success, true, 'Should return success: true');
    console.log('✓ Successfully added demo lead to Cold Call queue');

    console.log('\n--- 3. Test Duplicate Lead Protection (No Duplicate Leads) ---');
    // Adding again from Outreach should NOT create a duplicate lead
    const addDuplicateRes = await httpRequest(`http://127.0.0.1:${TEST_PORT}/api/coldcall/add`, {
      method: 'POST'
    }, { leadIds: [demoLeadId], source: 'Outreach' });
    assert.strictEqual(addDuplicateRes.status, 200);

    const coldCallDataRes = await httpRequest(`http://127.0.0.1:${TEST_PORT}/api/coldcall/data`);
    assert.strictEqual(coldCallDataRes.status, 200);
    const queuedDemoLeads = (coldCallDataRes.json?.leads || []).filter(
      (l) => l.id === demoLeadId || l.place_id === demoLeadId
    );
    assert.strictEqual(queuedDemoLeads.length, 1, 'Cold Call queue MUST have exactly 1 copy of demo lead, no duplicates');
    console.log('✓ Duplicate lead protection verified: exactly 1 lead in Cold Call queue');

    console.log('\n--- 4. Test Cold Call Counters & Metrics ---');
    const metrics = coldCallDataRes.json?.metrics;
    assert(metrics, 'Metrics object must be returned');
    assert(metrics.totalQueue >= 1, 'Total queue counter must be >= 1');
    assert(metrics.remaining >= 1, 'Remaining counter must be >= 1');
    console.log(`✓ Metrics verified: Total Queue=${metrics.totalQueue}, Remaining=${metrics.remaining}, Called=${metrics.called}`);

    console.log('\n--- 5. Test Recording Call Outcome (Interested) ---');
    const outcomeRes = await httpRequest(`http://127.0.0.1:${TEST_PORT}/api/coldcall/outcome`, {
      method: 'POST'
    }, {
      leadId: demoLeadId,
      outcome: 'Interested',
      status: 'Follow-Up Required',
      reason: 'Interested in AI receptionist',
      notes: 'Spoke with clinic owner, asked to send demo video.'
    });
    assert.strictEqual(outcomeRes.status, 200);
    assert.strictEqual(outcomeRes.json?.success, true);
    console.log('✓ Call outcome "Interested" recorded successfully');

    // Verify activity was logged in Lead Activity Timeline
    const actRes = await httpRequest(`http://127.0.0.1:${TEST_PORT}/api/leads/${demoLeadId}/activities`);
    assert.strictEqual(actRes.status, 200);
    const activities = actRes.json?.activities || [];
    const coldCallActivity = activities.find((a) => a.event_type === 'cold_call' || a.type === 'cold_call');
    assert(coldCallActivity, 'Activity timeline must contain a "cold_call" activity');
    assert.strictEqual(coldCallActivity.metadata?.outcome || coldCallActivity.details?.outcome, 'Interested');
    console.log('✓ Activity timeline integration verified: "cold_call" activity logged');

    // Verify note was logged in Lead Notes system
    const notesRes = await httpRequest(`http://127.0.0.1:${TEST_PORT}/api/leads/${demoLeadId}/notes`);
    assert.strictEqual(notesRes.status, 200);
    const notes = notesRes.json?.notes || [];
    assert(notes.some((n) => n.text?.includes('Spoke with clinic owner')), 'Lead notes must contain call notes');
    console.log('✓ Lead notes integration verified: note recorded in lead.notes');

    console.log('\n--- 6. Test Callback Outcome (Call Back Later with date/time) ---');
    const callbackIso = '2026-09-24T16:30:00.000Z';
    const callbackRes = await httpRequest(`http://127.0.0.1:${TEST_PORT}/api/coldcall/outcome`, {
      method: 'POST'
    }, {
      leadId: demoLeadId,
      outcome: 'Call Back Later',
      status: 'Follow-Up Required',
      callbackAt: callbackIso,
      reason: 'Doctor in surgery until 4:30 PM',
      notes: 'Call back at 4:30 PM sharp.'
    });
    assert.strictEqual(callbackRes.status, 200);
    assert.strictEqual(callbackRes.json?.success, true);

    const postCallbackData = await httpRequest(`http://127.0.0.1:${TEST_PORT}/api/coldcall/data`);
    const callbackLead = (postCallbackData.json?.leads || []).find((l) => l.id === demoLeadId);
    assert.strictEqual(callbackLead.cold_call?.callback_at, callbackIso, 'Callback time must be preserved on lead');
    console.log(`✓ Callback scheduled and attached to lead: ${callbackLead.cold_call.callback_at}`);

    console.log('\n--- 7. Test Call History Recording ---');
    const recentHistory = postCallbackData.json?.recentHistory || [];
    assert(recentHistory.length >= 2, 'Recent history must record both calls');
    assert.strictEqual(recentHistory[0].businessName, 'demo');
    console.log(`✓ Recent call history verified: ${recentHistory.length} entries recorded`);

    console.log('\n--- 8. Test Remove from Cold Call (DO NOT DELETE ACTUAL LEAD) ---');
    const removeRes = await httpRequest(`http://127.0.0.1:${TEST_PORT}/api/coldcall/remove`, {
      method: 'POST'
    }, { leadIds: [demoLeadId] });
    assert.strictEqual(removeRes.status, 200);
    assert.strictEqual(removeRes.json?.success, true);

    // Verify lead is removed from Cold Call data
    const afterRemoveCcData = await httpRequest(`http://127.0.0.1:${TEST_PORT}/api/coldcall/data`);
    const inQueueAfter = (afterRemoveCcData.json?.leads || []).some((l) => l.id === demoLeadId);
    assert.strictEqual(inQueueAfter, false, 'Lead must not appear in active Cold Call queue');

    // CRITICAL: Verify lead still exists in master leads database!
    const savedLeadsRes = await httpRequest(`http://127.0.0.1:${TEST_PORT}/api/leads/saved`);
    assert.strictEqual(savedLeadsRes.status, 200, 'Saved leads must be accessible');
    const retainedLead = (savedLeadsRes.json?.leads || []).find((l) => l.id === demoLeadId);
    assert(retainedLead, 'Master lead MUST STILL EXIST after remove from Cold Call');
    assert.strictEqual(retainedLead.business_name, 'demo');
    assert.strictEqual(retainedLead.cold_call?.queued, false);
    console.log('✓ Strict Data Safety confirmed: "Remove from Cold Call" unqueued lead without deleting the actual record');

    console.log('\n--- 9. Test /api/leads/count contains Cold Call counts ---');
    const countRes = await httpRequest(`http://127.0.0.1:${TEST_PORT}/api/leads/count`);
    assert.strictEqual(countRes.status, 200);
    assert(countRes.json?.coldCallCount !== undefined, 'Count API must provide coldCallCount');
    assert(countRes.json?.coldCallRemaining !== undefined, 'Count API must provide coldCallRemaining');
    console.log(`✓ /api/leads/count verified: coldCallCount=${countRes.json.coldCallCount}, coldCallRemaining=${countRes.json.coldCallRemaining}`);

    console.log('\n--- 10. Clean up test "demo" lead record ---');
    const cleanupRes = await httpRequest(`http://127.0.0.1:${TEST_PORT}/api/leads/${demoLeadId}`, {
      method: 'DELETE'
    });
    console.log(`✓ Cleaned up demo test lead (Status: ${cleanupRes.status})`);

    console.log('\n========================================================');
    console.log('ALL COLD CALL TESTS PASSED SUCCESSFULLY!');
    console.log('COLD CALL FEATURE ADDED — NO REAL DATA MODIFIED');
    console.log('========================================================');
  } finally {
    try {
      serverProcess.kill('SIGTERM');
    } catch (e) {}
    const storePaths = [
      path.join(__dirname, '..', 'data', 'leads_store.json'),
      path.join(process.env.APPDATA || '', 'clienthunter', 'data', 'leads_store.json')
    ];
    storePaths.forEach((p) => {
      if (fs.existsSync(p)) {
        try {
          const raw = fs.readFileSync(p, 'utf8');
          const d = JSON.parse(raw);
          const origLen = (d.leads || []).length;
          d.leads = (d.leads || []).filter(
            (l) => (l.business_name || '').toLowerCase() !== 'demo' && !(String(l.id || '').startsWith('demo_'))
          );
          if (d.leads.length !== origLen) {
            fs.writeFileSync(p, JSON.stringify(d, null, 2), 'utf8');
          }
        } catch (e) {}
      }
    });
  }
}

runSuite().catch((err) => {
  console.error('\n❌ Cold Call Test Suite Failed:', err);
  process.exit(1);
});
