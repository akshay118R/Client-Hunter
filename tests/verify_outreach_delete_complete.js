const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const assert = require('assert');

function apiPost(pathName, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: 3000,
      path: pathName,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { resolve(data); }
      });
    });
    req.on('error', reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

function apiGet(pathName) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:3000${pathName}`, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { resolve(data); }
      });
    }).on('error', reject);
  });
}

function apiDelete(pathName) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: 3000,
      path: pathName,
      method: 'DELETE'
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { resolve(data); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

app.whenReady().then(async () => {
  console.log('================================================================');
  console.log('CLIENTHUNTER — COMPLETE OUTREACH DELETE + CONFIRM + UNDO TEST');
  console.log('================================================================\n');

  let testLeadIds = [];

  try {
    // 0. Verify initial store state
    const initialSaved = await apiGet('/api/leads/saved');
    const baselineSavedCount = initialSaved.totalCount;
    console.log(`[SETUP] Baseline saved leads count: ${baselineSavedCount}`);

    // Create 3 demo leads with special phone numbers having leading zeros
    const demoLeads = [
      {
        place_id: 'test_demo_lead_1_' + Date.now(),
        business_name: 'Alpha Dental Spa',
        category: 'Dentist',
        city: 'Mumbai',
        state: 'Maharashtra',
        phone: '099124 17109', // MUST PRESERVE LEADING ZERO!
        website: 'https://alphadental.example.com',
        website_status: 'YES',
        opportunity_score: 95,
        saved_at: '2026-09-18T10:00:00.000Z'
      },
      {
        place_id: 'test_demo_lead_2_' + Date.now(),
        business_name: 'Beta Fitness Club',
        category: 'Gym',
        city: 'Mumbai',
        state: 'Maharashtra',
        phone: '088234 56789', // MUST PRESERVE LEADING ZERO!
        website: 'https://betafit.example.com',
        website_status: 'YES',
        opportunity_score: 85,
        saved_at: '2026-09-18T10:00:00.000Z'
      },
      {
        place_id: 'test_demo_lead_3_' + Date.now(),
        business_name: 'Gamma Law Associates',
        category: 'Lawyer',
        city: 'Mumbai',
        state: 'Maharashtra',
        phone: '077345 67890', // MUST PRESERVE LEADING ZERO!
        website: 'https://gammalaw.example.com',
        website_status: 'YES',
        opportunity_score: 75,
        saved_at: '2026-09-18T10:00:00.000Z'
      }
    ];

    const saveRes = await apiPost('/api/leads/save', { leads: demoLeads });
    assert(saveRes.success, 'Saving demo leads must succeed');

    const refreshedSaved = await apiGet('/api/leads/saved');
    const createdLeads = refreshedSaved.leads.filter(l => demoLeads.some(d => d.place_id === l.place_id));
    assert.strictEqual(createdLeads.length, 3, 'Must find 3 created leads');
    testLeadIds = createdLeads.map(l => String(l.id));
    console.log(`[SETUP] Created 3 test leads: ${testLeadIds.join(', ')}`);

    // Move all 3 to Outreach
    await apiPost('/api/leads/move-to-outreach', { leadIds: testLeadIds });
    console.log('[SETUP] Moved all 3 test leads to Outreach.');

    const win = new BrowserWindow({
      width: 1440,
      height: 900,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    await win.loadURL('http://127.0.0.1:3000/#outreach');
    await new Promise(r => setTimeout(r, 2500));

    // ----------------------------------------------------
    // CHECK 1: Leading Zero Sanitization & Phone preservation
    // ----------------------------------------------------
    console.log('\n--- CHECK 1: Phone numbers preserve leading zero; counters clean ---');
    const check1Result = await win.webContents.executeJavaScript(`
      (function() {
        const lead = AppState.outreach.data?.allLeads?.find(l => l.business_name === 'Alpha Dental Spa');
        const phone = lead?.phone;
        const totalMetric = document.getElementById('metric-total-outreach')?.textContent?.trim();
        const navBadge = document.getElementById('nav-outreach-badge')?.textContent?.trim();
        return { phone, totalMetric, navBadge };
      })()
    `);
    console.log('Check 1 result:', check1Result);
    assert.strictEqual(check1Result.phone, '099124 17109', 'Phone number MUST retain leading zero verbatim');
    assert(!check1Result.totalMetric?.startsWith('0') || check1Result.totalMetric === '0', 'Total metric must not have leading zero');
    console.log('✓ Check 1 passed: Phone number intact, metrics clean.');

    // ----------------------------------------------------
    // CHECK 2: Selection Logic (1 lead, 2 leads, 3 leads)
    // ----------------------------------------------------
    console.log('\n--- CHECK 2: Selection Logic (1 lead -> Delete (1), 2 leads -> Delete (2), 3 leads -> Delete (3)) ---');
    const id1 = testLeadIds[0];
    const id2 = testLeadIds[1];
    const id3 = testLeadIds[2];

    // Select 1 lead
    const sel1Result = await win.webContents.executeJavaScript(`
      (async function() {
        AppState.outreach.selectedLeadIds.clear();
        const card1 = document.querySelector('.outreach-card[data-id="${id1}"]');
        const chk1 = card1?.querySelector('.outreach-card-checkbox');
        if (chk1) chk1.click();
        await new Promise(r => setTimeout(r, 300));
        const delBtn = document.getElementById('btn-outreach-delete-batch');
        return {
          btnText: delBtn?.textContent?.trim(),
          disabled: delBtn?.disabled,
          selectedCount: AppState.outreach.selectedLeadIds.size
        };
      })()
    `);
    console.log('Select 1 lead result:', sel1Result);
    assert.strictEqual(sel1Result.selectedCount, 1, 'Should have 1 lead selected');
    assert.strictEqual(sel1Result.btnText, 'Delete (1)', 'Button text must be Delete (1)');
    assert.strictEqual(sel1Result.disabled, false, 'Delete button must be enabled');
    console.log('✓ Select 1 lead works correctly.');

    // Select 2nd lead
    const sel2Result = await win.webContents.executeJavaScript(`
      (async function() {
        const card2 = document.querySelector('.outreach-card[data-id="${id2}"]');
        const chk2 = card2?.querySelector('.outreach-card-checkbox');
        if (chk2) chk2.click();
        await new Promise(r => setTimeout(r, 300));
        const delBtn = document.getElementById('btn-outreach-delete-batch');
        return {
          btnText: delBtn?.textContent?.trim(),
          disabled: delBtn?.disabled,
          selectedCount: AppState.outreach.selectedLeadIds.size
        };
      })()
    `);
    console.log('Select 2 leads result:', sel2Result);
    assert.strictEqual(sel2Result.selectedCount, 2, 'Should have 2 leads selected');
    assert.strictEqual(sel2Result.btnText, 'Delete (2)', 'Button text must be Delete (2)');
    console.log('✓ Select 2 leads works correctly.');

    // Select 3rd lead
    const sel3Result = await win.webContents.executeJavaScript(`
      (async function() {
        const card3 = document.querySelector('.outreach-card[data-id="${id3}"]');
        const chk3 = card3?.querySelector('.outreach-card-checkbox');
        if (chk3) chk3.click();
        await new Promise(r => setTimeout(r, 300));
        const delBtn = document.getElementById('btn-outreach-delete-batch');
        return {
          btnText: delBtn?.textContent?.trim(),
          disabled: delBtn?.disabled,
          selectedCount: AppState.outreach.selectedLeadIds.size
        };
      })()
    `);
    console.log('Select 3 leads result:', sel3Result);
    assert.strictEqual(sel3Result.selectedCount, 3, 'Should have 3 leads selected');
    assert.strictEqual(sel3Result.btnText, 'Delete (3)', 'Button text must be Delete (3)');
    console.log('✓ Select 3 leads works correctly.');

    // Deselect 2 leads back to 1 lead
    await win.webContents.executeJavaScript(`
      (async function() {
        const card2 = document.querySelector('.outreach-card[data-id="${id2}"]');
        const chk2 = card2?.querySelector('.outreach-card-checkbox');
        if (chk2) chk2.click();
        const card3 = document.querySelector('.outreach-card[data-id="${id3}"]');
        const chk3 = card3?.querySelector('.outreach-card-checkbox');
        if (chk3) chk3.click();
        await new Promise(r => setTimeout(r, 300));
      })()
    `);

    // ----------------------------------------------------
    // CHECK 3: Confirmation Dialog on 1 Lead Delete
    // ----------------------------------------------------
    console.log('\n--- CHECK 3: Confirmation Dialog for 1 Lead Delete ---');
    const modal1Check = await win.webContents.executeJavaScript(`
      (async function() {
        const delBtn = document.getElementById('btn-outreach-delete-batch');
        delBtn.click();
        await new Promise(r => setTimeout(r, 400));
        const modal = document.getElementById('modal-delete-confirm');
        const isVisible = modal && !modal.classList.contains('hidden');
        const title = document.getElementById('confirm-delete-title')?.textContent?.trim();
        const desc = document.getElementById('confirm-delete-desc')?.textContent?.trim();
        const confirmBtn = document.getElementById('btn-perform-delete')?.textContent?.trim();
        const iconDanger = modal?.querySelector('.confirm-icon-danger i')?.className;
        return { isVisible, title, desc, confirmBtn, iconDanger };
      })()
    `);
    console.log('Modal 1 check:', modal1Check);
    assert.strictEqual(modal1Check.isVisible, true, 'modal-delete-confirm must be visible');
    assert.strictEqual(modal1Check.title, 'Delete Selected Leads?', 'Title must be "Delete Selected Leads?"');
    assert.strictEqual(modal1Check.desc, 'This will permanently delete 1 selected lead and its associated outreach/follow-up history.');
    assert.strictEqual(modal1Check.confirmBtn, 'Delete Leads', 'Confirm button must say "Delete Leads"');
    assert(modal1Check.iconDanger.includes('fa-triangle-exclamation'), 'Warning icon must be fa-triangle-exclamation');
    console.log('✓ Confirmation modal opened with exact title, text, icon, and button.');

    // Test Cancel button does NOT delete
    const cancelResult = await win.webContents.executeJavaScript(`
      (async function() {
        const cancelBtn = document.getElementById('btn-cancel-delete');
        cancelBtn.click();
        await new Promise(r => setTimeout(r, 300));
        const modal = document.getElementById('modal-delete-confirm');
        const isHidden = modal?.classList.contains('hidden');
        const card1 = document.querySelector('.outreach-card[data-id="${id1}"]');
        return { isHidden, card1Exists: Boolean(card1) };
      })()
    `);
    assert.strictEqual(cancelResult.isHidden, true, 'Modal must close on cancel');
    assert.strictEqual(cancelResult.card1Exists, true, 'Lead 1 must still exist after cancel');
    console.log('✓ Cancel properly dismissed modal without deleting.');

    // ----------------------------------------------------
    // CHECK 4: Confirm Delete & Undo Toast for 1 Lead
    // ----------------------------------------------------
    console.log('\n--- CHECK 4: Confirm Delete & Undo Toast for 1 Lead ---');
    const delete1Result = await win.webContents.executeJavaScript(`
      (async function() {
        const delBtn = document.getElementById('btn-outreach-delete-batch');
        delBtn.click();
        await new Promise(r => setTimeout(r, 300));
        const performBtn = document.getElementById('btn-perform-delete');
        performBtn.click();
        await new Promise(r => setTimeout(r, 1200));

        const card1 = document.querySelector('.outreach-card[data-id="${id1}"]');
        const toast = document.getElementById('toast-container')?.lastElementChild;
        const toastText = toast?.querySelector('span')?.textContent?.trim();
        const undoBtn = toast?.querySelector('.toast-undo-btn');
        return {
          card1Exists: Boolean(card1),
          toastText,
          hasUndoBtn: Boolean(undoBtn)
        };
      })()
    `);
    console.log('Delete 1 result:', delete1Result);
    assert.strictEqual(delete1Result.card1Exists, false, 'Card 1 must be removed from Outreach');
    assert.strictEqual(delete1Result.toastText, 'Outreach lead removed: Alpha Dental Spa', 'Toast text must state "Outreach lead removed: Alpha Dental Spa"');
    assert.strictEqual(delete1Result.hasUndoBtn, true, 'Toast must have Undo button');
    console.log('✓ Lead 1 deleted from Outreach with exact toast message and Undo button.');

    // Click Undo and verify Lead 1 restored cleanly
    console.log('Clicking Undo...');
    const undo1Result = await win.webContents.executeJavaScript(`
      (async function() {
        const toast = document.getElementById('toast-container')?.lastElementChild;
        const undoBtn = toast?.querySelector('.toast-undo-btn');
        if (undoBtn) undoBtn.click();
        await new Promise(r => setTimeout(r, 1500));
        const card1 = document.querySelector('.outreach-card[data-id="${id1}"]');
        return { card1Restored: Boolean(card1) };
      })()
    `);
    console.log('Undo 1 result:', undo1Result);
    assert.strictEqual(undo1Result.card1Restored, true, 'Lead 1 must be restored to Outreach after clicking Undo');
    console.log('✓ Undo cleanly restored Outreach lead!');

    // Wait for any existing toast to fade
    await new Promise(r => setTimeout(r, 3500));

    // ----------------------------------------------------
    // CHECK 5: Multiple Leads Delete & Confirmation (3 leads)
    // ----------------------------------------------------
    console.log('\n--- CHECK 5: Multiple Leads Delete & Confirmation (3 leads) ---');
    const modal3Check = await win.webContents.executeJavaScript(`
      (async function() {
        // Select all 3 test leads
        const card1 = document.querySelector('.outreach-card[data-id="${id1}"]');
        const chk1 = card1?.querySelector('.outreach-card-checkbox');
        if (chk1 && !chk1.checked) chk1.click();
        const card2 = document.querySelector('.outreach-card[data-id="${id2}"]');
        const chk2 = card2?.querySelector('.outreach-card-checkbox');
        if (chk2 && !chk2.checked) chk2.click();
        const card3 = document.querySelector('.outreach-card[data-id="${id3}"]');
        const chk3 = card3?.querySelector('.outreach-card-checkbox');
        if (chk3 && !chk3.checked) chk3.click();

        await new Promise(r => setTimeout(r, 300));
        const delBtn = document.getElementById('btn-outreach-delete-batch');
        delBtn.click();
        await new Promise(r => setTimeout(r, 400));

        const modal = document.getElementById('modal-delete-confirm');
        const isVisible = modal && !modal.classList.contains('hidden');
        const title = document.getElementById('confirm-delete-title')?.textContent?.trim();
        const desc = document.getElementById('confirm-delete-desc')?.textContent?.trim();
        return { isVisible, title, desc };
      })()
    `);
    console.log('Modal 3 check:', modal3Check);
    assert.strictEqual(modal3Check.isVisible, true);
    assert.strictEqual(modal3Check.title, 'Delete Selected Leads?');
    assert.strictEqual(modal3Check.desc, 'This will permanently delete 3 selected leads and their associated outreach/follow-up history.');
    console.log('✓ Multi-lead confirmation modal displays dynamic count "3 selected leads".');

    // Confirm multi delete
    const delete3Result = await win.webContents.executeJavaScript(`
      (async function() {
        const performBtn = document.getElementById('btn-perform-delete');
        performBtn.click();
        await new Promise(r => setTimeout(r, 1200));

        const card1 = document.querySelector('.outreach-card[data-id="${id1}"]');
        const card2 = document.querySelector('.outreach-card[data-id="${id2}"]');
        const card3 = document.querySelector('.outreach-card[data-id="${id3}"]');
        const toast = document.getElementById('toast-container')?.lastElementChild;
        const toastText = toast?.querySelector('span')?.textContent?.trim();
        const hasUndo = Boolean(toast?.querySelector('.toast-undo-btn'));
        return {
          card1: Boolean(card1),
          card2: Boolean(card2),
          card3: Boolean(card3),
          toastText,
          hasUndo
        };
      })()
    `);
    console.log('Delete 3 result:', delete3Result);
    assert.strictEqual(delete3Result.card1, false, 'Card 1 removed');
    assert.strictEqual(delete3Result.card2, false, 'Card 2 removed');
    assert.strictEqual(delete3Result.card3, false, 'Card 3 removed');
    assert.strictEqual(delete3Result.toastText, '3 Outreach leads removed', 'Toast must state "3 Outreach leads removed"');
    assert.strictEqual(delete3Result.hasUndo, true, 'Multi delete toast has Undo button');
    console.log('✓ Multi delete succeeded with clean toast and Undo button.');

    // Test Undo on multi-lead delete!
    console.log('Testing Undo on multi-lead delete...');
    const undo3Result = await win.webContents.executeJavaScript(`
      (async function() {
        const toast = document.getElementById('toast-container')?.lastElementChild;
        const undoBtn = toast?.querySelector('.toast-undo-btn');
        if (undoBtn) undoBtn.click();
        await new Promise(r => setTimeout(r, 1800));

        const card1 = document.querySelector('.outreach-card[data-id="${id1}"]');
        const card2 = document.querySelector('.outreach-card[data-id="${id2}"]');
        const card3 = document.querySelector('.outreach-card[data-id="${id3}"]');
        return {
          card1Restored: Boolean(card1),
          card2Restored: Boolean(card2),
          card3Restored: Boolean(card3)
        };
      })()
    `);
    console.log('Undo 3 result:', undo3Result);
    assert(undo3Result.card1Restored, 'Card 1 must be restored');
    assert(undo3Result.card2Restored, 'Card 2 must be restored');
    assert(undo3Result.card3Restored, 'Card 3 must be restored');
    console.log('✓ Multi-lead Undo cleanly restored all 3 leads!');

    // Wait for toast to fade
    await new Promise(r => setTimeout(r, 3500));

    // ----------------------------------------------------
    // CHECK 6: Workspace Remove Button Confirmation & Delete
    // ----------------------------------------------------
    console.log('\n--- CHECK 6: Workspace Remove Button Confirmation & Delete ---');
    const wsCheck = await win.webContents.executeJavaScript(`
      (async function() {
        // Select lead 1 to show in workspace
        const card1 = document.querySelector('.outreach-card[data-id="${id1}"]');
        if (card1) card1.click();
        await new Promise(r => setTimeout(r, 500));

        const wsRemoveBtn = document.getElementById('ws-btn-remove');
        if (!wsRemoveBtn) return { foundBtn: false };
        wsRemoveBtn.click();
        await new Promise(r => setTimeout(r, 400));

        const modal = document.getElementById('modal-delete-confirm');
        const isVisible = modal && !modal.classList.contains('hidden');
        const title = document.getElementById('confirm-delete-title')?.textContent?.trim();
        const desc = document.getElementById('confirm-delete-desc')?.textContent?.trim();

        // Click Cancel first
        const cancelBtn = document.getElementById('btn-cancel-delete');
        cancelBtn.click();
        await new Promise(r => setTimeout(r, 300));
        const modalAfterCancel = modal?.classList.contains('hidden');

        // Now click Remove again and confirm delete
        wsRemoveBtn.click();
        await new Promise(r => setTimeout(r, 300));
        const performBtn = document.getElementById('btn-perform-delete');
        performBtn.click();
        await new Promise(r => setTimeout(r, 1200));

        const toast = document.getElementById('toast-container')?.lastElementChild;
        const toastText = toast?.querySelector('span')?.textContent?.trim();
        const card1After = document.querySelector('.outreach-card[data-id="${id1}"]');

        return {
          foundBtn: true,
          modalVisibleOnRemove: isVisible,
          title,
          desc,
          modalHiddenAfterCancel: modalAfterCancel,
          card1Removed: !card1After,
          toastText
        };
      })()
    `);
    console.log('Workspace remove check:', wsCheck);
    assert.strictEqual(wsCheck.modalVisibleOnRemove, true, 'Workspace remove must open modal-delete-confirm');
    assert.strictEqual(wsCheck.title, 'Delete Selected Leads?');
    assert.strictEqual(wsCheck.desc, 'This will permanently delete 1 selected lead and its associated outreach/follow-up history.');
    assert.strictEqual(wsCheck.modalHiddenAfterCancel, true, 'Cancel dismissed modal');
    assert.strictEqual(wsCheck.card1Removed, true, 'Lead 1 removed via workspace');
    assert.strictEqual(wsCheck.toastText, 'Outreach lead removed: Alpha Dental Spa');
    console.log('✓ Workspace remove button opens standard confirmation modal and deletes with toast!');

    // ----------------------------------------------------
    // CHECK 7: Saved Leads 100% Intact with correct phone numbers
    // ----------------------------------------------------
    console.log('\n--- CHECK 7: Verify Master Saved Leads remain 100% intact ---');
    const savedAfterDelete = await apiGet('/api/leads/saved');
    const stillSaved = savedAfterDelete.leads.filter(l => testLeadIds.includes(String(l.id)));
    assert.strictEqual(stillSaved.length, 3, 'All 3 leads MUST still be in Saved Leads');
    const alphaLead = stillSaved.find(l => l.business_name === 'Alpha Dental Spa');
    assert.strictEqual(alphaLead.phone, '099124 17109', 'Contact phone number must have leading zero 100% intact');
    stillSaved.forEach(l => {
      assert(l.phone.startsWith('0'), 'Phone numbers must retain their original leading zero format');
    });
    console.log('✓ All 3 master Saved Leads remain 100% intact with verbatim phone numbers.');

    // Clean up test leads
    console.log('\n[TEARDOWN] Cleaning up 3 demo test leads...');
    for (const id of testLeadIds) {
      await apiDelete(`/api/leads/${id}`);
    }

    const finalSaved = await apiGet('/api/leads/saved');
    assert.strictEqual(finalSaved.totalCount, baselineSavedCount, 'Final saved count must equal baseline count');
    console.log(`✓ Teardown complete. Saved count restored to baseline: ${baselineSavedCount}`);

    console.log('\n================================================================');
    console.log('ALL VERIFICATION CHECKS PASSED SUCCESSFULLY!');
    console.log('================================================================\n');

    win.destroy();
    app.quit();
    process.exit(0);
  } catch (err) {
    console.error('\n❌ TEST VERIFICATION FAILED:', err);
    // Cleanup if possible
    for (const id of testLeadIds) {
      try { await apiDelete(`/api/leads/${id}`); } catch (e) {}
    }
    app.quit();
    process.exit(1);
  }
});
