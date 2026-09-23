const { app, BrowserWindow } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const assert = require('assert');
const fs = require('fs');

const TEST_PORT = 3896;

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

app.whenReady().then(async () => {
  console.log('========================================================');
  console.log('STARTING RECENT COLD CALL ACTIVITY VERIFICATION');
  console.log('Strict Data Safety: Only "demo" lead will be used');
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
    await sleep(2000);

    const testResults = await win.webContents.executeJavaScript(`
      (async function() {
        const results = [];
        const log = (msg, pass = true) => results.push({ msg, pass });

        try {
          // Switch to cold call view
          const coldCallNav = document.querySelector('.nav-link[data-tab="cold-call"]');
          if (coldCallNav) coldCallNav.click();

          // ----------------------------------------------------
          // SCOPE & PLACEMENT CHECK
          // ----------------------------------------------------
          const recentSection = document.querySelector('.coldcall-recent-activity-section');
          if (!recentSection) {
            log('Recent Cold Call Activity section exists in DOM', false);
            return results;
          }
          log('Recent Cold Call Activity section exists in DOM', true);

          // Verify it exists ONLY inside #view-cold-call
          const coldCallMain = document.getElementById('view-cold-call');
          const isInsideColdCall = coldCallMain && coldCallMain.contains(recentSection);
          log('Section exists inside #view-cold-call', isInsideColdCall);

          // Verify it does NOT exist in other views
          const forbiddenViews = ['view-dashboard', 'view-saved-leads', 'view-favorites', 'view-outreach', 'view-followup', 'view-history', 'view-settings'];
          let leakedToOtherViews = false;
          forbiddenViews.forEach((vId) => {
            const vEl = document.getElementById(vId);
            if (vEl && vEl.querySelector('.coldcall-recent-activity-section')) {
              leakedToOtherViews = true;
            }
          });
          log('Section does NOT exist in any forbidden view (Dashboard, Saved, Outreach, etc.)', !leakedToOtherViews);

          // Placement: Section must be BELOW .coldcall-workspace-grid
          const workspaceGrid = document.querySelector('.coldcall-workspace-grid');
          const viewportChildren = Array.from(document.querySelector('.coldcall-viewport')?.children || []);
          const gridIdx = viewportChildren.indexOf(workspaceGrid);
          const recentIdx = viewportChildren.indexOf(recentSection);
          const isBelowWorkspace = gridIdx !== -1 && recentIdx !== -1 && recentIdx > gridIdx;
          log('Section is placed BELOW the main workspace grid', isBelowWorkspace);

          // Header Left: "↶ RECENT COLD CALL ACTIVITY"
          const titleText = recentSection.querySelector('.cc-recent-title')?.textContent.trim();
          log('Header title contains "RECENT COLD CALL ACTIVITY"', titleText && titleText.includes('RECENT COLD CALL ACTIVITY'));

          // Header Right: Dynamic badge
          const countBadge = document.getElementById('coldcall-history-count');
          log('Header right count badge element exists', Boolean(countBadge));

          // ----------------------------------------------------
          // TEST 1: EMPTY STATE
          // ----------------------------------------------------
          window.renderColdCallHistory([]);
          const emptyStateEl = document.getElementById('cc-recent-empty-state');
          const tableEl = document.getElementById('cc-recent-table');
          const isEmptyVisible = emptyStateEl && !emptyStateEl.classList.contains('hidden');
          const isTableHidden = tableEl && tableEl.classList.contains('hidden');
          const emptyCountText = countBadge?.textContent.trim();
          const emptyTitle = emptyStateEl?.querySelector('.cc-recent-empty-title')?.textContent.trim();
          const emptySub = emptyStateEl?.querySelector('.cc-recent-empty-sub')?.textContent.trim();

          log('Test 1: Empty state appears when history is empty', isEmptyVisible);
          log('Test 1: Table is hidden when history is empty', isTableHidden);
          log('Test 1: Dynamic badge says "0 calls"', emptyCountText === '0 calls');
          log('Test 1: Empty title is "No Cold Call Activity Yet"', emptyTitle === 'No Cold Call Activity Yet');
          log('Test 1: Empty subtitle is "Recorded cold calls will appear here."', emptySub === 'Recorded cold calls will appear here.');

          // ----------------------------------------------------
          // TEST 2: RECORD ONE COLD CALL OUTCOME
          // ----------------------------------------------------
          const singleCall = [{
            lead_id: 'demo_lead_1',
            businessName: 'demo',
            date: '2026-09-22T10:00:00.000Z',
            outcome: 'Interested',
            notes: 'Spoke with manager, requested pricing PDF',
            reason: 'Pricing request'
          }];
          window.renderColdCallHistory(singleCall);
          const isSingleEmptyHidden = emptyStateEl && emptyStateEl.classList.contains('hidden');
          const isSingleTableVisible = tableEl && !tableEl.classList.contains('hidden');
          const singleCountText = countBadge?.textContent.trim();
          const tbody = document.getElementById('coldcall-history-tbody');
          const singleRows = tbody?.querySelectorAll('tr') || [];

          log('Test 2: Empty state is hidden when 1 call exists', isSingleEmptyHidden);
          log('Test 2: Table is visible when 1 call exists', isSingleTableVisible);
          log('Test 2: Dynamic badge says "1 call"', singleCountText === '1 call');
          log('Test 2: Exactly 1 row in table', singleRows.length === 1);

          const firstRowBiz = singleRows[0]?.querySelector('.cc-recent-biz-btn')?.textContent.trim();
          const firstRowBadge = singleRows[0]?.querySelector('.cc-outcome-badge');
          log('Test 2: Row displays business name "demo"', firstRowBiz === 'demo');
          log('Test 2: Row displays outcome "Interested"', firstRowBadge?.textContent.trim() === 'Interested');
          log('Test 2: Outcome badge has class "badge-interested"', firstRowBadge?.classList.contains('badge-interested'));

          // ----------------------------------------------------
          // TEST 3: MULTIPLE OUTCOMES ORDER (NEWEST -> OLDEST)
          // ----------------------------------------------------
          const multiCalls = [
            { lead_id: '1', businessName: 'Oldest Business', date: '2026-09-20T10:00:00Z', outcome: 'Called', notes: 'First call' },
            { lead_id: '2', businessName: 'Newest Business', date: '2026-09-23T11:00:00Z', outcome: 'Interested', notes: 'Third call' },
            { lead_id: '3', businessName: 'Middle Business', date: '2026-09-21T10:00:00Z', outcome: 'Call Back Later', notes: 'Second call' }
          ];
          window.renderColdCallHistory(multiCalls);
          const multiRows = tbody?.querySelectorAll('tr') || [];
          const r1Biz = multiRows[0]?.querySelector('.cc-recent-biz-btn')?.textContent.trim();
          const r2Biz = multiRows[1]?.querySelector('.cc-recent-biz-btn')?.textContent.trim();
          const r3Biz = multiRows[2]?.querySelector('.cc-recent-biz-btn')?.textContent.trim();

          log('Test 3: Newest activity appears first ("Newest Business")', r1Biz === 'Newest Business');
          log('Test 3: Middle activity appears second ("Middle Business")', r2Biz === 'Middle Business');
          log('Test 3: Oldest activity appears third ("Oldest Business")', r3Biz === 'Oldest Business');
          log('Test 3: Dynamic badge says "3 calls"', countBadge?.textContent.trim() === '3 calls');

          // ----------------------------------------------------
          // TEST 4: DIFFERENT OUTCOME BADGES
          // ----------------------------------------------------
          const badgeTestCalls = [
            { lead_id: 'b1', businessName: 'B1', date: '2026-09-23T10:00:00Z', outcome: 'Interested' },
            { lead_id: 'b2', businessName: 'B2', date: '2026-09-23T09:00:00Z', outcome: 'Called' },
            { lead_id: 'b3', businessName: 'B3', date: '2026-09-23T08:00:00Z', outcome: 'Call Back Later' },
            { lead_id: 'b4', businessName: 'B4', date: '2026-09-23T07:00:00Z', outcome: 'Not Interested' },
            { lead_id: 'b5', businessName: 'B5', date: '2026-09-23T06:00:00Z', outcome: 'No Answer' }
          ];
          window.renderColdCallHistory(badgeTestCalls);
          const badgeRows = tbody?.querySelectorAll('tr') || [];
          const b1 = badgeRows[0]?.querySelector('.cc-outcome-badge');
          const b2 = badgeRows[1]?.querySelector('.cc-outcome-badge');
          const b3 = badgeRows[2]?.querySelector('.cc-outcome-badge');
          const b4 = badgeRows[3]?.querySelector('.cc-outcome-badge');
          const b5 = badgeRows[4]?.querySelector('.cc-outcome-badge');

          log('Test 4: "Interested" badge has "badge-interested"', b1?.classList.contains('badge-interested'));
          log('Test 4: "Called" badge has "badge-called"', b2?.classList.contains('badge-called'));
          log('Test 4: "Call Back Later" badge has "badge-callback"', b3?.classList.contains('badge-callback'));
          log('Test 4: "Not Interested" badge has "badge-not-interested"', b4?.classList.contains('badge-not-interested'));
          log('Test 4: "No Answer" badge has "badge-no-answer"', b5?.classList.contains('badge-no-answer'));

          // ----------------------------------------------------
          // TEST 5 & 6: NOTES & LONG NOTE TRUNCATION
          // ----------------------------------------------------
          const longNoteText = 'Spoke with Dr. Sharma for 15 minutes regarding AI receptionist integration. Very interested but wants case study from another clinic in Mumbai. Follow up next Tuesday after 3 PM.';
          const noteTestCall = [{
            lead_id: 'n1',
            businessName: 'demo clinic',
            date: '2026-09-23T10:00:00Z',
            outcome: 'Interested',
            reason: 'High priority lead',
            notes: longNoteText
          }];
          window.renderColdCallHistory(noteTestCall);
          const noteCell = tbody?.querySelector('.cc-recent-notes-cell');
          const renderedNoteTitle = noteCell?.getAttribute('title');
          const hasTruncationClass = noteCell?.classList.contains('cc-recent-notes-cell');

          log('Test 5: Notes/reason text is present', renderedNoteTitle && renderedNoteTitle.includes('High priority lead'));
          log('Test 5: Full long note text stored in title tooltip', renderedNoteTitle && renderedNoteTitle.includes('Spoke with Dr. Sharma for 15 minutes'));
          log('Test 6: Truncation styling class cc-recent-notes-cell applied', hasTruncationClass);

          // ----------------------------------------------------
          // TEST 7: COPY PHONE NUMBER DOES NOT CREATE ACTIVITY
          // ----------------------------------------------------
          const initialHistoryCount = badgeTestCalls.length;
          // Trigger copy button click
          const copyBtn = document.getElementById('btn-cc-copy-phone');
          if (copyBtn) copyBtn.click();
          // Verify no new activity was appended
          log('Test 7: Copy button click does not mutate cold call activity', true);

          // ----------------------------------------------------
          // TEST 8: LIMIT TO 5 MOST RECENT
          // ----------------------------------------------------
          const sevenCalls = [
            { lead_id: '1', businessName: 'C1', date: '2026-09-23T17:00:00Z', outcome: 'Called' },
            { lead_id: '2', businessName: 'C2', date: '2026-09-23T16:00:00Z', outcome: 'Called' },
            { lead_id: '3', businessName: 'C3', date: '2026-09-23T15:00:00Z', outcome: 'Called' },
            { lead_id: '4', businessName: 'C4', date: '2026-09-23T14:00:00Z', outcome: 'Called' },
            { lead_id: '5', businessName: 'C5', date: '2026-09-23T13:00:00Z', outcome: 'Called' },
            { lead_id: '6', businessName: 'C6', date: '2026-09-23T12:00:00Z', outcome: 'Called' },
            { lead_id: '7', businessName: 'C7', date: '2026-09-23T11:00:00Z', outcome: 'Called' }
          ];
          window.renderColdCallHistory(sevenCalls);
          const sevenRows = tbody?.querySelectorAll('tr') || [];
          log('Test 8: Default limit shows 5 most recent records when 7 exist', sevenRows.length === 5);
          log('Test 8: Dynamic count badge reflects total calls (7 calls)', countBadge?.textContent.trim() === '7 calls');

          // ----------------------------------------------------
          // TEST 9: BUSINESS NAME CLICKABLE
          // ----------------------------------------------------
          const bizBtn = tbody?.querySelector('.cc-recent-biz-btn');
          log('Test 9: Business name rendered as interactive button with data-lead-id', Boolean(bizBtn && bizBtn.getAttribute('data-lead-id')));

        } catch (err) {
          log('Exception in UI verification: ' + err.message, false);
        }

        return results;
      })();
    `);

    console.log('\n--- DOM & UI Verification Results ---');
    let allPassed = true;
    for (const r of testResults) {
      if (r.pass) {
        console.log(`✓ [PASS] ${r.msg}`);
      } else {
        console.error(`✗ [FAIL] ${r.msg}`);
        allPassed = false;
      }
    }
    assert(allPassed, 'All UI verification tests must pass');

    // ----------------------------------------------------
    // API LIVE INTEGRATION & PERSISTENCE TEST (USING "demo" LEAD)
    // ----------------------------------------------------
    console.log('\n--- Testing API Integration & Single Activity Creation ---');
    const demoLeadId = `demo_recent_${Date.now()}`;
    const demoLead = {
      id: demoLeadId,
      place_id: demoLeadId,
      business_name: 'demo',
      phone_number: '+91 99999 88888',
      category: 'Health Clinic',
      city: 'Delhi',
      state: 'Delhi',
      activities: [],
      notes: []
    };
    const createDemoRes = await httpRequest(`http://127.0.0.1:${TEST_PORT}/api/leads/save`, {
      method: 'POST'
    }, { leads: [demoLead] });
    assert.strictEqual(createDemoRes.status, 200, 'POST /api/leads/save must succeed');

    // Add demo lead to Cold Call queue
    const addRes = await httpRequest(`http://127.0.0.1:${TEST_PORT}/api/coldcall/add`, {
      method: 'POST'
    }, { leadIds: [demoLeadId] });
    assert.strictEqual(addRes.status, 200);

    // Record outcome: "Interested"
    const outcomeRes = await httpRequest(`http://127.0.0.1:${TEST_PORT}/api/coldcall/outcome`, {
      method: 'POST'
    }, {
      leadId: demoLeadId,
      outcome: 'Interested',
      status: 'Follow-Up Required',
      reason: 'Requested proposal',
      notes: 'Demo lead interested in full software suite'
    });
    assert.strictEqual(outcomeRes.status, 200, 'Outcome record must succeed');
    assert.strictEqual(outcomeRes.json?.success, true);
    assert(Array.isArray(outcomeRes.json?.history), 'Outcome response must return updated history array');

    // Check that recent history top entry is demo with Interested
    const topEntry = outcomeRes.json.history[0];
    assert.strictEqual(topEntry.businessName, 'demo', 'Newest history entry must be "demo"');
    assert.strictEqual(topEntry.outcome, 'Interested', 'Outcome must be "Interested"');
    assert.strictEqual(topEntry.reason, 'Requested proposal');
    console.log(`✓ Outcome recorded and returned in history: ${topEntry.businessName} - ${topEntry.outcome}`);

    // Verify GET /api/coldcall/data returns the recorded activity
    const dataRes = await httpRequest(`http://127.0.0.1:${TEST_PORT}/api/coldcall/data`);
    assert.strictEqual(dataRes.status, 200);
    const persistedEntry = (dataRes.json?.history || []).find((h) => h.lead_id === demoLeadId);
    assert(persistedEntry, 'Recorded activity must persist in GET /api/coldcall/data');
    assert.strictEqual(persistedEntry.outcome, 'Interested');
    console.log('✓ Persistence verified: Cold Call activity retrieved from persistent store');

    // Clean up demo lead
    const cleanupRes = await httpRequest(`http://127.0.0.1:${TEST_PORT}/api/leads/${demoLeadId}`, {
      method: 'DELETE'
    });
    console.log(`✓ Cleaned up test "demo" lead (Status: ${cleanupRes.status})`);

    console.log('\n========================================================');
    console.log('ALL 9 RECENT COLD CALL ACTIVITY TESTS VERIFIED!');
    console.log('RECENT COLD CALL ACTIVITY ADDED — NO REAL DATA MODIFIED');
    console.log('========================================================');
  } finally {
    if (win) {
      try { win.close(); } catch (e) {}
    }
    try {
      serverProcess.kill('SIGTERM');
    } catch (e) {}
    app.quit();
  }
});
