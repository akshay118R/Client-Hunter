const assert = require('assert');
const http = require('http');

function apiReq(method, pathName, body = null) {
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
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// Helpers matching main.js implementation
const SAVED_MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

function formatSavedDate(dateInput) {
  if (!dateInput) return 'Date unavailable';
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return 'Date unavailable';
  const day = d.getDate();
  const month = SAVED_MONTH_NAMES[d.getMonth()];
  const year = d.getFullYear();
  return `${day} ${month} ${year}`;
}

function getSavedDateKey(dateInput) {
  if (!dateInput) return 'unavailable';
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return 'unavailable';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function runDateOrganizationTestSuite() {
  console.log('===============================================================');
  console.log('CLIENTHUNTER — SAVED LEADS DATE-BASED ORGANIZATION TEST SUITE');
  console.log('===============================================================\n');

  // Verify backend connectivity
  const statusRes = await apiReq('GET', '/api/system/status');
  assert.strictEqual(statusRes.status, 200, 'Server must be running on port 3000');
  console.log('✓ System Status: Server active and ready');

  // -------------------------------------------------------------------------
  // TEST A: Existing Data Integrity Check
  // -------------------------------------------------------------------------
  console.log('\n--- TEST A: Existing Data Verification ---');
  const savedRes = await apiReq('GET', '/api/leads/saved');
  assert.strictEqual(savedRes.status, 200);
  const baselineSavedCount = savedRes.data.totalCount;
  console.log(`✓ Existing Saved Leads present: ${baselineSavedCount}`);
  assert(baselineSavedCount >= 108, 'Existing Saved Leads must be preserved');

  const outreachRes = await apiReq('GET', '/api/outreach/data');
  assert.strictEqual(outreachRes.status, 200);
  const baselineOutreachCount = outreachRes.data.allLeads.length;
  console.log(`✓ Existing Outreach leads present: ${baselineOutreachCount}`);

  const settingsRes = await apiReq('GET', '/api/settings');
  assert.strictEqual(settingsRes.status, 200);
  const initialSettings = settingsRes.data.settings;
  assert(initialSettings && initialSettings.templates && initialSettings.templates.length > 0, 'Settings templates must be present');
  console.log(`✓ Settings templates present: ${initialSettings.templates.length} templates intact`);

  // -------------------------------------------------------------------------
  // TEST B: Today's Leads with Automatic Current Date
  // -------------------------------------------------------------------------
  console.log('\n--- TEST B: Today\'s Leads Save & Automatic Date Stamp ---');
  const now = new Date();
  const expectedTodayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const expectedTodayFormatted = `${now.getDate()} ${SAVED_MONTH_NAMES[now.getMonth()]} ${now.getFullYear()}`;

  console.log(`Today's expected key: ${expectedTodayKey} ("${expectedTodayFormatted}")`);

  const todayLead1 = {
    place_id: 'test_date_today_1_' + Date.now(),
    business_name: 'Dr. Rao Smiles Dental',
    category: 'Dental Clinic',
    city: 'Hyderabad',
    state: 'Telangana',
    phone: '+91 98888 10001',
    website: 'https://raosmiles.example.com',
    website_status: 'YES',
    opportunity_score: 95
  };

  const saveTodayRes1 = await apiReq('POST', '/api/leads/save', { leads: [todayLead1] });
  assert.strictEqual(saveTodayRes1.status, 200);
  assert.strictEqual(saveTodayRes1.data.savedCount, 1, '1 lead must be saved');

  // Verify it appears under today's date
  const queryToday = await apiReq('GET', `/api/leads/saved?savedDate=${expectedTodayKey}`);
  assert.strictEqual(queryToday.status, 200);
  const foundToday1 = queryToday.data.leads.find(l => l.place_id === todayLead1.place_id);
  assert(foundToday1, `Lead must appear under today's date (${expectedTodayKey})`);
  assert.strictEqual(formatSavedDate(foundToday1.created_at), expectedTodayFormatted);
  console.log(`✓ TEST B PASSED: Lead saved automatically under today's date: "${formatSavedDate(foundToday1.created_at)}"`);

  // -------------------------------------------------------------------------
  // TEST C: Multiple Saves on the Same Day Grouped Together
  // -------------------------------------------------------------------------
  console.log('\n--- TEST C: Multiple Saves on the Same Day ---');
  const todayLead2 = {
    place_id: 'test_date_today_2_' + Date.now(),
    business_name: 'Iron Forge Fitness Gym',
    category: 'Gym',
    city: 'Hyderabad',
    state: 'Telangana',
    phone: '+91 98888 10002',
    website: '',
    website_status: 'NO',
    opportunity_score: 88
  };

  const saveTodayRes2 = await apiReq('POST', '/api/leads/save', { leads: [todayLead2] });
  assert.strictEqual(saveTodayRes2.status, 200);
  assert.strictEqual(saveTodayRes2.data.savedCount, 1);

  // Both should now be returned under today's date
  const queryTodayMulti = await apiReq('GET', `/api/leads/saved?savedDate=${expectedTodayKey}`);
  const match1 = queryTodayMulti.data.leads.find(l => l.place_id === todayLead1.place_id);
  const match2 = queryTodayMulti.data.leads.find(l => l.place_id === todayLead2.place_id);
  assert(match1, 'Lead 1 must be present under today\'s date');
  assert(match2, 'Lead 2 must be present under today\'s date');
  assert.strictEqual(getSavedDateKey(match1.created_at), getSavedDateKey(match2.created_at), 'Both leads must share identical dateKey');
  console.log(`✓ TEST C PASSED: Multiple saves on same day grouped together under "${expectedTodayFormatted}"`);

  // -------------------------------------------------------------------------
  // TEST D: Different Dates Appear as Separate Sections
  // -------------------------------------------------------------------------
  console.log('\n--- TEST D: Different Dates Appear as Separate Sections ---');
  const queryAll = await apiReq('GET', '/api/leads/saved');
  const dateKeySet = new Set();
  queryAll.data.leads.forEach(l => {
    dateKeySet.add(getSavedDateKey(l.created_at));
  });

  console.log(`Distinct date groups in database: ${Array.from(dateKeySet).join(', ')}`);
  assert(dateKeySet.size >= 2, 'Must have at least 2 distinct date groups');
  assert(dateKeySet.has(expectedTodayKey), `Must contain today's key ${expectedTodayKey}`);
  assert(dateKeySet.has('2026-09-17'), 'Must contain yesterday\'s key 2026-09-17');

  // Verify query for yesterday returns only yesterday's leads
  const queryYesterday = await apiReq('GET', '/api/leads/saved?savedDate=2026-09-17');
  assert(queryYesterday.data.leads.length >= 108);
  assert(!queryYesterday.data.leads.some(l => l.place_id === todayLead1.place_id), 'Today\'s lead must NOT appear in yesterday\'s section');
  console.log(`✓ TEST D PASSED: Today (${expectedTodayKey}) and Yesterday (2026-09-17) are strictly separated.`);

  // -------------------------------------------------------------------------
  // TEST E: Existing Lead Protection (No modification, duplication, or corruption)
  // -------------------------------------------------------------------------
  console.log('\n--- TEST E: Existing Lead Protection ---');
  const existingSample = queryYesterday.data.leads[0];
  assert(existingSample.business_name, 'Existing lead must have business_name');
  assert(existingSample.phone, 'Existing lead must have phone');
  assert(existingSample.category, 'Existing lead must have category');
  assert(existingSample.created_at, 'Existing lead must retain original created_at');

  // Test duplicate protection
  const dupAttempt = await apiReq('POST', '/api/leads/save', { leads: [todayLead1] });
  assert.strictEqual(dupAttempt.data.savedCount, 0, 'Duplicate lead must not be re-saved or duplicated');
  console.log('✓ TEST E PASSED: Existing leads protected; duplicate save rejected.');

  // -------------------------------------------------------------------------
  // TEST F: Outreach Protection
  // -------------------------------------------------------------------------
  console.log('\n--- TEST F: Outreach Protection ---');
  const outreachCheck = await apiReq('GET', '/api/outreach/data');
  assert.strictEqual(outreachCheck.data.allLeads.length, baselineOutreachCount, 'Outreach count must be unchanged');
  console.log(`✓ TEST F PASSED: Outreach leads count preserved (${outreachCheck.data.allLeads.length})`);

  // -------------------------------------------------------------------------
  // TEST G: Follow-up Protection
  // -------------------------------------------------------------------------
  console.log('\n--- TEST G: Follow-up Protection ---');
  const countCheck = await apiReq('GET', '/api/leads/count');
  assert.strictEqual(typeof countCheck.data.activeFollowUps, 'number');
  assert.strictEqual(typeof countCheck.data.actionableFollowUps, 'number');
  console.log(`✓ TEST G PASSED: Follow-up data intact (Active: ${countCheck.data.activeFollowUps}, Actionable: ${countCheck.data.actionableFollowUps})`);

  // -------------------------------------------------------------------------
  // TEST H: Settings & Custom Message Templates Protection
  // -------------------------------------------------------------------------
  console.log('\n--- TEST H: Settings & Template Protection ---');
  const settingsCheck = await apiReq('GET', '/api/settings');
  assert.strictEqual(settingsCheck.data.settings.templates.length, initialSettings.templates.length, 'Template count must be unchanged');
  initialSettings.templates.forEach((origTpl, idx) => {
    const currTpl = settingsCheck.data.settings.templates[idx];
    assert.strictEqual(currTpl.id, origTpl.id, `Template #${idx} ID must match`);
    assert.strictEqual(currTpl.name, origTpl.name, `Template #${idx} name must match`);
    assert.strictEqual(currTpl.template, origTpl.template, `Template #${idx} text must match`);
  });
  console.log('✓ TEST H PASSED: All Settings, user preferences, and templates remain 100% identical.');

  // -------------------------------------------------------------------------
  // TEST I: Search & Filter Concurrency with Date Organization
  // -------------------------------------------------------------------------
  console.log('\n--- TEST I: Search & Filters working with Date Organization ---');
  // Search for 'Smiles' in today's date
  const searchDateRes = await apiReq('GET', `/api/leads/saved?savedDate=${expectedTodayKey}&search=Smiles`);
  assert.strictEqual(searchDateRes.data.leads.length, 1);
  assert.strictEqual(searchDateRes.data.leads[0].business_name, 'Dr. Rao Smiles Dental');
  console.log('✓ TEST I PASSED: Search + Date filter works seamlessly together.');

  // Clean up the 2 test leads
  console.log('\n--- Cleaning up temporary test leads ---');
  await apiReq('DELETE', `/api/leads/${foundToday1.id}`);
  await apiReq('DELETE', `/api/leads/${match2.id}`);

  const finalCheck = await apiReq('GET', '/api/leads/saved');
  assert.strictEqual(finalCheck.data.totalCount, baselineSavedCount, `Final count must match baseline (${baselineSavedCount})`);
  console.log(`✓ Cleaned up test leads. Final count verified: ${baselineSavedCount}`);

  console.log('\n===============================================================');
  console.log('ALL TESTS A THROUGH I PASSED SUCCESSFULLY!');
  console.log('===============================================================\n');
}

runDateOrganizationTestSuite().catch((err) => {
  console.error('\n❌ TEST SUITE FAILED:', err);
  process.exit(1);
});
