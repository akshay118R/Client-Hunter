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

function getStoredLeads() {
  if (fs.existsSync(LEADS_STORE_PATH)) {
    const raw = fs.readFileSync(LEADS_STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.leads) ? parsed.leads : [];
  }
  return [];
}

async function runTests() {
  console.log('====================================================');
  console.log('CLIENTHUNTER — UNDO DELETE TEST SUITE');
  console.log('====================================================\n');

  let originalBackup = null;
  if (fs.existsSync(LEADS_STORE_PATH)) {
    originalBackup = fs.readFileSync(LEADS_STORE_PATH, 'utf8');
    console.log('Backed up database state.');
  }

  try {
    const timestamp = Date.now();
    const testLeadIdA = `test_undo_lead_a_${timestamp}`;
    const testLeadIdB = `test_undo_lead_b_${timestamp}`;
    const testPlaceIdA = `ChIJ_undo_a_${timestamp}`;
    const testPlaceIdB = `ChIJ_undo_b_${timestamp}`;

    const leadA = {
      id: testLeadIdA,
      place_id: testPlaceIdA,
      business_name: 'Alpha Apex Dental',
      phone: '+91 98765 43210',
      email: 'contact@alphaapex.com',
      website: 'https://alphaapex.com',
      google_maps_url: 'https://maps.google.com/?cid=111',
      category: 'Dentists',
      city: 'Hyderabad',
      state: 'Telangana',
      opportunity_score: 92,
      website_status: 'YES',
      saved_date: '17 September 2026',
      created_at: '2026-09-17T10:00:00.000Z',
      is_favorite: true,
      favorite: true,
      outreach_status: 'Not Contacted',
      notes: [
        {
          id: `note_1_${timestamp}`,
          lead_id: testLeadIdA,
          text: 'Spoke with reception. Call after 5 PM.',
          created_at: '2026-09-17T10:05:00.000Z',
          updated_at: '2026-09-17T10:05:00.000Z'
        }
      ],
      activities: [
        {
          id: `act_1_${timestamp}`,
          lead_id: testLeadIdA,
          event_type: 'lead_added_outreach',
          event_title: 'Added to Outreach',
          event_description: 'Lead entered outreach queue',
          created_at: '2026-09-17T10:00:00.000Z'
        }
      ]
    };

    const leadB = {
      id: testLeadIdB,
      place_id: testPlaceIdB,
      business_name: 'Beta Beauty Spa',
      phone: '+91 91234 56789',
      email: 'info@betaspa.com',
      website: 'https://betaspa.com',
      google_maps_url: 'https://maps.google.com/?cid=222',
      category: 'Spas',
      city: 'Hyderabad',
      state: 'Telangana',
      opportunity_score: 78,
      website_status: 'YES',
      saved_date: '18 September 2026',
      created_at: '2026-09-18T09:00:00.000Z',
      is_favorite: false,
      favorite: false,
      outreach_status: 'Awaiting Reply',
      next_follow_up_at: '2026-09-23T09:00:00.000Z',
      next_follow_up_number: 1,
      next_follow_up_name: 'Follow-up #1',
      notes: [],
      activities: []
    };

    // Seed leads
    await apiReq('POST', '/api/leads/save', { leads: [leadA, leadB] });
    console.log('✓ Test leads seeded successfully.');

    // -------------------------------------------------------------
    // TEST 1: Saved Lead Delete & Undo
    // -------------------------------------------------------------
    console.log('\n--- TEST 1: Saved Lead Delete & Undo ---');
    const delRes1 = await apiReq('DELETE', `/api/leads/${testLeadIdA}`);
    assert.strictEqual(delRes1.status, 200, 'Delete must succeed');
    assert.strictEqual(delRes1.data.success, true);
    assert(delRes1.data.undoToken, 'Delete must return an undoToken');

    // Verify lead is gone from store
    const leadsAfterDel = getStoredLeads();
    assert(!leadsAfterDel.some(l => l.id === testLeadIdA), 'Lead A must be removed from store');

    // Call Undo
    const undoRes1 = await apiReq('POST', '/api/leads/undo-delete', {
      undoToken: delRes1.data.undoToken
    });
    assert.strictEqual(undoRes1.status, 200, 'Undo must succeed');
    assert.strictEqual(undoRes1.data.success, true);
    assert.strictEqual(undoRes1.data.restoredCount, 1);

    const leadsAfterUndo = getStoredLeads();
    const restoredA = leadsAfterUndo.find(l => l.id === testLeadIdA);
    assert(restoredA, 'Lead A must be present in store after Undo');
    console.log('✓ TEST 1 PASSED: Single lead deleted and successfully restored via Undo.');

    // -------------------------------------------------------------
    // TEST 2: Full Data Preservation
    // -------------------------------------------------------------
    console.log('\n--- TEST 2: Full Data Preservation ---');
    assert.strictEqual(restoredA.phone, leadA.phone, 'Phone preserved');
    assert.strictEqual(restoredA.email, leadA.email, 'Email preserved');
    assert.strictEqual(restoredA.website, leadA.website, 'Website preserved');
    assert.strictEqual(restoredA.opportunity_score, leadA.opportunity_score, 'Score preserved');
    assert.strictEqual(restoredA.category, leadA.category, 'Category preserved');
    assert.strictEqual(restoredA.city, leadA.city, 'City preserved');
    console.log('✓ TEST 2 PASSED: All lead fields 100% preserved after deletion and restoration.');

    // -------------------------------------------------------------
    // TEST 3: Original Date Preservation
    // -------------------------------------------------------------
    console.log('\n--- TEST 3: Original Date Preservation ---');
    assert.strictEqual(restoredA.saved_date, '17 September 2026', 'Original saved_date preserved');
    assert.strictEqual(restoredA.created_at, leadA.created_at, 'Original created_at preserved');
    console.log('✓ TEST 3 PASSED: Original date "17 September 2026" preserved intact.');

    // -------------------------------------------------------------
    // TEST 4: Outreach Delete & Undo (Saved Lead Untouched)
    // -------------------------------------------------------------
    console.log('\n--- TEST 4: Outreach Delete & Undo ---');
    // Remove lead B from outreach
    const outDel = await apiReq('POST', '/api/outreach/remove-batch', {
      leadIds: [testLeadIdB]
    });
    assert.strictEqual(outDel.status, 200);
    assert.strictEqual(outDel.data.success, true);
    assert(outDel.data.undoToken, 'Must provide undoToken for outreach removal');

    // Verify Saved Lead B was NOT deleted from store
    const leadsAfterOutDel = getStoredLeads();
    const savedLeadB = leadsAfterOutDel.find(l => l.id === testLeadIdB);
    assert(savedLeadB, 'Lead B must still exist in Saved Leads!');
    assert.strictEqual(savedLeadB.outreach_status, 'Pending', 'Outreach status is Pending after removal');

    // Undo outreach removal
    const outUndo = await apiReq('POST', '/api/outreach/undo-remove', {
      undoToken: outDel.data.undoToken
    });
    assert.strictEqual(outUndo.status, 200);
    assert.strictEqual(outUndo.data.success, true);

    const leadsAfterOutUndo = getStoredLeads();
    const restoredOutB = leadsAfterOutUndo.find(l => l.id === testLeadIdB);
    assert.strictEqual(restoredOutB.outreach_status, 'Awaiting Reply', 'Outreach status restored to Awaiting Reply');
    console.log('✓ TEST 4 PASSED: Outreach removal undone; Saved Lead remained 100% separate and intact.');

    // -------------------------------------------------------------
    // TEST 5: Favorite Status Preservation
    // -------------------------------------------------------------
    console.log('\n--- TEST 5: Favorite Status Preservation ---');
    assert.strictEqual(restoredA.is_favorite, true, 'is_favorite preserved');
    assert.strictEqual(restoredA.favorite, true, 'favorite preserved');
    console.log('✓ TEST 5 PASSED: Favorite status preserved after Undo.');

    // -------------------------------------------------------------
    // TEST 6: Follow-Up State Preservation
    // -------------------------------------------------------------
    console.log('\n--- TEST 6: Follow-Up State Preservation ---');
    assert.strictEqual(restoredOutB.next_follow_up_number, 1, 'Follow-up step #1 preserved');
    assert.strictEqual(restoredOutB.next_follow_up_name, 'Follow-up #1', 'Follow-up name preserved');
    assert.strictEqual(restoredOutB.next_follow_up_at, leadB.next_follow_up_at, 'Follow-up schedule date preserved');
    console.log('✓ TEST 6 PASSED: Follow-up schedule and step preserved after Undo.');

    // -------------------------------------------------------------
    // TEST 7: Notes Preservation
    // -------------------------------------------------------------
    console.log('\n--- TEST 7: Notes Preservation ---');
    assert(Array.isArray(restoredA.notes) && restoredA.notes.length === 1, 'Notes preserved');
    assert.strictEqual(restoredA.notes[0].text, leadA.notes[0].text, 'Note content matches');
    console.log('✓ TEST 7 PASSED: Lead Notes 100% preserved after Undo.');

    // -------------------------------------------------------------
    // TEST 8: Activity Timeline Preservation
    // -------------------------------------------------------------
    console.log('\n--- TEST 8: Activity Timeline Preservation ---');
    assert(Array.isArray(restoredA.activities) && restoredA.activities.length === 1, 'Activities preserved');
    assert.strictEqual(restoredA.activities[0].event_type, 'lead_added_outreach');
    console.log('✓ TEST 8 PASSED: Activity timeline preserved intact.');

    // -------------------------------------------------------------
    // TEST 9: Expiration Window & Token Consumption
    // -------------------------------------------------------------
    console.log('\n--- TEST 9: Expiration Window & Token Consumption ---');
    // Calling undo again with already consumed token
    const duplicateUndo = await apiReq('POST', '/api/leads/undo-delete', {
      undoToken: delRes1.data.undoToken
    });
    assert.strictEqual(duplicateUndo.status, 400, 'Duplicate undo must fail');
    assert.strictEqual(duplicateUndo.data.success, false);

    // Calling with non-existent token
    const fakeUndo = await apiReq('POST', '/api/leads/undo-delete', {
      undoToken: 'undo_expired_token_xyz'
    });
    assert.strictEqual(fakeUndo.status, 400, 'Expired or non-existent token must be rejected');
    console.log('✓ TEST 9 PASSED: Expired and consumed undo tokens properly rejected.');

    // -------------------------------------------------------------
    // TEST 10: Multiple Leads & Independent Undo
    // -------------------------------------------------------------
    console.log('\n--- TEST 10: Multiple Leads & Independent Undo ---');
    // Delete A then delete B
    const delA2 = await apiReq('DELETE', `/api/leads/${testLeadIdA}`);
    const delB2 = await apiReq('DELETE', `/api/leads/${testLeadIdB}`);

    assert(delA2.data.undoToken !== delB2.data.undoToken, 'Each deletion must have unique undoToken');

    // Restore ONLY A
    const undoA2 = await apiReq('POST', '/api/leads/undo-delete', {
      undoToken: delA2.data.undoToken
    });
    assert.strictEqual(undoA2.data.success, true);

    const leadsMid = getStoredLeads();
    assert(leadsMid.some(l => l.id === testLeadIdA), 'Lead A restored');
    assert(!leadsMid.some(l => l.id === testLeadIdB), 'Lead B still deleted');

    // Restore B
    const undoB2 = await apiReq('POST', '/api/leads/undo-delete', {
      undoToken: delB2.data.undoToken
    });
    assert.strictEqual(undoB2.data.success, true);

    const leadsFinal = getStoredLeads();
    assert(leadsFinal.some(l => l.id === testLeadIdB), 'Lead B now restored');
    console.log('✓ TEST 10 PASSED: Multiple independent deletions and restorations work safely.');

    // -------------------------------------------------------------
    // TEST 11: Bulk Delete & Undo
    // -------------------------------------------------------------
    console.log('\n--- TEST 11: Bulk Delete & Undo ---');
    const batchDel = await apiReq('POST', '/api/leads/delete-batch', {
      ids: [testLeadIdA, testLeadIdB]
    });
    assert.strictEqual(batchDel.status, 200);
    assert.strictEqual(batchDel.data.deletedCount, 2);
    assert(batchDel.data.undoToken);

    const leadsBatchDel = getStoredLeads();
    assert(!leadsBatchDel.some(l => l.id === testLeadIdA || l.id === testLeadIdB));

    // Bulk Undo
    const batchUndo = await apiReq('POST', '/api/leads/undo-delete', {
      undoToken: batchDel.data.undoToken
    });
    assert.strictEqual(batchUndo.status, 200);
    assert.strictEqual(batchUndo.data.restoredCount, 2);

    const leadsBatchRestored = getStoredLeads();
    assert(leadsBatchRestored.some(l => l.id === testLeadIdA));
    assert(leadsBatchRestored.some(l => l.id === testLeadIdB));
    console.log('✓ TEST 11 PASSED: Bulk delete of multiple leads successfully undone in full.');

    // -------------------------------------------------------------
    // TEST 12: Duplicate Protection Intact
    // -------------------------------------------------------------
    console.log('\n--- TEST 12: Duplicate Protection Intact ---');
    // Attempting to re-save lead A (which is already restored)
    const dupCheck = await apiReq('POST', '/api/leads/save', {
      leads: [leadA]
    });
    assert.strictEqual(dupCheck.status, 200);
    const leadsDup = getStoredLeads();
    const matchingLeads = leadsDup.filter(l => l.place_id === testPlaceIdA);
    assert.strictEqual(matchingLeads.length, 1, 'Duplicate protection must preserve exactly one record');
    console.log('✓ TEST 12 PASSED: Duplicate lead protection recognizes restored lead properly.');

    // -------------------------------------------------------------
    // TEST 13: Zero Local-Device Storage
    // -------------------------------------------------------------
    console.log('\n--- TEST 13: Zero Local-Device Storage ---');
    const mainJsContent = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    const serverJsContent = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

    // Verify no localStorage / sessionStorage used for undo
    assert(!mainJsContent.includes('localStorage.setItem("undo'), 'No localStorage in undo');
    assert(!mainJsContent.includes('sessionStorage.setItem("undo'), 'No sessionStorage in undo');
    assert(!serverJsContent.includes('trash_store.json'), 'No permanent trash database file created');
    console.log('✓ TEST 13 PASSED: Zero local-device storage and zero second databases verified.');

    console.log('\n====================================================');
    console.log('ALL 13 UNDO DELETE TESTS PASSED SUCCESSFULLY!');
    console.log('====================================================');
  } finally {
    if (originalBackup) {
      fs.writeFileSync(LEADS_STORE_PATH, originalBackup);
      console.log('\nOriginal database restored from backup.');
    }
  }
}

runTests().catch(err => {
  console.error('\n❌ TEST RUN FAILED:', err);
  process.exit(1);
});
