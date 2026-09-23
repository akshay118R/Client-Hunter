const { app, BrowserWindow } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const assert = require('assert');
const fs = require('fs');

const TEST_PORT = 3897;

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

app.whenReady().then(async () => {
  console.log('Spawning test backend server on port ' + TEST_PORT + '...');
  const serverProcess = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: TEST_PORT },
    stdio: 'ignore'
  });

  try {
    let ready = false;
    for (let i = 0; i < 30; i++) {
      await sleep(400);
      ready = await checkServerReady(TEST_PORT);
      if (ready) break;
    }
    assert(ready, `Server failed to start on port ${TEST_PORT}`);
    console.log(`✓ Test server running on http://127.0.0.1:${TEST_PORT}`);

    const win = new BrowserWindow({
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
    await sleep(2000);

    console.log('Executing live DOM and workflow verification in Electron...');
    const result = await win.webContents.executeJavaScript(`
      (async function() {
        try {
          // Switch to cold call view if not already active
          const coldCallNav = document.querySelector('.nav-link[data-tab="cold-call"]');
          if (coldCallNav) coldCallNav.click();

          // 1. Check UI elements
          const startCallingBtn = document.getElementById('btn-coldcall-start-calling');
          const copyPhoneBtn = document.getElementById('btn-cc-copy-phone');
          const noticeEl = document.querySelector('.cc-call-notice');
          const statusBadge = document.getElementById('cc-ws-call-status');
          const headerBadge = document.querySelector('.coldcall-header-left .dash-terminal-badge');
          const headerDesc = document.querySelector('.coldcall-header-left .dash-greeting-sub');
          const outcomeContainer = document.querySelector('.cc-outcome-container');
          const scriptContainer = document.querySelector('.cc-script-container');
          const scriptToggleHead = document.getElementById('btn-cc-toggle-script-head');

          // Check DOM structure order: outcome container should precede script container
          const leadCardChildren = Array.from(document.getElementById('cc-ws-lead-card')?.children || []);
          const outcomeIdx = leadCardChildren.indexOf(outcomeContainer);
          const scriptIdx = leadCardChildren.indexOf(scriptContainer);

          // Mock 2 sample leads for queue workflow testing
          window.AppState.coldCall.leads = [
            {
              id: 'demo_track_1',
              place_id: 'demo_track_1',
              business_name: 'Alpha Dental Spa',
              phone_number: '077298 07206',
              category: 'Dentistry',
              city: 'London',
              lead_priority: 'High',
              cold_call: {
                queued: true,
                status: 'Not Called',
                outcome: null
              }
            },
            {
              id: 'demo_track_2',
              place_id: 'demo_track_2',
              business_name: 'Beta Ortho Clinic',
              phone_number: '077298 07999',
              category: 'Orthodontics',
              city: 'London',
              lead_priority: 'Medium',
              cold_call: {
                queued: true,
                status: 'Not Called',
                outcome: null
              }
            }
          ];

          window.renderColdCallCards();
          window.selectColdCallLead('demo_track_1');

          // 2. Inspect workspace state after selecting demo_track_1
          const initialStatus = statusBadge?.textContent.trim();
          const phoneText = document.getElementById('cc-ws-phone-number')?.textContent.trim();
          const bizNameText = document.getElementById('cc-ws-business-name')?.textContent.trim();
          const isCopyBtnDisabled = copyPhoneBtn?.classList.contains('disabled');

          // Test clicking Copy button
          let toastMsg = '';
          const originalShowToast = window.showToast;
          window.showToast = function(msg) { toastMsg = msg; };

          copyPhoneBtn.click();
          const statusAfterCopy = statusBadge?.textContent.trim();
          const leadStatusAfterCopy = window.AppState.coldCall?.leads?.[0]?.cold_call?.status;

          // Test script collapse toggle
          const isCollapsedBefore = scriptContainer?.classList.contains('collapsed');
          if (scriptToggleHead) scriptToggleHead.click();
          const isCollapsedAfter = scriptContainer?.classList.contains('collapsed');
          if (scriptToggleHead) scriptToggleHead.click(); // restore

          // Test Next Lead advance
          window.advanceColdCallQueue();
          const nextLeadBizName = document.getElementById('cc-ws-business-name')?.textContent.trim();
          const nextLeadPhone = document.getElementById('cc-ws-phone-number')?.textContent.trim();

          // Re-render and select demo_track_1 for screenshot
          window.renderColdCallCards();
          window.selectColdCallLead('demo_track_1');

          // Restore showToast
          window.showToast = originalShowToast;

          return {
            success: true,
            hasStartCallingBtn: Boolean(startCallingBtn),
            hasCopyPhoneBtn: Boolean(copyPhoneBtn),
            copyBtnTagName: copyPhoneBtn?.tagName,
            copyBtnHasTel: copyPhoneBtn?.getAttribute('href')?.startsWith('tel:') || false,
            noticeText: noticeEl?.textContent.trim(),
            headerBadgeText: headerBadge?.textContent.trim(),
            headerDescText: headerDesc?.textContent.trim(),
            outcomePrecedesScript: outcomeIdx !== -1 && scriptIdx !== -1 && outcomeIdx < scriptIdx,
            initialStatus,
            phoneText,
            bizNameText,
            isCopyBtnDisabled,
            statusAfterCopy,
            leadStatusAfterCopy,
            isCollapsedBefore,
            isCollapsedAfter,
            nextLeadBizName,
            nextLeadPhone
          };
        } catch (err) {
          return {
            success: false,
            error: err.message,
            stack: err.stack
          };
        }
      })()
    `);

    console.log('Result:\n', JSON.stringify(result, null, 2));

    assert(result.success, `Execution error: ${result.error}`);
    assert.strictEqual(result.hasStartCallingBtn, false, 'Start Calling Queue button must be removed');
    assert.strictEqual(result.hasCopyPhoneBtn, true, 'Copy phone button must be present');
    assert.strictEqual(result.copyBtnTagName, 'BUTTON', 'Copy button must be a <button>, not an <a>');
    assert.strictEqual(result.copyBtnHasTel, false, 'Copy button must not use tel: URI');
    assert(result.noticeText.includes('call from your mobile'), 'Notice must state to call from mobile');
    assert(result.headerDescText.includes('Track your calls'), 'Header description must state "Track your calls"');
    assert.strictEqual(result.outcomePrecedesScript, true, 'Call Outcome section must be placed above Call Script');
    assert.strictEqual(result.initialStatus, 'NOT CALLED', 'Initial lead status must be NOT CALLED');
    assert.strictEqual(result.statusAfterCopy, 'NOT CALLED', 'Clicking Copy must NOT change status');
    assert.strictEqual(result.leadStatusAfterCopy, 'Not Called', 'Clicking Copy must NOT mutate lead data');
    assert.strictEqual(result.isCollapsedBefore, false, 'Script container is expanded initially');
    assert.strictEqual(result.isCollapsedAfter, true, 'Script container collapses on header click');
    assert.strictEqual(result.nextLeadBizName, 'Beta Ortho Clinic', 'advanceColdCallQueue advances to next lead');
    assert.strictEqual(result.nextLeadPhone, '077298 07999', 'Next lead phone is loaded into workspace');

    // Take screenshot of workspace for visual verification
    const screenshot = await win.capturePage();
    if (!fs.existsSync('scratch')) fs.mkdirSync('scratch', { recursive: true });
    fs.writeFileSync('scratch/coldcall_mobile_workspace_live.png', screenshot.toPNG());
    console.log('✓ Visual confirmation saved to scratch/coldcall_mobile_workspace_live.png');

    console.log('\n========================================================');
    console.log('✓ ALL MOBILE CALL TRACKING WORKSPACE CHECKS PASSED!');
    console.log('========================================================\n');

    win.close();
  } finally {
    try { serverProcess.kill('SIGTERM'); } catch (e) {}
    app.quit();
  }
});
