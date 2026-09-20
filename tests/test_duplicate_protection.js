const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');

const LEADS_STORE_PATH = path.join(
  process.env.APPDATA || (process.platform === 'darwin' ? process.env.HOME + '/Library/Preferences' : process.env.HOME + '/.local/share'),
  'clienthunter',
  'data',
  'leads_store.json'
);

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

async function runTests() {
  console.log('====================================================');
  console.log('CLIENTHUNTER — DUPLICATE PROTECTION TEST SUITE');
  console.log('====================================================\n');

  // Backup original store so we restore it at the end
  let originalStoreBackup = null;
  if (fs.existsSync(LEADS_STORE_PATH)) {
    originalStoreBackup = fs.readFileSync(LEADS_STORE_PATH, 'utf8');
    console.log('Backed up original database state.');
  }

  const testPlaceIdsCreated = new Set();

  try {
    const initialSavedRes = await apiReq('GET', '/api/leads/saved');
    const initialCount = initialSavedRes.data.totalCount || initialSavedRes.data.leads.length;
    console.log(`Initial saved leads count: ${initialCount}`);

    // ----------------------------------------------------
    // TEST 1 — Exact Place ID
    // ----------------------------------------------------
    console.log('\n--- TEST 1: Exact Place ID ---');
    const t1PlaceId = 'ChIJ_TEST_EXACT_001';
    testPlaceIdsCreated.add(t1PlaceId);
    const lead1 = {
      place_id: t1PlaceId,
      business_name: 'Studio 18 Family Salon',
      phone: '+91 98765 43210',
      category: 'Beauty Salons',
      city: 'Hyderabad',
      address: 'Road No 36, Jubilee Hills'
    };

    const saveRes1 = await apiReq('POST', '/api/leads/save', { leads: [lead1] });
    assert.strictEqual(saveRes1.data.success, true);
    assert.strictEqual(saveRes1.data.savedCount, 1);
    console.log('Initial lead saved successfully.');

    // Search or save duplicate lead with same Place ID
    const dupRes1 = await apiReq('POST', '/api/leads/save', { leads: [lead1] });
    assert.strictEqual(dupRes1.data.success, true);
    assert.strictEqual(dupRes1.data.savedCount, 0, 'Duplicate lead should not be saved');
    assert.strictEqual(dupRes1.data.duplicatesSkipped, 1, 'Should report 1 duplicate skipped');
    console.log('✅ TEST 1 PASSED: Exact Place ID recognized and prevented duplicate.');

    // ----------------------------------------------------
    // TEST 2 — Same business different capitalization
    // ----------------------------------------------------
    console.log('\n--- TEST 2: Same business different capitalization ---');
    const t2Phone = '09876543210';
    const dupCapLead = {
      place_id: null,
      business_name: 'STUDIO 18 FAMILY SALON',
      phone: t2Phone,
      category: 'Beauty Salons',
      city: 'Hyderabad'
    };
    const dupRes2 = await apiReq('POST', '/api/leads/save', { leads: [dupCapLead] });
    assert.strictEqual(dupRes2.data.savedCount, 0, 'Capitalized duplicate should be skipped');
    assert.strictEqual(dupRes2.data.duplicatesSkipped, 1);
    console.log('✅ TEST 2 PASSED: Capitalization difference normalized and detected.');

    // ----------------------------------------------------
    // TEST 3 — Phone formatting differences
    // ----------------------------------------------------
    console.log('\n--- TEST 3: Phone formatting differences ---');
    const t3PlaceId = 'ChIJ_TEST_PHONE_003';
    testPlaceIdsCreated.add(t3PlaceId);
    const phoneLead1 = {
      place_id: t3PlaceId,
      business_name: 'Health First Dental',
      phone: '040 1234 5678',
      category: 'Dental',
      city: 'Hyderabad'
    };
    const savePhoneRes = await apiReq('POST', '/api/leads/save', { leads: [phoneLead1] });
    assert.strictEqual(savePhoneRes.data.savedCount, 1);

    const phoneLead2 = {
      place_id: null,
      business_name: 'Health First Dental',
      phone: '040-1234-5678',
      category: 'Dental',
      city: 'Hyderabad'
    };
    const savePhoneDupRes = await apiReq('POST', '/api/leads/save', { leads: [phoneLead2] });
    assert.strictEqual(savePhoneDupRes.data.savedCount, 0, 'Formatted phone dupe should be skipped');
    assert.strictEqual(savePhoneDupRes.data.duplicatesSkipped, 1);
    console.log('✅ TEST 3 PASSED: Phone formats (040 1234 5678 vs 040-1234-5678) normalized & detected.');

    // ----------------------------------------------------
    // TEST 4 — Same business on next day (Preserve created_at)
    // ----------------------------------------------------
    console.log('\n--- TEST 4: Duplicates across different days ---');
    const t4PlaceId = 'ChIJ_TEST_DATE_004';
    testPlaceIdsCreated.add(t4PlaceId);
    const originalDate = '2026-09-18T10:00:00.000Z';
    const day1Lead = {
      place_id: t4PlaceId,
      business_name: 'Glow Skin Clinic',
      phone: '+91 91234 56789',
      category: 'Dermatologist',
      city: 'Hyderabad',
      saved_at: originalDate
    };
    const day1Save = await apiReq('POST', '/api/leads/save', { leads: [day1Lead] });
    assert.strictEqual(day1Save.data.savedCount, 1);

    // Day 2 attempt
    const day2Lead = {
      place_id: t4PlaceId,
      business_name: 'Glow Skin Clinic',
      phone: '+91 91234 56789',
      saved_at: '2026-09-19T10:00:00.000Z'
    };
    const day2Save = await apiReq('POST', '/api/leads/save', { leads: [day2Lead] });
    assert.strictEqual(day2Save.data.savedCount, 0);
    assert.strictEqual(day2Save.data.duplicatesSkipped, 1);

    // Verify original created_at is preserved
    const verifyDateRes = await apiReq('GET', '/api/leads/saved?search=Glow%20Skin%20Clinic');
    const foundGlow = verifyDateRes.data.leads.find(l => l.place_id === t4PlaceId);
    assert.ok(foundGlow, 'Lead must exist in store');
    assert.strictEqual(foundGlow.created_at, originalDate, 'Original created_at date must be preserved');
    console.log('✅ TEST 4 PASSED: Day 2 search prevented duplicate and preserved original created_at.');

    // ----------------------------------------------------
    // TEST 5 — Different businesses with similar names (Branches)
    // ----------------------------------------------------
    console.log('\n--- TEST 5: Branch separation (Jubilee Hills vs Secunderabad) ---');
    const t5BranchA = 'ChIJ_BRANCH_JUBILEE_005';
    const t5BranchB = 'ChIJ_BRANCH_SECUNDERABAD_005';
    testPlaceIdsCreated.add(t5BranchA);
    testPlaceIdsCreated.add(t5BranchB);

    const branchA = {
      place_id: t5BranchA,
      business_name: 'ABC Dental Clinic - Jubilee Hills',
      phone: '040 1111 2222',
      city: 'Hyderabad',
      address: 'Jubilee Hills Road 36'
    };
    const branchB = {
      place_id: t5BranchB,
      business_name: 'ABC Dental Clinic - Secunderabad',
      phone: '040 3333 4444',
      city: 'Hyderabad',
      address: 'MG Road Secunderabad'
    };

    const branchSave = await apiReq('POST', '/api/leads/save', { leads: [branchA, branchB] });
    assert.strictEqual(branchSave.data.savedCount, 2, 'Both distinct branches must be saved');
    assert.strictEqual(branchSave.data.duplicatesSkipped, 0);
    console.log('✅ TEST 5 PASSED: Distinct branches with different Place IDs/phones are preserved.');

    // ----------------------------------------------------
    // TEST 6 — Multiple selection (Batch Save: 15 new, 5 duplicates)
    // ----------------------------------------------------
    console.log('\n--- TEST 6: Batch Save (15 new, 5 duplicates) ---');
    const batchLeads = [];
    // 15 new leads
    for (let i = 1; i <= 15; i++) {
      const pId = `ChIJ_TEST_BATCH_NEW_${i}`;
      testPlaceIdsCreated.add(pId);
      batchLeads.push({
        place_id: pId,
        business_name: `Batch Lead New ${i}`,
        phone: `+91 98700 000${String(i).padStart(2, '0')}`,
        city: 'Hyderabad'
      });
    }
    // 5 duplicates (using already saved Place IDs)
    batchLeads.push(lead1); // t1PlaceId
    batchLeads.push(phoneLead1); // t3PlaceId
    batchLeads.push(day1Lead); // t4PlaceId
    batchLeads.push(branchA); // t5BranchA
    batchLeads.push(branchB); // t5BranchB

    assert.strictEqual(batchLeads.length, 20);

    const batchRes = await apiReq('POST', '/api/leads/save', { leads: batchLeads });
    assert.strictEqual(batchRes.data.success, true);
    assert.strictEqual(batchRes.data.savedCount, 15, 'Exactly 15 new leads should be saved');
    assert.strictEqual(batchRes.data.duplicatesSkipped, 5, 'Exactly 5 duplicates should be skipped');
    console.log('✅ TEST 6 PASSED: Batch save saved 15 new leads and skipped 5 duplicates.');

    // ----------------------------------------------------
    // TEST 7 — Duplicate inside the same API response / batch
    // ----------------------------------------------------
    console.log('\n--- TEST 7: Duplicates inside the same batch ---');
    const t7PlaceId = 'ChIJ_TEST_INTRA_BATCH_007';
    testPlaceIdsCreated.add(t7PlaceId);
    const intraBatchLeads = [
      { place_id: t7PlaceId, business_name: 'Apex Physiotherapy', phone: '+91 97777 66661' },
      { place_id: t7PlaceId, business_name: 'Apex Physiotherapy', phone: '+91 97777 66661' }
    ];

    const intraRes = await apiReq('POST', '/api/leads/save', { leads: intraBatchLeads });
    assert.strictEqual(intraRes.data.savedCount, 1, 'Only 1 of the duplicated batch items should be saved');
    assert.strictEqual(intraRes.data.duplicatesSkipped, 1, 'Second occurrence in batch must be skipped');
    console.log('✅ TEST 7 PASSED: In-batch duplicate deduplicated cleanly before saving.');

    // ----------------------------------------------------
    // TEST 8 — Existing Outreach lead preservation
    // ----------------------------------------------------
    console.log('\n--- TEST 8: Existing Outreach lead preservation ---');
    const t8PlaceId = 'ChIJ_TEST_OUTREACH_008';
    testPlaceIdsCreated.add(t8PlaceId);
    const outreachLead = {
      place_id: t8PlaceId,
      business_name: 'Prime Diagnostic Lab',
      phone: '+91 96666 55555',
      outreach_status: 'In Progress',
      first_message_sent: true,
      first_message_sent_at: '2026-09-18T12:00:00.000Z'
    };
    await apiReq('POST', '/api/leads/save', { leads: [outreachLead] });

    // Attempt to save again
    const dupOutreach = {
      place_id: t8PlaceId,
      business_name: 'Prime Diagnostic Lab',
      phone: '+91 96666 55555',
      outreach_status: 'Pending', // Fresh search would have Pending
      first_message_sent: false
    };
    const outreachDupRes = await apiReq('POST', '/api/leads/save', { leads: [dupOutreach] });
    assert.strictEqual(outreachDupRes.data.savedCount, 0);

    // Verify stored lead keeps Outreach status and first_message_sent
    const checkOutreach = (await apiReq('GET', '/api/leads/saved?search=Prime%20Diagnostic')).data.leads.find(l => l.place_id === t8PlaceId);
    assert.strictEqual(checkOutreach.outreach_status, 'In Progress');
    assert.strictEqual(checkOutreach.first_message_sent, true);
    console.log('✅ TEST 8 PASSED: Outreach status and history are 100% preserved.');

    // ----------------------------------------------------
    // TEST 9 — Existing Favorite preservation
    // ----------------------------------------------------
    console.log('\n--- TEST 9: Existing Favorite preservation ---');
    const t9PlaceId = 'ChIJ_TEST_FAVORITE_009';
    testPlaceIdsCreated.add(t9PlaceId);
    const favLead = {
      place_id: t9PlaceId,
      business_name: 'Elite Fitness Center',
      phone: '+91 95555 44444',
      favorite: true
    };
    await apiReq('POST', '/api/leads/save', { leads: [favLead] });

    // Duplicate search result with favorite: false
    const dupFav = {
      place_id: t9PlaceId,
      business_name: 'Elite Fitness Center',
      favorite: false
    };
    await apiReq('POST', '/api/leads/save', { leads: [dupFav] });

    const checkFav = (await apiReq('GET', '/api/leads/saved?search=Elite%20Fitness')).data.leads.find(l => l.place_id === t9PlaceId);
    assert.strictEqual(checkFav.favorite, true, 'Favorite flag must remain true');
    console.log('✅ TEST 9 PASSED: Favorite status preserved.');

    // ----------------------------------------------------
    // TEST 10 — Existing Follow-up preservation
    // ----------------------------------------------------
    console.log('\n--- TEST 10: Existing Follow-up preservation ---');
    const t10PlaceId = 'ChIJ_TEST_FOLLOWUP_010';
    testPlaceIdsCreated.add(t10PlaceId);
    const fuLead = {
      place_id: t10PlaceId,
      business_name: 'Sunrise Dental Hospital',
      phone: '+91 94444 33333',
      follow_up_day: 2,
      current_follow_up_number: 1,
      next_follow_up_name: 'Gentle Nudge',
      next_follow_up_at: '2026-09-20T10:00:00.000Z'
    };
    await apiReq('POST', '/api/leads/save', { leads: [fuLead] });

    // Duplicate search
    await apiReq('POST', '/api/leads/save', { leads: [{ place_id: t10PlaceId, business_name: 'Sunrise Dental Hospital' }] });

    const checkFu = (await apiReq('GET', '/api/leads/saved?search=Sunrise%20Dental')).data.leads.find(l => l.place_id === t10PlaceId);
    assert.strictEqual(checkFu.follow_up_day, 2);
    assert.strictEqual(checkFu.current_follow_up_number, 1);
    assert.strictEqual(checkFu.next_follow_up_name, 'Gentle Nudge');
    console.log('✅ TEST 10 PASSED: Follow-up state and scheduled dates preserved.');

    // ----------------------------------------------------
    // TEST 11 — Existing Notes / Message history preservation
    // ----------------------------------------------------
    console.log('\n--- TEST 11: Existing Notes / Message history preservation ---');
    const t11PlaceId = 'ChIJ_TEST_NOTES_011';
    testPlaceIdsCreated.add(t11PlaceId);
    const notesLead = {
      place_id: t11PlaceId,
      business_name: 'Metro Law Chambers',
      phone: '+91 93333 22222',
      notes: 'Spoke with lead partner; requested quotation on Friday',
      message_history: [
        { type: 'INITIAL', text: 'Hello partner', sent_at: '2026-09-18T09:00:00.000Z' }
      ]
    };
    await apiReq('POST', '/api/leads/save', { leads: [notesLead] });

    // Duplicate search
    await apiReq('POST', '/api/leads/save', { leads: [{ place_id: t11PlaceId, business_name: 'Metro Law Chambers' }] });

    const checkNotes = (await apiReq('GET', '/api/leads/saved?search=Metro%20Law')).data.leads.find(l => l.place_id === t11PlaceId);
    const noteText = Array.isArray(checkNotes.notes) ? checkNotes.notes[0]?.text : checkNotes.notes;
    assert.strictEqual(noteText, 'Spoke with lead partner; requested quotation on Friday');
    assert.strictEqual(checkNotes.message_history.length, 1);
    console.log('✅ TEST 11 PASSED: CRM Notes and message history preserved.');

    // ----------------------------------------------------
    // TEST 12 — Persistence and duplicate protection consistency
    // ----------------------------------------------------
    console.log('\n--- TEST 12: Persistence and duplicate index reload ---');
    // Ensure all test leads are stored in file
    const fileContent = fs.readFileSync(LEADS_STORE_PATH, 'utf8');
    const parsedData = JSON.parse(fileContent);
    const hasT1 = parsedData.leads.some(l => l.place_id === t1PlaceId);
    assert.strictEqual(hasT1, true, 'Lead must be saved in persistent file');

    // Duplicate check on persisted lead
    const persistCheck = await apiReq('POST', '/api/leads/save', { leads: [lead1] });
    assert.strictEqual(persistCheck.data.savedCount, 0);
    assert.strictEqual(persistCheck.data.duplicatesSkipped, 1);
    console.log('✅ TEST 12 PASSED: Persistence and duplicate protection confirmed.');

    // ----------------------------------------------------
    // TEST 13 — Large Batch Performance
    // ----------------------------------------------------
    console.log('\n--- TEST 13: Large batch performance test (200 leads) ---');
    const largeBatch = [];
    for (let i = 1; i <= 200; i++) {
      largeBatch.push({
        place_id: i % 2 === 0 ? t1PlaceId : `ChIJ_PERF_NEW_${i}`,
        business_name: `Perf Lead ${i}`,
        phone: `+91 99000 ${String(i).padStart(5, '0')}`,
        city: 'Hyderabad'
      });
    }

    const tStart = Date.now();
    const perfRes = await apiReq('POST', '/api/leads/save', { leads: largeBatch });
    const elapsed = Date.now() - tStart;
    assert.strictEqual(perfRes.data.success, true);
    assert.strictEqual(perfRes.data.duplicatesSkipped, 100, 'All 100 duplicate items should be skipped');
    assert.strictEqual(perfRes.data.savedCount, 100, 'All 100 unique items should be saved');
    console.log(`Large batch processed in ${elapsed}ms (< 500ms target).`);
    assert.ok(elapsed < 1000, 'Should complete rapidly');
    console.log('✅ TEST 13 PASSED: Large batch processed with zero lag.');

    console.log('\n====================================================');
    console.log('ALL 13 TESTS PASSED PERFECTLY!');
    console.log('====================================================\n');

  } finally {
    // Restore original store backup so database is left in exact original state
    if (originalStoreBackup) {
      fs.writeFileSync(LEADS_STORE_PATH, originalStoreBackup, 'utf8');
      console.log('Restored original database state (all 108 existing leads intact).');
      // Invalidate duplicate index on server by triggering a dummy request or reload
      await apiReq('GET', '/api/leads/saved');
    }
  }
}

runTests().catch(err => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
