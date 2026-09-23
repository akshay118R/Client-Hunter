/**
 * Comprehensive Automated Test Suite for Cold Call Backup & Export Capabilities
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const SCRATCH_USER_DATA = path.join(__dirname, '..', 'scratch', 'test_cc_backup_env');
const SCRATCH_STORE_DIR = path.join(SCRATCH_USER_DATA, 'data');
const SCRATCH_STORE = path.join(SCRATCH_STORE_DIR, 'leads_store.json');

fs.rmSync(SCRATCH_USER_DATA, { recursive: true, force: true });
fs.mkdirSync(SCRATCH_STORE_DIR, { recursive: true });

const seedStore = {
  leads: [
    {
      id: 'lead_cc_1',
      business_name: 'Alpha Dental Care',
      category: 'Dentist',
      phone: '+1 555-123-4567',
      is_favorite: true,
      cold_call: {
        queued: true,
        status: 'Called',
        outcome: 'Interested',
        last_call_at: new Date().toISOString(),
        callback_at: null,
        notes: 'Requested product brochure and pricing'
      },
      activities: [
        {
          activity_id: 'act_cc_1',
          event_type: 'cold_call',
          event_title: 'Cold Call - Interested',
          event_description: 'Alpha Dental Care: Outcome Interested',
          created_at: new Date().toISOString()
        }
      ]
    },
    {
      id: 'lead_cc_2',
      business_name: 'Beta Legal Group',
      category: 'Lawyer',
      phone: '+1 555-987-6543',
      cold_call: {
        queued: true,
        status: 'Not Called',
        outcome: null,
        notes: ''
      }
    },
    {
      id: 'lead_plain',
      business_name: 'Gamma HVAC Service',
      category: 'HVAC',
      cold_call: {
        queued: false,
        status: 'Not Called',
        outcome: null
      }
    }
  ],
  searchSessions: [{ sessionId: 'sess_1', query: 'Dentist in Seattle' }],
  outreach: [],
  settings: { profile: { fullName: 'Tester' }, services: [{ name: 'SEO' }] }
};
fs.writeFileSync(SCRATCH_STORE, JSON.stringify(seedStore, null, 2), 'utf8');

const TEST_PORT = 3288;

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

function requestHttp(method, reqPath, payload = null) {
  return new Promise((resolve, reject) => {
    const data = payload ? JSON.stringify(payload) : null;
    const req = http.request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: reqPath,
      method,
      headers: {
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {})
      }
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, data: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, body });
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function run() {
  console.log('Starting Cold Call Backup test suite on port', TEST_PORT);

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
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  assert(connected, 'Server failed to start');
  console.log('✓ Connected to test server.');

  // Test 1: GET /api/coldcall/export
  console.log('\n--- Test 1: GET /api/coldcall/export ---');
  const ccExport = await requestHttp('GET', '/api/coldcall/export');
  assert.strictEqual(ccExport.status, 200);
  assert.strictEqual(ccExport.data.source, 'ClientHunter Cold Call Backup');
  assert.strictEqual(ccExport.data.totalQueue, 2);
  assert.strictEqual(ccExport.data.leads.length, 2);
  assert(ccExport.data.history.length >= 1, 'Should include cold call history');
  console.log('✓ GET /api/coldcall/export returned valid JSON backup with 2 queued leads and call history.');

  // Test 2: POST /api/backup/create
  console.log('\n--- Test 2: POST /api/backup/create ---');
  const createRes = await requestHttp('POST', '/api/backup/create');
  assert.strictEqual(createRes.status, 200);
  assert.strictEqual(createRes.data.success, true);
  assert.strictEqual(createRes.data.metadata.coldCallCount, 2);
  console.log('✓ POST /api/backup/create returned metadata with coldCallCount = 2.');

  // Test 3: POST /api/backup/validate
  console.log('\n--- Test 3: POST /api/backup/validate ---');
  const backupPayload = createRes.data.backup;
  const valRes = await requestHttp('POST', '/api/backup/validate', { backupData: backupPayload });
  assert.strictEqual(valRes.status, 200);
  assert.strictEqual(valRes.data.success, true);
  assert.strictEqual(valRes.data.preview.coldCallCount, 2);
  console.log('✓ POST /api/backup/validate preview correctly displays coldCallCount = 2.');

  // Test 4: Verify HTML DOM Elements
  console.log('\n--- Test 4: HTML DOM Elements Verification ---');
  const htmlContent = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert(htmlContent.includes('id="btn-export-coldcall"'), 'Missing #btn-export-coldcall in index.html');
  assert(htmlContent.includes('value="cold_call"'), 'Missing value="cold_call" option in export modal');
  console.log('✓ index.html includes #btn-export-coldcall and value="cold_call" in #export-scope-select.');

  // Test 5: Verify main.js exports and mappings
  console.log('\n--- Test 5: main.js Cold Call Export System Logic ---');
  const mainContent = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert(mainContent.includes("scope === 'cold_call'"), 'Missing scope === "cold_call" in main.js');
  assert(mainContent.includes("scopePart = 'ColdCall'"), 'Missing ColdCall filename handling in main.js');
  assert(mainContent.includes("'Cold Call Status'"), 'Missing Cold Call Status in CSV headers');
  assert(mainContent.includes("btn-export-coldcall"), 'Missing btn-export-coldcall click listener in main.js');
  assert(mainContent.includes("AppState.coldCallDirty = true"), 'Missing coldCallDirty = true in restore reload');
  console.log('✓ main.js contains complete cold call export scoping, CSV headers, restore reload and button bindings.');

  console.log('\n======================================================');
  console.log('ALL COLD CALL BACKUP & EXPORT TESTS PASSED SUCCESSFULLY');
  console.log('======================================================\n');
}

run()
  .catch((err) => {
    console.error('Test Failed:', err);
    process.exit(1);
  })
  .finally(() => {
    try {
      srv.kill();
    } catch (_) {}
    try {
      fs.rmSync(SCRATCH_USER_DATA, { recursive: true, force: true });
    } catch (_) {}
  });
