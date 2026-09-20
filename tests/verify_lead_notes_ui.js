const { app, BrowserWindow } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');

const LEADS_STORE_PATH = path.join(
  process.env.APPDATA || (process.platform === 'darwin' ? process.env.HOME + '/Library/Preferences' : process.env.HOME + '/.local/share'),
  'clienthunter',
  'data',
  'leads_store.json'
);

function apiReq(method, pathName, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: 3000,
      path: pathName,
      method: method,
      headers: { 'Content-Type': 'application/json' }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

app.whenReady().then(async () => {
  let originalBackup = null;
  if (fs.existsSync(LEADS_STORE_PATH)) {
    originalBackup = fs.readFileSync(LEADS_STORE_PATH, 'utf8');
  }

  try {
    console.log('--- Setting up UI test lead with notes ---');
    const demoLead = {
      place_id: 'ChIJ_UI_TEST_NOTES_LEAD',
      business_name: 'Studio 18 Family Salon',
      phone: '+91 98765 43210',
      category: 'Beauty Salons',
      city: 'Hyderabad',
      address: 'Road No 36, Jubilee Hills',
      notes: [
        {
          id: 'note_initial_1',
          lead_id: 'ChIJ_UI_TEST_NOTES_LEAD',
          text: 'Owner asked me to call tomorrow after 5 PM.',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }
      ]
    };

    await apiReq('POST', '/api/leads/save', { leads: [demoLead] });
    console.log('Test lead created with 1 note.');

    const win = new BrowserWindow({
      width: 1400,
      height: 900,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    await win.loadURL('http://127.0.0.1:3000/#saved-leads');
    await new Promise(r => setTimeout(r, 2000));

    // 1. Verify table row has the subtle note badge
    const badgeCheck = await win.webContents.executeJavaScript(`
      (() => {
        const badge = document.querySelector('.lead-notes-badge');
        return {
          hasBadge: Boolean(badge),
          title: badge ? badge.getAttribute('title') : null
        };
      })()
    `);
    console.log('Table note badge check:', badgeCheck);
    if (!badgeCheck.hasBadge) throw new Error('Note badge not found in Saved Leads table');

    // 2. Open Lead Details Modal by clicking sparkle button or dispatching bubbling click on title
    await win.webContents.executeJavaScript(`
      (() => {
        const sparkleBtn = document.querySelector('.btn-act-sparkle');
        if (sparkleBtn) sparkleBtn.click();
      })()
    `);
    await new Promise(r => setTimeout(r, 1000));

    // 3. Verify Notes card is rendered inside open Lead Detail Modal
    const modalNotesCheck = await win.webContents.executeJavaScript(`
      (() => {
        const modal = document.getElementById('modal-lead-details');
        const isOpen = modal && !modal.classList.contains('hidden');
        const count = document.getElementById('detail-notes-count')?.textContent;
        const notes = Array.from(document.querySelectorAll('#detail-notes-list .lead-note-text')).map(el => el.textContent.trim());
        const hasAddBtn = Boolean(document.getElementById('btn-detail-toggle-add-note'));
        return {
          isOpen,
          count,
          notes,
          hasAddBtn
        };
      })()
    `);
    console.log('Modal notes check:', modalNotesCheck);
    if (!modalNotesCheck.isOpen) throw new Error('Detail modal is not open');

    // Capture screenshot of Lead Detail Modal with Notes
    const imgModal = await win.capturePage();
    fs.writeFileSync(
      path.join(process.env.ARTIFACT_DIR || path.join(__dirname, '..', 'scratch'), 'lead_detail_modal_notes.png'),
      imgModal.toPNG()
    );
    console.log('Captured lead_detail_modal_notes.png');

    // 4. Test Add Note via UI in modal
    await win.webContents.executeJavaScript(`
      (() => {
        document.getElementById('btn-detail-toggle-add-note').click();
        document.getElementById('detail-note-input').value = 'Requested quotation for website development.';
        document.getElementById('btn-detail-save-note').click();
      })()
    `);
    await new Promise(r => setTimeout(r, 1200));

    const modalAfterAdd = await win.webContents.executeJavaScript(`
      (() => {
        const count = document.getElementById('detail-notes-count')?.textContent;
        const notes = Array.from(document.querySelectorAll('#detail-notes-list .lead-note-text')).map(el => el.textContent.trim());
        return { count, notes };
      })()
    `);
    console.log('Modal notes after adding second note:', modalAfterAdd);
    if (modalAfterAdd.notes.length !== 2) throw new Error('Expected 2 notes in modal after add');

    // Close detail modal
    await win.webContents.executeJavaScript(`
      (() => {
        document.getElementById('btn-close-lead-detail')?.click();
      })()
    `);
    await new Promise(r => setTimeout(r, 500));

    // 5. Navigate to Outreach using tab navigation
    await apiReq('POST', '/api/leads/move-to-outreach', { leadIds: ['ChIJ_UI_TEST_NOTES_LEAD'] });

    await win.webContents.executeJavaScript(`
      (() => {
        const outreachNav = document.querySelector('a[data-tab="outreach"]');
        if (outreachNav) outreachNav.click();
      })()
    `);
    await new Promise(r => setTimeout(r, 2000));

    // Select the lead in outreach
    await win.webContents.executeJavaScript(`
      (() => {
        const card = document.querySelector('.outreach-lead-card');
        if (card) card.click();
      })()
    `);
    await new Promise(r => setTimeout(r, 800));

    const wsNotesCheck = await win.webContents.executeJavaScript(`
      (() => {
        const wsNotes = document.getElementById('ws-notes-section');
        const count = document.getElementById('ws-notes-count')?.textContent;
        const notes = Array.from(document.querySelectorAll('#ws-notes-list .lead-note-text')).map(el => el.textContent.trim());
        return {
          wsNotesVisible: Boolean(wsNotes),
          count,
          notes
        };
      })()
    `);
    console.log('Workspace notes check:', wsNotesCheck);
    if (!wsNotesCheck.wsNotesVisible) throw new Error('Notes section not visible in Outreach workspace');
    if (wsNotesCheck.notes.length !== 2) throw new Error('Expected 2 notes in workspace list');

    // Capture screenshot of Outreach Workspace with Notes
    const imgWs = await win.capturePage();
    fs.writeFileSync(
      path.join(process.env.ARTIFACT_DIR || path.join(__dirname, '..', 'scratch'), 'outreach_workspace_notes.png'),
      imgWs.toPNG()
    );
    console.log('Captured outreach_workspace_notes.png');

    console.log('\n====================================================');
    console.log('ALL LEAD NOTES UI INTERACTIONS VERIFIED SUCCESSFULLY!');
    console.log('====================================================\n');

  } catch (err) {
    console.error('UI VERIFICATION FAILED:', err);
    process.exit(1);
  } finally {
    if (originalBackup) {
      fs.writeFileSync(LEADS_STORE_PATH, originalBackup, 'utf8');
      console.log('Restored original database.');
    }
    app.quit();
  }
});
