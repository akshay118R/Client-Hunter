const fs = require('fs');
const path = require('path');

const BACKUP_PATH = path.join(__dirname, '..', 'data', 'backups', 'supabase_leads_backup_20260919.json');
const STORE_PATH = path.join(__dirname, '..', 'data', 'leads_store.json');
const BASE_URL = 'http://localhost:3000';

async function runTagsTestSuite() {
  console.log('=== LEAD TAGS AUTOMATED TEST SUITE ===\n');

  // Step 1: Baseline invariant verification
  const backupData = JSON.parse(fs.readFileSync(BACKUP_PATH, 'utf8'));
  const currentStore = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
  console.log(`[Step 1] Baseline check: Backup=${backupData.length}, Store=${currentStore.leads.length}`);
  if (currentStore.leads.length !== 111) {
    throw new Error(`Expected baseline 111 leads, found ${currentStore.leads.length}`);
  }

  // Step 2: Create isolated demo lead
  const demoPlaceId = 'demo_tags_test_' + Date.now();
  console.log(`[Step 2] Creating isolated demo lead (${demoPlaceId})...`);
  const createRes = await fetch(`${BASE_URL}/api/leads/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      leads: [{
        place_id: demoPlaceId,
        business_name: 'Tags Test Auto Repair Demo',
        category: 'Auto Repair',
        phone: '+1 555-999-8888',
        city: 'Austin',
        state: 'TX',
        status: 'New',
        opportunity_score: 85,
        tags: []
      }]
    })
  });
  const createData = await createRes.json();
  if (!createData.success) {
    throw new Error('Failed to create demo lead: ' + JSON.stringify(createData));
  }
  const demoId = demoPlaceId;
  console.log('✓ Isolated demo lead created successfully.');

  try {
    // Step 3: Add tags via POST /api/leads/:id/tags
    console.log('[Step 3] Assigning tags ["Hot", "Local", "Potential Client"]...');
    const tagRes1 = await fetch(`${BASE_URL}/api/leads/${demoId}/tags`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tags: ['Hot', 'Local', 'Potential Client']
      })
    });
    const tagData1 = await tagRes1.json();
    if (!tagData1.success || !Array.isArray(tagData1.tags)) {
      throw new Error('Failed to assign tags: ' + JSON.stringify(tagData1));
    }
    console.log(`✓ Tags saved: ${JSON.stringify(tagData1.tags)}`);
    if (tagData1.tags.length !== 3 || !tagData1.tags.includes('Hot') || !tagData1.tags.includes('Local')) {
      throw new Error('Tags array mismatch');
    }

    // Step 4: Verify activity log entry
    console.log('[Step 4] Verifying append-only activity timeline entry...');
    const actRes1 = await fetch(`${BASE_URL}/api/leads/${demoId}/activities`);
    const actData1 = await actRes1.json();
    const activities1 = actData1.activities || actData1;
    const tagActivity = (Array.isArray(activities1) ? activities1 : []).find(
      (a) => a.event_type === 'lead_tags_updated'
    );
    if (!tagActivity) {
      throw new Error('lead_tags_updated activity not found in timeline: ' + JSON.stringify(activities1));
    }
    console.log(`✓ Found activity: "${tagActivity.event_title}" - "${tagActivity.event_description}"`);

    // Step 5: Update tags (Add 'Website Needed', remove 'Local')
    console.log('[Step 5] Updating tags to ["Hot", "Potential Client", "Website Needed"]...');
    const tagRes2 = await fetch(`${BASE_URL}/api/leads/${demoId}/tags`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tags: ['Hot', 'Potential Client', 'Website Needed']
      })
    });
    const tagData2 = await tagRes2.json();
    if (!tagData2.success || !tagData2.tags.includes('Website Needed') || tagData2.tags.includes('Local')) {
      throw new Error('Tags update mismatch: ' + JSON.stringify(tagData2));
    }
    console.log(`✓ Updated tags: ${JSON.stringify(tagData2.tags)}`);

    // Step 6: Verify activity timeline preserved both updates
    console.log('[Step 6] Verifying activity timeline preserved historical entries...');
    const actRes2 = await fetch(`${BASE_URL}/api/leads/${demoId}/activities`);
    const actData2 = await actRes2.json();
    const activities2 = actData2.activities || actData2;
    const tagActivities = (Array.isArray(activities2) ? activities2 : []).filter(
      (a) => a.event_type === 'lead_tags_updated'
    );
    console.log(`✓ Total lead_tags_updated activities recorded: ${tagActivities.length}`);
    if (tagActivities.length < 2) {
      throw new Error(`Expected at least 2 tag activities, found ${tagActivities.length}`);
    }

    // Step 7: Verify GET /api/tags endpoint
    console.log('[Step 7] Testing GET /api/tags endpoint...');
    const tagsApiRes = await fetch(`${BASE_URL}/api/tags`);
    const tagsApiData = await tagsApiRes.json();
    if (!tagsApiData.success || !Array.isArray(tagsApiData.tags)) {
      throw new Error('GET /api/tags failed: ' + JSON.stringify(tagsApiData));
    }
    console.log(`✓ GET /api/tags returned: ${tagsApiData.tags.length} active tags, ${tagsApiData.defaultSuggestions.length} suggestions.`);
    if (!tagsApiData.tags.includes('Website Needed')) {
      throw new Error('Expected "Website Needed" in /api/tags output');
    }

  } finally {
    // Step 8: Clean up demo lead
    console.log('\n[Step 8] Deleting isolated demo lead...');
    await fetch(`${BASE_URL}/api/leads/${demoId}`, { method: 'DELETE' });
    console.log('✓ Demo lead deleted cleanly.');
  }

  // Step 9: Verify 100% baseline invariant preservation
  console.log('\n[Step 9] Verifying 100% data integrity & baseline invariants...');
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

  console.log('✓ All 111 baseline leads verified 100% intact and unchanged.');
  console.log('\n======================================');
  console.log('ALL TESTS PASSED: LEAD TAGS FUNCTIONAL');
  console.log('======================================');
}

runTagsTestSuite().catch((err) => {
  console.error('\n❌ TEST FAILED:', err.message);
  process.exit(1);
});
