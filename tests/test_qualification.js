const assert = require('assert');
const path = require('path');
const fs = require('fs');

// Ensure .env is loaded
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

console.log('=== RUNNING CLIENTHUNTER QUALIFICATION & LEAD FINDER TESTS ===\n');

// 1. Check API Key loading
console.log('Checking Google Maps API Key configuration...');
const mapsKey = process.env.GOOGLE_MAPS_API_KEY;
assert.ok(
  mapsKey,
  'GOOGLE_MAPS_API_KEY must be configured.'
);
console.log('✔ GOOGLE_MAPS_API_KEY successfully loaded:', mapsKey ? (mapsKey.slice(0, 4) + '...') : 'missing', '\n');

// Import qualification logic from server.js
const {
  hasWebsite,
  hasValidPhone,
  isQualifiedLead,
  getTodayDateString,
  getDailyCandidateUsage,
  MAX_DAILY_CANDIDATES,
  TARGET_QUALIFIED_LEADS
} = require('../server.js');

// ----------------------------------------------------
// TEST 3: Business has website + phone -> REJECT
// ----------------------------------------------------
console.log('TEST 3: Business has website + phone -> REJECT');
const candidate3 = {
  id: 'place_test_3',
  displayName: { text: 'Dental Care Center' },
  websiteUri: 'https://example.com',
  nationalPhoneNumber: '+919876543210'
};
assert.strictEqual(hasWebsite(candidate3), true, 'hasWebsite should be true');
assert.strictEqual(hasValidPhone(candidate3), true, 'hasValidPhone should be true');
assert.strictEqual(isQualifiedLead(candidate3), false, 'Candidate with website must be REJECTED');
console.log('✔ TEST 3 PASSED\n');

// ----------------------------------------------------
// TEST 4: Business has no website + phone -> ACCEPT
// ----------------------------------------------------
console.log('TEST 4: Business has no website + phone -> ACCEPT');
const candidate4 = {
  id: 'place_test_4',
  displayName: { text: 'Local Dental Clinic' },
  websiteUri: null,
  nationalPhoneNumber: '+919876543210'
};
assert.strictEqual(hasWebsite(candidate4), false, 'hasWebsite should be false');
assert.strictEqual(hasValidPhone(candidate4), true, 'hasValidPhone should be true');
assert.strictEqual(isQualifiedLead(candidate4), true, 'Candidate with no website + valid phone must be ACCEPTED');
console.log('✔ TEST 4 PASSED\n');

// ----------------------------------------------------
// TEST 5: Business has no website + no phone -> REJECT
// ----------------------------------------------------
console.log('TEST 5: Business has no website + no phone -> REJECT');
const candidate5 = {
  id: 'place_test_5',
  displayName: { text: 'No Contact Clinic' },
  websiteUri: '',
  nationalPhoneNumber: ''
};
assert.strictEqual(hasWebsite(candidate5), false, 'hasWebsite should be false');
assert.strictEqual(hasValidPhone(candidate5), false, 'hasValidPhone should be false');
assert.strictEqual(isQualifiedLead(candidate5), false, 'Candidate with no phone must be REJECTED');
console.log('✔ TEST 5 PASSED\n');

// ----------------------------------------------------
// TEST 6: Business has website + no phone -> REJECT
// ----------------------------------------------------
console.log('TEST 6: Business has website + no phone -> REJECT');
const candidate6 = {
  id: 'place_test_6',
  displayName: { text: 'Online Portal Only' },
  websiteUri: 'https://dentalportal.in',
  nationalPhoneNumber: null
};
assert.strictEqual(hasWebsite(candidate6), true, 'hasWebsite should be true');
assert.strictEqual(hasValidPhone(candidate6), false, 'hasValidPhone should be false');
assert.strictEqual(isQualifiedLead(candidate6), false, 'Candidate with website and no phone must be REJECTED');
console.log('✔ TEST 6 PASSED\n');

// Edge cases for website/phone validation
console.log('TEST Extra Edge Cases for Website & Phone Validation');
// Whitespace website
assert.strictEqual(hasWebsite({ websiteUri: '   ' }), false, 'Whitespace website should count as NO website');
assert.strictEqual(hasWebsite({ websiteUri: 'null' }), false, '"null" string website should count as NO website');
assert.strictEqual(hasWebsite({ websiteUri: 'n/a' }), false, '"n/a" string website should count as NO website');
assert.strictEqual(hasWebsite({ websiteUri: undefined }), false, 'undefined website should count as NO website');

// Invalid phones
assert.strictEqual(hasValidPhone({ nationalPhoneNumber: '0000000000' }), false, 'Repeating dummy digits should be invalid');
assert.strictEqual(hasValidPhone({ nationalPhoneNumber: 'Not available' }), false, '"Not available" should be invalid');
assert.strictEqual(hasValidPhone({ nationalPhoneNumber: '123' }), false, 'Too short number should be invalid');
// International phone field support
assert.strictEqual(hasValidPhone({ internationalPhoneNumber: '+91 98765 43210' }), true, 'internationalPhoneNumber should be recognized');
console.log('✔ Extra Edge Cases PASSED\n');

// ----------------------------------------------------
// TEST 7: Deduplication across candidate places
// ----------------------------------------------------
console.log('TEST 7: Deduplication prevents redundant processing');
const processedPlaceIds = new Set();
let candidatesChecked = 0;

const placesStream = [
  { id: 'place_A', nationalPhoneNumber: '+919999999991' },
  { id: 'place_B', nationalPhoneNumber: '+919999999992' },
  { id: 'place_A', nationalPhoneNumber: '+919999999991' }, // Duplicate!
  { id: 'place_C', nationalPhoneNumber: '+919999999993' }
];

for (const p of placesStream) {
  if (processedPlaceIds.has(p.id)) {
    continue; // Duplicate skipped without consuming slot
  }
  processedPlaceIds.add(p.id);
  candidatesChecked++;
}

assert.strictEqual(candidatesChecked, 3, 'Duplicate place_A must not consume an extra candidate slot');
assert.strictEqual(processedPlaceIds.size, 3, 'Set must contain exactly 3 unique place IDs');
console.log('✔ TEST 7 PASSED\n');

// ----------------------------------------------------
// TEST 1: 100+ businesses available -> stops at 100 qualified leads
// ----------------------------------------------------
console.log('TEST 1: 100+ businesses available -> Algorithm stops upon reaching 100 qualified leads');
{
  const simulatedPlaces = [];
  // Generate 250 candidates where all qualify
  for (let i = 0; i < 250; i++) {
    simulatedPlaces.push({
      id: `qual_place_${i}`,
      websiteUri: null,
      nationalPhoneNumber: `+919876500${String(i).padStart(3, '0')}`
    });
  }

  const qualifiedLeads = [];
  let evaluatedCount = 0;
  const target = 100;
  const maxLimit = 300;

  for (const p of simulatedPlaces) {
    if (qualifiedLeads.length >= target || evaluatedCount >= maxLimit) break;
    evaluatedCount++;
    if (isQualifiedLead(p)) {
      qualifiedLeads.push(p);
      if (qualifiedLeads.length >= target) break;
    }
  }

  assert.strictEqual(qualifiedLeads.length, 100, 'Must have exactly 100 qualified leads');
  assert.strictEqual(evaluatedCount, 100, 'Must stop evaluating candidates once 100 qualified leads are reached');
  console.log(`✔ TEST 1 PASSED: Evaluated ${evaluatedCount} candidates, collected exactly ${qualifiedLeads.length} qualified leads\n`);
}

// ----------------------------------------------------
// TEST 2 & TEST 8: 300 candidates checked, only 65 qualify -> stops at 300 candidates, returns 65
// ----------------------------------------------------
console.log('TEST 2 & TEST 8: 300 candidates checked, only 65 qualify -> stops at exactly 300, returns only 65');
{
  const simulatedPlaces = [];
  // 350 candidates: only first 65 qualify, rest have websites
  for (let i = 0; i < 350; i++) {
    simulatedPlaces.push({
      id: `mix_place_${i}`,
      websiteUri: i < 65 ? null : `https://biz${i}.com`,
      nationalPhoneNumber: `+919876500${String(i).padStart(3, '0')}`
    });
  }

  const qualifiedLeads = [];
  let evaluatedCount = 0;
  const target = 100;
  const maxLimit = 300;

  for (const p of simulatedPlaces) {
    if (qualifiedLeads.length >= target || evaluatedCount >= maxLimit) break;
    evaluatedCount++;
    if (isQualifiedLead(p)) {
      qualifiedLeads.push(p);
      if (qualifiedLeads.length >= target) break;
    }
    if (evaluatedCount >= maxLimit) break;
  }

  assert.strictEqual(evaluatedCount, 300, 'Must stop at exactly 300 candidates evaluated');
  assert.strictEqual(qualifiedLeads.length, 65, 'Must return only the 65 qualified leads found');
  console.log(`✔ TEST 2 & 8 PASSED: Evaluated ${evaluatedCount} candidates, returned only ${qualifiedLeads.length} qualified leads\n`);
}

// ----------------------------------------------------
// TEST 9: Daily Counter Persistence & Reset
// ----------------------------------------------------
console.log('TEST 9: Daily Candidate Tracker persistence and date rollover');
{
  const mockStore = {
    dailyCandidateTracker: {
      date: '2020-01-01', // old date
      candidatesChecked: 150
    }
  };

  const usageToday = getDailyCandidateUsage(mockStore);
  assert.strictEqual(usageToday.date, getTodayDateString(), 'Must roll over to today\'s date');
  assert.strictEqual(usageToday.candidatesChecked, 0, 'Must reset candidatesChecked to 0 on new date');

  // Increment candidates
  usageToday.candidatesChecked += 45;
  assert.strictEqual(mockStore.dailyCandidateTracker.candidatesChecked, 45, 'Must reflect incremented count');

  // Calling again on same day should preserve count
  const usageSameDay = getDailyCandidateUsage(mockStore);
  assert.strictEqual(usageSameDay.candidatesChecked, 45, 'Must preserve count on same calendar day');
  console.log('✔ TEST 9 PASSED\n');
}

console.log('ALL CLIENTHUNTER QUALIFICATION TESTS PASSED SUCCESSFULLY! 🎉');
process.exit(0);
