const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const BASE_URL = 'http://localhost:3000';
const BACKUP_PATH = path.join(__dirname, '..', 'data', 'backups', 'supabase_leads_backup_20260919.json');
const STORE_PATH = path.join(__dirname, '..', 'data', 'leads_store.json');

function fetchJson(urlPath) {
  return new Promise((resolve, reject) => {
    http.get(BASE_URL + urlPath, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch (e) {
          reject(new Error('JSON parse error: ' + body));
        }
      });
    }).on('error', reject);
  });
}

async function runTests() {
  console.log('===============================================================');
  console.log('CLIENTHUNTER — DASHBOARD & ANALYTICS VERIFICATION SUITE');
  console.log('===============================================================\n');

  // --- Step 1: Capture initial data snapshot ---
  console.log('--- Step 1: Capturing baseline state ---');
  const backupData = JSON.parse(fs.readFileSync(BACKUP_PATH, 'utf8'));
  const initialStore = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
  assert.strictEqual(initialStore.leads.length, 111, 'Expected exactly 111 baseline leads');
  console.log(`Baseline lead count: ${initialStore.leads.length} leads`);
  console.log('✓ Step 1 PASSED: Baseline data verified and safe.\n');

  // --- Step 2: Query All Time Analytics ---
  console.log('--- Step 2: Testing GET /api/analytics/dashboard?range=all ---');
  const resAll = await fetchJson('/api/analytics/dashboard?range=all');
  assert.strictEqual(resAll.status, 200, 'Expected 200 OK');
  assert.strictEqual(resAll.data.success, true, 'Expected success=true');
  assert.strictEqual(resAll.data.range, 'all', 'Expected range=all');

  const kpisAll = resAll.data.kpis;
  console.log('KPIs (All Time):', kpisAll);
  assert.strictEqual(kpisAll.totalLeads, 111, 'Expected 111 total leads');
  assert.strictEqual(kpisAll.newLeads, 75, 'Expected 75 new leads');
  assert.strictEqual(kpisAll.favorites, 0, 'Expected 0 favorites');
  assert.strictEqual(kpisAll.outreachPending, 60, 'Expected 60 outreach pending');
  assert.strictEqual(kpisAll.messagesSent, 72, 'Expected 72 messages sent');
  assert.strictEqual(kpisAll.followUpsDueToday, 0, 'Expected 0 follow-ups due today');
  assert.strictEqual(kpisAll.overdueFollowUps, 0, 'Expected 0 overdue follow-ups');
  assert.strictEqual(kpisAll.pausedFollowUps, 0, 'Expected 0 paused follow-ups');
  assert.strictEqual(kpisAll.interestedLeads, 0, 'Expected 0 interested leads');
  assert.strictEqual(kpisAll.notInterestedLeads, 0, 'Expected 0 not interested leads');
  assert.strictEqual(kpisAll.convertedLeads, 0, 'Expected 0 converted leads');
  assert.strictEqual(kpisAll.conversionRate, 0, 'Expected 0% conversion rate');
  assert.strictEqual(kpisAll.conversionValue, null, 'Expected null (—) conversion value where none recorded');
  console.log('✓ Step 2 PASSED: All-time KPIs match stored records with precision.\n');

  // --- Step 3: Performance Summary Validation ---
  console.log('--- Step 3: Testing Performance Summary data integrity ---');
  const perfAll = resAll.data.performanceSummary;
  console.log('Performance Summary (All Time):', JSON.stringify(perfAll, null, 2));
  assert.ok(Array.isArray(perfAll.leadsOverTime), 'Expected leadsOverTime array');
  assert.strictEqual(perfAll.leadsOverTime.length, 2, 'Expected 2 distinct creation dates');
  assert.strictEqual(perfAll.leadsOverTime[0].date, '2026-09-17');
  assert.strictEqual(perfAll.leadsOverTime[0].count, 108);
  assert.strictEqual(perfAll.leadsOverTime[1].date, '2026-09-18');
  assert.strictEqual(perfAll.leadsOverTime[1].count, 3);
  assert.strictEqual(perfAll.outreachCompleted.firstMessages, 36);
  assert.strictEqual(perfAll.outreachCompleted.followUps, 36);
  assert.strictEqual(perfAll.outreachCompleted.total, 72);
  assert.strictEqual(perfAll.followUpsCompleted, 36);
  console.log('✓ Step 3 PASSED: Performance summary accurately reflects real recorded timeline.\n');

  // --- Step 4: Testing Date Filters: Today ---
  console.log('--- Step 4: Testing GET /api/analytics/dashboard?range=today ---');
  const resToday = await fetchJson('/api/analytics/dashboard?range=today');
  assert.strictEqual(resToday.status, 200);
  assert.strictEqual(resToday.data.range, 'today');
  const kpisToday = resToday.data.kpis;
  console.log('KPIs (Today):', kpisToday);
  assert.strictEqual(kpisToday.totalLeads, 0, 'Expected 0 leads created today');
  assert.strictEqual(kpisToday.messagesSent, 36, 'Expected 36 messages sent today (first pitches)');
  console.log('✓ Step 4 PASSED: Today filter correctly filters to current date window.\n');

  // --- Step 5: Testing Date Filters: Last 7 Days, Last 30 Days, This Month ---
  console.log('--- Step 5: Testing GET /api/analytics/dashboard for 7d, 30d, and month ---');
  const [res7d, res30d, resMonth] = await Promise.all([
    fetchJson('/api/analytics/dashboard?range=7d'),
    fetchJson('/api/analytics/dashboard?range=30d'),
    fetchJson('/api/analytics/dashboard?range=month')
  ]);
  assert.strictEqual(res7d.data.kpis.totalLeads, 111, 'All 111 leads created within last 7 days');
  assert.strictEqual(res30d.data.kpis.totalLeads, 111, 'All 111 leads created within last 30 days');
  assert.strictEqual(resMonth.data.kpis.totalLeads, 111, 'All 111 leads created this month');
  console.log('✓ Step 5 PASSED: 7d, 30d, and month ranges verified accurately.\n');

  // --- Step 6: Verify Read-Only Safety Across Workspaces ---
  console.log('--- Step 6: Verifying Read-Only data integrity ---');
  const finalStore = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
  assert.strictEqual(finalStore.leads.length, 111, 'Lead count must remain 111');
  assert.deepStrictEqual(finalStore.outreach_settings, initialStore.outreach_settings, 'Settings must remain untouched');
  assert.deepStrictEqual(finalStore.my_services, initialStore.my_services, 'My Services must remain untouched');

  // Compare every lead against pristine backup
  for (let i = 0; i < backupData.length; i++) {
    const backupLead = backupData[i];
    const storeLead = finalStore.leads.find(l => String(l.id) === String(backupLead.id));
    assert.ok(storeLead, `Lead ${backupLead.id} must still exist`);
    assert.strictEqual(storeLead.created_at, backupLead.created_at, `Lead ${backupLead.id} created_at must match`);
    assert.strictEqual(storeLead.business_name, backupLead.business_name, `Lead ${backupLead.id} business_name must match`);
  }
  console.log('✓ Step 6 PASSED: 100% data integrity verified. No real data modified.\n');

  console.log('===============================================================');
  console.log('ALL TESTS PASSED: DASHBOARD & ANALYTICS FULLY VERIFIED');
  console.log('NO REAL DATA MODIFIED');
  console.log('===============================================================');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
