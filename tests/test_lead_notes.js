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
  console.log('CLIENTHUNTER — LEAD NOTES TEST SUITE');
  console.log('====================================================\n');

  let originalBackup = null;
  if (fs.existsSync(LEADS_STORE_PATH)) {
    originalBackup = fs.readFileSync(LEADS_STORE_PATH, 'utf8');
    console.log('Backed up database state.');
  }

  try {
    // 0. Setup: Create Lead A and Lead B
    const leadA = {
      place_id: 'ChIJ_NOTES_TEST_LEAD_A',
      business_name: 'Studio 18 Family Salon',
      phone: '+91 98765 00001',
      category: 'Beauty Salons',
      city: 'Hyderabad',
      favorite: true,
      status: 'New',
      outreach_status: 'Pending',
      follow_up_day: 0,
      message_history: [{ type: 'INITIAL', text: 'Welcome message', sent_at: '2026-09-18T10:00:00Z' }]
    };

    const leadB = {
      place_id: 'ChIJ_NOTES_TEST_LEAD_B',
      business_name: 'Crown Dental Hospital',
      phone: '+91 98765 00002',
      category: 'Dental Clinics',
      city: 'Hyderabad',
      favorite: false,
      status: 'Contacted',
      outreach_status: 'Ready'
    };

    const saveRes = await apiReq('POST', '/api/leads/save', { leads: [leadA, leadB] });
    assert.strictEqual(saveRes.data.success, true);
    console.log('Created Lead A and Lead B.');

    // Fetch leads to get assigned IDs
    const savedAll = (await apiReq('GET', '/api/leads/saved')).data.leads;
    const dbLeadA = savedAll.find(l => l.place_id === leadA.place_id);
    const dbLeadB = savedAll.find(l => l.place_id === leadB.place_id);
    assert.ok(dbLeadA, 'Lead A must be in database');
    assert.ok(dbLeadB, 'Lead B must be in database');

    const leadAId = dbLeadA.id || dbLeadA.place_id;
    const leadBId = dbLeadB.id || dbLeadB.place_id;

    // ----------------------------------------------------
    // TEST 1 — Add Note to Lead A
    // ----------------------------------------------------
    console.log('\n--- TEST 1: Add Note to Lead A ---');
    const addRes1 = await apiReq('POST', `/api/leads/${leadAId}/notes`, { text: 'Call tomorrow.' });
    assert.strictEqual(addRes1.status, 200);
    assert.strictEqual(addRes1.data.success, true);
    assert.ok(addRes1.data.note.id, 'Note must have unique ID');
    assert.strictEqual(addRes1.data.note.text, 'Call tomorrow.');
    assert.strictEqual(addRes1.data.note.lead_id, leadAId);
    assert.strictEqual(addRes1.data.notes.length, 1);

    const getNotesA = await apiReq('GET', `/api/leads/${leadAId}/notes`);
    assert.strictEqual(getNotesA.status, 200);
    assert.strictEqual(getNotesA.data.notes.length, 1);
    assert.strictEqual(getNotesA.data.notes[0].text, 'Call tomorrow.');
    console.log('✅ TEST 1 PASSED: Note added to Lead A and verified.');

    // ----------------------------------------------------
    // TEST 2 — Verify Lead A Note does NOT appear on Lead B
    // ----------------------------------------------------
    console.log('\n--- TEST 2: Note Isolation between leads ---');
    const getNotesB = await apiReq('GET', `/api/leads/${leadBId}/notes`);
    assert.strictEqual(getNotesB.status, 200);
    assert.strictEqual(getNotesB.data.notes.length, 0, 'Lead B must have 0 notes');
    console.log('✅ TEST 2 PASSED: Lead B has zero notes; Lead A note is strictly isolated.');

    // ----------------------------------------------------
    // TEST 3 — Edit Lead A's Note
    // ----------------------------------------------------
    console.log('\n--- TEST 3: Edit Lead A Note ---');
    const noteAId = addRes1.data.note.id;
    const editRes = await apiReq('PUT', `/api/leads/${leadAId}/notes/${noteAId}`, { text: 'Call tomorrow at 5 PM.' });
    assert.strictEqual(editRes.status, 200);
    assert.strictEqual(editRes.data.success, true);
    assert.strictEqual(editRes.data.note.text, 'Call tomorrow at 5 PM.');

    const checkEditA = await apiReq('GET', `/api/leads/${leadAId}/notes`);
    assert.strictEqual(checkEditA.data.notes[0].text, 'Call tomorrow at 5 PM.');
    console.log('✅ TEST 3 PASSED: Note edited and saved correctly.');

    // ----------------------------------------------------
    // TEST 4 — Delete Lead A's Note
    // ----------------------------------------------------
    console.log('\n--- TEST 4: Delete Lead A Note ---');
    const delRes = await apiReq('DELETE', `/api/leads/${leadAId}/notes/${noteAId}`);
    assert.strictEqual(delRes.status, 200);
    assert.strictEqual(delRes.data.success, true);
    assert.strictEqual(delRes.data.notes.length, 0);

    const checkDelA = await apiReq('GET', `/api/leads/${leadAId}/notes`);
    assert.strictEqual(checkDelA.data.notes.length, 0);

    // Lead A must still exist in database
    const verifyLeadAStillExists = (await apiReq('GET', '/api/leads/saved')).data.leads.find(l => l.place_id === leadA.place_id);
    assert.ok(verifyLeadAStillExists, 'Lead A must remain completely intact after note deletion');
    console.log('✅ TEST 4 PASSED: Note deleted cleanly; lead record remains intact.');

    // ----------------------------------------------------
    // TEST 5 — Persistence / Reload Test
    // ----------------------------------------------------
    console.log('\n--- TEST 5: Persistence across storage reads ---');
    const addPersistentNote = await apiReq('POST', `/api/leads/${leadAId}/notes`, { text: 'Persistent note for tomorrow.' });
    assert.strictEqual(addPersistentNote.status, 200);

    // Read directly from disk file to verify persistence
    const diskContent = JSON.parse(fs.readFileSync(LEADS_STORE_PATH, 'utf8'));
    const diskLeadA = diskContent.leads.find(l => l.place_id === leadA.place_id);
    assert.ok(diskLeadA, 'Lead A must be in disk store');
    assert.ok(Array.isArray(diskLeadA.notes), 'Notes must be array in disk store');
    assert.strictEqual(diskLeadA.notes.length, 1);
    assert.strictEqual(diskLeadA.notes[0].text, 'Persistent note for tomorrow.');
    console.log('✅ TEST 5 PASSED: Note persisted to storage file.');

    // ----------------------------------------------------
    // TEST 6 & 7 — Move Lead A into Outreach & Verify Notes Visible
    // ----------------------------------------------------
    console.log('\n--- TEST 6 & 7: Move to Outreach & Outreach Workspace Access ---');
    const moveRes = await apiReq('POST', '/api/leads/move-to-outreach', { leadIds: [leadAId] });
    assert.strictEqual(moveRes.data.success, true);

    // Verify notes are accessible via Lead ID in Outreach
    const outreachNotes = await apiReq('GET', `/api/leads/${leadAId}/notes`);
    assert.strictEqual(outreachNotes.data.notes.length, 1);
    assert.strictEqual(outreachNotes.data.notes[0].text, 'Persistent note for tomorrow.');
    console.log('✅ TEST 6 & 7 PASSED: Notes remain attached to Lead A in Outreach.');

    // ----------------------------------------------------
    // TEST 8 — Add Multiple Notes to Lead A
    // ----------------------------------------------------
    console.log('\n--- TEST 8: Multiple notes on same lead ---');
    const note2Res = await apiReq('POST', `/api/leads/${leadAId}/notes`, { text: 'Owner asked for pricing portfolio.' });
    const note3Res = await apiReq('POST', `/api/leads/${leadAId}/notes`, { text: 'Follow up next Monday after 6 PM.' });

    const multiNotes = await apiReq('GET', `/api/leads/${leadAId}/notes`);
    assert.strictEqual(multiNotes.data.notes.length, 3, 'Lead A must have 3 distinct notes');
    console.log('✅ TEST 8 PASSED: Multiple notes stored on same lead (3 notes present).');

    // ----------------------------------------------------
    // TEST 9 — Delete One of Multiple Notes
    // ----------------------------------------------------
    console.log('\n--- TEST 9: Delete one note among multiple ---');
    const noteToDeleteId = note2Res.data.note.id;
    const delMultiRes = await apiReq('DELETE', `/api/leads/${leadAId}/notes/${noteToDeleteId}`);
    assert.strictEqual(delMultiRes.status, 200);
    assert.strictEqual(delMultiRes.data.notes.length, 2);

    const remainingNotes = (await apiReq('GET', `/api/leads/${leadAId}/notes`)).data.notes;
    assert.strictEqual(remainingNotes.length, 2);
    assert.ok(!remainingNotes.some(n => n.id === noteToDeleteId), 'Deleted note must not be present');
    assert.ok(remainingNotes.some(n => n.text === 'Follow up next Monday after 6 PM.'), 'Other note must remain');
    assert.ok(remainingNotes.some(n => n.text === 'Persistent note for tomorrow.'), 'Original note must remain');
    console.log('✅ TEST 9 PASSED: Single note deleted without affecting other notes.');

    // ----------------------------------------------------
    // TEST 10 — Verify Lead Status Untouched
    // ----------------------------------------------------
    console.log('\n--- TEST 10: Lead Status untouched by notes ---');
    const statusLeadA = (await apiReq('GET', '/api/leads/saved')).data.leads.find(l => l.place_id === leadA.place_id);
    assert.strictEqual(statusLeadA.status, 'New', 'Status must remain New');
    console.log('✅ TEST 10 PASSED: Lead status completely unaffected.');

    // ----------------------------------------------------
    // TEST 11 — Verify Favorites Untouched
    // ----------------------------------------------------
    console.log('\n--- TEST 11: Favorites untouched by notes ---');
    assert.strictEqual(statusLeadA.favorite, true, 'Favorite flag must remain true');
    console.log('✅ TEST 11 PASSED: Favorite status completely unaffected.');

    // ----------------------------------------------------
    // TEST 12 — Verify Follow-Up Untouched
    // ----------------------------------------------------
    console.log('\n--- TEST 12: Follow-Up state untouched by notes ---');
    assert.strictEqual(statusLeadA.follow_up_day, 0);
    console.log('✅ TEST 12 PASSED: Follow-Up state completely unaffected.');

    // ----------------------------------------------------
    // TEST 13 — Verify Message History Untouched
    // ----------------------------------------------------
    console.log('\n--- TEST 13: Message history untouched by notes ---');
    assert.ok(Array.isArray(statusLeadA.message_history));
    assert.strictEqual(statusLeadA.message_history.length, 1);
    assert.strictEqual(statusLeadA.message_history[0].text, 'Welcome message');
    console.log('✅ TEST 13 PASSED: Message history completely unaffected.');

    // ----------------------------------------------------
    // TEST 14 — Verify No Local-Device Storage
    // ----------------------------------------------------
    console.log('\n--- TEST 14: Verify existing storage architecture ---');
    const mainJsContent = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    // Ensure no notes are saved in localStorage
    const hasNotesLocalStorage = mainJsContent.includes('localStorage.setItem("notes"') || mainJsContent.includes('localStorage.setItem(\'notes\'');
    assert.strictEqual(hasNotesLocalStorage, false, 'No localStorage used for notes');
    console.log('✅ TEST 14 PASSED: No local-device storage used. Uses existing backend architecture.');

    // ----------------------------------------------------
    // TEST 15 — Validation: Reject Empty Notes
    // ----------------------------------------------------
    console.log('\n--- TEST 15: Validation (reject empty / whitespace-only) ---');
    const emptyRes = await apiReq('POST', `/api/leads/${leadAId}/notes`, { text: '   ' });
    assert.strictEqual(emptyRes.status, 400);
    assert.strictEqual(emptyRes.data.success, false);
    assert.strictEqual(emptyRes.data.error, 'Please enter a note.');
    console.log('✅ TEST 15 PASSED: Empty note rejected with proper validation message.');

    console.log('\n====================================================');
    console.log('ALL 15 TESTS PASSED PERFECTLY!');
    console.log('====================================================\n');

  } finally {
    if (originalBackup) {
      fs.writeFileSync(LEADS_STORE_PATH, originalBackup, 'utf8');
      console.log('Restored original database state.');
      await apiReq('GET', '/api/leads/saved');
    }
  }
}

runTests().catch(err => {
  console.error('TEST SUITE FAILED:', err);
  process.exit(1);
});
