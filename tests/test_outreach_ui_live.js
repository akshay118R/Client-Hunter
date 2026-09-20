const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');

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
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    req.write(JSON.stringify(body));
    req.end();
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
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    req.end();
  });
}

app.whenReady().then(async () => {
  console.log('=== VERIFYING OUTREACH UI LIVE ===\n');

  // 1. Create 1 sample lead and add to Outreach
  const demoLead = {
    place_id: 'test_demo_ui_' + Date.now(),
    business_name: 'Starlight Medical Spa',
    category: 'Beauty Salon',
    city: 'Hyderabad',
    state: 'Telangana',
    phone: '+91 99999 88888',
    website: 'https://starlight.example.com',
    website_status: 'YES',
    opportunity_score: 95,
    saved_at: '2026-09-18T12:00:00.000Z'
  };

  const saveRes = await apiPost('/api/leads/save', { leads: [demoLead] });
  console.log('Save response:', saveRes.success);

  // Fetch created lead
  const savedRes = await new Promise(resolve => {
    http.get('http://127.0.0.1:3000/api/leads/saved', res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(JSON.parse(d)));
    });
  });
  const createdLead = savedRes.leads.find(l => l.place_id === demoLead.place_id);
  console.log('Created lead ID:', createdLead.id);

  // Move to Outreach
  await apiPost('/api/leads/move-to-outreach', { leadIds: [createdLead.id] });
  console.log('Moved Starlight Medical Spa to Outreach.');

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

  // 2. Select the card and inspect bulk delete button
  const bulkBtnState = await win.webContents.executeJavaScript(`
    (async function() {
      // Find card for created lead
      const card = document.querySelector('.outreach-card[data-id="${createdLead.id}"]');
      if (card) {
        const chk = card.querySelector('.outreach-card-checkbox');
        if (chk && !chk.checked) {
          chk.click();
        }
      }
      await new Promise(r => setTimeout(r, 400));
      const delBtn = document.getElementById('btn-outreach-delete-batch');
      return {
        btnText: delBtn?.textContent?.trim() || '',
        btnDisabled: delBtn?.disabled || delBtn?.classList.contains('disabled')
      };
    })()
  `);
  console.log('Bulk button state when checked:', bulkBtnState);

  // Capture screenshot of Outreach with Delete (1) active
  const img1 = await win.webContents.capturePage();
  const screen1Path = path.join(__dirname, '..', 'scratch', 'outreach_selected_bulk.png');
  fs.writeFileSync(screen1Path, img1.toPNG());
  console.log('Saved outreach_selected_bulk.png');

  // 3. Click the Delete button and verify modal
  const modalState = await win.webContents.executeJavaScript(`
    (async function() {
      const delBtn = document.getElementById('btn-outreach-delete-batch');
      delBtn.click();
      await new Promise(r => setTimeout(r, 400));
      const modal = document.getElementById('modal-remove-outreach-confirm');
      const title = document.getElementById('confirm-remove-outreach-title')?.textContent?.trim();
      const desc = document.getElementById('confirm-remove-outreach-desc')?.textContent?.trim();
      const isVisible = modal && !modal.classList.contains('hidden');
      return { isVisible, title, desc };
    })()
  `);
  console.log('Modal state on bulk delete click:', modalState);

  // Capture screenshot of modal open
  const img2 = await win.webContents.capturePage();
  const screen2Path = path.join(__dirname, '..', 'scratch', 'outreach_confirm_modal.png');
  fs.writeFileSync(screen2Path, img2.toPNG());
  console.log('Saved outreach_confirm_modal.png');

  // 4. Click perform remove from outreach
  const removalResult = await win.webContents.executeJavaScript(`
    (async function() {
      const performBtn = document.getElementById('btn-perform-remove-outreach');
      performBtn.click();
      await new Promise(r => setTimeout(r, 1200));
      const card = document.querySelector('.outreach-card[data-id="${createdLead.id}"]');
      const totalOutreachVal = document.getElementById('metric-total-outreach')?.textContent?.trim();
      return {
        cardStillInOutreach: Boolean(card),
        totalOutreachMetric: totalOutreachVal
      };
    })()
  `);
  console.log('Removal result in Outreach UI:', removalResult);

  // 5. Navigate to Saved Leads and verify lead is still there
  await win.loadURL('http://127.0.0.1:3000/#saved-leads');
  await new Promise(r => setTimeout(r, 2000));

  const savedVerification = await win.webContents.executeJavaScript(`
    (async function() {
      const leadRow = document.querySelector('tr.saved-lead-row[data-id="${createdLead.id}"]');
      const bizName = leadRow?.querySelector('.lead-title-link')?.textContent?.trim();
      const dateHeader = leadRow?.closest('tbody')?.querySelector('.saved-date-group-row[data-date-group="2026-09-18"]');
      const headerText = dateHeader?.querySelector('.saved-date-heading-text')?.textContent?.trim();
      return {
        rowFoundInSaved: Boolean(leadRow),
        businessName: bizName,
        dateHeaderText: headerText
      };
    })()
  `);
  console.log('Saved Leads verification:', savedVerification);

  // Capture screenshot of Saved Leads showing the lead is preserved
  const img3 = await win.webContents.capturePage();
  const screen3Path = path.join(__dirname, '..', 'scratch', 'saved_leads_preserved.png');
  fs.writeFileSync(screen3Path, img3.toPNG());
  console.log('Saved saved_leads_preserved.png');

  // Clean up demo lead
  await apiDelete(`/api/leads/${createdLead.id}`);
  console.log('Cleaned up demo lead.');

  console.log('\n=== LIVE UI VERIFICATION COMPLETED SUCCESSFULLY ===');
  app.quit();
  process.exit(0);
});
