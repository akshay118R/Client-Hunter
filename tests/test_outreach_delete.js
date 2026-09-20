const assert = require('assert');
const path = require('path');
const fs = require('fs');
const http = require('http');

// Helper to make local HTTP requests to running backend
function request(method, pathName, body) {
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

async function runTests() {
  console.log('====================================================');
  console.log('CLIENTHUNTER — OUTREACH DELETE / REMOVE TEST SUITE');
  console.log('====================================================\n');

  // Check backend readiness
  const statusRes = await request('GET', '/api/system/status');
  assert.strictEqual(statusRes.status, 200, 'Backend must be running on port 3000');
  console.log('✓ Backend ready on port 3000');

  // Fetch initial saved leads
  const initialSaved = await request('GET', '/api/leads/saved');
  assert.strictEqual(initialSaved.status, 200);
  const baselineCount = initialSaved.data.totalCount;
  console.log(`✓ Initial Saved Leads baseline count: ${baselineCount}`);

  // Create 3 test leads for safe isolated testing
  const now = new Date();
  const testDate = '2026-09-18T10:00:00.000Z';
  const testLeads = [
    {
      place_id: 'test_outreach_p1_' + Date.now(),
      business_name: 'Alpha Dental Studio',
      category: 'Dental Clinic',
      city: 'Hyderabad',
      state: 'Telangana',
      phone: '+91 98765 00001',
      website: 'https://alphadental.example.com',
      website_status: 'YES',
      opportunity_score: 90,
      saved_at: testDate
    },
    {
      place_id: 'test_outreach_p2_' + Date.now(),
      business_name: 'Beta Fitness Gym',
      category: 'Gym',
      city: 'Hyderabad',
      state: 'Telangana',
      phone: '+91 98765 00002',
      website: '',
      website_status: 'NO',
      opportunity_score: 85,
      saved_at: testDate
    },
    {
      place_id: 'test_outreach_p3_' + Date.now(),
      business_name: 'Gamma Real Estate',
      category: 'Real Estate',
      city: 'Hyderabad',
      state: 'Telangana',
      phone: '+91 98765 00003',
      website: 'https://gammareal.example.com',
      website_status: 'YES',
      opportunity_score: 95,
      saved_at: testDate
    }
  ];

  // Save the 3 leads
  const saveRes = await request('POST', '/api/leads/save', { leads: testLeads });
  assert.strictEqual(saveRes.data.success, true);
  console.log('✓ Created 3 test leads');

  // Fetch them to get generated IDs
  const savedAfterInsert = await request('GET', '/api/leads/saved');
  const inserted = savedAfterInsert.data.leads.filter(l => l.place_id && l.place_id.startsWith('test_outreach_p'));
  assert.strictEqual(inserted.length, 3, 'Must have inserted 3 test leads');
  const [lead1, lead2, lead3] = inserted;

  // Star lead1 (Favorite) to test TEST 6
  await request('POST', `/api/leads/${lead1.id}/favorite`, { favorite: true });
  console.log('✓ Marked Alpha Dental Studio as Favorite');

  // ----------------------------------------------------
  // TEST 1: Add a Saved Lead to Outreach. Remove it. Check Saved Leads.
  // ----------------------------------------------------
  console.log('\n--- Running TEST 1: Single removal preserves Saved Lead ---');
  // Add lead1 to Outreach
  const move1Res = await request('POST', '/api/leads/move-to-outreach', { leadIds: [lead1.id] });
  assert.strictEqual(move1Res.data.success, true);

  let outreachData = await request('GET', '/api/outreach/data');
  assert(outreachData.data.allLeads.some(l => l.id === lead1.id || l.place_id === lead1.place_id), 'Lead 1 must be in Outreach');

  // Remove lead1 from Outreach
  const remove1Res = await request('POST', '/api/outreach/remove-batch', { leadIds: [lead1.id] });
  assert.strictEqual(remove1Res.data.success, true);
  assert.strictEqual(remove1Res.data.removedCount, 1);

  // Verify lead1 is removed from Outreach
  outreachData = await request('GET', '/api/outreach/data');
  assert(!outreachData.data.allLeads.some(l => l.id === lead1.id || l.place_id === lead1.place_id), 'Lead 1 must NOT be in Outreach');

  // Verify lead1 still exists in Saved Leads
  const savedCheck1 = await request('GET', '/api/leads/saved');
  const foundInSaved1 = savedCheck1.data.leads.find(l => l.id === lead1.id || l.place_id === lead1.place_id);
  assert(foundInSaved1, 'Lead 1 MUST still exist in Saved Leads');
  assert.strictEqual(foundInSaved1.business_name, 'Alpha Dental Studio');
  console.log('✓ TEST 1 PASSED: Lead removed from Outreach only, remains in Saved Leads.');

  // ----------------------------------------------------
  // TEST 2: Add 3 Saved Leads to Outreach. Select 2. Click Delete.
  // Expected: 2 removed from Outreach. 1 remains in Outreach. All 3 remain in Saved Leads.
  // ----------------------------------------------------
  console.log('\n--- Running TEST 2: Bulk removal of 2 leaves 1 in Outreach and all 3 in Saved Leads ---');
  const move3Res = await request('POST', '/api/leads/move-to-outreach', { leadIds: [lead1.id, lead2.id, lead3.id] });
  assert.strictEqual(move3Res.data.success, true);

  outreachData = await request('GET', '/api/outreach/data');
  assert.strictEqual(outreachData.data.allLeads.filter(l => [lead1.id, lead2.id, lead3.id].includes(l.id)).length, 3);

  // Bulk remove 2 leads (lead1 and lead2)
  const remove2Res = await request('POST', '/api/outreach/remove-batch', { leadIds: [lead1.id, lead2.id] });
  assert.strictEqual(remove2Res.data.success, true);
  assert.strictEqual(remove2Res.data.removedCount, 2);

  // Verify 1 remains in Outreach (lead3)
  outreachData = await request('GET', '/api/outreach/data');
  assert(!outreachData.data.allLeads.some(l => l.id === lead1.id), 'Lead 1 must not be in Outreach');
  assert(!outreachData.data.allLeads.some(l => l.id === lead2.id), 'Lead 2 must not be in Outreach');
  assert(outreachData.data.allLeads.some(l => l.id === lead3.id), 'Lead 3 MUST remain in Outreach');

  // Verify all 3 remain in Saved Leads
  const savedCheck2 = await request('GET', '/api/leads/saved');
  assert(savedCheck2.data.leads.some(l => l.id === lead1.id), 'Lead 1 must remain in Saved Leads');
  assert(savedCheck2.data.leads.some(l => l.id === lead2.id), 'Lead 2 must remain in Saved Leads');
  assert(savedCheck2.data.leads.some(l => l.id === lead3.id), 'Lead 3 must remain in Saved Leads');
  console.log('✓ TEST 2 PASSED: 2 leads removed from Outreach, 1 remains in Outreach, all 3 preserved in Saved Leads.');

  // ----------------------------------------------------
  // TEST 3: Open lead in Conversation Workspace. Remove it.
  // ----------------------------------------------------
  console.log('\n--- Running TEST 3: Conversation workspace removal ---');
  // Remove lead3 via single deletion endpoint
  const remove3Res = await request('DELETE', `/api/outreach/${encodeURIComponent(lead3.id)}`);
  assert.strictEqual(remove3Res.data.success, true);

  outreachData = await request('GET', '/api/outreach/data');
  assert(!outreachData.data.allLeads.some(l => l.id === lead3.id), 'Lead 3 must disappear from Outreach');

  const savedCheck3 = await request('GET', '/api/leads/saved');
  const foundLead3 = savedCheck3.data.leads.find(l => l.id === lead3.id);
  assert(foundLead3, 'Lead 3 MUST remain in Saved Leads');
  console.log('✓ TEST 3 PASSED: Workspace removed lead disappeared from Outreach and remains in Saved Leads.');

  // ----------------------------------------------------
  // TEST 4: Remove a lead from Outreach. Refresh application.
  // ----------------------------------------------------
  console.log('\n--- Running TEST 4: Persistence across data reload ---');
  // Move lead2 to outreach and remove it
  await request('POST', '/api/leads/move-to-outreach', { leadIds: [lead2.id] });
  await request('POST', '/api/outreach/remove-batch', { leadIds: [lead2.id] });

  // Simulate refresh by querying both fresh endpoints
  const refreshOutreach = await request('GET', '/api/outreach/data');
  const refreshSaved = await request('GET', '/api/leads/saved');
  assert(!refreshOutreach.data.allLeads.some(l => l.id === lead2.id), 'Lead 2 must still be absent from Outreach');
  assert(refreshSaved.data.leads.some(l => l.id === lead2.id), 'Lead 2 must still be present in Saved Leads');
  console.log('✓ TEST 4 PASSED: State persists correctly across data refreshes.');

  // ----------------------------------------------------
  // TEST 5: Verify date-grouped section in Saved Leads
  // ----------------------------------------------------
  console.log('\n--- Running TEST 5: Date-grouped section preservation ---');
  const savedDateRes = await request('GET', '/api/leads/saved?savedDate=2026-09-18');
  assert.strictEqual(savedDateRes.status, 200);
  const leadsInDate = savedDateRes.data.leads.filter(l => [lead1.id, lead2.id, lead3.id].includes(l.id));
  assert.strictEqual(leadsInDate.length, 3, 'All 3 test leads must remain under their original date group');
  console.log('✓ TEST 5 PASSED: Leads remain under original 18 September 2026 date group.');

  // ----------------------------------------------------
  // TEST 6: Verify Favorites, Find Leads, and other lead data unaffected
  // ----------------------------------------------------
  console.log('\n--- Running TEST 6: Favorites and lead metadata unaffected ---');
  const favRes = await request('GET', '/api/leads/saved?favorite=true');
  const favLead = favRes.data.leads.find(l => l.id === lead1.id);
  assert(favLead, 'Alpha Dental Studio must still be marked favorite');
  assert.strictEqual(favLead.favorite, true);
  assert.strictEqual(favLead.category, 'Dental Clinic');
  assert.strictEqual(favLead.phone, '+91 98765 00001');
  assert.strictEqual(favLead.website_status, 'YES');
  console.log('✓ TEST 6 PASSED: Favorite status and all lead fields intact.');

  // Clean up 3 test leads from database
  console.log('\nCleaning up test leads...');
  await request('DELETE', `/api/leads/${lead1.id}`);
  await request('DELETE', `/api/leads/${lead2.id}`);
  await request('DELETE', `/api/leads/${lead3.id}`);

  const finalSaved = await request('GET', '/api/leads/saved');
  assert.strictEqual(finalSaved.data.totalCount, baselineCount, `Final Saved Leads count must equal baseline count (${baselineCount})`);
  console.log(`✓ Cleaned up test leads. Baseline count preserved: ${baselineCount}`);

  console.log('\n====================================================');
  console.log('ALL 6 OUTREACH DELETE / REMOVE TESTS PASSED SUCCESSFULLY!');
  console.log('====================================================');
}

runTests().catch((err) => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});
