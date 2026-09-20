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
  console.log('CLIENTHUNTER — OUTREACH ACTIVITY TIMELINE TEST SUITE');
  console.log('====================================================\n');

  let originalBackup = null;
  if (fs.existsSync(LEADS_STORE_PATH)) {
    originalBackup = fs.readFileSync(LEADS_STORE_PATH, 'utf8');
    console.log('Backed up database state.');
  }

  try {
    // 0. Setup: Create Lead A and Lead B
    const leadA = {
      place_id: 'ChIJ_TIMELINE_LEAD_A_' + Date.now(),
      business_name: 'Studio 18 Family Salon',
      phone: '+91 98765 43210',
      category: 'Beauty Salons',
      city: 'Hyderabad',
      state: 'Telangana',
      address: 'Road No 36, Jubilee Hills',
      website: 'https://studio18salon.com',
      opportunity_score: 85,
      favorite: true,
      status: 'New',
      outreach_status: 'Pending'
    };

    const leadB = {
      place_id: 'ChIJ_TIMELINE_LEAD_B_' + Date.now(),
      business_name: 'Crown Dental Hospital',
      phone: '+91 98765 11223',
      category: 'Dental Clinics',
      city: 'Hyderabad',
      state: 'Telangana',
      address: 'Banjara Hills',
      website: null,
      opportunity_score: 60,
      favorite: false,
      status: 'New',
      outreach_status: 'Pending'
    };

    const saveRes = await apiReq('POST', '/api/leads/save', { leads: [leadA, leadB] });
    assert.strictEqual(saveRes.data.success, true);
    console.log('✓ Created Lead A and Lead B.');

    const savedAll = (await apiReq('GET', '/api/leads/saved')).data.leads;
    const dbLeadA = savedAll.find(l => l.place_id === leadA.place_id);
    const dbLeadB = savedAll.find(l => l.place_id === leadB.place_id);
    assert.ok(dbLeadA, 'Lead A must be in database');
    assert.ok(dbLeadB, 'Lead B must be in database');

    const leadAId = dbLeadA.id || dbLeadA.place_id;
    const leadBId = dbLeadB.id || dbLeadB.place_id;

    // ----------------------------------------------------
    // TEST 1 — Add to Outreach
    // ----------------------------------------------------
    console.log('\n--- TEST 1: Add to Outreach ---');
    const moveRes = await apiReq('POST', '/api/leads/move-to-outreach', { leadIds: [leadAId] });
    assert.strictEqual(moveRes.data.success, true);

    const actRes1 = await apiReq('GET', `/api/leads/${leadAId}/activities`);
    assert.strictEqual(actRes1.status, 200);
    assert.strictEqual(actRes1.data.success, true);
    const addedActs = actRes1.data.activities.filter(a => a.event_type === 'lead_added_outreach');
    assert.strictEqual(addedActs.length, 1, 'Added to Outreach must appear exactly once');
    assert.strictEqual(addedActs[0].event_title, 'Added to Outreach');
    assert.strictEqual(addedActs[0].lead_id, leadAId);
    console.log('✓ TEST 1 PASSED: Added to Outreach appears exactly once.');

    // ----------------------------------------------------
    // TEST 2 — Open WhatsApp
    // ----------------------------------------------------
    console.log('\n--- TEST 2: Open WhatsApp ---');
    const waOpenRes = await apiReq('POST', `/api/leads/${leadAId}/activities`, {
      event_type: 'whatsapp_opened',
      event_title: 'WhatsApp Opened',
      event_description: 'WhatsApp opened with generated message',
      metadata: { channel: 'WhatsApp', message_preview: 'Hi Studio 18 Family Salon!' }
    });
    assert.strictEqual(waOpenRes.data.success, true);
    const actRes2 = await apiReq('GET', `/api/leads/${leadAId}/activities`);
    const waActs = actRes2.data.activities.filter(a => a.event_type === 'whatsapp_opened');
    assert.strictEqual(waActs.length, 1, 'WhatsApp Opened must appear in timeline');
    assert.strictEqual(waActs[0].event_title, 'WhatsApp Opened');
    console.log('✓ TEST 2 PASSED: WhatsApp Opened appears.');

    // ----------------------------------------------------
    // TEST 3 — Confirm Message Sent
    // ----------------------------------------------------
    console.log('\n--- TEST 3: Confirm Message Sent ---');
    const sentRes = await apiReq('POST', '/api/outreach/mark-sent', {
      leadId: leadAId,
      messageText: 'Hi Studio 18 Family Salon! I came across your business...'
    });
    assert.strictEqual(sentRes.data.success, true);
    const actRes3 = await apiReq('GET', `/api/leads/${leadAId}/activities`);
    const sentActs = actRes3.data.activities.filter(a => a.event_type === 'message_sent');
    assert.strictEqual(sentActs.length, 1, 'Message Sent appears exactly once');
    assert.strictEqual(sentActs[0].event_title, 'Message Sent');
    console.log('✓ TEST 3 PASSED: Message Sent appears exactly once.');

    // ----------------------------------------------------
    // TEST 4 — Keyboard shortcut (1 -> Message Sent idempotency)
    // ----------------------------------------------------
    console.log('\n--- TEST 4: Keyboard Shortcut (1 -> Message Sent) ---');
    // Invoking the same message send within debounce / idempotency guard
    const sentShortcutRes = await apiReq('POST', '/api/outreach/mark-sent', {
      leadId: leadAId,
      messageText: 'Hi Studio 18 Family Salon! I came across your business...'
    });
    const actRes4 = await apiReq('GET', `/api/leads/${leadAId}/activities`);
    const sentActs4 = actRes4.data.activities.filter(a => a.event_type === 'message_sent');
    assert.strictEqual(sentActs4.length, 1, 'Message Sent must not duplicate from shortcut trigger');
    console.log('✓ TEST 4 PASSED: Keyboard shortcut 1 creates exactly ONE event.');

    // ----------------------------------------------------
    // TEST 5 — Not Sent (2 -> Message Not Sent)
    // ----------------------------------------------------
    console.log('\n--- TEST 5: Not Sent (2 -> Message Not Sent) ---');
    const notSentRes = await apiReq('POST', `/api/leads/${leadAId}/activities`, {
      event_type: 'message_not_sent',
      event_title: 'Message Not Sent',
      event_description: 'User confirmed that the message was not sent.'
    });
    assert.strictEqual(notSentRes.data.success, true);
    const actRes5 = await apiReq('GET', `/api/leads/${leadAId}/activities`);
    const notSentActs = actRes5.data.activities.filter(a => a.event_type === 'message_not_sent');
    assert.strictEqual(notSentActs.length, 1, 'Message Not Sent appears exactly once');
    console.log('✓ TEST 5 PASSED: Message Not Sent appears exactly once.');

    // ----------------------------------------------------
    // TEST 6 — Not on WhatsApp (3 -> Not on WhatsApp)
    // ----------------------------------------------------
    console.log('\n--- TEST 6: Not on WhatsApp (3 -> Not on WhatsApp) ---');
    const notOnWaRes = await apiReq('POST', `/api/leads/${leadAId}/activities`, {
      event_type: 'not_on_whatsapp',
      event_title: 'Not on WhatsApp',
      event_description: 'Phone number confirmed as not registered on WhatsApp.'
    });
    assert.strictEqual(notOnWaRes.data.success, true);
    const actRes6 = await apiReq('GET', `/api/leads/${leadAId}/activities`);
    const notOnWaActs = actRes6.data.activities.filter(a => a.event_type === 'not_on_whatsapp');
    assert.strictEqual(notOnWaActs.length, 1, 'Not on WhatsApp appears exactly once');
    console.log('✓ TEST 6 PASSED: Not on WhatsApp appears exactly once.');

    // ----------------------------------------------------
    // TEST 7 — Follow-up due
    // ----------------------------------------------------
    console.log('\n--- TEST 7: Follow-up due ---');
    // Set next_follow_up_at in the past to simulate due state
    const storeObj = JSON.parse(fs.readFileSync(LEADS_STORE_PATH, 'utf8'));
    const targetLead = storeObj.leads.find(l => l.id === leadAId || l.place_id === leadA.place_id);
    assert.ok(targetLead);
    targetLead.outreach_status = 'Follow-Up';
    targetLead.next_follow_up_number = 1;
    targetLead.next_follow_up_at = new Date(Date.now() - 3600000).toISOString(); // 1 hour ago
    fs.writeFileSync(LEADS_STORE_PATH, JSON.stringify(storeObj, null, 2), 'utf8');

    const actRes7 = await apiReq('GET', `/api/leads/${leadAId}/activities`);
    const fuDueActs = actRes7.data.activities.filter(a => a.event_type === 'followup_due');
    assert.ok(fuDueActs.length >= 1, 'Follow-up #1 Due must appear in activities');
    assert.strictEqual(fuDueActs[0].event_title, 'Follow-up #1 Due');
    console.log('✓ TEST 7 PASSED: Follow-up #1 Due appears.');

    // ----------------------------------------------------
    // TEST 8 — Follow-up sent
    // ----------------------------------------------------
    console.log('\n--- TEST 8: Follow-up sent ---');
    const fuSentRes = await apiReq('POST', '/api/outreach/mark-followup-sent', {
      leadId: leadAId,
      messageText: 'Follow-up #1: Just checking in!',
      step: 1,
      bypassScheduleCheck: true
    });
    assert.strictEqual(fuSentRes.data.success, true);
    const actRes8 = await apiReq('GET', `/api/leads/${leadAId}/activities`);
    const fuSentActs = actRes8.data.activities.filter(a => a.event_type === 'followup_sent' && String(a.metadata?.step) === '1');
    assert.strictEqual(fuSentActs.length, 1, 'Follow-up #1 Sent appears');
    assert.strictEqual(fuSentActs[0].event_title, 'Follow-up #1 Sent');
    console.log('✓ TEST 8 PASSED: Follow-up #1 Sent appears.');

    // ----------------------------------------------------
    // TEST 9 — Multiple follow-ups
    // ----------------------------------------------------
    console.log('\n--- TEST 9: Multiple follow-ups sequence ---');
    const fu2Res = await apiReq('POST', '/api/outreach/mark-followup-sent', {
      leadId: leadAId,
      messageText: 'Follow-up #2: Thought you might like this sample portfolio.',
      step: 2,
      bypassScheduleCheck: true
    });
    assert.strictEqual(fu2Res.data.success, true);
    const fu3Res = await apiReq('POST', '/api/outreach/mark-followup-sent', {
      leadId: leadAId,
      messageText: 'Follow-up #3: Value proposition update.',
      step: 3,
      bypassScheduleCheck: true
    });
    assert.strictEqual(fu3Res.data.success, true);

    const actRes9 = await apiReq('GET', `/api/leads/${leadAId}/activities`);
    const activities = actRes9.data.activities;
    const fu1Idx = activities.findIndex(a => a.event_type === 'followup_sent' && String(a.metadata?.step) === '1');
    const fu2Idx = activities.findIndex(a => a.event_type === 'followup_sent' && String(a.metadata?.step) === '2');
    const fu3Idx = activities.findIndex(a => a.event_type === 'followup_sent' && String(a.metadata?.step) === '3');

    assert.ok(fu1Idx !== -1, 'Follow-up 1 must be present');
    assert.ok(fu2Idx !== -1, 'Follow-up 2 must be present');
    assert.ok(fu3Idx !== -1, 'Follow-up 3 must be present');
    // Reverse chronological order: FU 3 comes first (lower index), then FU 2, then FU 1
    assert.ok(fu3Idx <= fu2Idx, 'FU3 should be newer or equal to FU2');
    assert.ok(fu2Idx <= fu1Idx, 'FU2 should be newer or equal to FU1');
    console.log('✓ TEST 9 PASSED: Multiple follow-ups appear chronologically (newest first).');

    // ----------------------------------------------------
    // TEST 10 — Lead separation
    // ----------------------------------------------------
    console.log('\n--- TEST 10: Lead separation ---');
    const actResLeadB = await apiReq('GET', `/api/leads/${leadBId}/activities`);
    assert.strictEqual(actResLeadB.data.activities.length, 0, 'Lead B must have NO activity from Lead A');
    console.log('✓ TEST 10 PASSED: Lead A activities do NOT appear on Lead B.');

    // ----------------------------------------------------
    // TEST 11 — Restart / Persistent Storage
    // ----------------------------------------------------
    console.log('\n--- TEST 11: Restart / Persistence ---');
    const diskStore = JSON.parse(fs.readFileSync(LEADS_STORE_PATH, 'utf8'));
    const diskLeadA = diskStore.leads.find(l => l.id === leadAId || l.place_id === leadA.place_id);
    assert.ok(diskLeadA, 'Lead A must be on disk');
    assert.ok(Array.isArray(diskLeadA.activities), 'Activities array must be persisted on disk');
    assert.ok(diskLeadA.activities.length >= 4, 'Activities must be stored on disk');
    console.log(`✓ TEST 11 PASSED: ${diskLeadA.activities.length} activities persisted on disk.`);

    // ----------------------------------------------------
    // TEST 12 — Existing lead information untouched
    // ----------------------------------------------------
    console.log('\n--- TEST 12: Existing lead information untouched ---');
    const fetchedLeadA = (await apiReq('GET', '/api/leads/saved')).data.leads.find(l => l.place_id === leadA.place_id);
    assert.strictEqual(fetchedLeadA.business_name, leadA.business_name);
    assert.strictEqual(fetchedLeadA.phone, leadA.phone);
    assert.strictEqual(fetchedLeadA.category, leadA.category);
    assert.strictEqual(fetchedLeadA.city, leadA.city);
    assert.strictEqual(fetchedLeadA.state, leadA.state);
    assert.strictEqual(fetchedLeadA.address, leadA.address);
    assert.strictEqual(fetchedLeadA.website, leadA.website);
    assert.strictEqual(fetchedLeadA.opportunity_score, leadA.opportunity_score);
    assert.ok(fetchedLeadA.created_at, 'created_at must be preserved');
    console.log('✓ TEST 12 PASSED: All existing lead attributes remain 100% intact.');

    // ----------------------------------------------------
    // TEST 13 — Saved Lead separation on removal from outreach
    // ----------------------------------------------------
    console.log('\n--- TEST 13: Saved Lead separation on removal from outreach ---');
    const removeRes = await apiReq('POST', '/api/outreach/remove-batch', { leadIds: [leadAId] });
    assert.strictEqual(removeRes.data.success, true);

    const savedAfterRemove = (await apiReq('GET', '/api/leads/saved')).data.leads;
    const stillSavedA = savedAfterRemove.find(l => l.place_id === leadA.place_id);
    assert.ok(stillSavedA, 'Lead A must STILL exist in Saved Leads after removal from Outreach');
    assert.strictEqual(stillSavedA.outreach_status, 'Pending', 'Outreach status set to Pending');
    console.log('✓ TEST 13 PASSED: Removing lead from Outreach does NOT delete the Saved Lead.');

    // ----------------------------------------------------
    // TEST 14 — Duplicate event protection
    // ----------------------------------------------------
    console.log('\n--- TEST 14: Duplicate event protection ---');
    const dupRes1 = await apiReq('POST', `/api/leads/${leadAId}/activities`, {
      event_type: 'whatsapp_opened',
      event_title: 'WhatsApp Opened',
      event_description: 'Rapid click 1'
    });
    const dupRes2 = await apiReq('POST', `/api/leads/${leadAId}/activities`, {
      event_type: 'whatsapp_opened',
      event_title: 'WhatsApp Opened',
      event_description: 'Rapid click 2'
    });
    const actRes14 = await apiReq('GET', `/api/leads/${leadAId}/activities`);
    const waTotal = actRes14.data.activities.filter(a => a.event_type === 'whatsapp_opened');
    // Backend debounce prevents duplicate rapid clicks within 3 seconds
    assert.strictEqual(waTotal.length, 1, 'Only one activity record produced for rapid clicks');
    console.log('✓ TEST 14 PASSED: Rapid duplicate clicks produce exactly one activity entry.');

    // ----------------------------------------------------
    // TEST 15 — Existing History page still works
    // ----------------------------------------------------
    console.log('\n--- TEST 15: Existing History page still works ---');
    const histRes = await apiReq('GET', '/api/history');
    assert.strictEqual(histRes.status, 200);
    assert.ok(Array.isArray(histRes.data.history), 'History array must be accessible');
    console.log('✓ TEST 15 PASSED: Existing search History architecture intact and unaffected.');

    console.log('\n====================================================');
    console.log('ALL 15 TESTS PASSED SUCCESSFULLY!');
    console.log('====================================================');
  } finally {
    if (originalBackup) {
      fs.writeFileSync(LEADS_STORE_PATH, originalBackup, 'utf8');
      console.log('\nRestored original database backup.');
    }
  }
}

runTests().catch((err) => {
  console.error('\n❌ TEST RUN FAILED:', err);
  process.exit(1);
});
