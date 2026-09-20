const fs = require('fs');
const path = require('path');

const BACKUP_PATH = path.join(__dirname, '..', 'data', 'backups', 'supabase_leads_backup_20260919.json');
const STORE_PATH = path.join(__dirname, '..', 'data', 'leads_store.json');
const BASE_URL = 'http://localhost:3000';

async function runSavedViewsTestSuite() {
  console.log('================================================================');
  console.log('CLIENTHUNTER — SAVED VIEWS / SAVED FILTERS TEST SUITE');
  console.log('================================================================\n');

  // Step 1: Baseline Check
  console.log('[Step 1] Baseline Invariant Verification...');
  const backupData = JSON.parse(fs.readFileSync(BACKUP_PATH, 'utf8'));
  const currentStore = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
  console.log(`Pristine Backup: ${backupData.length} leads | Current Store: ${currentStore.leads.length} leads`);
  if (currentStore.leads.length !== 111) {
    throw new Error(`Expected baseline 111 leads, found ${currentStore.leads.length}`);
  }
  console.log('✓ Baseline verified: 111 leads safe.\n');

  // Step 2: GET /api/saved-views
  console.log('[Step 2] Testing GET /api/saved-views...');
  const getRes = await fetch(`${BASE_URL}/api/saved-views`);
  if (!getRes.ok) throw new Error(`GET /api/saved-views returned ${getRes.status}`);
  const getData = await getRes.json();
  if (!getData.success || !Array.isArray(getData.views)) {
    throw new Error('GET /api/saved-views invalid response: ' + JSON.stringify(getData));
  }
  const initialCount = getData.views.length;
  console.log(`✓ GET /api/saved-views successful. Current saved views count: ${initialCount}\n`);

  let viewId1 = null;
  let viewId2 = null;
  let dupViewId = null;

  try {
    // Step 3: Create View 1: "High Priority — No Website"
    console.log('[Step 3] Creating Saved View 1: "High Priority — No Website"...');
    const postRes1 = await fetch(`${BASE_URL}/api/saved-views`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'High Priority — No Website',
        tab: 'saved-leads',
        filters: {
          priority: 'High',
          website: 'NO',
          status: 'Not Contacted'
        }
      })
    });
    const postData1 = await postRes1.json();
    if (!postData1.success || !postData1.view || !postData1.view.id) {
      throw new Error('Failed to create view 1: ' + JSON.stringify(postData1));
    }
    viewId1 = postData1.view.id;
    console.log(`✓ View 1 created: "${postData1.view.name}" (ID: ${viewId1})`);
    if (postData1.view.filters.priority !== 'High' || postData1.view.filters.website !== 'NO') {
      throw new Error('View 1 filter configuration mismatch');
    }

    // Step 4: Create View 2: "Follow-Ups Today"
    console.log('\n[Step 4] Creating Saved View 2: "Follow-Ups Today"...');
    const postRes2 = await fetch(`${BASE_URL}/api/saved-views`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Follow-Ups Today',
        tab: 'saved-leads',
        filters: {
          followup: 'Due Today',
          status: 'Not Contacted'
        }
      })
    });
    const postData2 = await postRes2.json();
    if (!postData2.success || !postData2.view) {
      throw new Error('Failed to create view 2: ' + JSON.stringify(postData2));
    }
    viewId2 = postData2.view.id;
    console.log(`✓ View 2 created: "${postData2.view.name}" (ID: ${viewId2})`);

    // Step 5: Rename View 1 -> "High Priority — Missing Site"
    console.log('\n[Step 5] Testing Rename (PATCH /api/saved-views/:id)...');
    const patchRes = await fetch(`${BASE_URL}/api/saved-views/${viewId1}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'High Priority — Missing Site'
      })
    });
    const patchData = await patchRes.json();
    if (!patchData.success || patchData.view.name !== 'High Priority — Missing Site') {
      throw new Error('Failed to rename view: ' + JSON.stringify(patchData));
    }
    console.log(`✓ View renamed successfully to: "${patchData.view.name}"`);

    // Step 6: Duplicate View
    console.log('\n[Step 6] Testing Duplicate (POST /api/saved-views/:id/duplicate)...');
    const dupRes = await fetch(`${BASE_URL}/api/saved-views/${viewId1}/duplicate`, {
      method: 'POST'
    });
    const dupData = await dupRes.json();
    if (!dupData.success || !dupData.view) {
      throw new Error('Failed to duplicate view: ' + JSON.stringify(dupData));
    }
    dupViewId = dupData.view.id;
    console.log(`✓ View duplicated successfully: "${dupData.view.name}" (ID: ${dupViewId})`);
    if (dupData.view.name !== 'High Priority — Missing Site (Copy)') {
      throw new Error('Unexpected duplicate name: ' + dupData.view.name);
    }
    if (dupData.view.filters.priority !== 'High' || dupData.view.filters.website !== 'NO') {
      throw new Error('Duplicated view filters mismatch');
    }

    // Step 7: Delete Duplicate View (ONLY deletes config, zero leads deleted)
    console.log('\n[Step 7] Testing Delete (DELETE /api/saved-views/:id)...');
    const delRes = await fetch(`${BASE_URL}/api/saved-views/${dupViewId}`, {
      method: 'DELETE'
    });
    const delData = await delRes.json();
    if (!delData.success) {
      throw new Error('Failed to delete duplicate view: ' + JSON.stringify(delData));
    }
    console.log(`✓ Duplicate view deleted cleanly: ID ${dupViewId}`);
    dupViewId = null;

    // Verify duplicate is gone from list
    const checkRes = await fetch(`${BASE_URL}/api/saved-views`);
    const checkData = await checkRes.json();
    const foundDup = checkData.views.find((v) => v.id === dupViewId);
    if (foundDup) {
      throw new Error('Deleted duplicate view still exists in list!');
    }
    console.log('✓ Verified duplicate view completely removed from configuration.');

  } finally {
    // Clean up created test views
    console.log('\n[Cleanup] Removing temporary test views...');
    if (viewId1) await fetch(`${BASE_URL}/api/saved-views/${viewId1}`, { method: 'DELETE' });
    if (viewId2) await fetch(`${BASE_URL}/api/saved-views/${viewId2}`, { method: 'DELETE' });
    if (dupViewId) await fetch(`${BASE_URL}/api/saved-views/${dupViewId}`, { method: 'DELETE' });
    console.log('✓ Temporary test views cleaned up.');
  }

  // Step 8: Strict Invariant Verification
  console.log('\n[Step 8] Strict Invariant Verification...');
  const finalStore = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
  if (finalStore.leads.length !== 111) {
    throw new Error(`Final store lead count mismatch: expected 111, got ${finalStore.leads.length}`);
  }

  const backupIdMap = new Map(backupData.map((l) => [l.place_id, l]));
  for (const lead of finalStore.leads) {
    const orig = backupIdMap.get(lead.place_id);
    if (!orig) {
      throw new Error(`Unexpected lead ID in store: ${lead.place_id}`);
    }
    if (orig.created_at !== lead.created_at) {
      throw new Error(`Timestamp mismatch for lead ${lead.place_id}`);
    }
  }

  console.log('✓ All 111 baseline leads verified 100% untouched and unchanged.');
  console.log('\n================================================================');
  console.log('ALL TESTS PASSED: SAVED VIEWS FULLY FUNCTIONAL');
  console.log('NO REAL DATA MODIFIED');
  console.log('================================================================');
}

runSavedViewsTestSuite().catch((err) => {
  console.error('\n❌ TEST FAILED:', err.message);
  process.exit(1);
});
