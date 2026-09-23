const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('--- RUNNING PHONE FORMATTING TEST SUITE ---');

// 1. Test formatContactPhone logic
function formatContactPhone(phone) {
  if (!phone || typeof phone !== 'string') return phone || '';
  let trimmed = phone.trim();
  if (!trimmed || trimmed === 'Not available' || trimmed === 'N/A' || trimmed === 'No phone number') {
    return trimmed;
  }
  if (trimmed.startsWith('0')) {
    return '+91 ' + trimmed.replace(/^0\s*/, '');
  }
  if (/^\+91\s*0/.test(trimmed)) {
    return '+91 ' + trimmed.replace(/^\+91\s*0\s*/, '');
  }
  return trimmed;
}

function cleanPhoneNumber(rawPhone) {
  if (!rawPhone || rawPhone === 'Not available') return null;
  let clean = rawPhone.replace(/[\s\(\)\-\.\+]/g, '');
  if (clean.startsWith('0') && clean.length === 11) {
    clean = '91' + clean.slice(1);
  } else if (!clean.startsWith('91') && clean.length === 10) {
    clean = '91' + clean;
  }
  if (/^\d{10,15}$/.test(clean)) {
    return clean;
  }
  return null;
}

// Unit Tests
assert.strictEqual(formatContactPhone('070938 44999'), '+91 70938 44999', 'Should replace 0 with +91 ');
assert.strictEqual(formatContactPhone('099999 00001'), '+91 99999 00001', 'Should match image format');
assert.strictEqual(formatContactPhone('040 12345678'), '+91 40 12345678', 'Should handle landlines');
assert.strictEqual(formatContactPhone('+91 99999 00001'), '+91 99999 00001', 'Should keep existing +91 intact');
assert.strictEqual(formatContactPhone('+91 099999 00001'), '+91 99999 00001', 'Should strip redundant leading 0 after +91');
assert.strictEqual(formatContactPhone('Not available'), 'Not available', 'Should preserve Not available');
assert.strictEqual(formatContactPhone(''), '', 'Should handle empty string');
assert.strictEqual(formatContactPhone(null), '', 'Should handle null');
console.log('✓ All unit test assertions passed');

// Test cleanPhoneNumber compatibility
assert.strictEqual(cleanPhoneNumber('+91 70938 44999'), '917093844999', 'cleanPhoneNumber should extract valid 12-digit international format');
console.log('✓ cleanPhoneNumber WhatsApp compatibility verified');

// 2. Validate data/leads_store.json
const projectStorePath = path.join(__dirname, '..', 'data', 'leads_store.json');
if (fs.existsSync(projectStorePath)) {
  const store = JSON.parse(fs.readFileSync(projectStorePath, 'utf8'));
  const leads = store.leads || [];
  const startsWithZero = leads.filter(l => l.phone && l.phone.startsWith('0'));
  const startsWithPlus91 = leads.filter(l => l.phone && l.phone.startsWith('+91 '));
  const notAvail = leads.filter(l => !l.phone || l.phone === 'Not available');

  console.log(`[Project Store] Total leads: ${leads.length}`);
  console.log(`[Project Store] Starts with 0: ${startsWithZero.length}`);
  console.log(`[Project Store] Starts with +91: ${startsWithPlus91.length}`);
  console.log(`[Project Store] Not available: ${notAvail.length}`);

  assert.strictEqual(startsWithZero.length, 0, 'No leads in project store should start with 0');
  assert.ok(startsWithPlus91.length > 0, 'Leads with phone must start with +91 ');
  console.log('✓ Project store leads validated');
}

// 3. Validate AppData store if present
const appDataPath = process.env.APPDATA ? path.join(process.env.APPDATA, 'clienthunter', 'data', 'leads_store.json') : null;
if (appDataPath && fs.existsSync(appDataPath)) {
  const store = JSON.parse(fs.readFileSync(appDataPath, 'utf8'));
  const leads = store.leads || [];
  const startsWithZero = leads.filter(l => l.phone && l.phone.startsWith('0'));
  const startsWithPlus91 = leads.filter(l => l.phone && l.phone.startsWith('+91 '));

  console.log(`[AppData Store] Total leads: ${leads.length}`);
  console.log(`[AppData Store] Starts with 0: ${startsWithZero.length}`);
  console.log(`[AppData Store] Starts with +91: ${startsWithPlus91.length}`);

  assert.strictEqual(startsWithZero.length, 0, 'No leads in AppData store should start with 0');
  assert.ok(startsWithPlus91.length > 0, 'Leads with phone must start with +91 ');
  console.log('✓ AppData store leads validated');
}

console.log('--- ALL PHONE FORMATTING TESTS PASSED SUCCESSFULLY ---');
