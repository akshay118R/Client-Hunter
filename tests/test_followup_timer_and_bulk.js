const { app, BrowserWindow } = require('electron');
const path = require('path');
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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

app.whenReady().then(async () => {
  console.log('========================================================');
  console.log('CLIENTHUNTER — FOLLOW-UP TIMER & BULK SYSTEM TEST SUITE');
  console.log('========================================================\n');

  let win = null;
  try {
    // 0. Verify server readiness
    const sysStatus = await httpRequest('GET', '/api/system/status');
    assert.strictEqual(sysStatus.status, 200, 'Server must be active');
    console.log('✓ [PASS] Server is active on port 3000');

    // Clean up any existing test leads
    const existingSaved = await httpRequest('GET', '/api/leads/saved');
    if (existingSaved.data && Array.isArray(existingSaved.data.leads)) {
      const stale = existingSaved.data.leads.filter(l => l.place_id && l.place_id.startsWith('fu_timer_test_'));
      for (const s of stale) {
        await httpRequest('DELETE', `/api/leads/${s.id}`);
      }
    }

    // Seed 3 test leads with main_message_sent_at so they appear in Follow-Up
    const now = Date.now();
    const anchorPast = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(); // 3 days ago -> due for Follow-Up #1
    const testLeads = [
      {
        place_id: 'fu_timer_test_1_' + now,
        business_name: 'Alpha Apex Diagnostics',
        category: 'Diagnostic Lab',
        city: 'Hyderabad',
        state: 'Telangana',
        phone: '+91 98765 20001',
        website: 'https://alphaapex.example.com',
        rating: 4.8,
        reviews_count: 120,
        main_message_sent_at: anchorPast,
        first_message_sent: true,
        first_message_sent_at: anchorPast,
        outreach_status: 'Follow-Up',
        current_follow_up_number: 0,
        next_follow_up_number: 1,
        next_follow_up_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() // Overdue by 1 day
      },
      {
        place_id: 'fu_timer_test_2_' + now,
        business_name: 'Beta Bright Smiles',
        category: 'Dental Clinic',
        city: 'Hyderabad',
        state: 'Telangana',
        phone: '+91 98765 20002',
        website: 'https://betabright.example.com',
        rating: 4.7,
        reviews_count: 95,
        main_message_sent_at: anchorPast,
        first_message_sent: true,
        first_message_sent_at: anchorPast,
        outreach_status: 'Follow-Up',
        current_follow_up_number: 0,
        next_follow_up_number: 1,
        next_follow_up_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() // Due today
      },
      {
        place_id: 'fu_timer_test_3_' + now,
        business_name: 'Gamma Glow Aesthetics',
        category: 'Skin Clinic',
        city: 'Secunderabad',
        state: 'Telangana',
        phone: '+91 98765 20003',
        website: 'https://gammaglow.example.com',
        rating: 4.9,
        reviews_count: 150,
        main_message_sent_at: anchorPast,
        first_message_sent: true,
        first_message_sent_at: anchorPast,
        outreach_status: 'Follow-Up',
        current_follow_up_number: 0,
        next_follow_up_number: 1,
        next_follow_up_at: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString() // Due today
      }
    ];

    const saveRes = await httpRequest('POST', '/api/leads/save', { leads: testLeads });
    assert.strictEqual(saveRes.status, 200, `Failed to seed test leads: ${JSON.stringify(saveRes.data)}`);
    console.log('✓ [PASS] Seeded 3 test follow-up leads');

    // Create BrowserWindow
    win = new BrowserWindow({
      width: 1400,
      height: 900,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: false
      }
    });

    await win.loadURL('http://localhost:3000');
    await sleep(2000);

    // =========================================================================
    // TEST 1: SEPARATE SETTINGS (Outreach Timer vs Follow-Up Timer)
    // =========================================================================
    console.log('\n--- TEST 1: Independent Settings Verification ---');
    const settingsCheck = await win.webContents.executeJavaScript(`
      (async () => {
        // Set Outreach to 5, Follow-Up to 15
        const waTimer = document.getElementById('set-wa-auto-timer');
        const waFuTimer = document.getElementById('set-wa-fu-auto-timer');

        if (!waTimer || !waFuTimer) return { error: 'Timer select elements not found' };

        waTimer.value = '5';
        waTimer.dispatchEvent(new Event('change'));
        await new Promise(r => setTimeout(r, 400));

        waFuTimer.value = '15';
        waFuTimer.dispatchEvent(new Event('change'));
        await new Promise(r => setTimeout(r, 400));

        return {
          outreachTimerInUI: waTimer.value,
          followUpTimerInUI: waFuTimer.value,
          outreachTimerInState: AppState.settings?.whatsappPreferences?.autoTimer,
          followUpTimerInState: AppState.settings?.whatsappPreferences?.followUpAutoTimer
        };
      })()
    `);

    assert.strictEqual(settingsCheck.outreachTimerInUI, '5', 'Outreach timer select must be 5');
    assert.strictEqual(settingsCheck.followUpTimerInUI, '15', 'Follow-Up timer select must be 15');
    assert.strictEqual(settingsCheck.outreachTimerInState, 5, 'AppState outreach timer must be 5');
    assert.strictEqual(settingsCheck.followUpTimerInState, 15, 'AppState follow-up timer must be 15');
    console.log('✓ [PASS] Outreach Timer (5s) and Follow-Up Timer (15s) saved independently');

    // Test setting Follow-Up to 0 ("Off") without altering Outreach timer
    const timerOffCheck = await win.webContents.executeJavaScript(`
      (async () => {
        const waTimer = document.getElementById('set-wa-auto-timer');
        const waFuTimer = document.getElementById('set-wa-fu-auto-timer');

        waFuTimer.value = '0';
        waFuTimer.dispatchEvent(new Event('change'));
        await new Promise(r => setTimeout(r, 400));

        return {
          outreachTimerInUI: waTimer.value,
          followUpTimerInUI: waFuTimer.value,
          outreachTimerInState: AppState.settings?.whatsappPreferences?.autoTimer,
          followUpTimerInState: AppState.settings?.whatsappPreferences?.followUpAutoTimer
        };
      })()
    `);

    assert.strictEqual(timerOffCheck.outreachTimerInUI, '5', 'Outreach timer must remain 5 when FU changes to 0');
    assert.strictEqual(timerOffCheck.followUpTimerInUI, '0', 'Follow-Up timer must be 0 (Off)');
    assert.strictEqual(timerOffCheck.outreachTimerInState, 5, 'AppState outreach timer must remain 5');
    assert.strictEqual(timerOffCheck.followUpTimerInState, 0, 'AppState follow-up timer must be 0');
    console.log('✓ [PASS] Follow-Up timer set to Off (0s) does not affect Outreach timer (5s)');

    // =========================================================================
    // TEST 2: FOLLOW-UP TIMER OFF (No Auto Opening)
    // =========================================================================
    console.log('\n--- TEST 2: Follow-Up Timer Off Behavior ---');
    const timerOffBehavior = await win.webContents.executeJavaScript(`
      (async () => {
        // Track window.open calls
        let openCalls = 0;
        window.open = () => { openCalls++; };

        await loadFollowUpData();
        const testLead = AppState.followup.leads.find(l => l.place_id && l.place_id.startsWith('fu_timer_test_1'));
        if (!testLead) return { error: 'Test lead 1 not found' };

        openDedicatedFollowUpModal(testLead);
        const waBtn = document.getElementById('btn-fu-modal-wa');
        const spanTextInitial = waBtn?.querySelector('span')?.textContent;

        // Wait 1.5 seconds
        await new Promise(r => setTimeout(r, 1500));
        const spanTextAfterWait = waBtn?.querySelector('span')?.textContent;
        const finalOpenCalls = openCalls;

        closeDedicatedFollowUpModal();
        return {
          spanTextInitial,
          spanTextAfterWait,
          openCalls: finalOpenCalls
        };
      })()
    `);

    assert.strictEqual(timerOffBehavior.spanTextInitial, 'Open WhatsApp', 'Button text must remain "Open WhatsApp" when timer is Off');
    assert.strictEqual(timerOffBehavior.spanTextAfterWait, 'Open WhatsApp', 'Button text must not change after waiting');
    assert.strictEqual(timerOffBehavior.openCalls, 0, 'WhatsApp must NOT automatically open when timer is Off');
    console.log('✓ [PASS] Follow-Up timer Off: no countdown, no automatic WhatsApp opening');

    // =========================================================================
    // TEST 3: FOLLOW-UP TIMER (3 Seconds Countdown -> Auto Open)
    // =========================================================================
    console.log('\n--- TEST 3: Follow-Up Timer 3 Seconds Countdown ---');
    const timer3sCheck = await win.webContents.executeJavaScript(`
      (async () => {
        let openCalls = 0;
        window.open = () => { openCalls++; };

        // Set FU timer to 3s
        const waFuTimer = document.getElementById('set-wa-fu-auto-timer');
        waFuTimer.value = '3';
        waFuTimer.dispatchEvent(new Event('change'));
        await new Promise(r => setTimeout(r, 300));

        await loadFollowUpData();
        const testLead = AppState.followup.leads.find(l => l.place_id && l.place_id.startsWith('fu_timer_test_1'));
        openDedicatedFollowUpModal(testLead);

        const waBtn = document.getElementById('btn-fu-modal-wa');
        const t0Text = waBtn?.querySelector('span')?.textContent;

        await new Promise(r => setTimeout(r, 1050));
        const t1Text = waBtn?.querySelector('span')?.textContent;

        await new Promise(r => setTimeout(r, 1050));
        const t2Text = waBtn?.querySelector('span')?.textContent;

        // Wait for final tick to trigger open
        await new Promise(r => setTimeout(r, 1100));
        const finalOpenCalls = openCalls;
        const confirmBlockVisible = !document.getElementById('fu-composer-confirm-block')?.classList.contains('hidden');

        closeDedicatedFollowUpModal();
        return {
          t0Text,
          t1Text,
          t2Text,
          openCalls: finalOpenCalls,
          confirmBlockVisible
        };
      })()
    `);

    assert.strictEqual(timer3sCheck.t0Text, 'Open WhatsApp · 3', 'Initial countdown must show 3');
    assert.strictEqual(timer3sCheck.t1Text, 'Open WhatsApp · 2', 'Countdown after 1s must show 2');
    assert.strictEqual(timer3sCheck.t2Text, 'Open WhatsApp · 1', 'Countdown after 2s must show 1');
    assert.strictEqual(timer3sCheck.openCalls, 1, 'WhatsApp must be automatically opened once after 3s');
    assert.strictEqual(timer3sCheck.confirmBlockVisible, true, 'Confirm block must be visible after auto opening');
    console.log('✓ [PASS] 3s Timer: 3 → 2 → 1 → automatically opened WhatsApp once');

    // =========================================================================
    // TEST 4: PREVENT DOUBLE OPENING (Manual Click Cancels Timer)
    // =========================================================================
    console.log('\n--- TEST 4: Prevent Double Opening on Manual Click ---');
    const doubleOpenCheck = await win.webContents.executeJavaScript(`
      (async () => {
        let openCalls = 0;
        window.open = () => { openCalls++; };

        await loadFollowUpData();
        const testLead = AppState.followup.leads.find(l => l.place_id && l.place_id.startsWith('fu_timer_test_1'));
        openDedicatedFollowUpModal(testLead);

        // Wait 500ms into countdown, then manually click
        await new Promise(r => setTimeout(r, 500));
        const waBtn = document.getElementById('btn-fu-modal-wa');
        waBtn.click();
        const callsAfterClick = openCalls;

        // Wait 3.5s to ensure timer cannot trigger a second open
        await new Promise(r => setTimeout(r, 3500));
        const callsAfterWait = openCalls;

        closeDedicatedFollowUpModal();
        return {
          callsAfterClick,
          callsAfterWait
        };
      })()
    `);

    assert.strictEqual(doubleOpenCheck.callsAfterClick, 1, 'Manual click opens WhatsApp once immediately');
    assert.strictEqual(doubleOpenCheck.callsAfterWait, 1, 'Timer must not open WhatsApp a second time');
    console.log('✓ [PASS] Manual click during countdown cancelled timer and prevented double opening');

    // =========================================================================
    // TEST 5: CANCEL TIMER ON MODAL CLOSE / CANCEL
    // =========================================================================
    console.log('\n--- TEST 5: Cancel Timer on Modal Close ---');
    const cancelOnCloseCheck = await win.webContents.executeJavaScript(`
      (async () => {
        let openCalls = 0;
        window.open = () => { openCalls++; };

        await loadFollowUpData();
        const testLead = AppState.followup.leads.find(l => l.place_id && l.place_id.startsWith('fu_timer_test_1'));
        openDedicatedFollowUpModal(testLead);

        // Wait 500ms into countdown, then close via Cancel button
        await new Promise(r => setTimeout(r, 500));
        const cancelBtn = document.getElementById('btn-fu-modal-cancel');
        cancelBtn.click();

        // Wait 3.5s to ensure timer was truly cleared
        await new Promise(r => setTimeout(r, 3500));
        return {
          openCalls,
          isModalHidden: document.getElementById('modal-followup-composer')?.classList.contains('hidden')
        };
      })()
    `);

    assert.strictEqual(cancelOnCloseCheck.openCalls, 0, 'WhatsApp must NOT open after modal is cancelled');
    assert.strictEqual(cancelOnCloseCheck.isModalHidden, true, 'Modal must remain closed');
    console.log('✓ [PASS] Closing modal stopped timer immediately; WhatsApp did not open');

    // =========================================================================
    // TEST 6: SELECT ALL FOLLOW-UP LEADS
    // =========================================================================
    console.log('\n--- TEST 6: Select All Control Verification ---');
    const selectAllCheck = await win.webContents.executeJavaScript(`
      (async () => {
        switchView('followup');
        await loadFollowUpData();
        renderFollowUpCards();

        const chkSelectAll = document.getElementById('chk-fu-select-all');
        const textSelectAll = document.getElementById('text-fu-select-all');
        const badgeCount = document.getElementById('badge-fu-selected-count');
        const btnBulk = document.getElementById('btn-fu-bulk-send');

        // Initially unchecked
        const initialChecked = chkSelectAll?.checked;
        const initialDisabled = btnBulk?.disabled;

        // Toggle Select All
        chkSelectAll.checked = true;
        chkSelectAll.dispatchEvent(new Event('change'));

        const selectedCountAfterCheck = AppState.followup.selectedLeadIds.size;
        const textAfterCheck = textSelectAll?.textContent;
        const badgeAfterCheck = badgeCount?.textContent;
        const bulkBtnDisabledAfterCheck = btnBulk?.disabled;

        // Toggle Deselect All
        chkSelectAll.checked = false;
        chkSelectAll.dispatchEvent(new Event('change'));

        const selectedCountAfterUncheck = AppState.followup.selectedLeadIds.size;
        const bulkBtnDisabledAfterUncheck = btnBulk?.disabled;

        return {
          initialChecked,
          initialDisabled,
          selectedCountAfterCheck,
          textAfterCheck,
          badgeAfterCheck,
          bulkBtnDisabledAfterCheck,
          selectedCountAfterUncheck,
          bulkBtnDisabledAfterUncheck
        };
      })()
    `);

    assert.strictEqual(selectAllCheck.initialChecked, false, 'Select All must initially be unchecked');
    assert.strictEqual(selectAllCheck.initialDisabled, true, 'Bulk button must initially be disabled');
    assert.ok(selectAllCheck.selectedCountAfterCheck >= 3, 'Must have selected all seeded eligible leads');
    assert.ok(selectAllCheck.textAfterCheck.includes('Select All'), 'Text must display Select All');
    assert.ok(selectAllCheck.badgeAfterCheck.includes('selected'), 'Badge must display count of selected leads');
    assert.strictEqual(selectAllCheck.bulkBtnDisabledAfterCheck, false, 'Bulk button must be enabled when leads are selected');
    assert.strictEqual(selectAllCheck.selectedCountAfterUncheck, 0, 'Deselect All must clear selected IDs');
    assert.strictEqual(selectAllCheck.bulkBtnDisabledAfterUncheck, true, 'Bulk button must be disabled after deselecting');
    console.log(`✓ [PASS] Select All selected ${selectAllCheck.selectedCountAfterCheck} eligible leads, updated count display, and toggled off`);

    // =========================================================================
    // TEST 7: BULK FOLLOW-UP QUEUE (One-by-One with Queue Indicator & Per-Lead Timer)
    // =========================================================================
    console.log('\n--- TEST 7: Bulk Follow-Up Queue Flow ---');
    const bulkQueueCheck = await win.webContents.executeJavaScript(`
      (async () => {
        let openCalls = 0;
        window.open = () => { openCalls++; };

        switchView('followup');
        await loadFollowUpData();

        // Select exactly 2 test leads
        AppState.followup.selectedLeadIds.clear();
        const l1 = AppState.followup.leads.find(l => l.place_id && l.place_id.startsWith('fu_timer_test_1'));
        const l2 = AppState.followup.leads.find(l => l.place_id && l.place_id.startsWith('fu_timer_test_2'));

        AppState.followup.selectedLeadIds.add(String(l1.id || l1.place_id));
        AppState.followup.selectedLeadIds.add(String(l2.id || l2.place_id));
        updateFollowUpSelectionUI();

        // Start bulk queue
        startBulkFollowUpQueue();

        const trackerVisible1 = !document.getElementById('fu-modal-queue-tracker')?.classList.contains('hidden');
        const step1Text = document.getElementById('fu-queue-current-step')?.textContent;
        const total1Text = document.getElementById('fu-queue-total-step')?.textContent;
        const biz1 = document.getElementById('fu-modal-bizname')?.textContent;

        // Manually open WhatsApp for Lead 1
        handleOpenDedicatedWhatsApp();

        // Confirm YES for Lead 1
        await handleConfirmDedicatedSent(true);
        await new Promise(r => setTimeout(r, 600));

        // Verify it advanced to Lead 2
        const trackerVisible2 = !document.getElementById('fu-modal-queue-tracker')?.classList.contains('hidden');
        const step2Text = document.getElementById('fu-queue-current-step')?.textContent;
        const total2Text = document.getElementById('fu-queue-total-step')?.textContent;
        const biz2 = document.getElementById('fu-modal-bizname')?.textContent;

        // Stop queue on Lead 2
        const btnStop = document.getElementById('btn-fu-queue-stop');
        btnStop.click();

        return {
          trackerVisible1,
          step1Text,
          total1Text,
          biz1,
          trackerVisible2,
          step2Text,
          total2Text,
          biz2,
          queueActiveAfterStop: AppState.followup.queue?.isActive,
          modalClosedAfterStop: document.getElementById('modal-followup-composer')?.classList.contains('hidden')
        };
      })()
    `);

    assert.strictEqual(bulkQueueCheck.trackerVisible1, true, 'Queue indicator must be visible for Lead 1');
    assert.strictEqual(bulkQueueCheck.step1Text, '1', 'Queue current step must be 1');
    assert.strictEqual(bulkQueueCheck.total1Text, '2', 'Queue total step must be 2');
    assert.strictEqual(bulkQueueCheck.biz1, 'Alpha Apex Diagnostics', 'Lead 1 must be Alpha Apex Diagnostics');

    assert.strictEqual(bulkQueueCheck.trackerVisible2, true, 'Queue indicator must be visible for Lead 2');
    assert.strictEqual(bulkQueueCheck.step2Text, '2', 'Queue current step must be 2');
    assert.strictEqual(bulkQueueCheck.total2Text, '2', 'Queue total step must be 2');
    assert.strictEqual(bulkQueueCheck.biz2, 'Beta Bright Smiles', 'Lead 2 must be Beta Bright Smiles');

    assert.strictEqual(bulkQueueCheck.queueActiveAfterStop, false, 'Stopping queue must set isActive to false');
    assert.strictEqual(bulkQueueCheck.modalClosedAfterStop, true, 'Modal must close on stop');
    console.log('✓ [PASS] Bulk queue processed Lead 1 (1 of 2), advanced to Lead 2 (2 of 2), and Stop button halted queue cleanly');

    // =========================================================================
    // TEST 8: CONFIRMATION MODAL BUTTONS (Single-Line, No "Not on WhatsApp" in FU)
    // =========================================================================
    console.log('\n--- TEST 8: Follow-Up Confirmation Buttons Layout ---');
    const fuButtonsCheck = await win.webContents.executeJavaScript(`
      (() => {
        const notOnWaInFu = document.getElementById('btn-fu-confirm-not-wa');
        const btnYes = document.getElementById('btn-fu-confirm-yes');
        const btnNo = document.getElementById('btn-fu-confirm-no');

        const yesText = btnYes?.textContent?.trim().replace(/\\s+/g, ' ');
        const noText = btnNo?.textContent?.trim().replace(/\\s+/g, ' ');

        const yesStyle = window.getComputedStyle(btnYes);
        const noStyle = window.getComputedStyle(btnNo);

        return {
          hasNotOnWaInFu: Boolean(notOnWaInFu),
          yesText,
          noText,
          yesWhiteSpace: yesStyle.whiteSpace,
          noWhiteSpace: noStyle.whiteSpace
        };
      })()
    `);

    assert.strictEqual(fuButtonsCheck.hasNotOnWaInFu, false, '"Not on WhatsApp" button must NOT exist in Follow-Up modal');
    assert.strictEqual(fuButtonsCheck.yesText, '✓ Yes — Message Sent', 'Yes button text must be "✓ Yes — Message Sent"');
    assert.strictEqual(fuButtonsCheck.noText, '✕ No — Not Sent', 'No button text must be "✕ No — Not Sent"');
    assert.strictEqual(fuButtonsCheck.yesWhiteSpace, 'nowrap', 'Yes button white-space must be nowrap');
    assert.strictEqual(fuButtonsCheck.noWhiteSpace, 'nowrap', 'No button white-space must be nowrap');
    console.log('✓ [PASS] Follow-Up confirmation has NO "Not on WhatsApp" button and single-line "✓ Yes — Message Sent" / "✕ No — Not Sent"');

    // =========================================================================
    // TEST 9: PRESERVATION OF OUTREACH PAGE (Completely Untouched)
    // =========================================================================
    console.log('\n--- TEST 9: Outreach Page Integrity ---');
    const outreachIntegrityCheck = await win.webContents.executeJavaScript(`
      (() => {
        // Switch to outreach
        switchView('outreach');

        const outreachTimerSetting = document.getElementById('set-wa-auto-timer');
        const notOnWaInOutreach = document.getElementById('btn-confirm-not-on-wa');
        const composerQueueTracker = document.getElementById('composer-queue-tracker');
        const btnOutreachYes = document.getElementById('btn-confirm-sent-yes');
        const btnOutreachNo = document.getElementById('btn-confirm-sent-no');

        return {
          hasOutreachTimerSetting: Boolean(outreachTimerSetting),
          outreachTimerValue: outreachTimerSetting?.value,
          hasNotOnWaInOutreach: Boolean(notOnWaInOutreach),
          notOnWaText: notOnWaInOutreach?.textContent?.trim().replace(/\\s+/g, ' '),
          hasOutreachQueueTracker: Boolean(composerQueueTracker),
          hasOutreachYes: Boolean(btnOutreachYes),
          hasOutreachNo: Boolean(btnOutreachNo)
        };
      })()
    `);

    assert.strictEqual(outreachIntegrityCheck.hasOutreachTimerSetting, true, 'Outreach timer setting must exist');
    assert.strictEqual(outreachIntegrityCheck.outreachTimerValue, '5', 'Outreach timer setting value must remain 5');
    assert.strictEqual(outreachIntegrityCheck.hasNotOnWaInOutreach, true, 'Outreach MUST retain "Not on WhatsApp" button');
    assert.ok(outreachIntegrityCheck.notOnWaText.includes('Not on WhatsApp'), 'Outreach button must contain "Not on WhatsApp"');
    assert.strictEqual(outreachIntegrityCheck.hasOutreachQueueTracker, true, 'Outreach queue tracker must exist');
    assert.strictEqual(outreachIntegrityCheck.hasOutreachYes, true, 'Outreach YES button must exist');
    assert.strictEqual(outreachIntegrityCheck.hasOutreachNo, true, 'Outreach NO button must exist');
    console.log('✓ [PASS] Outreach page is 100% intact: retains "Not on WhatsApp", separate timer, and queue');

    console.log('\n========================================================');
    console.log('ALL TESTS PASSED SUCCESSFULLY! (9/9)');
    console.log('========================================================\n');

    // Cleanup seeded test leads
    for (const tl of testLeads) {
      const saved = await httpRequest('GET', '/api/leads/saved');
      const match = saved.data.leads.find(l => l.place_id === tl.place_id);
      if (match) {
        await httpRequest('DELETE', `/api/leads/${match.id}`);
      }
    }
    console.log('✓ Cleaned up test leads');

    win.destroy();
    app.quit();
    process.exit(0);
  } catch (err) {
    console.error('\n❌ TEST SUITE FAILED:', err);
    if (win) win.destroy();
    app.quit();
    process.exit(1);
  }
});
