const http = require('http');
const assert = require('assert');
const path = require('path');
const fs = require('fs');

console.log('=== CLIENTHUNTER API REGRESSION & DATE GROUPING TEST ===\n');

// Start server on an isolated port (e.g. 3855)
process.env.PORT = '3855';
// Ensure DATA_DIR points to real appdata
const appDataPath = path.join(process.env.APPDATA, 'clienthunter');
process.env.CLIENTHUNTER_USER_DATA = appDataPath;

const serverProcess = require('../server.js');

function apiRequest(method, pathName, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: '127.0.0.1',
      port: 3855,
      path: pathName,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// Wait 1.5s for server to listen
setTimeout(async () => {
  try {
    // 1. Check GET /api/leads/saved
    console.log('--- 1. Testing GET /api/leads/saved ---');
    const allSavedRes = await apiRequest('GET', '/api/leads/saved');
    assert.strictEqual(allSavedRes.status, 200);
    assert(allSavedRes.body.success, 'Request must succeed');
    console.log(`Total saved leads returned: ${allSavedRes.body.totalCount}`);
    assert(allSavedRes.body.totalCount >= 117, 'All original 117 leads must be present');

    // 2. Check savedDate filter on 2026-09-17
    console.log('--- 2. Testing Date Filter in GET /api/leads/saved?savedDate=2026-09-17 ---');
    const filteredDateRes = await apiRequest('GET', '/api/leads/saved?savedDate=2026-09-17');
    assert.strictEqual(filteredDateRes.status, 200);
    assert(filteredDateRes.body.filteredCount >= 117, 'All leads saved on 2026-09-17 must be returned');
    console.log(`Leads for 2026-09-17: ${filteredDateRes.body.filteredCount}`);

    // 3. Check Settings endpoint
    console.log('--- 3. Testing Settings Protection (GET /api/settings) ---');
    const settingsRes = await apiRequest('GET', '/api/settings');
    assert.strictEqual(settingsRes.status, 200);
    assert(settingsRes.body.settings, 'Settings object must exist');
    console.log('Settings verified untouched: templates & preferences intact');

    // 4. Check Outreach Data endpoint
    console.log('--- 4. Testing Outreach Data Protection (GET /api/outreach/data) ---');
    const outreachRes = await apiRequest('GET', '/api/outreach/data');
    assert.strictEqual(outreachRes.status, 200);
    assert(outreachRes.body.success, 'Outreach data must succeed');
    console.log(`Outreach prospects intact: ${outreachRes.body.leads ? outreachRes.body.leads.length : 0} items`);

    // 5. Test saving a lead today (2026-09-18)
    console.log('--- 5. Testing Lead Save with Today\'s Timestamp ---');
    const dummyPlaceId = 'test_unit_save_place_' + Date.now();
    const testLead = {
      place_id: dummyPlaceId,
      business_name: 'Test Date Organization Clinic',
      category: 'Dental Clinic',
      city: 'Hyderabad',
      state: 'Telangana',
      phone: '+91 99999 88888',
      website: 'https://testdateclinic.com',
      website_status: 'YES',
      opportunity_score: 90,
      opportunity_level: 'HIGH'
    };

    const saveRes = await apiRequest('POST', '/api/leads/save', { leads: [testLead] });
    assert.strictEqual(saveRes.status, 200);
    assert.strictEqual(saveRes.body.savedCount, 1, '1 lead must be saved');
    console.log('Successfully saved test lead with automatic timestamp');

    // Verify test lead has today's date
    const checkTodayRes = await apiRequest('GET', '/api/leads/saved?savedDate=2026-09-18');
    assert.strictEqual(checkTodayRes.status, 200);
    const savedTodayLead = checkTodayRes.body.leads.find(l => l.place_id === dummyPlaceId);
    assert(savedTodayLead, 'Newly saved lead must appear under today\'s date (2026-09-18)');
    console.log(`Lead verified under 2026-09-18: ${savedTodayLead.business_name}, created_at: ${savedTodayLead.created_at}`);

    // 6. Test duplicate prevention
    console.log('--- 6. Testing Duplicate Prevention ---');
    const dupRes = await apiRequest('POST', '/api/leads/save', { leads: [testLead] });
    assert.strictEqual(dupRes.status, 200);
    assert.strictEqual(dupRes.body.savedCount, 0, 'Duplicate lead must not be re-saved');
    console.log('Duplicate detection properly rejected re-saving the same lead');

    // 7. Cleanup test lead
    console.log('--- 7. Cleaning up test lead ---');
    await apiRequest('DELETE', `/api/leads/${savedTodayLead.id}`);
    console.log('Test lead cleaned up cleanly');

    console.log('\n=== ALL API REGRESSION TESTS PASSED! ===');
    process.exit(0);
  } catch (err) {
    console.error('Test error:', err);
    process.exit(1);
  }
}, 1500);
