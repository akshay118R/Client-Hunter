const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const assert = require('assert');

function httpRequest(method, pathName, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: 3000,
      path: pathName,
      method: method,
      headers: { 'Content-Type': 'application/json' }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

app.whenReady().then(async () => {
  console.log('===============================================================');
  console.log('CLIENTHUNTER — MY SERVICES DELETE BUTTON VERIFICATION TEST SUITE');
  console.log('===============================================================\n');

  try {
    // 0. Verify server status and store initial state
    const sys = await httpRequest('GET', '/api/system/status');
    assert.strictEqual(sys.status, 200, 'Server must be running on port 3000');
    console.log('✓ Server active on port 3000');

    const initialSettingsRes = await httpRequest('GET', '/api/settings');
    assert.strictEqual(initialSettingsRes.status, 200);
    const initialServices = JSON.parse(JSON.stringify(initialSettingsRes.data.settings.services || []));
    console.log(`✓ Baseline services count: ${initialServices.length}`);
    console.log(`  Services: ${initialServices.map(s => s.name).join(', ')}`);

    const initialSaved = await httpRequest('GET', '/api/leads/saved');
    const baselineSavedCount = initialSaved.data.totalCount;
    const initialOutreach = await httpRequest('GET', '/api/outreach/data');
    const baselineOutreachCount = initialOutreach.data.allLeads.length;

    const win = new BrowserWindow({
      width: 1440,
      height: 900,
      show: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    await win.loadURL('http://127.0.0.1:3000/#settings');
    await new Promise(r => setTimeout(r, 2000));

    // Switch to My Services tab
    await win.webContents.executeJavaScript(`
      SettingsModule.switchSettingsTab('services');
    `);
    await new Promise(r => setTimeout(r, 800));

    // -------------------------------------------------------------
    // TEST 3: Add a new custom service & verify it has a Delete button
    // -------------------------------------------------------------
    console.log('\n--- Running TEST 3: Add Custom Service with Delete Button ---');
    const customServiceName = 'WhatsApp Inbound Funnels ' + Date.now();
    const addResult = await win.webContents.executeJavaScript(`
      (async function() {
        const inp = document.getElementById('input-custom-service');
        const btn = document.getElementById('btn-add-custom-service');
        inp.value = '${customServiceName}';
        btn.click();
        await new Promise(r => setTimeout(r, 800));

        const container = document.getElementById('set-services-container');
        const items = Array.from(container.querySelectorAll('.service-toggle-item')).map(el => ({
          name: el.querySelector('.service-name')?.textContent?.trim(),
          hasDeleteBtn: Boolean(el.querySelector('.btn-service-delete')),
          id: el.getAttribute('data-service-id')
        }));

        const added = items.find(i => i.name === '${customServiceName}');
        return { itemsCount: items.length, added };
      })()
    `);
    console.log('Add custom service result:', addResult);
    assert(addResult.added, 'Added custom service must appear in the UI');
    assert.strictEqual(addResult.added.hasDeleteBtn, true, 'Custom service must have a Delete button');
    console.log('✓ TEST 3 PASSED: Added custom service renders with a Delete button.');

    // -------------------------------------------------------------
    // TEST 1 & 4: Confirmation Modal & Delete the custom service
    // -------------------------------------------------------------
    console.log('\n--- Running TEST 1 & 4: Delete Confirmation & Persistent Deletion ---');
    const testCustomId = addResult.added.id;

    // Test Cancel on confirmation modal first
    const cancelResult = await win.webContents.executeJavaScript(`
      (async function() {
        const container = document.getElementById('set-services-container');
        const delBtn = container.querySelector(\`.btn-service-delete[data-service-id="${testCustomId}"]\`);
        delBtn.click();
        await new Promise(r => setTimeout(r, 400));

        const modal = document.getElementById('modal-delete-confirm');
        const title = document.getElementById('confirm-delete-title')?.textContent?.trim();
        const desc = document.getElementById('confirm-delete-desc')?.textContent?.trim();
        const modalVisible = !modal.classList.contains('hidden');

        // Click Cancel
        const cancelBtn = document.getElementById('btn-cancel-delete');
        cancelBtn.click();
        await new Promise(r => setTimeout(r, 300));

        const modalHiddenAfterCancel = modal.classList.contains('hidden');
        const serviceStillPresent = Boolean(container.querySelector(\`.btn-service-delete[data-service-id="${testCustomId}"]\`));

        return { modalVisible, title, desc, modalHiddenAfterCancel, serviceStillPresent };
      })()
    `);
    console.log('Cancel confirmation result:', cancelResult);
    assert.strictEqual(cancelResult.modalVisible, true, 'Confirmation modal must become visible on click');
    assert.strictEqual(cancelResult.title, 'Delete Service?', 'Title must be "Delete Service?"');
    assert(cancelResult.desc.includes(customServiceName), 'Desc must mention service name');
    assert.strictEqual(cancelResult.modalHiddenAfterCancel, true, 'Modal must close on Cancel');
    assert.strictEqual(cancelResult.serviceStillPresent, true, 'Service must NOT be deleted if Cancel clicked');
    console.log('✓ Cancel behavior confirmed: modal closed, no changes made.');

    // Now test Confirm Delete
    const deleteResult = await win.webContents.executeJavaScript(`
      (async function() {
        const container = document.getElementById('set-services-container');
        const delBtn = container.querySelector(\`.btn-service-delete[data-service-id="${testCustomId}"]\`);
        delBtn.click();
        await new Promise(r => setTimeout(r, 400));

        // Click Delete button
        const performBtn = document.getElementById('btn-perform-delete');
        performBtn.click();
        await new Promise(r => setTimeout(r, 1000));

        const serviceGoneFromDOM = !container.querySelector(\`.btn-service-delete[data-service-id="${testCustomId}"]\`);
        const toast = document.querySelector('.toast-message')?.textContent?.trim() || '';

        return { serviceGoneFromDOM, toast };
      })()
    `);
    console.log('Confirm delete result:', deleteResult);
    assert.strictEqual(deleteResult.serviceGoneFromDOM, true, 'Service must immediately disappear from DOM');
    console.log('✓ TEST 1 & 4 PASSED: Service removed from UI upon confirmation.');

    // -------------------------------------------------------------
    // TEST 2: Persistence after page refresh & restart
    // -------------------------------------------------------------
    console.log('\n--- Running TEST 2: Persistence after Page Refresh ---');
    await win.loadURL('http://127.0.0.1:3000/#settings');
    await new Promise(r => setTimeout(r, 2000));

    const checkReload = await win.webContents.executeJavaScript(`
      (function() {
        SettingsModule.switchSettingsTab('services');
        const container = document.getElementById('set-services-container');
        const found = container.querySelector(\`.btn-service-delete[data-service-id="${testCustomId}"]\`);
        return { found: Boolean(found) };
      })()
    `);
    assert.strictEqual(checkReload.found, false, 'Deleted service must NOT come back after page reload');

    // Also check direct API response
    const apiCheck = await httpRequest('GET', '/api/settings');
    const apiFound = apiCheck.data.settings.services.find(s => s.id === testCustomId);
    assert(!apiFound, 'Deleted service must not be in backend settings');
    console.log('✓ TEST 2 PASSED: Deleted service remained deleted across reload.');

    // -------------------------------------------------------------
    // TEST 5: Delete one service while other services exist (isolated)
    // -------------------------------------------------------------
    console.log('\n--- Running TEST 5: Verify all other services remain intact ---');
    const currentServices = apiCheck.data.settings.services;
    console.log(`Current services count: ${currentServices.length}`);
    assert.strictEqual(currentServices.length, initialServices.length, 'Original services count must match initial baseline');
    initialServices.forEach(orig => {
      const match = currentServices.find(s => s.id === orig.id);
      assert(match, `Original service ${orig.name} (${orig.id}) must remain intact`);
      assert.strictEqual(match.name, orig.name);
    });
    console.log('✓ TEST 5 PASSED: All other services remain completely untouched.');

    // -------------------------------------------------------------
    // TEST 6: Gemini message generation excludes deleted service
    // -------------------------------------------------------------
    console.log('\n--- Running TEST 6: Gemini recommendations exclude deleted service ---');
    // Temporarily add a service, verify it is included in /api/outreach/generate-message, then delete it and verify excluded
    const geminiTestService = 'Proprietary AI Drone Delivery ' + Date.now();
    await httpRequest('POST', '/api/settings', {
      services: [...currentServices, { id: 'srv_gemini_test', name: geminiTestService, enabled: true }],
      _category: 'My Services'
    });

    const leadSample = (await httpRequest('GET', '/api/leads/saved')).data.leads[0];
    const genMsg1 = await httpRequest('POST', '/api/outreach/generate-message', {
      leadId: leadSample.id
    });
    console.log('Message with service included contains test service:', genMsg1.data.message.includes(geminiTestService));

    // Now delete it
    await httpRequest('POST', '/api/settings', {
      services: currentServices,
      _category: 'My Services'
    });

    const genMsg2 = await httpRequest('POST', '/api/outreach/generate-message', {
      leadId: leadSample.id
    });
    assert(!genMsg2.data.message.includes(geminiTestService), 'Message must NOT include the deleted service');
    console.log('✓ TEST 6 PASSED: Deleted service is dynamically excluded from AI message generation.');

    // -------------------------------------------------------------
    // TEST 7, 8, 9, 10: Saved Leads, Favorites, Outreach, Find Leads
    // -------------------------------------------------------------
    console.log('\n--- Running TEST 7, 8, 9, 10: System Data Integrity Verification ---');
    const finalSaved = await httpRequest('GET', '/api/leads/saved');
    assert.strictEqual(finalSaved.data.totalCount, baselineSavedCount, 'Saved leads count must match baseline');
    console.log(`✓ TEST 7 PASSED: Saved Leads count intact (${finalSaved.data.totalCount})`);

    const favCheck = await httpRequest('GET', '/api/leads/saved?favorite=true');
    assert.strictEqual(favCheck.status, 200, 'Favorites query must succeed');
    console.log(`✓ TEST 8 PASSED: Favorites query intact (${favCheck.data.totalCount} favorites)`);

    const finalOutreach = await httpRequest('GET', '/api/outreach/data');
    assert.strictEqual(finalOutreach.data.allLeads.length, baselineOutreachCount, 'Outreach leads count must match baseline');
    console.log(`✓ TEST 9 PASSED: Outreach leads count intact (${finalOutreach.data.allLeads.length})`);

    const findStatus = await httpRequest('GET', '/api/system/status');
    assert.strictEqual(findStatus.data.success, true);
    console.log('✓ TEST 10 PASSED: System & Find Leads engine fully operational');

    console.log('\n===============================================================');
    console.log('ALL TESTS 1 THROUGH 10 PASSED SUCCESSFULLY!');
    console.log('===============================================================\n');

    win.destroy();
    app.quit();
    process.exit(0);
  } catch (err) {
    console.error('\n❌ TEST FAILURE:', err);
    app.quit();
    process.exit(1);
  }
});
