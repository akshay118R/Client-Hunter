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
  // 1. Insert 2 test leads for today (18 September 2026)
  console.log('Adding 2 test leads for 18 September 2026...');
  const testLeads = [
    {
      place_id: 'test_demo_save_1_' + Date.now(),
      business_name: 'Apex Web Studio Hyderabad',
      category: 'Software Company',
      city: 'Hyderabad',
      state: 'Telangana',
      phone: '+91 98765 43210',
      website: 'https://apexweb.example.com',
      website_status: 'YES',
      opportunity_score: 92,
      opportunity_level: 'HIGH'
    },
    {
      place_id: 'test_demo_save_2_' + Date.now(),
      business_name: 'Glamour Dental Care Clinic',
      category: 'Dental Clinic',
      city: 'Hyderabad',
      state: 'Telangana',
      phone: '+91 91234 56789',
      website: '',
      website_status: 'NO',
      opportunity_score: 88,
      opportunity_level: 'HIGH'
    }
  ];

  const saveRes = await apiPost('/api/leads/save', { leads: testLeads });
  console.log('Save response:', saveRes);

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  console.log('Loading app URL at #saved-leads...');
  await win.loadURL('http://127.0.0.1:3000/#saved-leads');
  await new Promise((r) => setTimeout(r, 3500));

  // Inspect both date groups
  const inspectionAll = await win.webContents.executeJavaScript(`
    (async function() {
      const viewSaved = document.getElementById('view-saved-leads');
      if (viewSaved && (viewSaved.classList.contains('hidden') || viewSaved.style.display === 'none')) {
        const link = document.querySelector('a[data-tab="saved-leads"], a[href="#saved-leads"]');
        if (link) link.click();
        await new Promise(r => setTimeout(r, 1000));
      }

      const dateSelect = document.getElementById('saved-filter-date');
      const selectOptions = dateSelect
        ? Array.from(dateSelect.options).map((o) => ({ value: o.value, text: o.textContent.trim(), selected: o.selected }))
        : [];

      const dateHeaderRows = Array.from(document.querySelectorAll('.saved-date-group-row'));
      const headersInfo = dateHeaderRows.map((r) => {
        const textEl = r.querySelector('.saved-date-heading-text');
        const badgeEl = r.querySelector('.saved-date-count-badge');
        return {
          dateGroup: r.getAttribute('data-date-group'),
          headingText: textEl ? textEl.textContent.trim() : '',
          badgeText: badgeEl ? badgeEl.textContent.trim() : ''
        };
      });

      return {
        selectOptions,
        dateHeaderCount: dateHeaderRows.length,
        headersInfo
      };
    })()
  `);

  console.log('\n--- ALL DATES INSPECTION (Both 18 Sept and 17 Sept) ---');
  console.log(JSON.stringify(inspectionAll, null, 2));

  // Capture screenshot with both dates
  const imageAll = await win.webContents.capturePage();
  const screenAllPath = path.join(__dirname, '..', 'scratch', 'saved_leads_multidate.png');
  fs.writeFileSync(screenAllPath, imageAll.toPNG());
  console.log('Saved multidate screenshot to:', screenAllPath);

  // Now test selecting "18 September 2026" from dropdown
  console.log('\nSelecting 18 September 2026 from Date dropdown...');
  const inspectionSingleDate = await win.webContents.executeJavaScript(`
    (async function() {
      const dateSelect = document.getElementById('saved-filter-date');
      // Find option for 2026-09-18
      for (let i = 0; i < dateSelect.options.length; i++) {
        if (dateSelect.options[i].value === '2026-09-18') {
          dateSelect.selectedIndex = i;
          dateSelect.dispatchEvent(new Event('change'));
          break;
        }
      }
      await new Promise(r => setTimeout(r, 500));

      const dateHeaderRows = Array.from(document.querySelectorAll('.saved-date-group-row'));
      const headersInfo = dateHeaderRows.map((r) => {
        const textEl = r.querySelector('.saved-date-heading-text');
        const badgeEl = r.querySelector('.saved-date-count-badge');
        return {
          dateGroup: r.getAttribute('data-date-group'),
          headingText: textEl ? textEl.textContent.trim() : '',
          badgeText: badgeEl ? badgeEl.textContent.trim() : ''
        };
      });

      const leadRows = Array.from(document.querySelectorAll('#saved-leads-tbody tr.saved-lead-row')).map(r => ({
        id: r.getAttribute('data-id'),
        dateGroup: r.getAttribute('data-date-group'),
        name: r.querySelector('.lead-title-link')?.textContent.trim() || ''
      }));

      return {
        selectedDateVal: dateSelect.value,
        dateHeaderCount: dateHeaderRows.length,
        headersInfo,
        leadRowCount: leadRows.length,
        leads: leadRows
      };
    })()
  `);

  console.log('--- SINGLE DATE INSPECTION (18 September 2026 selected) ---');
  console.log(JSON.stringify(inspectionSingleDate, null, 2));

  await new Promise(r => setTimeout(r, 800));
  // Capture screenshot of single date selected
  const imageSingle = await win.webContents.capturePage();
  const screenSinglePath = path.join(__dirname, '..', 'scratch', 'saved_leads_single_date.png');
  fs.writeFileSync(screenSinglePath, imageSingle.toPNG());
  console.log('Saved single date screenshot to:', screenSinglePath);

  // Clean up the 2 test demo leads
  console.log('\nCleaning up the 2 test demo leads...');
  const todayLeadsRes = await win.webContents.executeJavaScript(`
    fetch('/api/leads/saved?savedDate=2026-09-18').then(r => r.json())
  `);
  if (todayLeadsRes.leads && todayLeadsRes.leads.length) {
    for (const tl of todayLeadsRes.leads) {
      if (tl.place_id.startsWith('test_demo_save_')) {
        await apiDelete('/api/leads/' + tl.id);
        console.log('Cleaned up:', tl.business_name);
      }
    }
  }

  console.log('\n=== VERIFICATION AND SCREENSHOT CAPTURE COMPLETE ===');
  app.quit();
  process.exit(0);
});
