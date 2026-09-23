const http = require('http');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const assert = require('assert');

const SCRATCH_USER_DATA = path.join(__dirname, '..', 'scratch', 'http_test_env');
const SCRATCH_DATA = path.join(SCRATCH_USER_DATA, 'data');
const SCRATCH_STORE = path.join(SCRATCH_DATA, 'leads_store.json');

if (!fs.existsSync(SCRATCH_DATA)) {
  fs.mkdirSync(SCRATCH_DATA, { recursive: true });
}

// Seed mock store with demo lead
const seedStore = {
  leads: [
    {
      id: 'lead_demo_test',
      place_id: 'place_demo_test',
      business_name: 'demo',
      category: 'Software Testing',
      phone: '+91 99999 11111',
      favorite: true,
      is_favorite: true,
      outreach_status: 'Follow-Up',
      first_message_sent: true,
      main_message_sent_at: '2026-09-20T10:00:00.000Z',
      next_follow_up_at: '2026-09-22T10:00:00.000Z',
      next_follow_up_number: 1,
      next_follow_up_name: 'Follow-Up #1 — Gentle Nudge',
      follow_up_day: 1,
      current_follow_up_number: 0,
      follow_up_paused: true,
      message_history: [
        { type: 'main_message', text: 'Hello' },
        { type: 'follow_up', text: 'Gentle bump' }
      ],
      cold_call: { queued: true, status: 'Called' }
    }
  ],
  searchSessions: [{ sessionId: 'sess_test', query: 'demo' }],
  outreach: [{ id: 'out_1', saved_lead_id: 'lead_demo_test', status: 'Follow-Up' }],
  settings: { profile: { fullName: 'Demo Tester' } }
};
fs.writeFileSync(SCRATCH_STORE, JSON.stringify(seedStore, null, 2), 'utf8');

const TEST_PORT = 3199;

// Spawn server with test environment
const srv = spawn('node', ['server.js'], {
  cwd: path.join(__dirname, '..'),
  env: {
    ...process.env,
    PORT: String(TEST_PORT),
    CLIENTHUNTER_USER_DATA: SCRATCH_USER_DATA,
    DISABLE_BROWSER_OPEN: 'true',
    SUPABASE_URL: '',
    SUPABASE_ANON_KEY: ''
  },
  stdio: ['ignore', 'pipe', 'pipe']
});

srv.stdout.on('data', (d) => {
  // console.log('[SRV STDOUT]', d.toString());
});
srv.stderr.on('data', (d) => {
  // console.error('[SRV STDERR]', d.toString());
});

function postJson(path, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload || {});
    const req = http.request({
      hostname: 'localhost',
      port: TEST_PORT,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, body });
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function run() {
  console.log('Waiting for test server on port', TEST_PORT);
  // Wait up to 15s for server to start
  let connected = false;
  for (let i = 0; i < 50; i++) {
    try {
      await new Promise((res, rej) => {
        const req = http.get(`http://localhost:${TEST_PORT}/api/settings`, (r) => {
          if (r.statusCode === 200) res();
          else rej();
        });
        req.on('error', rej);
        req.setTimeout(500, rej);
      });
      connected = true;
      break;
    } catch (_) {
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  assert(connected, 'Test server failed to start in 15 seconds');
  console.log('✓ Test server connected successfully.');

  // Test 1: Reset cold-call
  console.log('\nTesting POST /api/reset/cold-call...');
  const resCc = await postJson('/api/reset/cold-call');
  assert.strictEqual(resCc.status, 200);
  assert.strictEqual(resCc.data.success, true);
  assert.strictEqual(resCc.data.category, 'cold-call');
  console.log('✓ POST /api/reset/cold-call responded 200 OK with success: true');

  // Verify on disk in scratch store
  const storeAfterCc = JSON.parse(fs.readFileSync(SCRATCH_STORE, 'utf8'));
  assert.strictEqual(storeAfterCc.leads.length, 1, 'Saved lead must remain intact');
  assert.strictEqual(storeAfterCc.leads[0].cold_call.queued, false, 'Cold call queue must be false');
  assert.strictEqual(storeAfterCc.leads[0].favorite, true, 'Favorite must remain untouched');
  console.log('✓ Verified on disk: lead preserved, cold_call cleared, favorite intact.');

  // Test 2: Reset favorites
  console.log('\nTesting POST /api/reset/favorites...');
  const resFav = await postJson('/api/reset/favorites');
  assert.strictEqual(resFav.status, 200);
  assert.strictEqual(resFav.data.success, true);
  assert.strictEqual(resFav.data.category, 'favorites');
  console.log('✓ POST /api/reset/favorites responded 200 OK with success: true');

  const storeAfterFav = JSON.parse(fs.readFileSync(SCRATCH_STORE, 'utf8'));
  assert.strictEqual(storeAfterFav.leads.length, 1, 'Saved lead must remain intact');
  assert.strictEqual(storeAfterFav.leads[0].favorite, false, 'Favorite must be false');
  console.log('✓ Verified on disk: lead preserved, favorite set to false.');

  // Test 3: Reset followup
  console.log('\nTesting POST /api/reset/followup...');
  const resFu = await postJson('/api/reset/followup');
  assert.strictEqual(resFu.status, 200);
  assert.strictEqual(resFu.data.success, true);
  assert.strictEqual(resFu.data.category, 'followup');
  console.log('✓ POST /api/reset/followup responded 200 OK with success: true');

  const storeAfterFu = JSON.parse(fs.readFileSync(SCRATCH_STORE, 'utf8'));
  assert.strictEqual(storeAfterFu.leads.length, 1, 'Saved lead must remain intact');
  assert.strictEqual(storeAfterFu.leads[0].next_follow_up_at, null, 'next_follow_up_at must be null');
  assert.strictEqual(storeAfterFu.leads[0].next_follow_up_number, null, 'next_follow_up_number must be null');
  assert.strictEqual(storeAfterFu.leads[0].follow_up_paused, false, 'follow_up_paused must be false');
  assert.strictEqual(storeAfterFu.leads[0].outreach_status, 'Contacted', 'outreach_status must be Contacted');
  assert.strictEqual(storeAfterFu.leads[0].first_message_sent, true, 'first_message_sent must remain true');
  assert.strictEqual(storeAfterFu.leads[0].main_message_sent_at, '2026-09-20T10:00:00.000Z', 'main_message_sent_at must remain intact');
  assert.strictEqual(storeAfterFu.leads[0].message_history.length, 1, 'Follow-up messages must be removed');
  assert.strictEqual(storeAfterFu.leads[0].message_history[0].type, 'main_message', 'Main message must be preserved');
  assert.strictEqual(storeAfterFu.outreach[0].status, 'Contacted', 'outreach tracking status must be updated to Contacted');
  console.log('✓ Verified on disk: lead preserved, follow-up fields cleared, outreach message intact.');

  // Test 4: Invalid category rejected
  console.log('\nTesting POST /api/reset/invalid-cat...');
  const resInv = await postJson('/api/reset/invalid-cat');
  assert.strictEqual(resInv.status, 400);
  assert.strictEqual(resInv.data.success, false);
  console.log('✓ POST /api/reset/invalid-cat correctly returned 400 Bad Request');

  console.log('\n======================================================');
  console.log('ALL HTTP SERVER DATA RESET TESTS PASSED WITH SUCCESS');
  console.log('======================================================');
}

run()
  .catch((err) => {
    console.error('Test failed:', err);
    process.exitCode = 1;
  })
  .finally(() => {
    srv.kill('SIGTERM');
    try {
      fs.rmSync(SCRATCH_USER_DATA, { recursive: true, force: true });
    } catch (_) {}
  });
