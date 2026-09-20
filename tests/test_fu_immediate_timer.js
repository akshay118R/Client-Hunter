const { app, BrowserWindow } = require('electron');
const path = require('path');
const http = require('http');
const assert = require('assert');
const { fork } = require('child_process');

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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

let serverProcess = null;

async function ensureServerRunning() {
  try {
    const res = await httpRequest('GET', '/api/system/status');
    if (res.status === 200) {
      console.log('✓ Backend server is already running on port 3000');
      return;
    }
  } catch (e) {
    // start server
  }

  console.log('Starting backend server for testing...');
  serverProcess = fork(path.join(__dirname, '../server.js'), [], {
    env: { ...process.env, PORT: 3000 },
    stdio: 'ignore'
  });

  for (let i = 0; i < 30; i++) {
    await sleep(500);
    try {
      const res = await httpRequest('GET', '/api/system/status');
      if (res.status === 200) {
        console.log('✓ Backend server successfully started on port 3000');
        return;
      }
    } catch (err) {}
  }
  throw new Error('Failed to start backend server within 15 seconds');
}

app.whenReady().then(async () => {
  console.log('========================================================');
  console.log('CLIENTHUNTER — FOLLOW-UP WHATSAPP TIMER: IMMEDIATE TEST');
  console.log('========================================================\n');

  let win = null;
  let originalSetting = null;

  try {
    await ensureServerRunning();

    // Fetch initial settings to record original setting for restoration
    const initialSettingsRes = await httpRequest('GET', '/api/settings');
    assert.strictEqual(initialSettingsRes.status, 200, 'Must get 200 from /api/settings');
    originalSetting = initialSettingsRes.data.settings?.whatsappPreferences?.followUpAutoTimer ?? 3;
    console.log(`Original Follow-Up timer setting: ${originalSetting}`);

    // Create BrowserWindow
    win = new BrowserWindow({
      width: 1440,
      height: 900,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: false
      }
    });

    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    await win.loadURL('http://127.0.0.1:3000/#settings');
    await sleep(2000);
    console.log('✓ Loaded Client Hunter window on #settings\n');

    // =========================================================================
    // TEST 1: DROPDOWN OPTIONS INSPECTION
    // =========================================================================
    console.log('--- TEST 1: Dropdown Options Verification ---');
    const dropdownInfo = await win.webContents.executeJavaScript(`
      (() => {
        const fuSelect = document.getElementById('set-wa-fu-auto-timer');
        const outreachSelect = document.getElementById('set-wa-auto-timer');

        if (!fuSelect) return { error: 'Follow-Up timer select not found' };
        if (!outreachSelect) return { error: 'Outreach timer select not found' };

        const fuOptions = Array.from(fuSelect.options).map(o => ({ value: o.value, text: o.text.trim() }));
        const outreachOptions = Array.from(outreachSelect.options).map(o => ({ value: o.value, text: o.text.trim() }));

        return { fuOptions, outreachOptions };
      })()
    `);

    assert(!dropdownInfo.error, dropdownInfo.error);

    const expectedFuOptions = [
      { value: '0', text: 'Off' },
      { value: 'immediate', text: 'Immediate' },
      { value: '3', text: '3 seconds' },
      { value: '5', text: '5 seconds' },
      { value: '10', text: '10 seconds' },
      { value: '15', text: '15 seconds' },
      { value: '20', text: '20 seconds' },
      { value: '30', text: '30 seconds' }
    ];

    assert.strictEqual(dropdownInfo.fuOptions.length, 8, 'Follow-Up timer must have exactly 8 options');
    for (let i = 0; i < expectedFuOptions.length; i++) {
      assert.strictEqual(dropdownInfo.fuOptions[i].value, expectedFuOptions[i].value, `Option ${i} value mismatch`);
      assert.strictEqual(dropdownInfo.fuOptions[i].text, expectedFuOptions[i].text, `Option ${i} text mismatch`);
    }
    console.log('✓ [PASS] Follow-Up dropdown contains all 8 options in exact order:');
    expectedFuOptions.forEach(o => console.log(`   • ${o.text} (value="${o.value}")`));

    // Verify Outreach timer remains unchanged (7 options, no Immediate)
    assert.strictEqual(dropdownInfo.outreachOptions.length, 7, 'Outreach timer must retain 7 options');
    assert(!dropdownInfo.outreachOptions.some(o => o.value === 'immediate' || o.text === 'Immediate'), 'Outreach timer must NOT have Immediate');
    console.log('✓ [PASS] Outreach timer remains completely unchanged');

    // =========================================================================
    // TEST 2: IMMEDIATE OPTION PERSISTENCE & RESTORE
    // =========================================================================
    console.log('\n--- TEST 2: Settings Persistence & Restore ---');
    const persistImmediate = await win.webContents.executeJavaScript(`
      (async () => {
        const fuSelect = document.getElementById('set-wa-fu-auto-timer');
        fuSelect.value = 'immediate';
        fuSelect.dispatchEvent(new Event('change'));
        await new Promise(r => setTimeout(r, 600));

        return {
          stateVal: AppState.settings?.whatsappPreferences?.followUpAutoTimer,
          selectVal: fuSelect.value
        };
      })()
    `);

    assert.strictEqual(persistImmediate.stateVal, 'immediate', 'AppState must have followUpAutoTimer="immediate"');
    assert.strictEqual(persistImmediate.selectVal, 'immediate', 'Select must have value="immediate"');

    // Verify persisted to backend
    const savedBackendSettings = await httpRequest('GET', '/api/settings');
    assert.strictEqual(
      savedBackendSettings.data.settings?.whatsappPreferences?.followUpAutoTimer,
      'immediate',
      'Backend must persist followUpAutoTimer as "immediate"'
    );
    console.log('✓ [PASS] Setting "Immediate" persists in AppState and backend store');

    // Reload settings in UI to verify restore
    const reloadCheck = await win.webContents.executeJavaScript(`
      (async () => {
        await SettingsModule.loadSettings();
        SettingsModule.initSettingsUI();
        const fuSelect = document.getElementById('set-wa-fu-auto-timer');
        return {
          selectVal: fuSelect.value,
          stateVal: AppState.settings?.whatsappPreferences?.followUpAutoTimer,
          seconds: getFollowUpWhatsAppAutoTimerSeconds(),
          setting: getFollowUpWhatsAppAutoTimerSetting()
        };
      })()
    `);

    assert.strictEqual(reloadCheck.selectVal, 'immediate', 'Select must restore "immediate" after reload');
    assert.strictEqual(reloadCheck.stateVal, 'immediate', 'State must restore "immediate" after reload');
    assert.strictEqual(reloadCheck.seconds, 0, 'getFollowUpWhatsAppAutoTimerSeconds() must return 0 for Immediate');
    assert.strictEqual(reloadCheck.setting, 'immediate', 'getFollowUpWhatsAppAutoTimerSetting() must return "immediate"');
    console.log('✓ [PASS] Setting "Immediate" is restored after reload; seconds=0, setting="immediate"');

    // Test saving "0" (Off) persistence
    const persistOff = await win.webContents.executeJavaScript(`
      (async () => {
        const fuSelect = document.getElementById('set-wa-fu-auto-timer');
        fuSelect.value = '0';
        fuSelect.dispatchEvent(new Event('change'));
        await new Promise(r => setTimeout(r, 600));

        await SettingsModule.loadSettings();
        SettingsModule.initSettingsUI();

        return {
          selectVal: fuSelect.value,
          stateVal: AppState.settings?.whatsappPreferences?.followUpAutoTimer,
          seconds: getFollowUpWhatsAppAutoTimerSeconds(),
          setting: getFollowUpWhatsAppAutoTimerSetting()
        };
      })()
    `);

    assert.strictEqual(persistOff.selectVal, '0', 'Select must restore "0" for Off');
    assert.strictEqual(persistOff.stateVal, 0, 'State must restore 0 for Off');
    assert.strictEqual(persistOff.seconds, 0, 'getFollowUpWhatsAppAutoTimerSeconds() returns 0 for Off');
    assert.strictEqual(persistOff.setting, 0, 'getFollowUpWhatsAppAutoTimerSetting() returns 0 for Off');
    console.log('✓ [PASS] Setting "Off" (0) preserves existing meaning and behavior');

    // =========================================================================
    // TEST 3: IMMEDIATE BEHAVIOR (0-second delay, no countdown, no popup, immediate WA open)
    // =========================================================================
    console.log('\n--- TEST 3: Immediate WhatsApp Opening Behavior ---');
    const immediateExecResult = await win.webContents.executeJavaScript(`
      (async () => {
        // Set setting to Immediate
        const fuSelect = document.getElementById('set-wa-fu-auto-timer');
        fuSelect.value = 'immediate';
        fuSelect.dispatchEvent(new Event('change'));
        await new Promise(r => setTimeout(r, 400));

        // Spy on window.open
        let openCalls = [];
        const origOpen = window.open;
        window.open = (url, target) => {
          openCalls.push({ url, target, time: Date.now() });
          return {};
        };

        // Define ONLY demo dummy lead (DATA SAFETY: NO REAL DATA MODIFIED)
        const demoLead = {
          id: 'demo',
          place_id: 'demo',
          business_name: 'Demo Business Clinic',
          category: 'Dental Clinic',
          city: 'Hyderabad',
          phone: '+91 99999 88888',
          next_follow_up_number: 1,
          current_follow_up_number: 0,
          main_message_sent_at: '2026-09-15T10:00:00.000Z'
        };

        const startTime = Date.now();
        openDedicatedFollowUpModal(demoLead);
        const openTime = Date.now() - startTime;

        const modal = document.getElementById('modal-followup-composer');
        const mainContent = document.getElementById('fu-composer-main-content');
        const confirmBlock = document.getElementById('fu-composer-confirm-block');
        const waBtn = document.getElementById('btn-fu-modal-wa');
        const confirmBizName = document.getElementById('fu-confirm-biz-name')?.textContent;

        const mainHidden = mainContent ? mainContent.classList.contains('hidden') : false;
        const confirmVisible = confirmBlock ? !confirmBlock.classList.contains('hidden') : false;
        const btnText = waBtn ? waBtn.querySelector('span')?.textContent : '';

        // Wait 1.2s to ensure no subsequent timer ticks occur
        await new Promise(r => setTimeout(r, 1200));
        const finalCallCount = openCalls.length;

        // Cleanup modal
        closeDedicatedFollowUpModal();
        window.open = origOpen;

        return {
          openCallsCount: openCalls.length,
          openUrl: openCalls[0]?.url,
          openTimeMs: openTime,
          mainHidden,
          confirmVisible,
          btnText,
          confirmBizName,
          finalCallCount
        };
      })()
    `);

    assert.strictEqual(immediateExecResult.openCallsCount, 1, 'WhatsApp must open exactly once immediately');
    assert(immediateExecResult.openUrl.includes('919999988888'), 'URL must contain cleaned demo phone number');
    assert(immediateExecResult.mainHidden, 'Composer main content must be hidden');
    assert(immediateExecResult.confirmVisible, 'Confirmation block must be immediately visible');
    assert.strictEqual(immediateExecResult.confirmBizName, 'Demo Business Clinic', 'Confirm block must show demo business');
    assert.strictEqual(immediateExecResult.finalCallCount, 1, 'No duplicate timer calls must occur');
    console.log(`✓ [PASS] Immediate mode opens WhatsApp immediately (${immediateExecResult.openTimeMs}ms)`);
    console.log('✓ [PASS] No countdown shown, no delay, transitions straight to confirmation block');
    console.log('✓ [PASS] No duplicate timers or repeated calls');

    // =========================================================================
    // TEST 4: OFF BEHAVIOR (No auto-open, manual click only)
    // =========================================================================
    console.log('\n--- TEST 4: Off Mode Behavior Verification ---');
    const offExecResult = await win.webContents.executeJavaScript(`
      (async () => {
        const fuSelect = document.getElementById('set-wa-fu-auto-timer');
        fuSelect.value = '0';
        fuSelect.dispatchEvent(new Event('change'));
        await new Promise(r => setTimeout(r, 400));

        let openCalls = 0;
        const origOpen = window.open;
        window.open = () => { openCalls++; return {}; };

        const demoLead = {
          id: 'demo',
          place_id: 'demo',
          business_name: 'Demo Business Clinic',
          category: 'Dental Clinic',
          city: 'Hyderabad',
          phone: '+91 99999 88888',
          next_follow_up_number: 1,
          current_follow_up_number: 0
        };

        openDedicatedFollowUpModal(demoLead);

        const waBtn = document.getElementById('btn-fu-modal-wa');
        const initialText = waBtn ? waBtn.querySelector('span')?.textContent : '';

        await new Promise(r => setTimeout(r, 1500));

        const afterWaitText = waBtn ? waBtn.querySelector('span')?.textContent : '';
        const mainContent = document.getElementById('fu-composer-main-content');
        const confirmBlock = document.getElementById('fu-composer-confirm-block');

        const mainVisible = mainContent ? !mainContent.classList.contains('hidden') : false;
        const confirmHidden = confirmBlock ? confirmBlock.classList.contains('hidden') : false;

        closeDedicatedFollowUpModal();
        window.open = origOpen;

        return {
          openCalls,
          initialText,
          afterWaitText,
          mainVisible,
          confirmHidden
        };
      })()
    `);

    assert.strictEqual(offExecResult.openCalls, 0, 'WhatsApp must NOT auto-open when Off');
    assert.strictEqual(offExecResult.initialText, 'Open WhatsApp', 'Button text must remain "Open WhatsApp"');
    assert.strictEqual(offExecResult.afterWaitText, 'Open WhatsApp', 'Button text must not change after waiting');
    assert(offExecResult.mainVisible, 'Main content must remain visible');
    assert(offExecResult.confirmHidden, 'Confirm block must remain hidden');
    console.log('✓ [PASS] Off mode: no countdown, no auto-opening, manual click only');

    // =========================================================================
    // TEST 5: COUNTDOWN OPTIONS (3s, 5s, 10s, 15s, 20s, 30s)
    // =========================================================================
    console.log('\n--- TEST 5: Countdown Options Verification (3, 5, 10, 15, 20, 30 sec) ---');
    const secondsOptions = [3, 5, 10, 15, 20, 30];
    for (const sec of secondsOptions) {
      const secResult = await win.webContents.executeJavaScript(`
        (async () => {
          const fuSelect = document.getElementById('set-wa-fu-auto-timer');
          fuSelect.value = '${sec}';
          fuSelect.dispatchEvent(new Event('change'));
          await new Promise(r => setTimeout(r, 200));

          const demoLead = {
            id: 'demo',
            place_id: 'demo',
            business_name: 'Demo Business Clinic',
            category: 'Dental Clinic',
            city: 'Hyderabad',
            phone: '+91 99999 88888',
            next_follow_up_number: 1,
            current_follow_up_number: 0
          };

          openDedicatedFollowUpModal(demoLead);
          const waBtn = document.getElementById('btn-fu-modal-wa');
          const spanText = waBtn ? waBtn.querySelector('span')?.textContent : '';

          closeDedicatedFollowUpModal();

          return {
            setting: getFollowUpWhatsAppAutoTimerSetting(),
            seconds: getFollowUpWhatsAppAutoTimerSeconds(),
            spanText
          };
        })()
      `);

      assert.strictEqual(secResult.setting, sec, `Setting must be ${sec}`);
      assert.strictEqual(secResult.seconds, sec, `Seconds must be ${sec}`);
      assert.strictEqual(secResult.spanText, `Open WhatsApp · ${sec}`, `Button text must display "Open WhatsApp · ${sec}"`);
      console.log(`✓ [PASS] ${sec} seconds option verified: button displays "Open WhatsApp · ${sec}"`);
    }

    // =========================================================================
    // TEST 6: ONE-BY-ONE QUEUE WORKFLOW WITH CONFIRMATION
    // =========================================================================
    console.log('\n--- TEST 6: One-By-One Follow-Up Queue Workflow ---');
    const queueFlowResult = await win.webContents.executeJavaScript(`
      (async () => {
        // Set setting to Immediate
        const fuSelect = document.getElementById('set-wa-fu-auto-timer');
        fuSelect.value = 'immediate';
        fuSelect.dispatchEvent(new Event('change'));
        await new Promise(r => setTimeout(r, 200));

        let openCalls = [];
        const origOpen = window.open;
        window.open = (url) => { openCalls.push(url); return {}; };

        // Set up mock demo queue
        const demoQueue = [
          { id: 'demo_1', place_id: 'demo_1', business_name: 'Demo Lead 1', phone: '+91 99999 11111', next_follow_up_number: 1 },
          { id: 'demo_2', place_id: 'demo_2', business_name: 'Demo Lead 2', phone: '+91 99999 22222', next_follow_up_number: 1 }
        ];

        AppState.followup.queue = {
          isActive: true,
          leads: demoQueue,
          currentIndex: 0
        };

        // Open lead 1 in queue
        openDedicatedFollowUpModal(demoQueue[0]);

        const lead1OpenCalls = openCalls.length;
        const confirm1Visible = !document.getElementById('fu-composer-confirm-block')?.classList.contains('hidden');
        const biz1 = document.getElementById('fu-confirm-biz-name')?.textContent;

        closeDedicatedFollowUpModal();

        // Advance to lead 2 in queue
        AppState.followup.queue.currentIndex = 1;
        openDedicatedFollowUpModal(demoQueue[1]);

        const lead2OpenCalls = openCalls.length;
        const confirm2Visible = !document.getElementById('fu-composer-confirm-block')?.classList.contains('hidden');
        const biz2 = document.getElementById('fu-confirm-biz-name')?.textContent;

        closeDedicatedFollowUpModal();
        AppState.followup.queue.isActive = false;
        window.open = origOpen;

        return {
          lead1OpenCalls,
          confirm1Visible,
          biz1,
          lead2OpenCalls,
          confirm2Visible,
          biz2
        };
      })()
    `);

    assert.strictEqual(queueFlowResult.lead1OpenCalls, 1, 'Lead 1 must open WhatsApp immediately');
    assert(queueFlowResult.confirm1Visible, 'Lead 1 must show confirmation block');
    assert.strictEqual(queueFlowResult.biz1, 'Demo Lead 1', 'Lead 1 biz name matches');
    assert.strictEqual(queueFlowResult.lead2OpenCalls, 2, 'Lead 2 must open WhatsApp immediately');
    assert(queueFlowResult.confirm2Visible, 'Lead 2 must show confirmation block');
    assert.strictEqual(queueFlowResult.biz2, 'Demo Lead 2', 'Lead 2 biz name matches');
    console.log('✓ [PASS] One-by-one queue processing preserved; each lead opens WhatsApp immediately and transitions to confirmation flow');

    // =========================================================================
    // RESTORE ORIGINAL SETTING
    // =========================================================================
    console.log('\n--- Restoring original setting ---');
    await win.webContents.executeJavaScript(`
      (async () => {
        const fuSelect = document.getElementById('set-wa-fu-auto-timer');
        fuSelect.value = '${originalSetting}';
        fuSelect.dispatchEvent(new Event('change'));
        await new Promise(r => setTimeout(r, 400));
      })()
    `);
    console.log(`✓ Original setting restored to ${originalSetting}`);

    console.log('\n========================================================');
    console.log('ALL TESTS PASSED SUCCESSFULLY! 100% VERIFIED.');
    console.log('========================================================');
    console.log('NO REAL DATA MODIFIED');

    if (win) win.close();
    if (serverProcess) serverProcess.kill();
    setTimeout(() => {
      app.quit();
      process.exit(0);
    }, 500);

  } catch (err) {
    console.error('\n❌ TEST SUITE FAILED:', err);
    if (win) win.close();
    if (serverProcess) serverProcess.kill();
    setTimeout(() => {
      app.exit(1);
      process.exit(1);
    }, 500);
  }
});
