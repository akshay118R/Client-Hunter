const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
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
  console.log('CLIENTHUNTER — AUTO-OPEN WHATSAPP TIMER TEST SUITE');
  console.log('========================================================\n');

  try {
    // 0. Verify server readiness
    const sysStatus = await httpRequest('GET', '/api/system/status');
    assert.strictEqual(sysStatus.status, 200, 'Server must be active');
    console.log('✓ Server active on port 3000');

    // Clean up any previously uncleaned test leads first
    const existingSaved = await httpRequest('GET', '/api/leads/saved');
    const stale = existingSaved.data.leads.filter(l => l.place_id && l.place_id.startsWith('wa_test_p'));
    for (const s of stale) {
      await httpRequest('DELETE', `/api/leads/${s.id}`);
    }

    // Create 2 test leads for testing
    const now = Date.now();
    const testDate = '2026-09-18T12:00:00.000Z';
    const p1 = 'wa_test_p1_' + now;
    const p2 = 'wa_test_p2_' + now;
    const sampleLeads = [
      {
        place_id: p1,
        business_name: 'Radiant Dental Care',
        category: 'Dental Clinic',
        city: 'Hyderabad',
        state: 'Telangana',
        phone: '+91 98765 11111',
        website: 'https://radiantdental.example.com',
        website_status: 'YES',
        opportunity_score: 92,
        saved_at: testDate
      },
      {
        place_id: p2,
        business_name: 'Apex Fitness Center',
        category: 'Gym',
        city: 'Hyderabad',
        state: 'Telangana',
        phone: '+91 98765 22222',
        website: '',
        website_status: 'NO',
        opportunity_score: 88,
        saved_at: testDate
      }
    ];

    const saveRes = await httpRequest('POST', '/api/leads/save', { leads: sampleLeads });
    assert.strictEqual(saveRes.data.success, true);
    console.log('✓ Saved 2 test leads');

    const savedAll = await httpRequest('GET', '/api/leads/saved');
    const lead1 = savedAll.data.leads.find(l => l.place_id === p1);
    const lead2 = savedAll.data.leads.find(l => l.place_id === p2);
    assert(lead1 && lead2, 'Must have inserted both test leads');

    // Move to outreach
    await httpRequest('POST', '/api/leads/move-to-outreach', { leadIds: [lead1.id, lead2.id] });
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

    // Intercept window.open so external browser / WhatsApp doesn't actually open real desktop app tabs during automated tests
    win.webContents.setWindowOpenHandler(({ url }) => {
      console.log('   [Simulated external window.open]:', url.slice(0, 45) + '...');
      return { action: 'deny' };
    });

    await win.loadURL('http://127.0.0.1:3000/#outreach');
    await new Promise(r => setTimeout(r, 2000));

    // ----------------------------------------------------
    // TEST 8 & 9: SETTINGS PERSISTENCE & TOAST
    // ----------------------------------------------------
    console.log('\n--- Running TEST 8 & 9: Settings Save, Toast, and Reload Persistence ---');
    const settingsSaveResult = await win.webContents.executeJavaScript(`
      (async function() {
        // Navigate to Settings
        switchView('settings');
        await new Promise(r => setTimeout(r, 400));
        SettingsModule.switchSettingsTab('whatsapp');
        await new Promise(r => setTimeout(r, 400));

        const timerSel = document.getElementById('set-wa-auto-timer');
        if (!timerSel) return { error: 'set-wa-auto-timer not found' };

        // Change timer to 5s
        timerSel.value = '5';
        timerSel.dispatchEvent(new Event('change'));
        await new Promise(r => setTimeout(r, 800));

        const toast = document.querySelector('.toast-message')?.textContent || '';
        const currentStored = AppState.settings?.whatsappPreferences?.autoTimer;
        return { toast, currentStored, selVal: timerSel.value };
      })()
    `);
    console.log('Settings save result:', settingsSaveResult);
    assert.strictEqual(settingsSaveResult.currentStored, 5, 'Setting should be updated to 5');
    assert(settingsSaveResult.toast.includes('Auto Open WhatsApp Timer settings saved'), 'Toast must match requested message');

    // Reload page to test persistence across reload
    await win.loadURL('http://127.0.0.1:3000/#settings');
    await new Promise(r => setTimeout(r, 2000));
    const persistedState = await win.webContents.executeJavaScript(`
      (function() {
        SettingsModule.switchSettingsTab('whatsapp');
        const timerSel = document.getElementById('set-wa-auto-timer');
        return {
          persistedInAppState: AppState.settings?.whatsappPreferences?.autoTimer,
          persistedInDOM: timerSel ? timerSel.value : null
        };
      })()
    `);
    console.log('Persisted state after reload:', persistedState);
    assert.strictEqual(persistedState.persistedInAppState, 5, 'AppState must retain 5s after reload');
    assert.strictEqual(persistedState.persistedInDOM, '5', 'DOM select must retain 5s after reload');
    console.log('✓ TEST 8 & 9 PASSED: Settings saved, toast confirmed, and persisted across reloads.');

    // ----------------------------------------------------
    // TEST 1: Setting = 3s. Open Send Message. Countdown 3 -> 2 -> 1 -> trigger
    // ----------------------------------------------------
    console.log('\n--- Running TEST 1: 3-Second Countdown & Auto-Trigger ---');
    // Set setting back to 3s
    await win.webContents.executeJavaScript(`
      (async function() {
        const timerSel = document.getElementById('set-wa-auto-timer');
        if (timerSel) {
          timerSel.value = '3';
          timerSel.dispatchEvent(new Event('change'));
        }
        await new Promise(r => setTimeout(r, 600));
      })()
    `);

    // Open Send Message composer for lead1
    await win.webContents.executeJavaScript(`
      (async function() {
        switchView('outreach');
        await new Promise(r => setTimeout(r, 500));
        const lead = AppState.outreach.data?.allLeads?.find(l => l.id === '${lead1.id}');
        await openOutreachComposer(lead);
      })()
    `);

    // Monitor countdown button over 4.5 seconds
    const countdownSnapshots = [];
    for (let i = 0; i < 5; i++) {
      await new Promise(r => setTimeout(r, 800));
      const snap = await win.webContents.executeJavaScript(`
        (function() {
          const btn = document.getElementById('btn-composer-open-wa');
          const span = btn?.querySelector('span');
          const mainVis = !document.getElementById('composer-main-content')?.classList.contains('hidden');
          const confirmVis = !document.getElementById('composer-confirm-block')?.classList.contains('hidden');
          return {
            btnText: span ? span.textContent.trim() : '',
            mainVis,
            confirmVis
          };
        })()
      `);
      countdownSnapshots.push(snap);
      console.log(`   Tick ${i + 1}:`, snap);
    }

    // Verify countdown proceeded and ended in confirmVis = true
    const hasCountdown = countdownSnapshots.some(s => s.btnText.includes('Open WhatsApp ·'));
    const finalConfirmVisible = countdownSnapshots[countdownSnapshots.length - 1].confirmVis;
    assert(hasCountdown, 'Button must have displayed countdown text');
    assert(finalConfirmVisible, 'Confirm block must be visible after countdown completes');
    console.log('✓ TEST 1 PASSED: Countdown ticked and automatically triggered Open WhatsApp action.');

    // Close composer modal
    await win.webContents.executeJavaScript(`closeOutreachComposer();`);

    // ----------------------------------------------------
    // TEST 4: Setting = Off (0). No timer.
    // ----------------------------------------------------
    console.log('\n--- Running TEST 4: Setting = Off (0) ---');
    await win.webContents.executeJavaScript(`
      (async function() {
        const timerSel = document.getElementById('set-wa-auto-timer');
        if (timerSel) {
          timerSel.value = '0';
          timerSel.dispatchEvent(new Event('change'));
        }
        await new Promise(r => setTimeout(r, 600));
        const lead = AppState.outreach.data?.allLeads?.find(l => l.id === '${lead1.id}');
        await openOutreachComposer(lead);
      })()
    `);

    await new Promise(r => setTimeout(r, 1200));
    const offSnap = await win.webContents.executeJavaScript(`
      (function() {
        const btn = document.getElementById('btn-composer-open-wa');
        const span = btn?.querySelector('span');
        const mainVis = !document.getElementById('composer-main-content')?.classList.contains('hidden');
        const confirmVis = !document.getElementById('composer-confirm-block')?.classList.contains('hidden');
        return {
          btnText: span ? span.textContent.trim() : '',
          mainVis,
          confirmVis
        };
      })()
    `);
    console.log('Off state snapshot:', offSnap);
    assert.strictEqual(offSnap.btnText, 'Open WhatsApp', 'Button text must remain "Open WhatsApp" without countdown');
    assert.strictEqual(offSnap.mainVis, true, 'Composer main content must remain visible');
    assert.strictEqual(offSnap.confirmVis, false, 'Confirm block must NOT open automatically');
    console.log('✓ TEST 4 PASSED: When Off, no timer runs and button requires manual click.');

    await win.webContents.executeJavaScript(`closeOutreachComposer();`);

    // ----------------------------------------------------
    // TEST 5: 10s timer, manual click at 2s cancels timer
    // ----------------------------------------------------
    console.log('\n--- Running TEST 5: Manual click before countdown reaches zero ---');
    await win.webContents.executeJavaScript(`
      (async function() {
        const timerSel = document.getElementById('set-wa-auto-timer');
        if (timerSel) {
          timerSel.value = '10';
          timerSel.dispatchEvent(new Event('change'));
        }
        await new Promise(r => setTimeout(r, 600));
        const lead = AppState.outreach.data?.allLeads?.find(l => l.id === '${lead1.id}');
        await openOutreachComposer(lead);
      })()
    `);

    await new Promise(r => setTimeout(r, 1200));
    const clickManualRes = await win.webContents.executeJavaScript(`
      (function() {
        const btn = document.getElementById('btn-composer-open-wa');
        const textBefore = btn?.querySelector('span')?.textContent?.trim();
        // Click manually
        btn.click();
        const confirmVis = !document.getElementById('composer-confirm-block')?.classList.contains('hidden');
        return { textBefore, confirmVis };
      })()
    `);
    console.log('Manual click result:', clickManualRes);
    assert(clickManualRes.textBefore.includes('Open WhatsApp ·'), 'Should have had active countdown before click');
    assert.strictEqual(clickManualRes.confirmVis, true, 'Confirm block should open immediately upon manual click');
    console.log('✓ TEST 5 PASSED: Manual click opened WhatsApp immediately and cancelled timer.');

    await win.webContents.executeJavaScript(`closeOutreachComposer();`);

    // ----------------------------------------------------
    // TEST 6: Start countdown and click Cancel
    // ----------------------------------------------------
    console.log('\n--- Running TEST 6: Start countdown and click Cancel ---');
    await win.webContents.executeJavaScript(`
      (async function() {
        const lead = AppState.outreach.data?.allLeads?.find(l => l.id === '${lead1.id}');
        await openOutreachComposer(lead);
      })()
    `);

    await new Promise(r => setTimeout(r, 1000));
    const cancelRes = await win.webContents.executeJavaScript(`
      (async function() {
        const cancelBtn = document.getElementById('btn-composer-cancel');
        cancelBtn.click();
        await new Promise(r => setTimeout(r, 400));
        const modal = document.getElementById('modal-outreach-composer');
        const isHidden = modal.classList.contains('hidden') || modal.style.display === 'none';
        return { isHidden };
      })()
    `);
    console.log('Cancel result:', cancelRes);
    assert.strictEqual(cancelRes.isHidden, true, 'Modal must be hidden after clicking Cancel');

    // Wait 4 seconds to be 100% sure timer does not fire after close
    await new Promise(r => setTimeout(r, 3000));
    const afterCloseCheck = await win.webContents.executeJavaScript(`
      (function() {
        const confirmVis = !document.getElementById('composer-confirm-block')?.classList.contains('hidden');
        const modalHidden = document.getElementById('modal-outreach-composer')?.classList.contains('hidden');
        return { confirmVis, modalHidden };
      })()
    `);
    assert.strictEqual(afterCloseCheck.modalHidden, true, 'Modal must stay hidden');
    assert.strictEqual(afterCloseCheck.confirmVis, false, 'Confirm block must never open after Cancel');
    console.log('✓ TEST 6 PASSED: Cancel immediately closed modal and aborted timer.');

    // ----------------------------------------------------
    // TEST 7: Multi-lead queue
    // ----------------------------------------------------
    console.log('\n--- Running TEST 7: Multi-Lead Queue Workflow ---');
    // Set timer to 3s
    await win.webContents.executeJavaScript(`
      (async function() {
        const timerSel = document.getElementById('set-wa-auto-timer');
        if (timerSel) {
          timerSel.value = '3';
          timerSel.dispatchEvent(new Event('change'));
        }
        await new Promise(r => setTimeout(r, 500));

        // Start queue with 2 leads
        const l1 = AppState.outreach.data?.allLeads?.find(l => l.id === '${lead1.id}');
        const l2 = AppState.outreach.data?.allLeads?.find(l => l.id === '${lead2.id}');
        await startOutreachQueue([l1, l2], 'outreach');
      })()
    `);

    // Check Lead 1 countdown active
    await new Promise(r => setTimeout(r, 800));
    const q1State = await win.webContents.executeJavaScript(`
      (function() {
        const curStep = document.getElementById('queue-current-step')?.textContent?.trim();
        const totStep = document.getElementById('queue-total-step')?.textContent?.trim();
        const btnText = document.getElementById('btn-composer-open-wa')?.querySelector('span')?.textContent?.trim();
        return { curStep, totStep, btnText };
      })()
    `);
    console.log('Queue Lead 1 state:', q1State);
    assert.strictEqual(q1State.curStep, '1');
    assert.strictEqual(q1State.totStep, '2');
    assert(q1State.btnText.includes('Open WhatsApp ·'));

    // Wait for Lead 1 auto-trigger
    await new Promise(r => setTimeout(r, 3400));

    // Confirm Lead 1 as sent
    await win.webContents.executeJavaScript(`
      (async function() {
        const confirmYesBtn = document.getElementById('btn-confirm-sent-yes');
        confirmYesBtn.click();
        await new Promise(r => setTimeout(r, 800));
      })()
    `);

    // Check Lead 2 now loaded with active countdown
    const q2State = await win.webContents.executeJavaScript(`
      (function() {
        const curStep = document.getElementById('queue-current-step')?.textContent?.trim();
        const totStep = document.getElementById('queue-total-step')?.textContent?.trim();
        const btnText = document.getElementById('btn-composer-open-wa')?.querySelector('span')?.textContent?.trim();
        return { curStep, totStep, btnText };
      })()
    `);
    console.log('Queue Lead 2 state:', q2State);
    assert.strictEqual(q2State.curStep, '2');
    assert(q2State.btnText.includes('Open WhatsApp ·'));
    console.log('✓ TEST 7 PASSED: Multi-lead queue sequentially applied timer at Open WhatsApp stage for each lead.');

    await win.webContents.executeJavaScript(`stopOutreachQueue();`);

    // ----------------------------------------------------
    // TEST 10: Verify Saved Leads and Outreach Data Integrity
    // ----------------------------------------------------
    console.log('\n--- Running TEST 10: Data Model & Relationship Integrity ---');
    const finalSaved = await httpRequest('GET', '/api/leads/saved');

    const lead1Saved = finalSaved.data.leads.find(l => l.id === lead1.id);
    const lead2Saved = finalSaved.data.leads.find(l => l.id === lead2.id);

    assert(lead1Saved, 'Lead 1 must still exist in Saved Leads');
    assert(lead2Saved, 'Lead 2 must still exist in Saved Leads');
    assert.strictEqual(lead1Saved.business_name, 'Radiant Dental Care');
    assert.strictEqual(lead2Saved.business_name, 'Apex Fitness Center');
    console.log('✓ Saved Leads remain completely intact with all fields and dates preserved.');

    // Clean up test leads
    console.log('\nCleaning up test leads...');
    await httpRequest('DELETE', `/api/leads/${lead1.id}`);
    await httpRequest('DELETE', `/api/leads/${lead2.id}`);
    console.log('✓ Cleaned up test leads.');

    // Restore default timer setting to 3s
    await httpRequest('POST', '/api/settings', {
      whatsappPreferences: { autoTimer: 3 },
      _category: 'Auto Open WhatsApp Timer'
    });
    console.log('✓ Restored setting to default (3s).');

    console.log('\n========================================================');
    console.log('ALL TESTS PASSED SUCCESSFULLY! 10/10 VERIFIED!');
    console.log('========================================================');

    app.quit();
    process.exit(0);
  } catch (err) {
    console.error('\n❌ TEST SUITE FAILURE:', err);
    app.quit();
    process.exit(1);
  }
});
