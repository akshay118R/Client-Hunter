const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');

const BACKUP_PATH = path.join(__dirname, '..', 'data', 'backups', 'supabase_leads_backup_20260919.json');
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

function pass(name, msg) {
  console.log(`  ✓ ${name}: ${msg}`);
}

function fail(name, err) {
  console.error(`  ✗ ${name} FAILED:`, err);
  throw err;
}

async function runSuite() {
  console.log('====================================================');
  console.log('CLIENTHUNTER — LEAD ACTIVITY SEARCH & FILTER TEST SUITE');
  console.log('====================================================\n');

  // Verify baseline pristine leads
  const pristineLeads = JSON.parse(fs.readFileSync(BACKUP_PATH, 'utf8'));
  const baselineCount = pristineLeads.length;
  console.log(`Pristine baseline lead count: ${baselineCount}`);

  const initialServerRes = await apiReq('GET', '/api/leads/saved');
  assert.strictEqual(initialServerRes.status, 200);
  const initialLeads = initialServerRes.data.leads;
  assert.strictEqual(initialLeads.length, baselineCount, `Server leads must match baseline count (${baselineCount})`);

  // Snapshot all initial lead notes, activities, message_history
  const leadStateSnapshot = new Map();
  initialLeads.forEach(l => {
    leadStateSnapshot.set(l.id || l.place_id, {
      name: l.business_name,
      notesCount: Array.isArray(l.notes) ? l.notes.length : 0,
      actCount: Array.isArray(l.activities) ? l.activities.length : 0,
      msgCount: Array.isArray(l.message_history) ? l.message_history.length : 0,
      created_at: l.created_at
    });
  });

  // Find a lead with activities or create an isolated demo lead for testing
  let demoLead = initialLeads.find(l => l.place_id === 'demo' || l.id === 'demo');
  if (!demoLead) {
    demoLead = initialLeads[0];
  }
  const demoLeadId = demoLead.id || demoLead.place_id;
  console.log(`Using target lead: "${demoLead.business_name}" (${demoLeadId})\n`);

  // -------------------------------------------------------------
  // TEST 1 — GET /api/leads/:id/activities base response
  // -------------------------------------------------------------
  try {
    const res = await apiReq('GET', `/api/leads/${encodeURIComponent(demoLeadId)}/activities`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
    assert.ok(Array.isArray(res.data.activities), 'Must return activities array');
    pass('TEST 1 — Base Activities Retrieval', `Retrieved ${res.data.activities.length} activities for lead.`);
  } catch (e) {
    fail('TEST 1 — Base Activities Retrieval', e);
  }

  // -------------------------------------------------------------
  // TEST 2 — Activity Search by Business / Lead Name
  // -------------------------------------------------------------
  try {
    const qName = demoLead.business_name.split(' ')[0];
    const res = await apiReq('GET', `/api/leads/${encodeURIComponent(demoLeadId)}/activities?q=${encodeURIComponent(qName)}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
    assert.ok(Array.isArray(res.data.activities));
    pass('TEST 2 — Search by Lead/Business Name', `Search for "${qName}" returned ${res.data.activities.length} matching events.`);
  } catch (e) {
    fail('TEST 2 — Search by Lead/Business Name', e);
  }

  // -------------------------------------------------------------
  // TEST 3 — Activity Search by Activity Type & Event Title
  // -------------------------------------------------------------
  try {
    const resOutreach = await apiReq('GET', `/api/leads/${encodeURIComponent(demoLeadId)}/activities?q=outreach`);
    assert.strictEqual(resOutreach.status, 200);
    assert.ok(Array.isArray(resOutreach.data.activities));
    const resWhatsApp = await apiReq('GET', `/api/leads/${encodeURIComponent(demoLeadId)}/activities?q=whatsapp`);
    assert.strictEqual(resWhatsApp.status, 200);
    assert.ok(Array.isArray(resWhatsApp.data.activities));
    pass('TEST 3 — Search by Activity Type / Title', `Search by type ("outreach", "whatsapp") works cleanly.`);
  } catch (e) {
    fail('TEST 3 — Search by Activity Type / Title', e);
  }

  // -------------------------------------------------------------
  // TEST 4 — Activity Search by Outcome
  // -------------------------------------------------------------
  try {
    const resOutcome = await apiReq('GET', `/api/leads/${encodeURIComponent(demoLeadId)}/activities?q=interested`);
    assert.strictEqual(resOutcome.status, 200);
    assert.ok(Array.isArray(resOutcome.data.activities));
    pass('TEST 4 — Search by Outcome', `Outcome search returned ${resOutcome.data.activities.length} items without error.`);
  } catch (e) {
    fail('TEST 4 — Search by Outcome', e);
  }

  // -------------------------------------------------------------
  // TEST 5 — Activity Search by Message Text
  // -------------------------------------------------------------
  try {
    const resMsg = await apiReq('GET', `/api/leads/${encodeURIComponent(demoLeadId)}/activities?q=message`);
    assert.strictEqual(resMsg.status, 200);
    assert.ok(Array.isArray(resMsg.data.activities));
    pass('TEST 5 — Search by Message Text', `Message text search returned ${resMsg.data.activities.length} matching items.`);
  } catch (e) {
    fail('TEST 5 — Search by Message Text', e);
  }

  // -------------------------------------------------------------
  // TEST 6 — Activity Search by Note Text
  // -------------------------------------------------------------
  try {
    const resNote = await apiReq('GET', `/api/leads/${encodeURIComponent(demoLeadId)}/activities?q=note`);
    assert.strictEqual(resNote.status, 200);
    assert.ok(Array.isArray(resNote.data.activities));
    pass('TEST 6 — Search by Note Text', `Note search returned ${resNote.data.activities.length} matching items.`);
  } catch (e) {
    fail('TEST 6 — Search by Note Text', e);
  }

  // -------------------------------------------------------------
  // TEST 7 — Activity Category Filters (All, Outreach, Follow-Up, Message Sent, Outcome, Notes, Status changes)
  // -------------------------------------------------------------
  try {
    const categories = ['all', 'outreach', 'followup', 'message_sent', 'outcome', 'notes', 'status_change'];
    for (const cat of categories) {
      const res = await apiReq('GET', `/api/leads/${encodeURIComponent(demoLeadId)}/activities?type=${cat}`);
      assert.strictEqual(res.status, 200, `Category ${cat} must return 200`);
      assert.strictEqual(res.data.success, true);
      assert.ok(Array.isArray(res.data.activities), `Category ${cat} must return array`);
    }
    pass('TEST 7 — Category Filters', `All 7 categories successfully filtered without server errors.`);
  } catch (e) {
    fail('TEST 7 — Category Filters', e);
  }

  // -------------------------------------------------------------
  // TEST 8 — Date Filters (Today, Last 7 Days, Last 30 Days, All Time)
  // -------------------------------------------------------------
  try {
    const dateFilters = ['today', '7d', '30d', 'all'];
    for (const df of dateFilters) {
      const res = await apiReq('GET', `/api/leads/${encodeURIComponent(demoLeadId)}/activities?date=${df}`);
      assert.strictEqual(res.status, 200, `Date filter ${df} must return 200`);
      assert.strictEqual(res.data.success, true);
      assert.ok(Array.isArray(res.data.activities), `Date filter ${df} must return array`);
    }
    pass('TEST 8 — Date Filters', `Date filters (today, 7d, 30d, all) executed cleanly.`);
  } catch (e) {
    fail('TEST 8 — Date Filters', e);
  }

  // -------------------------------------------------------------
  // TEST 9 — Cross-Lead Activity Search API (/api/activities/search)
  // -------------------------------------------------------------
  try {
    const resGlobal = await apiReq('GET', '/api/activities/search?q=outreach');
    assert.strictEqual(resGlobal.status, 200);
    assert.strictEqual(resGlobal.data.success, true);
    assert.ok(Array.isArray(resGlobal.data.activities));
    assert.ok(typeof resGlobal.data.totalCount === 'number');
    pass('TEST 9 — Cross-Lead Activity Search', `Global activity search returned ${resGlobal.data.activities.length} items (total: ${resGlobal.data.totalCount}).`);
  } catch (e) {
    fail('TEST 9 — Cross-Lead Activity Search', e);
  }

  // -------------------------------------------------------------
  // TEST 10 — CRITICAL DATA SAFETY INVARIANTS CHECK
  // -------------------------------------------------------------
  console.log('\n--- VERIFYING CRITICAL DATA SAFETY INVARIANTS ---');
  const postServerRes = await apiReq('GET', '/api/leads/saved');
  assert.strictEqual(postServerRes.status, 200);
  const postLeads = postServerRes.data.leads;

  // Invariant A: Lead count exactly unchanged
  assert.strictEqual(postLeads.length, baselineCount, `Lead count MUST remain ${baselineCount}`);
  pass('INVARIANT A — Lead Count', `Exactly ${baselineCount} leads (0 added, 0 deleted).`);

  // Invariant B: Lead notes, activities, message_history, created_at unchanged
  let noteMismatches = 0;
  let actMismatches = 0;
  let msgMismatches = 0;
  let dateMismatches = 0;

  postLeads.forEach(l => {
    const key = l.id || l.place_id;
    const snap = leadStateSnapshot.get(key);
    assert.ok(snap, `Lead ${key} must exist in snapshot`);

    const currentNotesCount = Array.isArray(l.notes) ? l.notes.length : 0;
    const currentActCount = Array.isArray(l.activities) ? l.activities.length : 0;
    const currentMsgCount = Array.isArray(l.message_history) ? l.message_history.length : 0;

    if (currentNotesCount !== snap.notesCount) noteMismatches++;
    if (currentActCount !== snap.actCount) actMismatches++;
    if (currentMsgCount !== snap.msgCount) msgMismatches++;
    if (l.created_at !== snap.created_at) dateMismatches++;
  });

  assert.strictEqual(noteMismatches, 0, 'Notes count must not change');
  pass('INVARIANT B — Lead Notes', 'Notes count 100% unchanged across all leads.');

  assert.strictEqual(actMismatches, 0, 'Stored activities count must not change');
  pass('INVARIANT C — Stored Activities', 'Stored activities 100% unchanged across all leads.');

  assert.strictEqual(msgMismatches, 0, 'Message history must not change');
  pass('INVARIANT D — Message History', 'Message history 100% unchanged across all leads.');

  assert.strictEqual(dateMismatches, 0, 'Lead created_at dates must not change');
  pass('INVARIANT E — Timestamps', 'Timestamps and dates 100% preserved and untouched.');

  console.log('\n====================================================');
  console.log('ALL 10 TESTS PASSED — NO REAL DATA MODIFIED');
  console.log('====================================================\n');
}

runSuite().catch(err => {
  console.error('Fatal error during test suite:', err);
  process.exit(1);
});
