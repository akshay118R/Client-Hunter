const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('--- VERIFYING FLOATING BOTTOM ACTION POPUPS & TOP BUTTON CLEANUP ---');

const htmlContent = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

// 1. Verify Top Buttons Removed
assert.ok(!htmlContent.includes('id="saved-action-bar-buttons"'), 'Saved leads top action buttons container must be removed');
assert.ok(!htmlContent.includes('id="btn-outreach-send-batch"'), 'Outreach top send message button must be removed');
assert.ok(!htmlContent.includes('id="btn-outreach-coldcall-batch"'), 'Outreach top cold call button must be removed');
assert.ok(!htmlContent.includes('id="btn-outreach-delete-batch"'), 'Outreach top delete button must be removed');
assert.ok(!htmlContent.includes('class="fu-bulk-right"'), 'Follow-up top action buttons container must be removed');
assert.ok(!htmlContent.includes('id="btn-coldcall-remove-batch"'), 'Cold call top delete button must be removed');
console.log('✓ All top toolbars cleaned up as requested');

// 2. Verify Floating Bottom Popups Exist
const expectedBars = [
  { id: 'saved-bulk-bar', countId: 'saved-bulk-count-text', cancelBtn: 'btn-bulk-dismiss' },
  { id: 'outreach-bulk-bar', countId: 'outreach-bulk-count-text', cancelBtn: 'btn-outreach-pop-dismiss', sendBtn: 'btn-outreach-pop-send', coldcallBtn: 'btn-outreach-pop-coldcall', deleteBtn: 'btn-outreach-pop-delete' },
  { id: 'followup-bulk-bar', countId: 'followup-bulk-count-text', cancelBtn: 'btn-fu-pop-dismiss', pauseBtn: 'btn-fu-pop-pause', resumeBtn: 'btn-fu-pop-resume', sendBtn: 'btn-fu-pop-send' },
  { id: 'coldcall-bulk-bar', countId: 'coldcall-bulk-count-text', cancelBtn: 'btn-coldcall-pop-dismiss', deleteBtn: 'btn-coldcall-pop-delete' }
];

expectedBars.forEach((bar) => {
  assert.ok(htmlContent.includes(`id="${bar.id}"`), `Floating bar #${bar.id} must exist in HTML`);
  assert.ok(htmlContent.includes(`id="${bar.countId}"`), `Count text #${bar.countId} must exist`);
  assert.ok(htmlContent.includes(`id="${bar.cancelBtn}"`), `Cancel button #${bar.cancelBtn} must exist`);
  if (bar.sendBtn) assert.ok(htmlContent.includes(`id="${bar.sendBtn}"`), `Send button #${bar.sendBtn} must exist`);
  if (bar.coldcallBtn) assert.ok(htmlContent.includes(`id="${bar.coldcallBtn}"`), `Cold call button #${bar.coldcallBtn} must exist`);
  if (bar.deleteBtn) assert.ok(htmlContent.includes(`id="${bar.deleteBtn}"`), `Delete button #${bar.deleteBtn} must exist`);
  if (bar.pauseBtn) assert.ok(htmlContent.includes(`id="${bar.pauseBtn}"`), `Pause button #${bar.pauseBtn} must exist`);
  if (bar.resumeBtn) assert.ok(htmlContent.includes(`id="${bar.resumeBtn}"`), `Resume button #${bar.resumeBtn} must exist`);
  console.log(`✓ Floating bar #${bar.id} fully configured with buttons`);
});

// 3. Verify CSS styling for new popup buttons
const cssContent = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
assert.ok(cssContent.includes('.btn-bulk-pause'), '.btn-bulk-pause style must be defined');
assert.ok(cssContent.includes('.btn-bulk-resume'), '.btn-bulk-resume style must be defined');
console.log('✓ CSS button styles verified');

console.log('--- ALL POPUP VERIFICATION CHECKS PASSED ---');
