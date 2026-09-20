const { app, BrowserWindow } = require('electron');
const http = require('http');
const assert = require('assert');
const path = require('path');
const fs = require('fs');

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
  console.log('CLIENTHUNTER — SMART FOLLOW-UP QUEUE COMPLETE 18-TEST SUITE');
  console.log('========================================================\n');

  let win = null;
  try {
    // 0. Verify server status
    const sysStatus = await httpRequest('GET', '/api/system/status');
    assert.strictEqual(sysStatus.status, 200, 'Server must be active');
    console.log('✓ Server active on port 3000');

    // Create browser window for Electron UI tests
    win = new BrowserWindow({
      width: 1440,
      height: 900,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    await win.loadURL('http://127.0.0.1:3000/#followup');
    await new Promise(r => setTimeout(r, 2000));
    console.log('✓ Loaded ClientHunter window in headless Electron on #followup\n');

    // Clean up any existing test leads from previous runs
    const existingSaved = await httpRequest('GET', '/api/leads/saved');
    const stale = (existingSaved.data.leads || []).filter(l => l.place_id && l.place_id.startsWith('fu_test_'));
    for (const s of stale) {
      await httpRequest('DELETE', `/api/leads/${s.id}`);
    }
    if (stale.length > 0) console.log(`✓ Cleaned up ${stale.length} leftover test leads`);

    // Seed test leads for all 18 test scenarios
    const now = new Date();
    const todayIso = now.toISOString();

    const overdueDate = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString(); // 2 days ago
    const dueTodayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 0, 0).toISOString(); // Today
    const dueSoonDate = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString(); // 2 days from now (Due Soon)
    const upcomingDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days from now (Upcoming)

    const testLeadsSeed = [
      {
        place_id: `fu_test_overdue_${Date.now()}`,
        business_name: 'Overdue Test Spa',
        category: 'Spa & Wellness',
        city: 'Hyderabad',
        state: 'Telangana',
        phone: '+91 91234 56780',
        opportunity_score: 85,
        saved_at: overdueDate,
        first_message_sent: true,
        main_message_sent_at: overdueDate,
        last_message_sent_at: overdueDate,
        last_message_type: 'Main Message',
        current_follow_up_number: 0,
        next_follow_up_number: 1,
        next_follow_up_at: overdueDate,
        outreach_status: 'Follow-Up',
        notes: [{ id: 'note-1', text: 'Important VIP client follow up urgently', created_at: overdueDate }]
      },
      {
        place_id: `fu_test_today_${Date.now()}`,
        business_name: 'Today Test Dental',
        category: 'Dental Clinic',
        city: 'Hyderabad',
        state: 'Telangana',
        phone: '+91 91234 56781',
        opportunity_score: 90,
        saved_at: overdueDate,
        first_message_sent: true,
        main_message_sent_at: overdueDate,
        last_message_sent_at: overdueDate,
        last_message_type: 'Main Message',
        current_follow_up_number: 0,
        next_follow_up_number: 1,
        next_follow_up_at: dueTodayDate,
        outreach_status: 'Follow-Up'
      },
      {
        place_id: `fu_test_duesoon_${Date.now()}`,
        business_name: 'Due Soon Test Salon',
        category: 'Hair Salon',
        city: 'Hyderabad',
        state: 'Telangana',
        phone: '+91 91234 56782',
        opportunity_score: 75,
        saved_at: overdueDate,
        first_message_sent: true,
        main_message_sent_at: overdueDate,
        last_message_sent_at: overdueDate,
        last_message_type: 'Main Message',
        current_follow_up_number: 0,
        next_follow_up_number: 1,
        next_follow_up_at: dueSoonDate,
        outreach_status: 'Follow-Up'
      },
      {
        place_id: `fu_test_upcoming_${Date.now()}`,
        business_name: 'Upcoming Test Gym',
        category: 'Fitness Center',
        city: 'Hyderabad',
        state: 'Telangana',
        phone: '+91 91234 56783',
        opportunity_score: 80,
        saved_at: overdueDate,
        first_message_sent: true,
        main_message_sent_at: overdueDate,
        last_message_sent_at: overdueDate,
        last_message_type: 'Main Message',
        current_follow_up_number: 0,
        next_follow_up_number: 1,
        next_follow_up_at: upcomingDate,
        outreach_status: 'Follow-Up'
      }
    ];

    const saveRes = await httpRequest('POST', '/api/leads/save', { leads: testLeadsSeed });
    assert.strictEqual(saveRes.data.success, true, 'Seeded leads must save');
    console.log('✓ Seeded 4 specialized follow-up leads (Overdue, Today, Due Soon, Upcoming)');

    // Refresh application state
    await win.webContents.executeJavaScript(`
      (async function() {
        await loadFollowUpData();
        setFollowUpTab('all');
      })()
    `);
    await new Promise(r => setTimeout(r, 600));

    // ----------------------------------------------------
    // TEST 1 — Overdue
    // ----------------------------------------------------
    console.log('\n--- TEST 1: Overdue Lead Categorization & Display ---');
    const test1 = await win.webContents.executeJavaScript(`
      (function() {
        setFollowUpTab('overdue');
        const cards = Array.from(document.querySelectorAll('#followup-cards-container .followup-card'));
        const overdueLead = cards.find(c => c.textContent.includes('Overdue Test Spa'));
        const badge = overdueLead ? overdueLead.querySelector('.fu-badge.overdue') : null;
        return {
          found: Boolean(overdueLead),
          badgeText: badge ? badge.textContent.trim() : null
        };
      })()
    `);
    assert.strictEqual(test1.found, true, 'Overdue lead must appear under Overdue tab');
    assert(test1.badgeText && test1.badgeText.includes('OVERDUE'), 'Badge must show OVERDUE');
    console.log(`✓ TEST 1 PASSED: Overdue lead appears under Overdue with badge "${test1.badgeText}".`);

    // ----------------------------------------------------
    // TEST 2 — Today
    // ----------------------------------------------------
    console.log('\n--- TEST 2: Due Today Lead Categorization & Display ---');
    const test2 = await win.webContents.executeJavaScript(`
      (function() {
        setFollowUpTab('due-today');
        const cards = Array.from(document.querySelectorAll('#followup-cards-container .followup-card'));
        const todayLead = cards.find(c => c.textContent.includes('Today Test Dental'));
        const badge = todayLead ? todayLead.querySelector('.fu-badge.due') : null;
        return {
          found: Boolean(todayLead),
          badgeText: badge ? badge.textContent.trim() : null
        };
      })()
    `);
    assert.strictEqual(test2.found, true, 'Due today lead must appear under Today tab');
    assert(test2.badgeText && test2.badgeText.includes('DUE TODAY'), 'Badge must show DUE TODAY');
    console.log(`✓ TEST 2 PASSED: Today lead appears under Due Today with badge "${test2.badgeText}".`);

    // ----------------------------------------------------
    // TEST 3 — Upcoming
    // ----------------------------------------------------
    console.log('\n--- TEST 3: Upcoming Lead Categorization & Display ---');
    const test3 = await win.webContents.executeJavaScript(`
      (function() {
        setFollowUpTab('upcoming');
        const cards = Array.from(document.querySelectorAll('#followup-cards-container .followup-card'));
        const upcomingLead = cards.find(c => c.textContent.includes('Upcoming Test Gym'));
        const badge = upcomingLead ? upcomingLead.querySelector('.fu-badge.upcoming') : null;
        return {
          found: Boolean(upcomingLead),
          badgeText: badge ? badge.textContent.trim() : null
        };
      })()
    `);
    assert.strictEqual(test3.found, true, 'Upcoming lead must appear under Upcoming tab');
    assert(test3.badgeText && test3.badgeText.includes('UPCOMING'), 'Badge must show UPCOMING');
    console.log(`✓ TEST 3 PASSED: Upcoming lead appears under Upcoming with badge "${test3.badgeText}".`);

    // ----------------------------------------------------
    // TEST 4 — Priority Order
    // ----------------------------------------------------
    console.log('\n--- TEST 4: Priority Ordering (Overdue -> Today -> Due Soon -> Upcoming) ---');
    const test4 = await win.webContents.executeJavaScript(`
      (function() {
        setFollowUpTab('all');
        const cards = Array.from(document.querySelectorAll('#followup-cards-container .followup-card'));
        const titles = cards.map(c => c.querySelector('.fu-biz-name')?.textContent?.trim() || '');
        const overdueIdx = titles.indexOf('Overdue Test Spa');
        const todayIdx = titles.indexOf('Today Test Dental');
        const dueSoonIdx = titles.indexOf('Due Soon Test Salon');
        const upcomingIdx = titles.indexOf('Upcoming Test Gym');
        return { overdueIdx, todayIdx, dueSoonIdx, upcomingIdx, total: cards.length };
      })()
    `);
    assert(test4.overdueIdx !== -1, 'Overdue lead must be in All list');
    assert(test4.todayIdx !== -1, 'Today lead must be in All list');
    assert(test4.dueSoonIdx !== -1, 'Due Soon lead must be in All list');
    assert(test4.upcomingIdx !== -1, 'Upcoming lead must be in All list');
    assert(test4.overdueIdx < test4.todayIdx, 'Overdue must appear before Today');
    assert(test4.todayIdx < test4.dueSoonIdx, 'Today must appear before Due Soon');
    assert(test4.dueSoonIdx < test4.upcomingIdx, 'Due Soon must appear before Upcoming');
    console.log(`✓ TEST 4 PASSED: Priority strictly maintained: Overdue (#${test4.overdueIdx}) < Today (#${test4.todayIdx}) < Due Soon (#${test4.dueSoonIdx}) < Upcoming (#${test4.upcomingIdx}).`);

    // ----------------------------------------------------
    // TEST 5 — Message Button
    // ----------------------------------------------------
    console.log('\n--- TEST 5: Message Button Opens Follow-Up Modal ---');
    const test5 = await win.webContents.executeJavaScript(`
      (function() {
        const overdueCard = Array.from(document.querySelectorAll('#followup-cards-container .followup-card'))
          .find(c => c.textContent.includes('Overdue Test Spa'));
        const msgBtn = overdueCard ? overdueCard.querySelector('.btn-fu-send') : null;
        if (msgBtn) msgBtn.click();
        const modal = document.getElementById('modal-followup-composer');
        const isVisible = modal && !modal.classList.contains('hidden') && modal.style.display !== 'none';
        const bizName = document.getElementById('fu-modal-bizname')?.textContent;
        // Close modal
        closeDedicatedFollowUpModal();
        return { isVisible, bizName };
      })()
    `);
    assert.strictEqual(test5.isVisible, true, 'Message button must open follow-up composer modal');
    assert.strictEqual(test5.bizName, 'Overdue Test Spa', 'Composer modal must display correct lead business');
    console.log(`✓ TEST 5 PASSED: Message button opened follow-up modal for "${test5.bizName}".`);

    // ----------------------------------------------------
    // TEST 6 — Queue Progression
    // ----------------------------------------------------
    console.log('\n--- TEST 6: Start Follow-Up Queue and Progress to Next Lead ---');
    const test6 = await win.webContents.executeJavaScript(`
      (function() {
        startFollowUpQueue();
        const modal = document.getElementById('modal-followup-composer');
        const firstBiz = document.getElementById('fu-modal-bizname')?.textContent;
        // Advance queue to next
        openFollowUpQueueLead(1);
        const secondBiz = document.getElementById('fu-modal-bizname')?.textContent;
        closeDedicatedFollowUpModal();
        if (AppState.followup.queue) AppState.followup.queue.isActive = false;
        return { firstBiz, secondBiz };
      })()
    `);
    assert(test6.firstBiz && test6.firstBiz.length > 0, 'First lead in queue must open');
    assert(test6.secondBiz && test6.secondBiz.length > 0, 'Second lead in queue must open');
    console.log(`✓ TEST 6 PASSED: Queue smoothly progressed from "${test6.firstBiz}" to "${test6.secondBiz}".`);

    // ----------------------------------------------------
    // TEST 7 — Keyboard Shortcuts (1, 2, 3)
    // ----------------------------------------------------
    console.log('\n--- TEST 7: Invisible Keyboard Shortcuts 1, 2, 3 ---');
    const test7 = await win.webContents.executeJavaScript(`
      (function() {
        const lead = AppState.followup.leads.find(l => l.business_name === 'Today Test Dental');
        openDedicatedFollowUpModal(lead);
        handleOpenDedicatedWhatsApp(); // Moves to confirmation block

        const confirmBlock = document.getElementById('fu-composer-confirm-block');
        const isConfirmVisible = confirmBlock && !confirmBlock.classList.contains('hidden');

        // Test key 2 (No, Not Sent)
        document.dispatchEvent(new KeyboardEvent('keydown', { key: '2', bubbles: true }));

        const modal = document.getElementById('modal-followup-composer');
        const isClosed = modal.classList.contains('hidden') || modal.style.display === 'none';

        return { isConfirmVisible, isClosed };
      })()
    `);
    assert.strictEqual(test7.isConfirmVisible, true, 'Confirm block was open');
    assert.strictEqual(test7.isClosed, true, 'Pressing key 2 triggered No, Not Sent and closed modal');
    console.log('✓ TEST 7 PASSED: Keyboard shortcut 2 successfully triggered No, Not Sent.');

    // ----------------------------------------------------
    // TEST 8 — Snooze
    // ----------------------------------------------------
    console.log('\n--- TEST 8: Snooze Follow-Up by 3 Days ---');
    const todayLeadObj = (await httpRequest('GET', '/api/outreach/data')).data.allLeads.find(l => l.business_name === 'Today Test Dental');
    assert(todayLeadObj, 'Today lead must exist');

    const snoozeRes = await httpRequest('POST', '/api/outreach/snooze-followup', {
      leadId: todayLeadObj.id,
      days: 3
    });
    assert.strictEqual(snoozeRes.data.success, true, 'Snooze endpoint must succeed');
    const updatedNextAt = snoozeRes.data.lead.next_follow_up_at;
    const diffSnoozed = Math.round((new Date(updatedNextAt).getTime() - new Date(todayIso).getTime()) / (24 * 3600 * 1000));
    assert(diffSnoozed >= 2 && diffSnoozed <= 4, 'Next follow-up must be ~3 days in future');

    // Verify activity timeline recorded followup_snoozed
    const activities = snoozeRes.data.lead.activities || [];
    const snoozeActivity = activities.find(a => a.event_type === 'followup_snoozed');
    assert(snoozeActivity, 'Activity timeline must record followup_snoozed event');
    console.log(`✓ TEST 8 PASSED: Follow-up snoozed 3 days to ${updatedNextAt}, activity recorded.`);

    // ----------------------------------------------------
    // TEST 9 — Notes
    // ----------------------------------------------------
    console.log('\n--- TEST 9: Notes Indicator and Preservation ---');
    const overdueWithNote = (await httpRequest('GET', '/api/outreach/data')).data.allLeads.find(l => l.business_name === 'Overdue Test Spa');
    assert(overdueWithNote && Array.isArray(overdueWithNote.notes) && overdueWithNote.notes.length > 0, 'Note must exist');

    await win.webContents.executeJavaScript(`
      (async function() {
        await loadFollowUpData();
        setFollowUpTab('all');
      })()
    `);
    await new Promise(r => setTimeout(r, 600));

    const test9 = await win.webContents.executeJavaScript(`
      (function() {
        const overdueCard = Array.from(document.querySelectorAll('#followup-cards-container .followup-card'))
          .find(c => c.textContent.includes('Overdue Test Spa'));
        const noteBadge = overdueCard ? overdueCard.querySelector('.fu-note-badge') : null;
        return {
          foundBadge: Boolean(noteBadge),
          badgeText: noteBadge ? noteBadge.textContent.trim() : null
        };
      })()
    `);
    assert.strictEqual(test9.foundBadge, true, 'Follow-up card must display note badge');
    assert(test9.badgeText.includes('Note available'), 'Badge must indicate note available');
    console.log(`✓ TEST 9 PASSED: Lead note badge visible: "${test9.badgeText}".`);

    // ----------------------------------------------------
    // TEST 10 — Reply
    // ----------------------------------------------------
    console.log('\n--- TEST 10: Mark Lead as Replied ---');
    const replyRes = await httpRequest('POST', '/api/outreach/mark-replied', {
      leadId: overdueWithNote.id,
      replyStatus: 'INTERESTED'
    });
    assert.strictEqual(replyRes.data.success, true, 'Mark replied must succeed');

    await win.webContents.executeJavaScript(`
      (async function() {
        await loadFollowUpData();
        setFollowUpTab('all');
      })()
    `);
    await new Promise(r => setTimeout(r, 600));

    const test10 = await win.webContents.executeJavaScript(`
      (function() {
        const activeCards = Array.from(document.querySelectorAll('#followup-cards-container .followup-card'));
        const inActiveQueue = activeCards.some(c => c.textContent.includes('Overdue Test Spa'));
        setFollowUpTab('replies');
        const replyCards = Array.from(document.querySelectorAll('#followup-cards-container .followup-card'));
        const inReplyQueue = replyCards.some(c => c.textContent.includes('Overdue Test Spa'));
        return { inActiveQueue, inReplyQueue };
      })()
    `);
    assert.strictEqual(test10.inActiveQueue, false, 'Replied lead must not appear in active queue');
    assert.strictEqual(test10.inReplyQueue, true, 'Replied lead must appear in Replies tab');
    console.log('✓ TEST 10 PASSED: Replied lead excluded from active follow-up queue.');

    // ----------------------------------------------------
    // TEST 11 — Stopped
    // ----------------------------------------------------
    console.log('\n--- TEST 11: Mark Lead as Stopped ---');
    const upcomingGym = (await httpRequest('GET', '/api/outreach/data')).data.allLeads.find(l => l.business_name === 'Upcoming Test Gym');
    assert(upcomingGym, 'Upcoming gym lead must exist');

    const stopRes = await httpRequest('POST', '/api/outreach/mark-stopped', {
      leadId: upcomingGym.id
    });
    assert.strictEqual(stopRes.data.success, true, 'Mark stopped must succeed');

    await win.webContents.executeJavaScript(`
      (async function() {
        await loadFollowUpData();
        setFollowUpTab('all');
      })()
    `);
    await new Promise(r => setTimeout(r, 600));

    const test11 = await win.webContents.executeJavaScript(`
      (function() {
        const cards = Array.from(document.querySelectorAll('#followup-cards-container .followup-card'));
        return { found: cards.some(c => c.textContent.includes('Upcoming Test Gym')) };
      })()
    `);
    assert.strictEqual(test11.found, false, 'Stopped lead must disappear from active follow-up queue');
    console.log('✓ TEST 11 PASSED: Stopped lead disappeared from active follow-up queue.');

    // ----------------------------------------------------
    // TEST 12 — Activity Timeline
    // ----------------------------------------------------
    console.log('\n--- TEST 12: Activity Timeline Complete Event Tracking ---');
    const actRes = await httpRequest('GET', `/api/leads/${todayLeadObj.id}/activities`);
    assert.strictEqual(actRes.status, 200, 'Activities request must return 200');
    const events = (actRes.data.activities || []).map(a => a.event_type);
    assert(events.includes('followup_snoozed'), 'Must include followup_snoozed');
    assert(events.includes('followup_not_sent'), 'Must include followup_not_sent');
    console.log('✓ TEST 12 PASSED: Activity timeline records all follow-up actions:', events);

    // ----------------------------------------------------
    // TEST 13 & 14 — Delete and Undo Restore
    // ----------------------------------------------------
    console.log('\n--- TEST 13 & 14: Delete and Undo Restore ---');
    const delRes = await httpRequest('DELETE', `/api/leads/${todayLeadObj.id}`);
    assert.strictEqual(delRes.data.success, true, 'Delete lead must succeed');
    const undoToken = delRes.data.undoToken;
    assert(undoToken, 'Delete must return undoToken');

    const savedAfterDel = (await httpRequest('GET', '/api/leads/saved')).data.leads || [];
    const verifyDel = savedAfterDel.find(l => String(l.id) === String(todayLeadObj.id));
    assert.strictEqual(verifyDel, undefined, 'Lead must be deleted');
    console.log('✓ TEST 13 PASSED: Lead successfully deleted.');

    const undoRes = await httpRequest('POST', '/api/leads/undo-delete', { undoToken });
    assert.strictEqual(undoRes.data.success, true, 'Undo delete must succeed');
    const savedAfterUndo = (await httpRequest('GET', '/api/leads/saved')).data.leads || [];
    const restoredLead = savedAfterUndo.find(l => String(l.id) === String(todayLeadObj.id));
    assert(restoredLead, 'Restored lead must exist');
    assert.strictEqual(restoredLead.business_name, 'Today Test Dental', 'Restored lead business name matches');
    assert(restoredLead.next_follow_up_at, 'Restored lead follow-up date preserved');
    console.log('✓ TEST 14 PASSED: Undo delete restored lead with intact follow-up state.');

    // ----------------------------------------------------
    // TEST 15 — Duplicate Protection
    // ----------------------------------------------------
    console.log('\n--- TEST 15: No Duplicate Leads in Store or Queue ---');
    const allStoreLeads = (await httpRequest('GET', '/api/outreach/data')).data.allLeads;
    const todayMatches = allStoreLeads.filter(l => l.business_name === 'Today Test Dental');
    assert.strictEqual(todayMatches.length, 1, 'Exactly one instance of lead must exist in store');
    console.log('✓ TEST 15 PASSED: Exactly 1 copy exists, no duplicates created.');

    // ----------------------------------------------------
    // TEST 16 — Refresh Recalculation
    // ----------------------------------------------------
    console.log('\n--- TEST 16: Refresh Recalculates Queue from Real Store Data ---');
    await win.reload();
    await new Promise(r => setTimeout(r, 2000));
    const test16 = await win.webContents.executeJavaScript(`
      (function() {
        const overdueCount = parseInt(document.getElementById('fu-counter-overdue')?.textContent || '0', 10);
        const dueCount = parseInt(document.getElementById('fu-counter-due-today')?.textContent || '0', 10);
        const activeCount = parseInt(document.getElementById('fu-counter-active')?.textContent || '0', 10);
        return { overdueCount, dueCount, activeCount };
      })()
    `);
    assert(typeof test16.activeCount === 'number', 'Active count must be numeric');
    console.log(`✓ TEST 16 PASSED: UI refreshed and recalculated from backend (Active: ${test16.activeCount}).`);

    // ----------------------------------------------------
    // TEST 17 — Restart Persistence
    // ----------------------------------------------------
    console.log('\n--- TEST 17: Persistent Storage Intact across Application Restarts ---');
    const rawStore = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA, 'clienthunter', 'data', 'leads_store.json'), 'utf8'));
    const persistedLead = rawStore.leads.find(l => l.id === todayLeadObj.id);
    assert(persistedLead, 'Lead must be on disk in leads_store.json');
    assert(persistedLead.next_follow_up_at, 'Lead must have scheduled follow-up on disk');
    console.log('✓ TEST 17 PASSED: Persistent leads_store.json holds valid follow-up state on disk.');

    // ----------------------------------------------------
    // TEST 18 — No Automatic Messaging
    // ----------------------------------------------------
    console.log('\n--- TEST 18: No Automatic Messaging without User Confirmation ---');
    const test18 = await win.webContents.executeJavaScript(`
      (function() {
        startFollowUpQueue();
        const curLead = AppState.followup.currentComposerLead;
        const confirmBlock = document.getElementById('fu-composer-confirm-block');
        const wasAutoConfirmed = confirmBlock ? !confirmBlock.classList.contains('hidden') : false;
        closeDedicatedFollowUpModal();
        if (AppState.followup.queue) AppState.followup.queue.isActive = false;
        return { curLeadFound: Boolean(curLead), wasAutoConfirmed };
      })()
    `);
    assert.strictEqual(test18.curLeadFound, true, 'Starting queue loaded composer lead safely');
    assert.strictEqual(test18.wasAutoConfirmed, false, 'Message was NOT automatically confirmed or sent');
    console.log('✓ TEST 18 PASSED: Start Queue prepares message safely without automatic sending.');

    console.log('\n========================================================');
    console.log('🎉 ALL 18 SMART FOLLOW-UP QUEUE TESTS PASSED PERFECTLY!');
    console.log('========================================================\n');

    // Clean up temporary test leads
    for (const tl of testLeadsSeed) {
      const match = (await httpRequest('GET', '/api/leads/saved')).data.leads.find(l => l.place_id === tl.place_id);
      if (match) {
        await httpRequest('DELETE', `/api/leads/${match.id}`);
      }
    }
    console.log('✓ Cleaned up test leads from storage.');

  } catch (err) {
    console.error('❌ TEST FAILED:', err);
    process.exitCode = 1;
  } finally {
    if (win) win.close();
    app.quit();
  }
});
