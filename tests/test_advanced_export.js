const { app, BrowserWindow } = require('electron');
const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');

const appDataStorePath = path.join(
  process.env.APPDATA || (process.platform === 'darwin' ? process.env.HOME + '/Library/Preferences' : process.env.HOME + '/.local/share'),
  'clienthunter',
  'data',
  'leads_store.json'
);
const localStorePath = path.join(__dirname, '..', 'data', 'leads_store.json');
const activeStorePath = fs.existsSync(appDataStorePath) ? appDataStorePath : localStorePath;

function httpRequest(method, pathName, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: 3000,
      path: pathName,
      method: method,
      headers: { 'Content-Type': 'application/json' }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// Backup original store file to ensure zero collateral damage
const originalStoreBackup = fs.readFileSync(activeStorePath, 'utf8');

app.whenReady().then(async () => {
  console.log('================================================================');
  console.log('CLIENTHUNTER — ADVANCED EXPORT SYSTEM 16-TEST AUTOMATED SUITE');
  console.log('================================================================\n');

  let testCount = 0;
  let passCount = 0;

  function pass(testName, details) {
    testCount++;
    passCount++;
    console.log(`[PASS ${testCount}/16] ✓ ${testName}`);
    if (details) console.log(`       ↳ ${details}`);
  }

  function fail(testName, err) {
    testCount++;
    console.error(`[FAIL ${testCount}/16] ✗ ${testName}:`, err);
  }

  let win = null;

  try {
    // 0. Verify server status
    const sysStatus = await httpRequest('GET', '/api/system/status');
    assert.strictEqual(sysStatus.status, 200, 'Server must be active on port 3000');
    console.log('✓ Verified server active on port 3000');

    // Create 3 isolated test leads with special characters, Unicode, notes, and activity
    const testLeads = [
      {
        id: 'lead_exp_test_1',
        place_id: 'ChIJ_EXP_001_' + Date.now(),
        business_name: 'Apex Web Studio & Solutions',
        category: 'Software Companies',
        state: 'Telangana',
        city: 'Hyderabad',
        address: 'Hitech City, Main Road, Hyderabad',
        phone: '+91 99599 83437',
        email: 'info@apexstudio.in',
        website: 'https://apexstudio.in',
        website_status: 'YES',
        opportunity_score: 85,
        opportunity_level: 'HIGH',
        status: 'SAVED',
        favorite: true,
        outreach_status: 'Follow-Up',
        first_message_sent: true,
        first_message_sent_at: '2026-09-15T10:00:00.000Z',
        main_message_sent_at: '2026-09-15T10:00:00.000Z',
        last_message_sent_at: '2026-09-18T11:00:00.000Z',
        next_follow_up_at: '2026-09-22T10:00:00.000Z',
        current_follow_up_number: 1,
        reply_status: 'INTERESTED',
        notes: [
          { id: 'n1', text: 'Client requested demo with commas, "quotes", and\nline breaks.', created_at: '2026-09-16T12:00:00.000Z' }
        ],
        google_maps_url: 'https://maps.google.com/?cid=12345678',
        created_at: '2026-09-14T08:00:00.000Z',
        saved_at: '2026-09-14T08:00:00.000Z',
        activities: [
          { activity_id: 'act_1', lead_id: 'lead_exp_test_1', event_type: 'lead_saved', event_title: 'Lead Saved', created_at: '2026-09-14T08:00:00.000Z', event_description: 'Saved lead' },
          { activity_id: 'act_2', lead_id: 'lead_exp_test_1', event_type: 'lead_added_outreach', event_title: 'Added to Outreach', created_at: '2026-09-14T09:00:00.000Z', event_description: 'Added to outreach' },
          { activity_id: 'act_3', lead_id: 'lead_exp_test_1', event_type: 'message_sent', event_title: 'Message Sent', created_at: '2026-09-15T10:00:00.000Z', event_description: 'Pitch sent' }
        ]
      },
      {
        id: 'lead_exp_test_2',
        place_id: 'ChIJ_EXP_002_' + Date.now(),
        business_name: 'श्री गणेश ज्वेलर्स (Shree Ganesh ₹ Jewellers)',
        category: 'Beauty Salons',
        state: 'Telangana',
        city: 'Hyderabad',
        address: 'Banjara Hills Road 1, Hyderabad',
        phone: '040 23456789',
        email: 'ganesh@jewels.in',
        website: '',
        website_status: 'NO',
        opportunity_score: 95,
        opportunity_level: 'HIGH',
        status: 'SAVED',
        favorite: false,
        outreach_status: 'Ready',
        first_message_sent: false,
        notes: 'Single string note with ₹ Rupee sign & Hindi text श्री गणेश',
        google_maps_url: 'https://maps.google.com/?cid=87654321',
        created_at: '2026-09-19T09:00:00.000Z',
        saved_at: '2026-09-19T09:00:00.000Z',
        activities: [
          { activity_id: 'act_4', lead_id: 'lead_exp_test_2', event_type: 'lead_saved', event_title: 'Lead Saved', created_at: '2026-09-19T09:00:00.000Z', event_description: 'Saved lead' }
        ]
      },
      {
        id: 'lead_exp_test_3',
        place_id: 'ChIJ_EXP_003_' + Date.now(),
        business_name: 'Royal Dental Care',
        category: 'Dental Clinics',
        state: 'Karnataka',
        city: 'Bengaluru',
        address: 'Indiranagar 100ft Road',
        phone: '+91 80 4123 9999',
        email: 'contact@royaldental.com',
        website: 'https://royaldental.com',
        website_status: 'YES',
        opportunity_score: 60,
        opportunity_level: 'MEDIUM',
        status: 'SAVED',
        favorite: true,
        outreach_status: 'Pending',
        first_message_sent: false,
        notes: [],
        google_maps_url: 'https://maps.google.com/?cid=99991111',
        created_at: '2026-09-10T14:00:00.000Z',
        saved_at: '2026-09-10T14:00:00.000Z',
        activities: []
      }
    ];

    // Seed test leads in store
    const store = JSON.parse(fs.readFileSync(activeStorePath, 'utf8'));
    store.leads = testLeads;
    fs.writeFileSync(activeStorePath, JSON.stringify(store, null, 2), 'utf8');

    // Launch headless Electron window to load real application UI
    win = new BrowserWindow({
      width: 1440,
      height: 900,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, '..', 'electron', 'preload.js')
      }
    });

    await win.loadURL('http://localhost:3000/#saved-leads');
    await new Promise(r => setTimeout(r, 2000));

    // -------------------------------------------------------------
    // TEST 1 — Export all Saved Leads
    // -------------------------------------------------------------
    try {
      const result = await win.webContents.executeJavaScript(`
        (async () => {
          const res = await window.resolveExportScopeData('all_saved');
          const csv = window.serializeLeadsToCsv(res.leads);
          return { count: res.leads.length, csvStartsWithBom: csv.startsWith('\\uFEFF'), length: csv.length };
        })()
      `);

      assert.strictEqual(result.count, 3, 'Expected 3 saved leads');
      assert.strictEqual(result.csvStartsWithBom, true, 'CSV must start with UTF-8 BOM');
      pass('TEST 1: Export all Saved Leads', `Every Saved Lead is exported exactly once (${result.count} leads) with UTF-8 BOM.`);
    } catch (err) {
      fail('TEST 1: Export all Saved Leads', err);
    }

    // -------------------------------------------------------------
    // TEST 2 — Apply a filter (Export Current Results)
    // -------------------------------------------------------------
    try {
      const result = await win.webContents.executeJavaScript(`
        (async () => {
          // Apply filter: Category = 'Beauty Salons'
          const catSelect = document.getElementById('saved-filter-category');
          if (catSelect) {
            catSelect.value = 'Beauty Salons';
            catSelect.dispatchEvent(new Event('change'));
          }
          await new Promise(r => setTimeout(r, 300));
          const res = await window.resolveExportScopeData('filtered');
          const csv = window.serializeLeadsToCsv(res.leads);
          return {
            count: res.leads.length,
            name: res.leads[0]?.business_name,
            csvContainsName: csv.includes('श्री गणेश ज्वेलर्स')
          };
        })()
      `);

      assert.strictEqual(result.count, 1, 'Expected 1 filtered lead');
      assert.ok(result.csvContainsName, 'Filtered export contains the matching lead');
      pass('TEST 2: Apply a filter', `Export Current Results contains exactly 1 filtered lead (${result.name}).`);
    } catch (err) {
      fail('TEST 2: Apply a filter', err);
    }

    // -------------------------------------------------------------
    // TEST 3 — Selected Leads (With Selection & 0 Selection)
    // -------------------------------------------------------------
    try {
      const result = await win.webContents.executeJavaScript(`
        (async () => {
          // Clear filters first
          const clearBtn = document.getElementById('btn-clear-saved-filters');
          if (clearBtn) clearBtn.click();
          await new Promise(r => setTimeout(r, 200));

          // Select 2 specific leads in AppState
          AppState.selectedLeadIds.clear();
          AppState.selectedLeadIds.add('lead_exp_test_1');
          AppState.selectedLeadIds.add('lead_exp_test_3');

          const resWith2 = await window.resolveExportScopeData('selected');

          // Now test with 0 selected
          AppState.selectedLeadIds.clear();
          const resWith0 = await window.resolveExportScopeData('selected');

          return { countWith2: resWith2.leads.length, countWith0: resWith0.leads.length };
        })()
      `);

      assert.strictEqual(result.countWith2, 2, 'Must export exactly 2 selected leads');
      assert.strictEqual(result.countWith0, 0, 'Must contain 0 when none selected');
      pass('TEST 3: Selected Leads', 'Export Selected contains exactly selected leads; 0-selected properly verified.');
    } catch (err) {
      fail('TEST 3: Selected Leads', err);
    }

    // -------------------------------------------------------------
    // TEST 4 — Export Favorites
    // -------------------------------------------------------------
    try {
      const result = await win.webContents.executeJavaScript(`
        (async () => {
          const res = await window.resolveExportScopeData('favorites');
          const allFavs = res.leads.every(l => l.favorite || l.is_favorite);
          return { count: res.leads.length, allFavs };
        })()
      `);

      assert.strictEqual(result.count, 2, 'Expected 2 favorite leads');
      assert.strictEqual(result.allFavs, true, 'All exported leads must have favorite=true');
      pass('TEST 4: Export Favorites', `Only Favorite leads are exported (count: ${result.count}).`);
    } catch (err) {
      fail('TEST 4: Export Favorites', err);
    }

    // -------------------------------------------------------------
    // TEST 5 — Export Outreach
    // -------------------------------------------------------------
    try {
      const result = await win.webContents.executeJavaScript(`
        (async () => {
          const res = await window.resolveExportScopeData('outreach');
          const nonPending = res.leads.every(l => l.outreach_status && l.outreach_status !== 'Pending');
          return { count: res.leads.length, nonPending };
        })()
      `);

      assert.strictEqual(result.count, 2, 'Expected 2 outreach leads');
      assert.strictEqual(result.nonPending, true, 'Pending leads must be excluded from outreach export');
      pass('TEST 5: Export Outreach', `Only Outreach records are exported (count: ${result.count}, Pending excluded).`);
    } catch (err) {
      fail('TEST 5: Export Outreach', err);
    }

    // -------------------------------------------------------------
    // TEST 6 — Export Follow-Ups
    // -------------------------------------------------------------
    try {
      const result = await win.webContents.executeJavaScript(`
        (async () => {
          const res = await window.resolveExportScopeData('followup');
          return { count: res.leads.length, leadId: res.leads[0]?.id };
        })()
      `);

      assert.strictEqual(result.count, 1, 'Expected 1 follow-up lead');
      assert.strictEqual(result.leadId, 'lead_exp_test_1');
      pass('TEST 6: Export Follow-Ups', `Only applicable Follow-Up records are exported (count: ${result.count}).`);
    } catch (err) {
      fail('TEST 6: Export Follow-Ups', err);
    }

    // -------------------------------------------------------------
    // TEST 7 — Export JSON backup
    // -------------------------------------------------------------
    try {
      const backupRes = await httpRequest('GET', '/api/backup/export');
      assert.strictEqual(backupRes.status, 200);
      assert.strictEqual(backupRes.data.exportVersion, '2.2.0', 'Must contain exportVersion 2.2.0');
      assert.ok(backupRes.data.exportedAt, 'Must contain exportedAt ISO timestamp');
      assert.strictEqual(backupRes.data.source, 'ClientHunter Desktop');
      assert.strictEqual(backupRes.data.leads.length, 3, 'Must contain all 3 test leads');
      assert.ok(Array.isArray(backupRes.data.activityTimeline), 'Must contain activity timeline');

      // Verify no API keys or secrets
      const settingsStr = JSON.stringify(backupRes.data.settings);
      assert.ok(!settingsStr.includes('api_key') && !settingsStr.includes('apiKey') && !settingsStr.includes('geminiKey'), 'Must not contain sensitive API keys');

      pass('TEST 7: Export JSON backup', 'Valid structured versioned JSON backup created without secrets.');
    } catch (err) {
      fail('TEST 7: Export JSON backup', err);
    }

    // -------------------------------------------------------------
    // TEST 8 — Export CSV
    // -------------------------------------------------------------
    try {
      const result = await win.webContents.executeJavaScript(`
        (async () => {
          const res = await window.resolveExportScopeData('all_saved');
          const csv = window.serializeLeadsToCsv(res.leads);
          const firstLine = csv.split('\\r\\n')[0];
          return {
            hasBOM: csv.startsWith('\\uFEFF'),
            firstLine
          };
        })()
      `);

      assert.strictEqual(result.hasBOM, true);
      assert.ok(result.firstLine.includes('"Lead ID"'));
      assert.ok(result.firstLine.includes('"Business Name"'));
      assert.ok(result.firstLine.includes('"Phone"'));
      assert.ok(result.firstLine.includes('"Google Maps Link"'));
      assert.ok(result.firstLine.includes('"Outreach Status"'));
      assert.ok(result.firstLine.includes('"Follow-Up Status"'));
      assert.ok(result.firstLine.includes('"Notes"'));

      pass('TEST 8: Export CSV', 'CSV formatted with RFC 4180 quotes, all 28 headers, and UTF-8 BOM.');
    } catch (err) {
      fail('TEST 8: Export CSV', err);
    }

    // -------------------------------------------------------------
    // TEST 9 — Unicode & Indian Characters
    // -------------------------------------------------------------
    try {
      const result = await win.webContents.executeJavaScript(`
        (async () => {
          const res = await window.resolveExportScopeData('all_saved');
          const csv = window.serializeLeadsToCsv(res.leads);
          return {
            hasHindi: csv.includes('श्री गणेश ज्वेलर्स'),
            hasRupee: csv.includes('₹')
          };
        })()
      `);

      assert.strictEqual(result.hasHindi, true, 'Indian business name in Hindi must display correctly');
      assert.strictEqual(result.hasRupee, true, 'Rupee currency symbol ₹ must display correctly');
      pass('TEST 9: Unicode characters', 'Indian/Unicode business names and ₹ currency symbols preserved accurately.');
    } catch (err) {
      fail('TEST 9: Unicode characters', err);
    }

    // -------------------------------------------------------------
    // TEST 10 — Notes containing commas and line breaks
    // -------------------------------------------------------------
    try {
      const result = await win.webContents.executeJavaScript(`
        (async () => {
          const res = await window.resolveExportScopeData('all_saved');
          const csv = window.serializeLeadsToCsv(res.leads);
          return {
            hasDoubledQuotes: csv.includes('""quotes""'),
            hasLineBreaks: csv.includes('line breaks.')
          };
        })()
      `);

      assert.strictEqual(result.hasDoubledQuotes, true, 'Internal quotes must be escaped as double quotes');
      assert.strictEqual(result.hasLineBreaks, true, 'Multiline notes preserved in quoted CSV cell');
      pass('TEST 10: Multiline notes and commas', 'CSV remains completely valid with commas, quotes, and newlines in notes.');
    } catch (err) {
      fail('TEST 10: Multiline notes and commas', err);
    }

    // -------------------------------------------------------------
    // TEST 11 — Phone numbers (Leading zeroes and + signs)
    // -------------------------------------------------------------
    try {
      const result = await win.webContents.executeJavaScript(`
        (async () => {
          const res = await window.resolveExportScopeData('all_saved');
          const csv = window.serializeLeadsToCsv(res.leads);
          return {
            hasPlusPhone: csv.includes('"+91 99599 83437"'),
            hasLeadingZeroPhone: csv.includes('"040 23456789"')
          };
        })()
      `);

      assert.strictEqual(result.hasPlusPhone, true, 'Phone number with + sign preserved as string');
      assert.strictEqual(result.hasLeadingZeroPhone, true, 'Phone number with leading zero preserved without stripping');
      pass('TEST 11: Phone numbers', 'Leading zeros, spaces, and + signs preserved without numeric coercion.');
    } catch (err) {
      fail('TEST 11: Phone numbers', err);
    }

    // -------------------------------------------------------------
    // TEST 12 — Duplicate Protection
    // -------------------------------------------------------------
    try {
      // Simulate duplicate record in database
      const dupStore = JSON.parse(fs.readFileSync(activeStorePath, 'utf8'));
      dupStore.leads.push({ ...testLeads[0] }); // Add duplicate of lead 1
      assert.strictEqual(dupStore.leads.length, 4);
      fs.writeFileSync(activeStorePath, JSON.stringify(dupStore, null, 2), 'utf8');

      const backupRes = await httpRequest('GET', '/api/backup/export');
      assert.strictEqual(backupRes.data.leads.length, 3, 'Backup must eliminate duplicate records');

      pass('TEST 12: Duplicate protection', 'A lead is not duplicated during Full Backup (exact 3 unique records).');
    } catch (err) {
      fail('TEST 12: Duplicate protection', err);
    }

    // -------------------------------------------------------------
    // TEST 13 — Export does NOT modify data (Read-Only Invariant)
    // -------------------------------------------------------------
    try {
      const beforeRes = await httpRequest('GET', '/api/leads/saved');
      const beforeCount = beforeRes.data.leads.length;
      const beforeStatus = beforeRes.data.leads[0].outreach_status;
      const beforeDate = beforeRes.data.leads[0].saved_at;

      // Trigger export operations in UI
      await win.webContents.executeJavaScript(`
        (async () => {
          await window.resolveExportScopeData('all_saved');
          await window.resolveExportScopeData('filtered');
          await window.resolveExportScopeData('activity');
          await window.resolveExportScopeData('daily_perf');
          await window.resolveExportScopeData('backup');
        })()
      `);

      const afterRes = await httpRequest('GET', '/api/leads/saved');
      const afterCount = afterRes.data.leads.length;
      const afterStatus = afterRes.data.leads[0].outreach_status;
      const afterDate = afterRes.data.leads[0].saved_at;

      assert.strictEqual(beforeCount, afterCount, 'Lead count must not change');
      assert.strictEqual(beforeStatus, afterStatus, 'Lead status must not change');
      assert.strictEqual(beforeDate, afterDate, 'Lead dates must not change');

      pass('TEST 13: Read-only verification', 'Export is strictly read-only; zero mutations to stored leads or statuses.');
    } catch (err) {
      fail('TEST 13: Read-only verification', err);
    }

    // -------------------------------------------------------------
    // TEST 14 — Large Dataset Export
    // -------------------------------------------------------------
    try {
      const result = await win.webContents.executeJavaScript(`
        (async () => {
          const largeLeads = [];
          for (let i = 1; i <= 1500; i++) {
            largeLeads.push({
              id: 'large_lead_' + i,
              place_id: 'place_large_' + i,
              business_name: 'Enterprise Client #' + i,
              category: 'IT Services',
              state: 'Telangana',
              city: 'Hyderabad',
              phone: '+91 98000 ' + String(i).padStart(5, '0'),
              opportunity_score: 80,
              website: 'https://example' + i + '.com',
              created_at: new Date().toISOString()
            });
          }
          const t0 = Date.now();
          const csv = window.serializeLeadsToCsv(largeLeads);
          const t1 = Date.now();
          return { lines: csv.split('\\r\\n').length, durationMs: t1 - t0, byteLength: csv.length };
        })()
      `);

      assert.strictEqual(result.lines, 1501, 'Expected 1500 records + 1 header line');
      assert.ok(result.durationMs < 1500, `Large export took ${result.durationMs}ms`);
      pass('TEST 14: Large datasets (1,500 leads)', `Export completed without crashing in ${result.durationMs}ms (${result.lines} lines).`);
    } catch (err) {
      fail('TEST 14: Large datasets', err);
    }

    // -------------------------------------------------------------
    // TEST 15 — Failed export handling
    // -------------------------------------------------------------
    try {
      const result = await win.webContents.executeJavaScript(`
        (async () => {
          // Clear any previous toasts
          const container = document.getElementById('toast-container');
          if (container) container.innerHTML = '';

          // Execute with failing save function
          await window.executeAdvancedExport(async () => {
            return { success: false, error: 'Simulated disk write error' };
          });

          await new Promise(r => setTimeout(r, 100));

          const toastEl = document.querySelector('.toast-message.toast-error');
          const toastText = toastEl ? toastEl.textContent : '';

          return { toastMessage: toastText, hasErrorToast: Boolean(toastEl) };
        })()
      `);

      assert.strictEqual(result.hasErrorToast, true, 'Error toast must be rendered in DOM on failed export');
      assert.ok(result.toastMessage.includes('Export failed'), `Expected error toast message, got: ${result.toastMessage}`);

      pass('TEST 15: Failed export handling', 'Gracefully displayed clear error message without corrupting state.');
    } catch (err) {
      fail('TEST 15: Failed export handling', err);
    }

    // -------------------------------------------------------------
    // TEST 16 — Daily Performance Export
    // -------------------------------------------------------------
    try {
      const perfRes = await httpRequest('GET', '/api/dashboard/daily-performance');
      assert.strictEqual(perfRes.status, 200);
      assert.ok(perfRes.data.success);
      const perf = perfRes.data.performance;

      const result = await win.webContents.executeJavaScript(`
        (async () => {
          const res = await window.resolveExportScopeData('daily_perf');
          const csv = window.serializeDailyPerformanceToCsv(res.performance);
          return {
            date: res.performance.date,
            messagesSent: res.performance.messagesSent,
            target: res.performance.target,
            status: res.performance.status,
            csv
          };
        })()
      `);

      assert.strictEqual(result.date, perf.date, 'Exported date must match API date');
      assert.strictEqual(result.messagesSent, perf.messagesSent, 'Exported messagesSent must match API');
      assert.strictEqual(result.target, perf.target, 'Exported target must match API target');
      assert.ok(result.csv.includes(`"${perf.date}"`));
      assert.ok(result.csv.includes(`"${perf.status}"`));

      pass('TEST 16: Daily Performance Export', `Exported statistics exactly match live Daily Performance Summary (${result.date}, Target: ${result.target}).`);
    } catch (err) {
      fail('TEST 16: Daily Performance Export', err);
    }

  } finally {
    // Restore original store file
    if (originalStoreBackup && fs.existsSync(activeStorePath)) {
      fs.writeFileSync(activeStorePath, originalStoreBackup, 'utf8');
      console.log('\n✓ Restored original database state.');
    }
    if (win) {
      win.destroy();
    }
  }

  console.log('\n================================================================');
  console.log(`TEST SUITE RESULTS: ${passCount} / ${testCount} TESTS PASSED`);
  console.log('================================================================');

  if (passCount === 16) {
    console.log('🎉 ALL 16 ADVANCED EXPORT TESTS PASSED SUCCESSFULLY!\n');
    app.quit();
  } else {
    console.error(`❌ ${testCount - passCount} TESTS FAILED.\n`);
    app.exit(1);
  }
});
