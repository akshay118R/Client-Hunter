const fs = require('fs');
const path = require('path');
const assert = require('assert');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

console.log('Verifying Settings Manage / Reset Data UI in index.html...');

// Check headings and copy
assert(html.includes('Manage / Reset Data'), 'Must include "Manage / Reset Data" heading');
assert(html.includes('Remove specific Client Hunter data categories individually, or reset all data at once.'), 'Must include description');

// Check category buttons
const requiredButtons = [
  { id: 'btn-reset-saved-leads', cat: 'saved-leads', label: 'Saved Leads' },
  { id: 'btn-reset-coldcall', cat: 'cold-call', label: 'Cold Call' },
  { id: 'btn-reset-outreach', cat: 'outreach', label: 'Outreach' },
  { id: 'btn-reset-favorites', cat: 'favorites', label: 'Favorites' },
  { id: 'btn-reset-followup', cat: 'followup', label: 'Follow-Up' },
  { id: 'btn-reset-history', cat: 'history', label: 'History' },
  { id: 'btn-reset-settings', cat: 'settings', label: 'Settings' }
];

for (const btn of requiredButtons) {
  assert(html.includes(`id="${btn.id}"`), `Missing button ${btn.id}`);
  assert(html.includes(`data-category="${btn.cat}"`), `Missing data-category="${btn.cat}"`);
  console.log(`✓ Verified category button: ${btn.label} (#${btn.id})`);
}

// Check Reset Everything button and section
assert(html.includes('Reset Everything'), 'Must include Reset Everything title');
assert(html.includes('data-category="everything"'), 'Must include data-category="everything"');
console.log('✓ Verified Reset Everything card and button.');

// Check modal structure
assert(html.includes('id="modal-reset-leads-confirm"'), 'Missing confirmation modal');
assert(html.includes('id="confirm-reset-title"'), 'Missing modal title element');
assert(html.includes('id="confirm-reset-desc"'), 'Missing modal description element');
assert(html.includes('id="confirm-reset-preserve-box"'), 'Missing modal preserve box element');
assert(html.includes('id="confirm-reset-preserve-text"'), 'Missing modal preserve text element');
assert(html.includes('id="confirm-reset-input-wrap"'), 'Missing modal typing input wrapper');
assert(html.includes('id="btn-cancel-reset-leads"'), 'Missing modal cancel button');
assert(html.includes('id="btn-perform-reset-leads"'), 'Missing modal perform button');
console.log('✓ Verified universal confirmation modal structure.');

console.log('\n=============================================');
console.log('ALL HTML DOM CHECKS PASSED SUCCESSFULLY!');
console.log('=============================================');
