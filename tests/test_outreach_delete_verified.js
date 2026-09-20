const assert = require('assert');
const http = require('http');

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

async function runAllTests() {
  console.log('====================================================');
  console.log('CLIENTHUNTER — VERIFIED OUTREACH DELETE TEST SUITE');
  console.log('====================================================\n');

  // Verify backend
  const statusRes = await request('GET', '/api/system/status');
  assert.strictEqual(statusRes.status, 200, 'Backend must be responsive');
  console.log('✓ Backend ready on port 3000');

  // Get initial saved leads count
  const initialSaved = await request('GET', '/api/leads/saved');
  const baselineCount = initialSaved.data.totalCount;
  console.log(`✓ Baseline Saved Leads count: ${baselineCount}`);

  // Setup 3 dedicated test leads with distinct properties and a specific savedDate
  const testDate = '2026-09-18T10:00:00.000Z';
  const testLeads = [
    {
      place_id: 'verified_outreach_p1_' + Date.now(),
      business_name: 'Apex Orthodontics Hub',
      category: 'Dental Clinic',
      city: 'Hyderabad',
      state: 'Telangana',
      phone: '+91 91234 50001',
      website: 'https://apexortho.example.com',
      website_status: 'YES',
      opportunity_score: 92,
      saved_at: testDate,
      created_at: testDate
    },
    {
      place_id: 'verified_outreach_p2_' + Date.now(),
      business_name: 'Bolt CrossFit Arena',
      category: 'Gym',
      city: 'Hyderabad',
      state: 'Telangana',
      phone: '+91 91234 50002',
      website: '',
      website_status: 'NO',
      opportunity_score: 88,
      saved_at: testDate,
      created_at: testDate
    },
    {
      place_id: 'verified_outreach_p3_' + Date.now(),
      business_name: 'Crown Real Estate Advisors',
      category: 'Real Estate',
      city: 'Hyderabad',
      state: 'Telangana',
      phone: '+91 91234 50003',
      website: 'https://crownreal.example.com',
      website_status: 'YES',
      opportunity_score: 96,
      saved_at: testDate,
      created_at: testDate
    }
  ];

  // Save the test leads
  const saveRes = await request('POST', '/api/leads/save', { leads: testLeads });
  assert.strictEqual(saveRes.data.success, true);
  console.log('✓ Created 3 test leads');

  const savedAfterInsert = await request('GET', '/api/leads/saved');
  const inserted = savedAfterInsert.data.leads.filter(l => l.place_id && l.place_id.startsWith('verified_outreach_p'));
  assert.strictEqual(inserted.length, 3, 'Must find 3 inserted test leads');
  const [lead1, lead2, lead3] = inserted;

  // Star lead1 (Favorite) to test favorite persistence
  await request('POST', `/api/leads/${lead1.id}/favorite`, { favorite: true });
  console.log('✓ Marked lead1 (Apex Orthodontics Hub) as Favorite');

  // ----------------------------------------------------
  // TEST 1: Add a Saved Lead to Outreach. Remove it. Check Saved Leads.
  // ----------------------------------------------------
  console.log('\n--- TEST 1: Add a Saved Lead to Outreach. Remove it. Check Saved Leads ---');
  await request('POST', '/api/leads/move-to-outreach', { leadIds: [lead1.id] });
  let outreachCheck = await request('GET', '/api/outreach/data');
  assert(outreachCheck.data.allLeads.some(l => l.id === lead1.id), 'Lead 1 must be in Outreach');

  // Remove lead1
  const remove1 = await request('POST', '/api/outreach/remove-batch', { leadIds: [lead1.id] });
  assert.strictEqual(remove1.data.success, true);

  // Check Outreach
  outreachCheck = await request('GET', '/api/outreach/data');
  assert(!outreachCheck.data.allLeads.some(l => l.id === lead1.id), 'Lead 1 must be absent from Outreach');

  // Check Saved Leads
  let savedCheck = await request('GET', '/api/leads/saved');
  const foundLead1 = savedCheck.data.leads.find(l => l.id === lead1.id);
  assert(foundLead1, 'Lead 1 MUST still exist in Saved Leads');
  assert.strictEqual(foundLead1.business_name, 'Apex Orthodontics Hub');
  assert.strictEqual(foundLead1.outreach_status, 'Pending');
  console.log('✓ TEST 1 PASSED: Lead removed from Outreach only, completely preserved in Saved Leads.');

  // ----------------------------------------------------
  // TEST 2: Add 3 Saved Leads to Outreach. Select 2. Click Delete.
  // Expected: 2 removed from Outreach. 1 remains in Outreach. All 3 remain in Saved Leads.
  // ----------------------------------------------------
  console.log('\n--- TEST 2: Bulk Delete 2 of 3 leads from Outreach ---');
  await request('POST', '/api/leads/move-to-outreach', { leadIds: [lead1.id, lead2.id, lead3.id] });
  outreachCheck = await request('GET', '/api/outreach/data');
  assert.strictEqual(outreachCheck.data.allLeads.filter(l => [lead1.id, lead2.id, lead3.id].includes(l.id)).length, 3);

  // Bulk remove lead1 and lead2
  const remove2 = await request('POST', '/api/outreach/remove-batch', { leadIds: [lead1.id, lead2.id] });
  assert.strictEqual(remove2.data.success, true);
  assert.strictEqual(remove2.data.removedCount, 2);

  // Verify Outreach
  outreachCheck = await request('GET', '/api/outreach/data');
  assert(!outreachCheck.data.allLeads.some(l => l.id === lead1.id), 'Lead 1 must be removed from Outreach');
  assert(!outreachCheck.data.allLeads.some(l => l.id === lead2.id), 'Lead 2 must be removed from Outreach');
  assert(outreachCheck.data.allLeads.some(l => l.id === lead3.id), 'Lead 3 MUST remain in Outreach');

  // Verify Saved Leads
  savedCheck = await request('GET', '/api/leads/saved');
  assert(savedCheck.data.leads.some(l => l.id === lead1.id), 'Lead 1 must remain in Saved Leads');
  assert(savedCheck.data.leads.some(l => l.id === lead2.id), 'Lead 2 must remain in Saved Leads');
  assert(savedCheck.data.leads.some(l => l.id === lead3.id), 'Lead 3 must remain in Saved Leads');
  console.log('✓ TEST 2 PASSED: Exactly 2 leads removed from Outreach, 1 remains in Outreach, all 3 preserved in Saved Leads.');

  // ----------------------------------------------------
  // TEST 3: Open a lead in Conversation Workspace. Click Remove.
  // Expected: Lead disappears from Outreach. Lead remains in Saved Leads.
  // ----------------------------------------------------
  console.log('\n--- TEST 3: Individual workspace remove button ---');
  const removeLead3 = await request('DELETE', `/api/outreach/${encodeURIComponent(lead3.id)}`);
  assert.strictEqual(removeLead3.data.success, true);

  outreachCheck = await request('GET', '/api/outreach/data');
  assert(!outreachCheck.data.allLeads.some(l => l.id === lead3.id), 'Lead 3 must disappear from Outreach');

  savedCheck = await request('GET', '/api/leads/saved');
  const foundLead3 = savedCheck.data.leads.find(l => l.id === lead3.id);
  assert(foundLead3, 'Lead 3 MUST remain in Saved Leads');
  console.log('✓ TEST 3 PASSED: Workspace removed lead disappeared from Outreach and remains in Saved Leads.');

  // ----------------------------------------------------
  // TEST 4: Remove a lead from Outreach. Refresh application (Simulate refresh / reload).
  // Also tests that messaged leads (first_message_sent: true) do not resurrect!
  // ----------------------------------------------------
  console.log('\n--- TEST 4: Persistence across data reload (including messaged lead resurrection prevention) ---');
  // Move lead2 to outreach and mark first message sent
  await request('POST', '/api/leads/move-to-outreach', { leadIds: [lead2.id] });
  await request('POST', '/api/outreach/mark-sent', { leadId: lead2.id, channel: 'WhatsApp', messageText: 'Hello' });

  // Remove lead2 from outreach
  await request('POST', '/api/outreach/remove-batch', { leadIds: [lead2.id] });

  // Simulate multiple reloads/refreshes of data
  const refresh1 = await request('GET', '/api/outreach/data');
  const refresh2 = await request('GET', '/api/leads/count');
  const refresh3 = await request('GET', '/api/outreach/data');
  const refreshSaved = await request('GET', '/api/leads/saved');

  assert(!refresh1.data.allLeads.some(l => l.id === lead2.id), 'Lead 2 must NOT be in Outreach on refresh');
  assert(!refresh3.data.allLeads.some(l => l.id === lead2.id), 'Lead 2 must NOT resurrect in Outreach after count query');
  assert(refreshSaved.data.leads.some(l => l.id === lead2.id), 'Lead 2 must still be present in Saved Leads');
  console.log('✓ TEST 4 PASSED: Lead remains absent from Outreach and present in Saved Leads across refreshes (no resurrection).');

  // ----------------------------------------------------
  // TEST 5: Verify original date-grouped section in Saved Leads
  // ----------------------------------------------------
  console.log('\n--- TEST 5: Saved Leads date-grouped section preservation ---');
  const dateRes = await request('GET', '/api/leads/saved?savedDate=2026-09-18');
  assert.strictEqual(dateRes.status, 200);
  const matchedInDate = dateRes.data.leads.filter(l => [lead1.id, lead2.id, lead3.id].includes(l.id));
  assert.strictEqual(matchedInDate.length, 3, 'All 3 leads must remain grouped under original 2026-09-18 date');
  console.log('✓ TEST 5 PASSED: All leads remain intact under their original date-grouped section.');

  // ----------------------------------------------------
  // TEST 6: Verify Favorites, Find Leads history, and other lead data are unaffected
  // ----------------------------------------------------
  console.log('\n--- TEST 6: Verify Favorites and lead data unaffected ---');
  const favRes = await request('GET', '/api/leads/saved?favorite=true');
  const favLead = favRes.data.leads.find(l => l.id === lead1.id);
  assert(favLead, 'Lead 1 must still be in Favorites');
  assert.strictEqual(favLead.favorite, true);
  assert.strictEqual(favLead.business_name, 'Apex Orthodontics Hub');
  assert.strictEqual(favLead.category, 'Dental Clinic');
  assert.strictEqual(favLead.phone, '+91 91234 50001');
  assert.strictEqual(favLead.website_status, 'YES');
  assert.strictEqual(favLead.opportunity_score, 92);
  console.log('✓ TEST 6 PASSED: Favorite status and lead fields are 100% untouched.');

  // Clean up 3 test leads
  console.log('\nCleaning up test leads...');
  await request('DELETE', `/api/leads/${lead1.id}`);
  await request('DELETE', `/api/leads/${lead2.id}`);
  await request('DELETE', `/api/leads/${lead3.id}`);

  const finalSaved = await request('GET', '/api/leads/saved');
  assert.strictEqual(finalSaved.data.totalCount, baselineCount, `Final count must equal baseline count (${baselineCount})`);
  console.log(`✓ Cleaned up test leads. Final count verified: ${baselineCount}`);

  console.log('\n====================================================');
  console.log('ALL 6 OUTREACH DELETE VERIFICATION TESTS PASSED!');
  console.log('====================================================\n');
}

runAllTests().catch((err) => {
  console.error('\n❌ TEST SUITE FAILED:', err);
  process.exit(1);
});
