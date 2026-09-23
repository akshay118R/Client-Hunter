const { app, BrowserWindow } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const assert = require('assert');
const fs = require('fs');

const TEST_PORT = 3894;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function checkServerReady(port) {
  return new Promise((resolve) => {
    http.get(`http://127.0.0.1:${port}/api/system/status`, (res) => {
      resolve(res.statusCode === 200);
    }).on('error', () => resolve(false));
  });
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
      res.on('data', (chunk) => (data += chunk));
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

app.whenReady().then(async () => {
  console.log('========================================================');
  console.log('VERIFYING COLD CALL COMPLETE REQUIREMENTS');
  console.log('========================================================\n');

  console.log(`Spawning test backend server on port ${TEST_PORT}...`);
  const serverProcess = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: TEST_PORT },
    stdio: 'ignore'
  });

  let win = null;

  try {
    let ready = false;
    for (let i = 0; i < 30; i++) {
      await sleep(400);
      ready = await checkServerReady(TEST_PORT);
      if (ready) break;
    }
    assert(ready, `Server failed to start on port ${TEST_PORT}`);
    console.log(`✓ Test server running on http://127.0.0.1:${TEST_PORT}`);

    // Create 3 demo leads via API so backend and frontend are in sync
    const demoLeads = [
      {
        id: 'demo_lead_a',
        place_id: 'demo_lead_a',
        business_name: 'Lead A Clinic',
        phone_number: '01234 567890',
        phone: '01234 567890',
        category: 'Healthcare',
        city: 'London',
        lead_priority: 'High',
        outreach_status: 'Not Contacted',
        cold_call: { queued: true, status: 'Not Called', outcome: null }
      },
      {
        id: 'demo_lead_b',
        place_id: 'demo_lead_b',
        business_name: 'Lead B Studio',
        phone_number: '01234 567891',
        phone: '01234 567891',
        category: 'Design',
        city: 'London',
        lead_priority: 'Medium',
        outreach_status: 'Not Contacted',
        cold_call: { queued: true, status: 'Not Called', outcome: null }
      },
      {
        id: 'demo_lead_c',
        place_id: 'demo_lead_c',
        business_name: 'Lead C Salon',
        phone_number: '01234 567892',
        phone: '01234 567892',
        category: 'Beauty',
        city: 'London',
        lead_priority: 'Low',
        outreach_status: 'Not Contacted',
        cold_call: { queued: true, status: 'Not Called', outcome: null }
      }
    ];

    await httpRequest(`http://127.0.0.1:${TEST_PORT}/api/leads/save`, { method: 'POST' }, { leads: demoLeads });
    await httpRequest(`http://127.0.0.1:${TEST_PORT}/api/coldcall/add`, { method: 'POST' }, { leadIds: ['demo_lead_a', 'demo_lead_b', 'demo_lead_c'] });

    win = new BrowserWindow({
      width: 1400,
      height: 900,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: false
      }
    });

    console.log(`Loading http://127.0.0.1:${TEST_PORT}/#cold-call in Electron...`);
    await win.loadURL(`http://127.0.0.1:${TEST_PORT}/#cold-call`);
    await sleep(2500);

    const testResults = await win.webContents.executeJavaScript(`
      (async function() {
        const results = [];
        const check = (name, passed, details = '') => {
          results.push({ name, passed, details });
        };

        try {
          // Switch to cold call view
          const coldCallNav = document.querySelector('.nav-link[data-tab="cold-call"]');
          if (coldCallNav) coldCallNav.click();

          // Ensure cold call data is loaded
          await window.loadColdCallData('demo_lead_a');

          // ----------------------------------------------------
          // 1. Check Copy Button Attributes & Behavior
          // ----------------------------------------------------
          const copyBtn = document.getElementById('btn-cc-copy-phone');
          check('Copy button exists', Boolean(copyBtn));
          check('Copy button text is Copy', copyBtn?.textContent.trim().includes('Copy'));
          check('Copy button is not Call', !copyBtn?.textContent.trim().includes('Call'));
          check('Copy button is not an <a> tag with tel:', copyBtn?.getAttribute('href') !== 'tel:');

          copyBtn.click();
          await new Promise((r) => setTimeout(r, 400));
          const toastContainer = document.getElementById('toast-container');
          const lastToastText = toastContainer?.lastElementChild?.textContent || '';
          check('Copy button triggers "Phone number copied" toast', lastToastText.includes('Phone number copied') || lastToastText.includes('copied'), 'Toast: ' + lastToastText);
          check('Copy does NOT mark lead Called', document.getElementById('cc-ws-call-status')?.textContent.trim() === 'NOT CALLED');

          // ----------------------------------------------------
          // 2. Check Page Description
          // ----------------------------------------------------
          const descEl = document.querySelector('.coldcall-header-left .dash-greeting-sub');
          check('Page description matches preferred wording',
            descEl?.textContent.trim() === 'Track your calls one by one and record the outcome.');

          // ----------------------------------------------------
          // 3. Individual Selection Checkbox (CRITICAL)
          // ----------------------------------------------------
          window.AppState.coldCall.selectedIds.clear();
          window.renderColdCallCards();

          const cardA = document.querySelector('.coldcall-card[data-lead-id="demo_lead_a"]');
          const checkInputA = cardA?.querySelector('.coldcall-lead-check');

          // Dispatch change on checkbox A
          checkInputA.checked = true;
          checkInputA.dispatchEvent(new Event('change', { bubbles: true }));

          check('Individual selection of Lead A works', window.AppState.coldCall.selectedIds.has('demo_lead_a'));
          check('Delete button displays "Delete (1)"', document.getElementById('btn-coldcall-remove-batch')?.textContent.includes('Delete (1)'));

          // Multiple selection: select Lead B
          const cardB = document.querySelector('.coldcall-card[data-lead-id="demo_lead_b"]');
          const checkInputB = cardB?.querySelector('.coldcall-lead-check');
          checkInputB.checked = true;
          checkInputB.dispatchEvent(new Event('change', { bubbles: true }));

          check('Multiple selection works (Lead A and B)',
            window.AppState.coldCall.selectedIds.has('demo_lead_a') && window.AppState.coldCall.selectedIds.has('demo_lead_b'));
          check('Delete button displays "Delete (2)"', document.getElementById('btn-coldcall-remove-batch')?.textContent.includes('Delete (2)'));

          // Uncheck Lead B
          checkInputB.checked = false;
          checkInputB.dispatchEvent(new Event('change', { bubbles: true }));
          check('Unchecking Lead B leaves only Lead A',
            window.AppState.coldCall.selectedIds.has('demo_lead_a') && !window.AppState.coldCall.selectedIds.has('demo_lead_b'));
          check('Delete button displays "Delete (1)" again', document.getElementById('btn-coldcall-remove-batch')?.textContent.includes('Delete (1)'));

          // ----------------------------------------------------
          // 4. Delete Confirmation Modal (CRITICAL)
          // ----------------------------------------------------
          const delBatchBtn = document.getElementById('btn-coldcall-remove-batch');
          delBatchBtn.click();

          const deleteModal = document.getElementById('modal-delete-confirm');
          const isModalVisible = deleteModal && !deleteModal.classList.contains('hidden');
          check('Clicking Delete shows confirmation modal', isModalVisible);

          const modalTitle = document.getElementById('confirm-delete-title')?.textContent.trim();
          const modalDesc = document.getElementById('confirm-delete-desc')?.textContent.trim();
          check('Confirmation title is "Delete Selected Leads?"', modalTitle === 'Delete Selected Leads?', 'Got: ' + modalTitle);
          check('Confirmation description has dynamic count 1', modalDesc?.includes('1 selected lead'), 'Got: ' + modalDesc);

          // Click Cancel -> modal closes, NO data changed
          const cancelBtn = document.getElementById('btn-cancel-delete');
          cancelBtn.click();
          check('Cancel closes modal', deleteModal && deleteModal.classList.contains('hidden'));
          check('Lead A is still in queue after Cancel', window.AppState.coldCall.leads.some((l) => l.id === 'demo_lead_a'));

          // Multiple select modal test
          checkInputB.checked = true;
          checkInputB.dispatchEvent(new Event('change', { bubbles: true }));
          delBatchBtn.click();
          const modalDescMulti = document.getElementById('confirm-delete-desc')?.textContent.trim();
          check('Confirmation description has dynamic count 2 for 2 leads', modalDescMulti?.includes('2 selected leads'), 'Got: ' + modalDescMulti);
          cancelBtn.click();

          // Reset selection to Lead A only
          checkInputB.checked = false;
          checkInputB.dispatchEvent(new Event('change', { bubbles: true }));

          // ----------------------------------------------------
          // 5. Delete Execution & Undo Toast (CRITICAL)
          // ----------------------------------------------------
          // Click Delete and confirm
          delBatchBtn.click();
          const performDeleteBtn = document.getElementById('btn-perform-delete');
          performDeleteBtn.click();

          // Wait for delete network call and toast rendering
          await new Promise((r) => setTimeout(r, 600));

          const deleteToast = toastContainer?.lastElementChild;
          const deleteToastText = deleteToast?.textContent || '';
          const undoBtn = deleteToast?.querySelector('.toast-undo-btn');

          check('Lead A removed from coldCall.leads in memory', !window.AppState.coldCall.leads.some((l) => l.id === 'demo_lead_a'));
          check('Delete toast message says "1 lead deleted"', deleteToastText.includes('1 lead deleted'), 'Got: ' + deleteToastText);
          check('Toast has Undo action button', Boolean(undoBtn));

          // Click Undo in the toast
          if (undoBtn) {
            undoBtn.click();
            await new Promise((r) => setTimeout(r, 1000));
          }

          check('Undo restores Lead A into coldCall.leads', window.AppState.coldCall.leads.some((l) => l.id === 'demo_lead_a'));
          check('Undo does NOT duplicate Lead A', window.AppState.coldCall.leads.filter((l) => l.id === 'demo_lead_a').length === 1);

          // ----------------------------------------------------
          // 6. Test Select All -> Unselect One -> Delete
          // ----------------------------------------------------
          const selectAllBtn = document.getElementById('btn-coldcall-select-all');
          selectAllBtn.click();
          check('Select All selects all 3 leads', window.AppState.coldCall.selectedIds.size === 3, 'Size: ' + window.AppState.coldCall.selectedIds.size);

          // Unselect Lead C
          const cardC = document.querySelector('.coldcall-card[data-lead-id="demo_lead_c"]');
          const checkInputC = cardC?.querySelector('.coldcall-lead-check');
          checkInputC.checked = false;
          checkInputC.dispatchEvent(new Event('change', { bubbles: true }));

          check('Unselecting Lead C leaves 2 selected', window.AppState.coldCall.selectedIds.size === 2);
          check('Lead C is unchecked', !window.AppState.coldCall.selectedIds.has('demo_lead_c'));

          // Delete the 2 selected leads
          delBatchBtn.click();
          check('Multi delete confirmation shows dynamic count 2', document.getElementById('confirm-delete-desc')?.textContent.includes('2 selected leads'));
          performDeleteBtn.click();
          await new Promise((r) => setTimeout(r, 600));

          const multiDeleteToast = toastContainer?.lastElementChild;
          const multiDeleteToastText = multiDeleteToast?.textContent || '';
          check('2 leads deleted toast appears', multiDeleteToastText.includes('2 leads deleted'), 'Got: ' + multiDeleteToastText);
          check('Lead C still remains in Cold Call queue', window.AppState.coldCall.leads.some((l) => l.id === 'demo_lead_c'));

          // Undo the 2 leads deletion
          const undoBtnMulti = multiDeleteToast?.querySelector('.toast-undo-btn');
          if (undoBtnMulti) {
            undoBtnMulti.click();
            await new Promise((r) => setTimeout(r, 1000));
          }
          check('Undo restores both deleted leads', window.AppState.coldCall.leads.length >= 3);

          // ----------------------------------------------------
          // 7. Test Counter Formatting (No Unwanted Leading Zeros)
          // ----------------------------------------------------
          const totalVal = document.getElementById('coldcall-metric-total')?.textContent.trim();
          const remVal = document.getElementById('coldcall-metric-remaining')?.textContent.trim();
          const calledVal = document.getElementById('coldcall-metric-called')?.textContent.trim();
          check('Total Queue counter has no leading zero', !/^0[1-9]/.test(totalVal), 'Got: ' + totalVal);
          check('Remaining counter has no leading zero', !/^0[1-9]/.test(remVal), 'Got: ' + remVal);
          check('Called counter is valid integer', !/^0[1-9]/.test(calledVal), 'Got: ' + calledVal);

          return results;
        } catch (err) {
          return [{ name: 'Test execution error', passed: false, details: err.message + '\\n' + err.stack }];
        }
      })()
    `);

    console.log('\n--- VERIFICATION TEST RESULTS ---');
    let allPassed = true;
    testResults.forEach((t) => {
      const mark = t.passed ? '✓ [PASS]' : '✗ [FAIL]';
      console.log(`${mark} ${t.name}${t.details ? ` (${t.details})` : ''}`);
      if (!t.passed) allPassed = false;
    });

    console.log('\nSummary: ' + (allPassed ? 'ALL PASSED' : 'FAILURES DETECTED'));

    // Check Master Saved Leads are completely intact!
    const savedRes = await httpRequest(`http://127.0.0.1:${TEST_PORT}/api/leads/saved`);
    const savedLeads = savedRes.json?.leads || [];
    const masterLeadA = savedLeads.find((l) => l.id === 'demo_lead_a');
    const masterLeadB = savedLeads.find((l) => l.id === 'demo_lead_b');
    const masterLeadC = savedLeads.find((l) => l.id === 'demo_lead_c');

    console.log('\n--- MASTER SAVED LEADS PRESERVATION CHECK ---');
    assert(masterLeadA, 'Master Saved Lead A MUST exist in database');
    assert(masterLeadB, 'Master Saved Lead B MUST exist in database');
    assert(masterLeadC, 'Master Saved Lead C MUST exist in database');
    console.log('✓ [PASS] Master Saved Leads A, B, C are completely intact in Saved Leads database');

    // Clean up demo leads
    for (const id of ['demo_lead_a', 'demo_lead_b', 'demo_lead_c']) {
      await httpRequest(`http://127.0.0.1:${TEST_PORT}/api/leads/${id}`, { method: 'DELETE' });
    }
    console.log('✓ [PASS] Cleaned up demo test leads');

    assert(allPassed, 'All test requirements must pass');
    win.close();
  } finally {
    try { serverProcess.kill('SIGTERM'); } catch (e) {}
    app.quit();
  }
});
