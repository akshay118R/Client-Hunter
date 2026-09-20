const assert = require('assert');
const fs = require('fs');
const path = require('path');

const PRISTINE_BACKUP_PATH = path.join(__dirname, '..', 'data', 'backups', 'supabase_leads_backup_20260919.json');
const SERVER_URL = 'http://localhost:3000';

async function runTests() {
  console.log('=== DATA HEALTH & DIAGNOSTICS TEST SUITE ===');

  // Test 1: GET /api/diagnostics/health returns 200 and expected schema
  console.log('\n[TEST 1] Querying GET /api/diagnostics/health...');
  const res = await fetch(`${SERVER_URL}/api/diagnostics/health`);
  assert.strictEqual(res.status, 200, 'Expected HTTP 200 from diagnostics endpoint');
  const data = await res.json();

  assert.strictEqual(data.success, true, 'Response must have success: true');
  assert(['Healthy', 'Warning', 'Error'].includes(data.overallHealth), `overallHealth must be Healthy, Warning, or Error. Got: ${data.overallHealth}`);
  console.log(`✓ TEST 1 PASSED: Endpoint returned status 200 with overallHealth: ${data.overallHealth}`);

  // Test 2: Local Data section assertions
  console.log('\n[TEST 2] Validating Local Data diagnostics...');
  const local = data.localData;
  assert(local, 'localData section must be present');
  assert(['loaded', 'empty', 'failed', 'uninitialized'].includes(local.storeStatus), `Invalid storeStatus: ${local.storeStatus}`);
  assert(local.runtimePath && local.runtimePath.includes('leads_store.json'), `runtimePath must point to leads_store.json. Got: ${local.runtimePath}`);
  assert.strictEqual(typeof local.leadCount, 'number', 'leadCount must be a number');
  assert.strictEqual(local.leadCount, 111, `Expected exactly 111 leads. Got: ${local.leadCount}`);
  assert.strictEqual(local.fileAccessible, true, 'Database file must be accessible');
  assert.strictEqual(local.validationStatus, 'Valid', 'Store schema validation must be Valid');
  assert(local.integrity, 'Integrity sub-object must be present');
  assert.strictEqual(local.integrity.duplicateIdsCount, 0, 'Must have 0 duplicate IDs');
  console.log(`✓ TEST 2 PASSED: Local Data verified — 111 leads, storeStatus: ${local.storeStatus}, runtimePath: ${local.runtimePath}`);

  // Test 3: Supabase section assertions
  console.log('\n[TEST 3] Validating Supabase diagnostics...');
  const supa = data.supabase;
  assert(supa, 'supabase section must be present');
  assert(['Connected', 'Offline / Sync unavailable', 'Unconfigured', 'Connected (Standby)'].some(s => supa.connectionStatus.includes(s)), `Unexpected connectionStatus: ${supa.connectionStatus}`);
  assert(['Healthy', 'Warning'].includes(supa.status), `Supabase health must be Healthy or Warning. Got: ${supa.status}`);
  console.log(`✓ TEST 3 PASSED: Supabase status: ${supa.status} (Connection: ${supa.connectionStatus})`);

  // Test 4: Backup section assertions
  console.log('\n[TEST 4] Validating Backup diagnostics...');
  const bkp = data.backup;
  assert(bkp, 'backup section must be present');
  assert(bkp.backupCount >= 1, `Expected at least 1 backup. Got: ${bkp.backupCount}`);
  assert(bkp.lastSuccessfulBackup, 'lastSuccessfulBackup must have a timestamp');
  assert(bkp.mostRecentBackupName, 'mostRecentBackupName must be present');
  console.log(`✓ TEST 4 PASSED: Backup status: ${bkp.status} (${bkp.backupCount} backups available, latest: ${bkp.mostRecentBackupName})`);

  // Test 5: Application section assertions
  console.log('\n[TEST 5] Validating Application diagnostics...');
  const app = data.application;
  assert(app, 'application section must be present');
  assert.strictEqual(app.clientHunterVersion, '2.2.0', `Expected ClientHunter 2.2.0. Got: ${app.clientHunterVersion}`);
  assert(app.electronVersion, 'electronVersion must be present');
  assert.strictEqual(app.backendPort, 3000, `Expected backendPort 3000. Got: ${app.backendPort}`);
  assert.strictEqual(app.platform, 'win32', `Expected platform win32. Got: ${app.platform}`);
  assert(app.backendStatus.includes('Active') || app.backendStatus.includes('Healthy'), `Unexpected backend status: ${app.backendStatus}`);
  console.log(`✓ TEST 5 PASSED: App info: v${app.clientHunterVersion}, Electron v${app.electronVersion}, Port: ${app.backendPort}, OS: ${app.platform}`);

  // Test 6: Checklist Items assertions
  console.log('\n[TEST 6] Validating Data-Safety & Integrity Checklist...');
  assert(Array.isArray(data.checks) && data.checks.length >= 6, 'Checks array must have at least 6 items');
  for (const check of data.checks) {
    assert(check.id, 'Check must have an id');
    assert(check.name, 'Check must have a name');
    assert(['Healthy', 'Warning', 'Error'].includes(check.status), `Check status must be Healthy/Warning/Error. Got: ${check.status}`);
    assert(check.detail, 'Check must have detail text');
    console.log(`   - [${check.status.toUpperCase()}] ${check.name}: ${check.detail}`);
  }
  console.log('✓ TEST 6 PASSED: All checklist items validated.');

  // Test 7: POST /api/diagnostics/backup creates a safe snapshot
  console.log('\n[TEST 7] Testing POST /api/diagnostics/backup...');
  const bkpRes = await fetch(`${SERVER_URL}/api/diagnostics/backup`, { method: 'POST' });
  assert.strictEqual(bkpRes.status, 200, 'Expected 200 from manual safety backup endpoint');
  const bkpData = await bkpRes.json();
  assert.strictEqual(bkpData.success, true, 'Safety backup response must be success: true');
  assert(bkpData.fileName && bkpData.fileName.includes('ClientHunter_Safety_Backup_'), `Unexpected backup filename: ${bkpData.fileName}`);
  assert.strictEqual(bkpData.leadCount, 111, `Safety backup must contain 111 leads. Got: ${bkpData.leadCount}`);
  assert(fs.existsSync(bkpData.backupPath), `Safety backup file must exist at ${bkpData.backupPath}`);
  console.log(`✓ TEST 7 PASSED: Manual safety backup created successfully at ${bkpData.backupPath}`);

  // Test 8: Read-Only Invariant Verification
  console.log('\n[TEST 8] Verifying Strict Read-Only Invariants...');
  const currentStoreRes = await fetch(`${SERVER_URL}/api/leads/saved`);
  const currentStoreData = await currentStoreRes.json();
  const pristineRaw = fs.readFileSync(PRISTINE_BACKUP_PATH, 'utf8');
  const pristineStore = JSON.parse(pristineRaw);

  const pristineLeads = Array.isArray(pristineStore.leads) ? pristineStore.leads : pristineStore;
  const currentLeads = currentStoreData.leads || [];

  assert.strictEqual(currentLeads.length, pristineLeads.length, `Lead counts must match: current ${currentLeads.length} vs pristine ${pristineLeads.length}`);
  assert.strictEqual(currentLeads.length, 111, `Lead count must remain 111`);

  // Ensure every pristine place_id exists in current leads
  const currentPlaceIds = new Set(currentLeads.map(l => l.place_id));
  for (const pl of pristineLeads) {
    assert(currentPlaceIds.has(pl.place_id), `Lead place_id ${pl.place_id} missing from current store!`);
  }
  console.log('✓ TEST 8 PASSED: 100% of pristine leads preserved intact.');

  console.log('\n===========================================');
  console.log('ALL DATA HEALTH & DIAGNOSTICS TESTS PASSED!');
  console.log('===========================================');
}

runTests().catch(err => {
  console.error('\n❌ TEST SUITE FAILED:', err);
  process.exit(1);
});
