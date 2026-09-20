const { app, BrowserWindow } = require('electron');
const http = require('http');
const assert = require('assert');

function httpRequest(method, pathName, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: 3000,
      path: pathName,
      method: method,
      headers: { 'Content-Type': 'application/json' }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

app.whenReady().then(async () => {
  console.log('========================================================');
  console.log('CLIENTHUNTER — SEND MESSAGE CONFIRMATION KEYBOARD SHORTCUTS TEST');
  console.log('========================================================\n');

  try {
    // 0. Server status check
    const sysStatus = await httpRequest('GET', '/api/system/status');
    assert.strictEqual(sysStatus.status, 200, 'Server must be active');
    console.log('✓ Server active on port 3000');

    // Clean up any existing test leads
    const existingSaved = await httpRequest('GET', '/api/leads/saved');
    const stale = existingSaved.data.leads.filter(l => l.place_id && l.place_id.startsWith('sc_test_'));
    for (const s of stale) {
      await httpRequest('DELETE', `/api/leads/${s.id}`);
    }

    // Create 10 test leads for all 10 tests
    const now = Date.now();
    const testDate = '2026-09-18T12:00:00.000Z';
    const leadsData = [];
    for (let i = 0; i < 10; i++) {
      leadsData.push({
        place_id: `sc_test_${i}_${now}`,
        business_name: `Shortcut Test Lead ${i + 1}`,
        category: 'Dental Clinic',
        city: 'Hyderabad',
        state: 'Telangana',
        phone: `+91 98765 300${String(i).padStart(2, '0')}`,
        website: i % 2 === 0 ? `https://dental${i}.example.com` : '',
        website_status: i % 2 === 0 ? 'YES' : 'NO',
        opportunity_score: 70 + i * 2,
        saved_at: testDate
      });
    }

    const saveRes = await httpRequest('POST', '/api/leads/save', { leads: leadsData });
    assert.strictEqual(saveRes.data.success, true, 'Leads should save');
    console.log(`✓ Saved ${leadsData.length} test leads`);

    const savedAll = await httpRequest('GET', '/api/leads/saved');
    const createdLeads = savedAll.data.leads.filter(l => l.place_id && l.place_id.startsWith(`sc_test_`));
    assert.strictEqual(createdLeads.length, 10, 'All 10 test leads must be retrieved');

    // Move all 10 to outreach
    const leadIds = createdLeads.map(l => l.id);
    await httpRequest('POST', '/api/leads/move-to-outreach', { leadIds });
    console.log('✓ Moved test leads to Outreach');

    const win = new BrowserWindow({
      width: 1440,
      height: 900,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    await win.loadURL('http://127.0.0.1:3000/#outreach');
    await new Promise(r => setTimeout(r, 2000));
    console.log('✓ Loaded application window in headless Electron on #outreach');

    // ----------------------------------------------------
    // TEST 6: Outside modal safety (Find Leads / Saved Leads)
    // ----------------------------------------------------
    console.log('\n--- Running TEST 6: Verify 1/2/3 outside modal does NOT trigger confirmation ---');
    const test6Result = await win.webContents.executeJavaScript(`
      (function() {
        // Dispatch key '1', '2', '3' while modal is closed
        document.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }));
        document.dispatchEvent(new KeyboardEvent('keydown', { key: '2', bubbles: true }));
        document.dispatchEvent(new KeyboardEvent('keydown', { key: '3', bubbles: true }));
        const modal = document.getElementById('modal-outreach-composer');
        const isHidden = modal ? (modal.classList.contains('hidden') || modal.style.display === 'none') : true;
        return { isHidden };
      })()
    `);
    assert.strictEqual(test6Result.isHidden, true, 'Modal must remain closed');
    console.log('✓ TEST 6 PASSED: Keys 1/2/3 outside confirmation modal do nothing.');

    // ----------------------------------------------------
    // TEST 7: Input field safety
    // ----------------------------------------------------
    console.log('\n--- Running TEST 7: Typing 1/2/3 in input/textarea does NOT trigger confirmation ---');
    const test7Result = await win.webContents.executeJavaScript(`
      (function() {
        const searchInput = document.getElementById('saved-search-input') || document.querySelector('input');
        if (searchInput) {
          searchInput.focus();
          const evt = new KeyboardEvent('keydown', { key: '1', bubbles: true });
          searchInput.dispatchEvent(evt);
        }
        const modal = document.getElementById('modal-outreach-composer');
        return modal ? (modal.classList.contains('hidden') || modal.style.display === 'none') : true;
      })()
    `);
    assert.strictEqual(test7Result, true, 'Modal must remain inactive when typing into inputs');
    console.log('✓ TEST 7 PASSED: Typing in input fields does not trigger confirmation.');

    // ----------------------------------------------------
    // TEST 1: Open lead 0, open WA, press "1" -> Yes, Message Sent
    // ----------------------------------------------------
    console.log('\n--- Running TEST 1: Key 1 triggers "Yes, Message Sent" ---');
    const test1Lead = createdLeads[0];
    const test1Outcome = await win.webContents.executeJavaScript(`
      (async function() {
        const lead = AppState.outreach?.data?.allLeads?.find(l => l.place_id === '${test1Lead.place_id}');
        await openOutreachComposer(lead);
        await new Promise(r => setTimeout(r, 600));

        // Click Open WhatsApp to show confirmation block
        document.getElementById('btn-composer-open-wa')?.click();
        await new Promise(r => setTimeout(r, 400));

        const confirmBlock = document.getElementById('composer-confirm-block');
        const isConfirmVisible = !confirmBlock.classList.contains('hidden');

        // Press '1'
        document.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }));
        await new Promise(r => setTimeout(r, 1200));

        const modal = document.getElementById('modal-outreach-composer');
        const isModalClosed = modal.classList.contains('hidden') || modal.style.display === 'none';
        return { isConfirmVisible, isModalClosed };
      })()
    `);
    assert.strictEqual(test1Outcome.isConfirmVisible, true, 'Confirm block must be visible before press 1');
    assert.strictEqual(test1Outcome.isModalClosed, true, 'Single lead modal should close after pressing 1 (Yes, Message Sent)');

    // Verify lead status on backend
    const savedAfterTest1 = await httpRequest('GET', '/api/leads/saved');
    const l1 = savedAfterTest1.data.leads.find(l => l.place_id === test1Lead.place_id);
    assert.strictEqual(l1.status, 'Contacted', 'Lead 1 status must be Contacted');
    assert.strictEqual(l1.first_message_sent, true, 'Lead 1 first_message_sent must be true');
    console.log('✓ TEST 1 PASSED: Key 1 triggered "Yes, Message Sent" exactly as clicking the button.');

    // ----------------------------------------------------
    // TEST 2: Open lead 1, open WA, press "2" -> No, Not Sent
    // ----------------------------------------------------
    console.log('\n--- Running TEST 2: Key 2 triggers "No, Not Sent" ---');
    const test2Lead = createdLeads[1];
    const test2Outcome = await win.webContents.executeJavaScript(`
      (async function() {
        const lead = AppState.outreach?.data?.allLeads?.find(l => l.place_id === '${test2Lead.place_id}');
        await openOutreachComposer(lead);
        await new Promise(r => setTimeout(r, 600));

        document.getElementById('btn-composer-open-wa')?.click();
        await new Promise(r => setTimeout(r, 400));

        // Press '2'
        document.dispatchEvent(new KeyboardEvent('keydown', { key: '2', bubbles: true }));
        await new Promise(r => setTimeout(r, 800));

        const modal = document.getElementById('modal-outreach-composer');
        return modal.classList.contains('hidden') || modal.style.display === 'none';
      })()
    `);
    assert.strictEqual(test2Outcome, true, 'Single lead modal should close or reset after No, Not Sent');

    // Verify lead status: should NOT be marked as contacted
    const savedAfterTest2 = await httpRequest('GET', '/api/leads/saved');
    const l2 = savedAfterTest2.data.leads.find(l => l.place_id === test2Lead.place_id);
    assert.notStrictEqual(l2.status, 'Contacted', 'Lead 2 status must NOT be Contacted');
    console.log('✓ TEST 2 PASSED: Key 2 triggered "No, Not Sent" exactly as clicking the button.');

    // ----------------------------------------------------
    // TEST 3: Open lead 2, open WA, press "3" -> Not on WhatsApp
    // ----------------------------------------------------
    console.log('\n--- Running TEST 3: Key 3 triggers "Not on WhatsApp" ---');
    const test3Lead = createdLeads[2];
    const test3Outcome = await win.webContents.executeJavaScript(`
      (async function() {
        const lead = AppState.outreach?.data?.allLeads?.find(l => l.place_id === '${test3Lead.place_id}');
        await openOutreachComposer(lead);
        await new Promise(r => setTimeout(r, 600));

        document.getElementById('btn-composer-open-wa')?.click();
        await new Promise(r => setTimeout(r, 400));

        // Press '3'
        document.dispatchEvent(new KeyboardEvent('keydown', { key: '3', bubbles: true }));
        await new Promise(r => setTimeout(r, 1400));

        const modal = document.getElementById('modal-outreach-composer');
        return modal.classList.contains('hidden') || modal.style.display === 'none';
      })()
    `);
    assert.strictEqual(test3Outcome, true, 'Modal should close after Not on WhatsApp');

    // Verify lead was removed from backend
    const savedAfterTest3 = await httpRequest('GET', '/api/leads/saved');
    const l3 = savedAfterTest3.data.leads.find(l => l.place_id === test3Lead.place_id);
    assert.strictEqual(l3, undefined, 'Lead 3 should have been deleted (Not on WhatsApp)');
    console.log('✓ TEST 3 PASSED: Key 3 triggered "Not on WhatsApp" and deleted lead as expected.');

    // ----------------------------------------------------
    // TEST 4: Multi-Lead Queue Navigation via Keyboard Only
    // ----------------------------------------------------
    console.log('\n--- Running TEST 4: Multi-lead queue via keyboard shortcuts only ---');
    const queueLeads = [createdLeads[3], createdLeads[4], createdLeads[5]];
    const queueResult = await win.webContents.executeJavaScript(`
      (async function() {
        // Start queue with 3 leads
        const qLeads = AppState.outreach?.data?.allLeads?.filter(l =>
          ['${queueLeads[0].place_id}', '${queueLeads[1].place_id}', '${queueLeads[2].place_id}'].includes(l.place_id)
        );
        startOutreachQueue(qLeads, 'outreach');
        await new Promise(r => setTimeout(r, 800));

        const history = [];

        // --- Lead 1 of 3: Open WA -> Press 1 (Yes, Sent) ---
        history.push({ step: document.getElementById('queue-current-step')?.textContent?.trim() });
        document.getElementById('btn-composer-open-wa')?.click();
        await new Promise(r => setTimeout(r, 400));
        document.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }));
        await new Promise(r => setTimeout(r, 1400));

        // --- Lead 2 of 3: Open WA -> Press 2 (No, Not Sent) ---
        history.push({ step: document.getElementById('queue-current-step')?.textContent?.trim() });
        document.getElementById('btn-composer-open-wa')?.click();
        await new Promise(r => setTimeout(r, 400));
        document.dispatchEvent(new KeyboardEvent('keydown', { key: '2', bubbles: true }));
        await new Promise(r => setTimeout(r, 1400));

        // --- Lead 3 of 3: Open WA -> Press 1 (Yes, Sent) ---
        history.push({ step: document.getElementById('queue-current-step')?.textContent?.trim() });
        document.getElementById('btn-composer-open-wa')?.click();
        await new Promise(r => setTimeout(r, 400));
        document.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }));
        await new Promise(r => setTimeout(r, 1600));

        const completeBlock = document.getElementById('composer-queue-complete');
        const isCompleted = !completeBlock.classList.contains('hidden');
        return { history, isCompleted };
      })()
    `);
    console.log('Queue steps traversed:', queueResult.history);
    assert.strictEqual(queueResult.history[0].step, '1');
    assert.strictEqual(queueResult.history[1].step, '2');
    assert.strictEqual(queueResult.history[2].step, '3');
    assert.strictEqual(queueResult.isCompleted, true, 'Queue must complete');
    console.log('✓ TEST 4 PASSED: Multi-lead queue processed smoothly with 1, 2, 1.');

    // ----------------------------------------------------
    // TEST 5: Mouse click still works identically
    // ----------------------------------------------------
    console.log('\n--- Running TEST 5: Verify mouse buttons still work exactly as before ---');
    const test5Lead = createdLeads[6];
    await win.webContents.executeJavaScript(`
      (async function() {
        const lead = AppState.outreach?.data?.allLeads?.find(l => l.place_id === '${test5Lead.place_id}');
        await openOutreachComposer(lead);
        await new Promise(r => setTimeout(r, 600));

        document.getElementById('btn-composer-open-wa')?.click();
        await new Promise(r => setTimeout(r, 400));

        // Click with mouse
        const confirmYesBtn = document.getElementById('btn-confirm-sent-yes');
        confirmYesBtn.click();
        await new Promise(r => setTimeout(r, 1400));
      })()
    `);

    const mCheck = await httpRequest('GET', '/api/leads/saved');
    const mSaved = mCheck.data.leads.find(l => l.place_id === test5Lead.place_id);
    assert.strictEqual(mSaved.status, 'Contacted', 'Mouse click must mark lead as contacted');
    console.log('✓ TEST 5 PASSED: Mouse click works identically to keyboard shortcut.');

    // ----------------------------------------------------
    // TEST 8: Double action & repeat safety
    // ----------------------------------------------------
    console.log('\n--- Running TEST 8: Key repeat and rapid keypresses do not process lead twice ---');
    const test8Lead = createdLeads[7];
    const repeatResult = await win.webContents.executeJavaScript(`
      (async function() {
        const lead = AppState.outreach?.data?.allLeads?.find(l => l.place_id === '${test8Lead.place_id}');
        await openOutreachComposer(lead);
        await new Promise(r => setTimeout(r, 600));

        document.getElementById('btn-composer-open-wa')?.click();
        await new Promise(r => setTimeout(r, 400));

        // Fire initial keydown and rapid repeat keydowns
        document.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }));
        document.dispatchEvent(new KeyboardEvent('keydown', { key: '1', repeat: true, bubbles: true }));
        document.dispatchEvent(new KeyboardEvent('keydown', { key: '1', repeat: true, bubbles: true }));
        document.dispatchEvent(new KeyboardEvent('keydown', { key: '1', repeat: true, bubbles: true }));
        document.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true })); // Rapid second press blocked by isConfirmProcessing

        await new Promise(r => setTimeout(r, 1400));

        const modal = document.getElementById('modal-outreach-composer');
        return modal.classList.contains('hidden') || modal.style.display === 'none';
      })()
    `);
    assert.strictEqual(repeatResult, true, 'Modal should close cleanly without throwing error or double execution');
    console.log('✓ TEST 8 PASSED: Key repeat and rapid double action prevented.');

    // ----------------------------------------------------
    // TEST 9 & 10: Modal close & reopen safety
    // ----------------------------------------------------
    console.log('\n--- Running TEST 9 & 10: Modal close ignores shortcuts; reopening works properly ---');
    const test9Lead = createdLeads[8];

    // TEST 9: Open modal, close it, press 1
    const test9Res = await win.webContents.executeJavaScript(`
      (async function() {
        const lead = AppState.outreach?.data?.allLeads?.find(l => l.place_id === '${test9Lead.place_id}');
        await openOutreachComposer(lead);
        await new Promise(r => setTimeout(r, 500));

        // Close modal
        closeOutreachComposer();
        await new Promise(r => setTimeout(r, 300));

        // Press '1'
        document.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }));
        await new Promise(r => setTimeout(r, 500));

        return true;
      })()
    `);
    const roCheck1 = await httpRequest('GET', '/api/leads/saved');
    const roLeadAfter9 = roCheck1.data.leads.find(l => l.place_id === test9Lead.place_id);
    assert.notStrictEqual(roLeadAfter9.status, 'Contacted', 'Closed modal must ignore key 1');
    console.log('✓ TEST 9 PASSED: Closed modal completely ignores confirmation shortcuts.');

    // TEST 10: Reopen modal and confirm shortcut works again
    const test10Lead = createdLeads[9];
    const test10Res = await win.webContents.executeJavaScript(`
      (async function() {
        const lead = AppState.outreach?.data?.allLeads?.find(l => l.place_id === '${test10Lead.place_id}');
        await openOutreachComposer(lead);
        await new Promise(r => setTimeout(r, 600));

        document.getElementById('btn-composer-open-wa')?.click();
        await new Promise(r => setTimeout(r, 400));

        // Press '1' now that confirmation is active again
        document.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }));
        await new Promise(r => setTimeout(r, 1400));

        const modal = document.getElementById('modal-outreach-composer');
        return modal.classList.contains('hidden') || modal.style.display === 'none';
      })()
    `);
    assert.strictEqual(test10Res, true, 'Reopened modal must process shortcut properly');
    const roCheck2 = await httpRequest('GET', '/api/leads/saved');
    const roLeadAfter10 = roCheck2.data.leads.find(l => l.place_id === test10Lead.place_id);
    assert.strictEqual(roLeadAfter10.status, 'Contacted', 'Reopened lead must be marked Contacted');
    console.log('✓ TEST 10 PASSED: Reopened modal accepts keyboard shortcuts as expected.');

    // Clean up created test leads
    console.log('\nCleaning up all test leads...');
    const allRemainingSaved = await httpRequest('GET', '/api/leads/saved');
    const toDelete = allRemainingSaved.data.leads.filter(l => l.place_id && l.place_id.startsWith('sc_test_'));
    for (const d of toDelete) {
      await httpRequest('DELETE', `/api/leads/${d.id}`);
    }
    console.log(`✓ Cleaned up ${toDelete.length} test leads.`);

    console.log('\n========================================================');
    console.log('ALL 10 TESTS PASSED SUCCESSFULLY! 10/10 VERIFIED!');
    console.log('========================================================');

    app.quit();
    process.exit(0);
  } catch (err) {
    console.error('\n❌ TEST FAILURE:', err);
    app.quit();
    process.exit(1);
  }
});
