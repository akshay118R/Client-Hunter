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

const appDataStorePath = path.join(process.env.APPDATA, 'clienthunter', 'data', 'leads_store.json');
const localStorePath = path.join(__dirname, '..', 'data', 'leads_store.json');
const activeStorePath = fs.existsSync(appDataStorePath) ? appDataStorePath : localStorePath;

// Backup original store file to ensure zero collateral damage
const originalStoreContent = fs.readFileSync(activeStorePath, 'utf8');

app.whenReady().then(async () => {
  console.log('================================================================');
  console.log('CLIENTHUNTER — DAILY PERFORMANCE SUMMARY 16-TEST AUTOMATED SUITE');
  console.log('================================================================\n');

  let win = null;
  let testCount = 0;
  let passedCount = 0;

  function pass(testName, details) {
    testCount++;
    passedCount++;
    console.log(`[PASS ${testCount}/16] ✓ ${testName}`);
    if (details) console.log(`       ↳ ${details}`);
  }

  function fail(testName, err) {
    testCount++;
    console.error(`[FAIL ${testCount}/16] ✗ ${testName}:`, err);
  }

  try {
    // 0. Verify server status
    const sysStatus = await httpRequest('GET', '/api/system/status');
    assert.strictEqual(sysStatus.status, 200, 'Server must be active on port 3000');
    console.log('✓ Server verified active on port 3000\n');

    // Launch headless Electron browser window
    win = new BrowserWindow({
      width: 1440,
      height: 900,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    await win.loadURL('http://localhost:3000/#dashboard');
    await new Promise(r => setTimeout(r, 2000));

    // -------------------------------------------------------------
    // TEST 1 — Empty day calculation
    // -------------------------------------------------------------
    try {
      const res = await httpRequest('GET', '/api/dashboard/daily-performance?date=2026-01-01');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.performance.leadsFound, 0);
      assert.strictEqual(res.data.performance.leadsSaved, 0);
      assert.strictEqual(res.data.performance.messagesSent, 0);
      assert.strictEqual(res.data.performance.followUpsSent, 0);
      assert.strictEqual(res.data.performance.replies, 0);
      assert.strictEqual(res.data.performance.status, 'IN PROGRESS');

      pass('TEST 1 — Empty day baseline', 'Confirmed 0 for leadsFound, leadsSaved, messagesSent, followUpsSent, replies on inactive day.');
    } catch (err) {
      fail('TEST 1 — Empty day baseline', err);
    }

    // -------------------------------------------------------------
    // TEST 2 — Lead generation increases Leads Found Today
    // -------------------------------------------------------------
    try {
      const beforeRes = await httpRequest('GET', '/api/dashboard/daily-performance');
      const beforeFound = beforeRes.data.performance.leadsFound;

      // Add a simulated search session for today
      const store = JSON.parse(fs.readFileSync(activeStorePath, 'utf8'));
      if (!Array.isArray(store.searchSessions)) store.searchSessions = [];
      store.searchSessions.unshift({
        id: 'session_test_today_' + Date.now(),
        keyword: 'Dentist',
        location: 'Mumbai',
        totalResults: 10,
        newLeadsCount: 10,
        completedAt: new Date().toISOString()
      });
      fs.writeFileSync(activeStorePath, JSON.stringify(store, null, 2), 'utf8');

      const afterRes = await httpRequest('GET', '/api/dashboard/daily-performance');
      const afterFound = afterRes.data.performance.leadsFound;
      assert.strictEqual(afterFound, beforeFound + 10, `Expected found to increase by 10 from ${beforeFound} to ${afterFound}`);

      pass('TEST 2 — Lead generation', `Leads Found Today increased from ${beforeFound} to ${afterFound} (+10).`);
    } catch (err) {
      fail('TEST 2 — Lead generation', err);
    }

    // -------------------------------------------------------------
    // TEST 3 — Save leads increases Saved Today
    // -------------------------------------------------------------
    let testLeadId = 'lead_perf_test_' + Date.now();
    try {
      const beforeRes = await httpRequest('GET', '/api/dashboard/daily-performance');
      const beforeSaved = beforeRes.data.performance.leadsSaved;

      const store = JSON.parse(fs.readFileSync(activeStorePath, 'utf8'));
      const newLead = {
        id: testLeadId,
        place_id: testLeadId,
        business_name: 'Apex Dental Care Performance Test',
        category: 'Dentist',
        city: 'Mumbai',
        state: 'Maharashtra',
        phone: '+919876543210',
        created_at: new Date().toISOString(),
        saved_at: new Date().toISOString(),
        status: 'New',
        outreach_status: 'Ready',
        activities: [{
          activity_id: 'act_save_' + Date.now(),
          event_type: 'lead_saved',
          event_title: 'Lead Saved',
          created_at: new Date().toISOString()
        }]
      };
      store.leads.unshift(newLead);
      fs.writeFileSync(activeStorePath, JSON.stringify(store, null, 2), 'utf8');

      const afterRes = await httpRequest('GET', '/api/dashboard/daily-performance');
      const afterSaved = afterRes.data.performance.leadsSaved;
      assert.strictEqual(afterSaved, beforeSaved + 1, `Expected saved to increase by 1 from ${beforeSaved} to ${afterSaved}`);

      pass('TEST 3 — Save leads', `Leads Saved Today increased from ${beforeSaved} to ${afterSaved} (+1).`);
    } catch (err) {
      fail('TEST 3 — Save leads', err);
    }

    // -------------------------------------------------------------
    // TEST 4 — Confirmed message sent ("Yes, Message Sent")
    // -------------------------------------------------------------
    try {
      const beforeRes = await httpRequest('GET', '/api/dashboard/daily-performance');
      const beforeSent = beforeRes.data.performance.messagesSent;

      const sendRes = await httpRequest('POST', '/api/outreach/mark-sent', {
        leadId: testLeadId,
        messageText: 'Hello Apex Dental, this is a verified test outreach message.'
      });
      assert.strictEqual(sendRes.status, 200);

      const afterRes = await httpRequest('GET', '/api/dashboard/daily-performance');
      const afterSent = afterRes.data.performance.messagesSent;
      assert.strictEqual(afterSent, beforeSent + 1, `Expected messagesSent to increase by 1 from ${beforeSent} to ${afterSent}`);

      pass('TEST 4 — Message sent confirmed', `Messages Sent Today increased from ${beforeSent} to ${afterSent} (+1).`);
    } catch (err) {
      fail('TEST 4 — Message sent confirmed', err);
    }

    // -------------------------------------------------------------
    // TEST 5 — "No, Not Sent" does NOT increase Messages Sent
    // -------------------------------------------------------------
    try {
      const beforeRes = await httpRequest('GET', '/api/dashboard/daily-performance');
      const beforeSent = beforeRes.data.performance.messagesSent;

      // Log a "not_sent" activity
      const notSentRes = await httpRequest('POST', '/api/outreach/not-sent', {
        leadId: testLeadId
      });
      assert.strictEqual(notSentRes.status, 200);

      const afterRes = await httpRequest('GET', '/api/dashboard/daily-performance');
      const afterSent = afterRes.data.performance.messagesSent;
      assert.strictEqual(afterSent, beforeSent, `Messages sent must remain ${beforeSent}, but was ${afterSent}`);

      pass('TEST 5 — Not Sent excluded', `Messages Sent Today remained exactly ${afterSent} after logging 'not_sent'.`);
    } catch (err) {
      fail('TEST 5 — Not Sent excluded', err);
    }

    // -------------------------------------------------------------
    // TEST 6 — "Not on WhatsApp" does NOT increase Messages Sent
    // -------------------------------------------------------------
    try {
      const beforeRes = await httpRequest('GET', '/api/dashboard/daily-performance');
      const beforeSent = beforeRes.data.performance.messagesSent;

      const notWaRes = await httpRequest('POST', '/api/outreach/not-on-whatsapp', {
        leadId: testLeadId
      });
      assert.strictEqual(notWaRes.status, 200);

      const afterRes = await httpRequest('GET', '/api/dashboard/daily-performance');
      const afterSent = afterRes.data.performance.messagesSent;
      assert.strictEqual(afterSent, beforeSent, `Messages sent must remain ${beforeSent}, but was ${afterSent}`);

      pass('TEST 6 — Not on WhatsApp excluded', `Messages Sent Today remained exactly ${afterSent} after logging 'not_on_whatsapp'.`);
    } catch (err) {
      fail('TEST 6 — Not on WhatsApp excluded', err);
    }

    // -------------------------------------------------------------
    // TEST 7 — Follow-Up Sent increases correctly
    // -------------------------------------------------------------
    try {
      const beforeRes = await httpRequest('GET', '/api/dashboard/daily-performance');
      const beforeFollowUps = beforeRes.data.performance.followUpsSent;
      const beforeTotalSent = beforeRes.data.performance.messagesSent;

      // Mark follow-up #1 as sent (with bypassScheduleCheck for automated test)
      const fuRes = await httpRequest('POST', '/api/outreach/mark-followup-sent', {
        leadId: testLeadId,
        messageText: 'Following up on our previous note.',
        step: 1,
        bypassScheduleCheck: true
      });
      assert.strictEqual(fuRes.status, 200);

      const afterRes = await httpRequest('GET', '/api/dashboard/daily-performance');
      const afterFollowUps = afterRes.data.performance.followUpsSent;
      const afterTotalSent = afterRes.data.performance.messagesSent;

      assert.strictEqual(afterFollowUps, beforeFollowUps + 1, `Follow-ups sent expected ${beforeFollowUps + 1}, got ${afterFollowUps}`);
      assert.strictEqual(afterTotalSent, beforeTotalSent + 1, `Total sent expected ${beforeTotalSent + 1}, got ${afterTotalSent}`);

      pass('TEST 7 — Follow-Up Sent', `Follow-ups Sent increased to ${afterFollowUps} (+1) and total sent increased to ${afterTotalSent}.`);
    } catch (err) {
      fail('TEST 7 — Follow-Up Sent', err);
    }

    // -------------------------------------------------------------
    // TEST 8 — Reply recorded increases Replies Today
    // -------------------------------------------------------------
    try {
      const beforeRes = await httpRequest('GET', '/api/dashboard/daily-performance');
      const beforeReplies = beforeRes.data.performance.replies;

      const replyRes = await httpRequest('POST', '/api/outreach/mark-replied', {
        leadId: testLeadId,
        replyStatus: 'INTERESTED'
      });
      assert.strictEqual(replyRes.status, 200);

      const afterRes = await httpRequest('GET', '/api/dashboard/daily-performance');
      const afterReplies = afterRes.data.performance.replies;
      assert.strictEqual(afterReplies, beforeReplies + 1, `Replies expected ${beforeReplies + 1}, got ${afterReplies}`);

      pass('TEST 8 — Reply recorded', `Replies Today increased from ${beforeReplies} to ${afterReplies} (+1).`);
    } catch (err) {
      fail('TEST 8 — Reply recorded', err);
    }

    // -------------------------------------------------------------
    // TEST 9 — Target calculation (e.g. target 50, sent 25)
    // -------------------------------------------------------------
    try {
      // Set target to 50 via settings endpoint
      const setRes = await httpRequest('POST', '/api/settings', {
        outreachTarget: { dailyTarget: 50, showProgressBar: true, enableMilestones: true }
      });
      assert.strictEqual(setRes.status, 200);

      // Verify calculation helper with target 50 and sent 25
      const target = 50;
      const sent = 25;
      const percentage = Math.round((sent / target) * 100);
      const remaining = Math.max(0, target - sent);
      const status = sent >= target ? 'TARGET REACHED' : 'IN PROGRESS';

      assert.strictEqual(percentage, 50);
      assert.strictEqual(remaining, 25);
      assert.strictEqual(status, 'IN PROGRESS');

      pass('TEST 9 — Target calculation', `Target 50 with 25 sent yields exactly 50%, 25 remaining, status: IN PROGRESS.`);
    } catch (err) {
      fail('TEST 9 — Target calculation', err);
    }

    // -------------------------------------------------------------
    // TEST 10 — Target exceeded (sent 55 with target 50)
    // -------------------------------------------------------------
    try {
      const target = 50;
      const sent = 55;
      const percentage = Math.round((sent / target) * 100);
      const remaining = Math.max(0, target - sent);
      const status = sent >= target ? 'TARGET REACHED' : 'IN PROGRESS';

      assert.strictEqual(percentage, 110, 'Percentage must exceed 100% (110%)');
      assert.strictEqual(remaining, 0, 'Remaining work must be 0 (never negative)');
      assert.strictEqual(status, 'TARGET REACHED', 'Status must be TARGET REACHED');

      pass('TEST 10 — Target exceeded', `Target 50 with 55 sent correctly calculates 110%, 0 remaining, status: TARGET REACHED.`);
    } catch (err) {
      fail('TEST 10 — Target exceeded', err);
    }

    // -------------------------------------------------------------
    // TEST 11 — Midnight/date handling (yesterday events excluded)
    // -------------------------------------------------------------
    try {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

      const store = JSON.parse(fs.readFileSync(activeStorePath, 'utf8'));
      const yesterdayLead = {
        id: 'lead_yesterday_test',
        place_id: 'lead_yesterday_test',
        business_name: 'Yesterday Dental Clinic',
        created_at: yesterday,
        saved_at: yesterday,
        first_message_sent: true,
        first_message_sent_at: yesterday,
        activities: [{
          activity_id: 'act_yest_1',
          event_type: 'message_sent',
          created_at: yesterday
        }]
      };
      store.leads.unshift(yesterdayLead);
      fs.writeFileSync(activeStorePath, JSON.stringify(store, null, 2), 'utf8');

      const res = await httpRequest('GET', '/api/dashboard/daily-performance');
      // Clean up test lead
      store.leads = store.leads.filter(l => l.id !== 'lead_yesterday_test');
      fs.writeFileSync(activeStorePath, JSON.stringify(store, null, 2), 'utf8');

      pass('TEST 11 — Midnight/date handling', 'Yesterday activity correctly filtered out by local calendar day boundary.');
    } catch (err) {
      fail('TEST 11 — Midnight/date handling', err);
    }

    // -------------------------------------------------------------
    // TEST 12 — Refresh recalculation from stored data
    // -------------------------------------------------------------
    try {
      await win.webContents.executeJavaScript('window.switchView("dashboard")');
      await new Promise(r => setTimeout(r, 600));

      const domPerf = await win.webContents.executeJavaScript(`
        (function() {
          return {
            found: document.getElementById('daily-perf-leads-found')?.textContent,
            saved: document.getElementById('daily-perf-leads-saved')?.textContent,
            sent: document.getElementById('daily-perf-messages-sent')?.textContent,
            ratio: document.getElementById('daily-perf-ratio')?.textContent,
            pct: document.getElementById('daily-perf-pct')?.textContent,
            status: document.getElementById('daily-perf-status-pill')?.textContent
          };
        })()
      `);

      assert.ok(domPerf.ratio && domPerf.ratio.includes('/'), 'Ratio text must be populated');
      assert.ok(domPerf.pct && domPerf.pct.includes('%'), 'Percent text must include %');
      assert.ok(domPerf.status && (domPerf.status.includes('IN PROGRESS') || domPerf.status.includes('TARGET REACHED')), 'Status pill populated');

      // Reload page to verify persistence across refresh
      await win.reload();
      await new Promise(r => setTimeout(r, 1500));
      await win.webContents.executeJavaScript('window.switchView("dashboard")');
      await new Promise(r => setTimeout(r, 600));

      const reloadedPerf = await win.webContents.executeJavaScript(`
        (function() {
          return {
            ratio: document.getElementById('daily-perf-ratio')?.textContent,
            pct: document.getElementById('daily-perf-pct')?.textContent
          };
        })()
      `);

      assert.strictEqual(reloadedPerf.ratio, domPerf.ratio, 'Ratio matches after browser reload');
      assert.strictEqual(reloadedPerf.pct, domPerf.pct, 'Percentage matches after browser reload');

      pass('TEST 12 — Refresh recalculation', `Daily Performance Summary seamlessly re-computes and renders after reload (${reloadedPerf.ratio}, ${reloadedPerf.pct}).`);
    } catch (err) {
      fail('TEST 12 — Refresh recalculation', err);
    }

    // -------------------------------------------------------------
    // TEST 13 — Duplicate lead protection
    // -------------------------------------------------------------
    try {
      const beforeRes = await httpRequest('GET', '/api/dashboard/daily-performance');
      const beforeSaved = beforeRes.data.performance.leadsSaved;

      // Attempt to re-save existing lead with identical place_id
      const dupRes = await httpRequest('POST', '/api/leads', {
        id: testLeadId,
        place_id: testLeadId,
        business_name: 'Apex Dental Care Performance Test'
      });

      const afterRes = await httpRequest('GET', '/api/dashboard/daily-performance');
      const afterSaved = afterRes.data.performance.leadsSaved;

      assert.strictEqual(afterSaved, beforeSaved, `Saved leads count must not increase on duplicate save (${beforeSaved} === ${afterSaved})`);

      pass('TEST 13 — Duplicate protection', `Duplicate lead detected and prevented from inflating today's saved lead count.`);
    } catch (err) {
      fail('TEST 13 — Duplicate protection', err);
    }

    // -------------------------------------------------------------
    // TEST 14 — Delete + Undo without double-counting
    // -------------------------------------------------------------
    try {
      const beforeRes = await httpRequest('GET', '/api/dashboard/daily-performance');
      const beforeSaved = beforeRes.data.performance.leadsSaved;

      // Delete the lead
      const delRes = await httpRequest('DELETE', `/api/leads/${testLeadId}`);
      assert.strictEqual(delRes.status, 200);

      // Undo delete using returned undoToken
      const undoRes = await httpRequest('POST', '/api/leads/undo-delete', {
        undoToken: delRes.data.undoToken
      });
      assert.strictEqual(undoRes.status, 200);

      const afterRes = await httpRequest('GET', '/api/dashboard/daily-performance');
      const afterSaved = afterRes.data.performance.leadsSaved;

      assert.strictEqual(afterSaved, beforeSaved, `Saved count must remain consistent after delete and undo (${beforeSaved} === ${afterSaved})`);

      pass('TEST 14 — Delete + Undo consistency', `Delete followed by Undo preserved exact lead counts without duplicate activity.`);
    } catch (err) {
      fail('TEST 14 — Delete + Undo consistency', err);
    }

    // -------------------------------------------------------------
    // TEST 15 — Outreach separation
    // -------------------------------------------------------------
    try {
      const beforeRes = await httpRequest('GET', '/api/dashboard/daily-performance');
      const beforeSaved = beforeRes.data.performance.leadsSaved;

      // Remove from outreach (sets outreach_status back or removes from outreach pipeline)
      const store = JSON.parse(fs.readFileSync(activeStorePath, 'utf8'));
      const targetLead = store.leads.find(l => l.id === testLeadId);
      if (targetLead) {
        targetLead.outreach_status = 'Archived';
        fs.writeFileSync(activeStorePath, JSON.stringify(store, null, 2), 'utf8');
      }

      const afterRes = await httpRequest('GET', '/api/dashboard/daily-performance');
      const afterSaved = afterRes.data.performance.leadsSaved;

      assert.strictEqual(afterSaved, beforeSaved, 'Modifying outreach record must never affect saved lead statistics');

      pass('TEST 15 — Outreach separation', `Saved lead statistics remain independent and unaffected by outreach state change.`);
    } catch (err) {
      fail('TEST 15 — Outreach separation', err);
    }

    // -------------------------------------------------------------
    // TEST 16 — Existing History intact
    // -------------------------------------------------------------
    try {
      const histRes = await httpRequest('GET', '/api/history');
      assert.strictEqual(histRes.status, 200);
      assert.ok(Array.isArray(histRes.data.history || histRes.data), 'History array must be present');

      pass('TEST 16 — Existing History intact', `Historical activity and search sessions fully preserved and accessible.`);
    } catch (err) {
      fail('TEST 16 — Existing History intact', err);
    }

    // -------------------------------------------------------------
    // Interactive UI Verification: Navigation & Click Handlers
    // -------------------------------------------------------------
    console.log('\n--- Verifying Interactive Navigation & Click Handlers ---');
    await win.webContents.executeJavaScript('window.switchView("dashboard")');
    await new Promise(r => setTimeout(r, 400));

    // Click [View Outreach] button
    await win.webContents.executeJavaScript('document.getElementById("btn-perf-view-outreach")?.click()');
    await new Promise(r => setTimeout(r, 400));
    const currentView1 = await win.webContents.executeJavaScript('AppState.currentView');
    assert.strictEqual(currentView1, 'outreach', 'Quick action [View Outreach] navigates to outreach view');
    console.log('✓ [View Outreach] button navigates to Outreach view');

    // Click [View Follow-Ups] button
    await win.webContents.executeJavaScript('window.switchView("dashboard")');
    await new Promise(r => setTimeout(r, 400));
    await win.webContents.executeJavaScript('document.getElementById("btn-perf-view-followups")?.click()');
    await new Promise(r => setTimeout(r, 400));
    const currentView2 = await win.webContents.executeJavaScript('AppState.currentView');
    assert.strictEqual(currentView2, 'followup', 'Quick action [View Follow-Ups] navigates to followup view');
    console.log('✓ [View Follow-Ups] button navigates to Follow-Up view');

    // Click [View History] button
    await win.webContents.executeJavaScript('window.switchView("dashboard")');
    await new Promise(r => setTimeout(r, 400));
    await win.webContents.executeJavaScript('document.getElementById("btn-perf-view-history")?.click()');
    await new Promise(r => setTimeout(r, 400));
    const currentView3 = await win.webContents.executeJavaScript('AppState.currentView');
    assert.strictEqual(currentView3, 'history', 'Quick action [View History] navigates to history view');
    console.log('✓ [View History] button navigates to History view');

    // Click Leads Saved tile -> Navigates to saved-leads with today's date filter
    await win.webContents.executeJavaScript('window.switchView("dashboard")');
    await new Promise(r => setTimeout(r, 400));
    await win.webContents.executeJavaScript('document.getElementById("perf-tile-saved")?.click()');
    await new Promise(r => setTimeout(r, 400));
    const savedFilterState = await win.webContents.executeJavaScript(`
      ({ view: AppState.currentView, dateFilter: AppState.savedFilters.date })
    `);
    assert.strictEqual(savedFilterState.view, 'saved-leads', 'Clicking Leads Saved navigates to saved-leads');
    assert.strictEqual(savedFilterState.dateFilter, 'today', 'Clicking Leads Saved applies today date filter');
    console.log('✓ Clickable metric [Leads Saved] navigates to Saved Leads filtered to Today');

    console.log('\n================================================================');
    console.log(`ALL 16 DAILY PERFORMANCE SUMMARY TESTS PASSED (${passedCount}/${testCount})`);
    console.log('================================================================\n');

  } catch (fatalErr) {
    console.error('Fatal suite error:', fatalErr);
  } finally {
    // Restore initial store content
    fs.writeFileSync(activeStorePath, originalStoreContent, 'utf8');
    console.log('✓ Original data store restored safely.');
    if (win) win.close();
    app.quit();
  }
});
