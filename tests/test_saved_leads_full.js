const assert = require('assert');
const path = require('path');
const fs = require('fs');

console.log('=== CLIENTHUNTER FULL SAVED LEADS DATE GROUPING TEST ===\n');

// Load real persistent data
const appDataPath = path.join(process.env.APPDATA, 'clienthunter', 'data', 'leads_store.json');
const store = JSON.parse(fs.readFileSync(appDataPath, 'utf8'));
const realLeads = store.leads;

console.log(`Loaded ${realLeads.length} genuine saved leads from storage.`);

// 1. Test Date Helper Functions
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

console.log('--- Test 1: Date formatting on real leads ---');
const sampleLead = realLeads[0];
const sampleFormatted = formatSavedDate(sampleLead.created_at);
const sampleKey = getSavedDateKey(sampleLead.created_at);
console.log(`Sample lead "${sampleLead.business_name}":`);
console.log(`  created_at: "${sampleLead.created_at}"`);
console.log(`  formatSavedDate: "${sampleFormatted}"`);
console.log(`  getSavedDateKey: "${sampleKey}"`);
assert.strictEqual(sampleFormatted, '17 September 2026');
assert.strictEqual(sampleKey, '2026-09-17');
console.log('✓ PASS: Formatted date matches "17 September 2026" exactly.\n');

// 2. Test Multi-Date Grouping Simulation (Day 1: Sept 17, Day 2: Sept 18)
console.log('--- Test 2: Multi-date grouping simulation ---');
const simulatedLeads = [
  ...realLeads,
  {
    id: 'sim_lead_1',
    place_id: 'sim_place_1',
    business_name: 'Dr. Rao Dental Clinic',
    category: 'Dentist',
    city: 'Hyderabad',
    created_at: '2026-09-18T10:00:00.000Z',
    website_status: 'YES'
  },
  {
    id: 'sim_lead_2',
    place_id: 'sim_place_2',
    business_name: 'Apex Orthodontics',
    category: 'Dental Clinic',
    city: 'Hyderabad',
    created_at: '2026-09-18T15:30:00.000Z',
    website_status: 'NO'
  }
];

// Group leads by date
const dateGroupMap = new Map();
const dateGroups = [];

// Sort descending by created_at (newest first)
simulatedLeads.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

simulatedLeads.forEach((lead) => {
  const dateKey = getSavedDateKey(lead.created_at);
  if (!dateGroupMap.has(dateKey)) {
    const groupObj = {
      dateKey,
      formattedDate: dateKey === 'unavailable' ? 'Date unavailable' : formatSavedDate(lead.created_at),
      leads: []
    };
    dateGroupMap.set(dateKey, groupObj);
    dateGroups.push(groupObj);
  }
  dateGroupMap.get(dateKey).leads.push(lead);
});

console.log(`Total distinct date groups found: ${dateGroups.length}`);
dateGroups.forEach(g => {
  console.log(`  Group: "${g.formattedDate}" (key: ${g.dateKey}) -> ${g.leads.length} leads`);
});

// Assertions for Multi-date grouping:
assert.strictEqual(dateGroups.length, 2, 'Should have exactly 2 date groups (Sept 18 and Sept 17)');
assert.strictEqual(dateGroups[0].formattedDate, '18 September 2026', 'Newest date (18 September 2026) must appear first');
assert.strictEqual(dateGroups[0].leads.length, 2, 'Sept 18 should have 2 leads saved at 10:00 AM and 3:30 PM');
assert.strictEqual(dateGroups[1].formattedDate, '17 September 2026', 'Older date (17 September 2026) must appear second');
assert.strictEqual(dateGroups[1].leads.length, 117, 'Sept 17 must keep all original 117 leads completely intact');
console.log('✓ PASS: Multi-date grouping, ordering, and same-day grouping verified.\n');

// 3. Test Date Dropdown Filter Options
console.log('--- Test 3: Date dropdown filter options ---');
const dateCounts = {};
simulatedLeads.forEach((l) => {
  const key = getSavedDateKey(l.created_at);
  dateCounts[key] = (dateCounts[key] || 0) + 1;
});
const sortedKeys = Object.keys(dateCounts).sort((a, b) => {
  if (a === 'unavailable') return 1;
  if (b === 'unavailable') return -1;
  return b.localeCompare(a);
});

const dropdownOptions = [
  { value: 'All', label: `Date: All Dates (${simulatedLeads.length})` },
  ...sortedKeys.map(k => ({
    value: k,
    label: `${k === 'unavailable' ? 'Date unavailable' : formatSavedDate(k)} (${dateCounts[k]})`
  }))
];

console.log('Generated Dropdown Options:');
dropdownOptions.forEach(opt => console.log(`  [value="${opt.value}"] -> "${opt.label}"`));

assert.strictEqual(dropdownOptions[0].value, 'All');
assert.strictEqual(dropdownOptions[1].value, '2026-09-18');
assert.strictEqual(dropdownOptions[1].label, '18 September 2026 (2)');
assert.strictEqual(dropdownOptions[2].value, '2026-09-17');
assert.strictEqual(dropdownOptions[2].label, '17 September 2026 (117)');
console.log('✓ PASS: Date dropdown options populated correctly with newest dates first.\n');

// 4. Test Search + Date Filter Harmony
console.log('--- Test 4: Search + Date Filter Harmony ---');
// Filter date = 2026-09-18 AND search = "dental"
const searchQ = 'dental';
const selectedDate = '2026-09-18';

let filtered = simulatedLeads.filter(l => getSavedDateKey(l.created_at) === selectedDate);
assert.strictEqual(filtered.length, 2, '2 leads on 2026-09-18');

filtered = filtered.filter(l =>
  (l.business_name && l.business_name.toLowerCase().includes(searchQ)) ||
  (l.category && l.category.toLowerCase().includes(searchQ))
);
console.log(`Filtered for Date="${selectedDate}" + Search="${searchQ}": ${filtered.length} matching leads`);
assert.strictEqual(filtered.length, 2, 'Both dental leads on 2026-09-18 match "dental"');
console.log('✓ PASS: Search and date filtering work together harmoniously.\n');

// 5. Test Fallback for Missing Date
console.log('--- Test 5: Fallback for missing date ---');
const leadNoDate = { id: 'no_date', business_name: 'No Date Business', created_at: null };
assert.strictEqual(getSavedDateKey(leadNoDate.created_at), 'unavailable');
assert.strictEqual(formatSavedDate(leadNoDate.created_at), 'Date unavailable');
console.log('✓ PASS: Fallback properly handles missing date without crashing or inventing dates.\n');

console.log('=== ALL ADVANCED VERIFICATION TESTS PASSED SUCCESSFULLY ===');
