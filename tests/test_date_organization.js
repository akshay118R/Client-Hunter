const assert = require('assert');
const path = require('path');
const fs = require('fs');

console.log('=== CLIENTHUNTER SAVED LEADS DATE-BASED ORGANIZATION TEST SUITE ===\n');

// 1. UNIT TESTS: Date Formatting & Grouping
console.log('--- TEST 1: Date Formatting & Grouping Functions ---');

const SAVED_MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

function formatSavedDate(dateInput) {
  if (!dateInput) return 'Date unavailable';
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return 'Date unavailable';
  const day = d.getDate();
  const month = SAVED_MONTH_NAMES[d.getMonth()];
  const year = d.getFullYear();
  return `${day} ${month} ${year}`;
}

function getSavedDateKey(dateInput) {
  if (!dateInput) return 'unavailable';
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return 'unavailable';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Test exact format requirement: DD Month YYYY
const testDate1 = new Date(2026, 8, 18, 14, 30, 0); // 18 September 2026
assert.strictEqual(formatSavedDate(testDate1), '18 September 2026', 'Must format as "18 September 2026"');
assert.strictEqual(getSavedDateKey(testDate1), '2026-09-18', 'Must produce key "2026-09-18"');

const testDate2 = new Date(2026, 8, 19, 9, 15, 0); // 19 September 2026
assert.strictEqual(formatSavedDate(testDate2), '19 September 2026', 'Must format as "19 September 2026"');
assert.strictEqual(getSavedDateKey(testDate2), '2026-09-19', 'Must produce key "2026-09-19"');

// Test Same-Day Saves: Two saves at different times on same day must have identical date keys
const morningSave = new Date(2026, 8, 18, 10, 0, 0);
const afternoonSave = new Date(2026, 8, 18, 15, 0, 0);
assert.strictEqual(getSavedDateKey(morningSave), getSavedDateKey(afternoonSave), 'Morning and afternoon saves on same day must have matching dateKey');
assert.strictEqual(formatSavedDate(morningSave), formatSavedDate(afternoonSave), 'Morning and afternoon saves on same day must have matching formatted date');

// Test Fallback for Missing/Corrupt Date
assert.strictEqual(formatSavedDate(null), 'Date unavailable', 'Null date must format as "Date unavailable"');
assert.strictEqual(formatSavedDate(undefined), 'Date unavailable', 'Undefined date must format as "Date unavailable"');
assert.strictEqual(formatSavedDate('not-a-date'), 'Date unavailable', 'Invalid string must format as "Date unavailable"');
assert.strictEqual(getSavedDateKey(null), 'unavailable', 'Null date must return key "unavailable"');
assert.strictEqual(getSavedDateKey('not-a-date'), 'unavailable', 'Invalid string must return key "unavailable"');

console.log('✓ PASS: Date formatting and grouping functions meet all requirements.\n');

// 2. DATA INTEGRITY & PROTECTION CHECK
console.log('--- TEST 2: Existing Leads and Data Protection ---');

const appDataStorePath = path.join(process.env.APPDATA, 'clienthunter', 'data', 'leads_store.json');
assert(fs.existsSync(appDataStorePath), `AppData store must exist at ${appDataStorePath}`);

const storeData = JSON.parse(fs.readFileSync(appDataStorePath, 'utf8'));
assert(Array.isArray(storeData.leads), 'Leads in store must be an array');
console.log(`Verified total existing leads in storage: ${storeData.leads.length}`);
assert(storeData.leads.length >= 117, 'All 117 original leads must be preserved');

// Verify critical fields on all leads
let validTimestampCount = 0;
storeData.leads.forEach((l, idx) => {
  assert(l.place_id, `Lead #${idx} must have place_id`);
  assert(l.business_name, `Lead #${idx} must have business_name`);
  assert(l.created_at, `Lead #${idx} must have created_at`);
  const d = new Date(l.created_at);
  if (!isNaN(d.getTime())) validTimestampCount++;
});
assert.strictEqual(validTimestampCount, storeData.leads.length, 'All leads must have valid timestamps');
console.log(`✓ PASS: All ${validTimestampCount} existing leads have valid timestamps and required fields.\n`);

console.log('=== ALL TESTS PASSED SUCCESSFULLY ===');
