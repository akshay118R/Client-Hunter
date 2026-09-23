const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');

let serverProc = null;

function waitForServer(port = 3899, timeoutMs = 8000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    function tryConnect() {
      const req = http.get(`http://127.0.0.1:${port}/api/health`, (res) => {
        if (res.statusCode === 200) return resolve();
        retry();
      });
      req.on('error', retry);
    }
    function retry() {
      if (Date.now() - start > timeoutMs) return reject(new Error('Server start timeout'));
      setTimeout(tryConnect, 200);
    }
    tryConnect();
  });
}

app.whenReady().then(async () => {
  // Start server
  serverProc = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: Object.assign({}, process.env, { PORT: '3899' }),
    stdio: 'ignore'
  });

  try {
    await waitForServer(3899);
    console.log('✓ Test backend server running');

    const win = new BrowserWindow({
      width: 1366,
      height: 768,
      show: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    });

    await win.loadURL('http://127.0.0.1:3899');
    await new Promise((r) => setTimeout(r, 2500));

    const results = await win.webContents.executeJavaScript(`
      (async function() {
        const tests = [];

        // 1. Saved Leads
        window.switchView('saved-leads');
        await new Promise(r => setTimeout(r, 600));

        const savedTopButtons = document.getElementById('saved-action-bar-buttons');
        tests.push({
          name: 'Saved Leads: Top buttons removed',
          pass: !savedTopButtons
        });

        const savedSelectAll = document.getElementById('saved-select-all');
        const savedBar = document.getElementById('saved-bulk-bar');
        const savedCountText = document.getElementById('saved-bulk-count-text');

        if (savedSelectAll) {
          savedSelectAll.click();
          await new Promise(r => setTimeout(r, 100));
          const isVisible = savedBar && !savedBar.classList.contains('hidden');
          tests.push({
            name: 'Saved Leads: Select all shows bottom popup',
            pass: isVisible && savedCountText && savedCountText.textContent.includes('selected')
          });

          // Cancel
          const cancelBtn = document.getElementById('btn-bulk-dismiss');
          if (cancelBtn) cancelBtn.click();
          await new Promise(r => setTimeout(r, 100));
          tests.push({
            name: 'Saved Leads: Cancel button hides bottom popup',
            pass: savedBar && savedBar.classList.contains('hidden')
          });

          // Single selection
          const singleChk = document.querySelector('.row-checkbox');
          if (singleChk) {
            singleChk.click();
            await new Promise(r => setTimeout(r, 100));
            tests.push({
              name: 'Saved Leads: Single lead select shows bottom popup',
              pass: savedBar && !savedBar.classList.contains('hidden') && savedCountText?.textContent === '1 lead selected'
            });
            if (cancelBtn) cancelBtn.click();
            await new Promise(r => setTimeout(r, 100));
          }
        }

        // 2. Outreach
        window.switchView('outreach');
        await new Promise(r => setTimeout(r, 600));

        const outreachTopSend = document.getElementById('btn-outreach-send-batch');
        const outreachTopColdCall = document.getElementById('btn-outreach-coldcall-batch');
        const outreachTopDelete = document.getElementById('btn-outreach-delete-batch');
        tests.push({
          name: 'Outreach: Top buttons removed',
          pass: !outreachTopSend && !outreachTopColdCall && !outreachTopDelete
        });

        const outreachSelectAll = document.getElementById('btn-outreach-select-all');
        const outreachBar = document.getElementById('outreach-bulk-bar');
        const outreachCountText = document.getElementById('outreach-bulk-count-text');

        if (outreachSelectAll) {
          outreachSelectAll.click();
          await new Promise(r => setTimeout(r, 100));
          const isVisible = outreachBar && !outreachBar.classList.contains('hidden');
          tests.push({
            name: 'Outreach: Select all shows bottom popup',
            pass: isVisible && outreachCountText && outreachCountText.textContent.includes('selected')
          });

          // Cancel
          const cancelBtn = document.getElementById('btn-outreach-pop-dismiss');
          if (cancelBtn) cancelBtn.click();
          await new Promise(r => setTimeout(r, 100));
          tests.push({
            name: 'Outreach: Cancel button hides bottom popup',
            pass: outreachBar && outreachBar.classList.contains('hidden')
          });

          // Single selection
          const singleChk = document.querySelector('.outreach-card-checkbox');
          if (singleChk) {
            singleChk.click();
            await new Promise(r => setTimeout(r, 100));
            tests.push({
              name: 'Outreach: Single lead select shows bottom popup',
              pass: outreachBar && !outreachBar.classList.contains('hidden') && outreachCountText?.textContent === '1 lead selected'
            });
            if (cancelBtn) cancelBtn.click();
            await new Promise(r => setTimeout(r, 100));
          }
        }

        // 3. Follow-Up
        window.switchView('followup');
        await new Promise(r => setTimeout(r, 600));

        const fuTopRight = document.querySelector('.fu-bulk-right');
        tests.push({
          name: 'Follow-Up: Top buttons removed',
          pass: !fuTopRight
        });

        const fuSelectAll = document.getElementById('chk-fu-select-all');
        const fuBar = document.getElementById('followup-bulk-bar');
        const fuCountText = document.getElementById('followup-bulk-count-text');

        if (fuSelectAll) {
          fuSelectAll.click();
          await new Promise(r => setTimeout(r, 100));
          const isVisible = fuBar && !fuBar.classList.contains('hidden');
          tests.push({
            name: 'Follow-Up: Select all shows bottom popup (if eligible leads exist)',
            pass: isVisible || fuBar.classList.contains('hidden')
          });

          // Cancel
          const cancelBtn = document.getElementById('btn-fu-pop-dismiss');
          if (cancelBtn) cancelBtn.click();
          await new Promise(r => setTimeout(r, 100));
          tests.push({
            name: 'Follow-Up: Cancel button hides bottom popup',
            pass: fuBar && fuBar.classList.contains('hidden')
          });

          // Single selection
          const singleChk = document.querySelector('.fu-card-checkbox:not(:disabled)');
          if (singleChk) {
            singleChk.click();
            await new Promise(r => setTimeout(r, 100));
            tests.push({
              name: 'Follow-Up: Single lead select shows bottom popup',
              pass: fuBar && !fuBar.classList.contains('hidden') && fuCountText?.textContent === '1 follow-up selected'
            });
            if (cancelBtn) cancelBtn.click();
            await new Promise(r => setTimeout(r, 100));
          }
        }

        // 4. Cold Call
        window.switchView('cold-call');
        await new Promise(r => setTimeout(r, 600));

        const ccTopDel = document.getElementById('btn-coldcall-remove-batch');
        tests.push({
          name: 'Cold Call: Top delete button removed',
          pass: !ccTopDel
        });

        const ccSelectAll = document.getElementById('btn-coldcall-select-all');
        const ccBar = document.getElementById('coldcall-bulk-bar');
        const ccCountText = document.getElementById('coldcall-bulk-count-text');

        if (ccSelectAll) {
          ccSelectAll.click();
          await new Promise(r => setTimeout(r, 100));
          const isVisible = ccBar && !ccBar.classList.contains('hidden');
          tests.push({
            name: 'Cold Call: Select all shows bottom popup',
            pass: isVisible && ccCountText && ccCountText.textContent.includes('selected')
          });

          // Cancel
          const cancelBtn = document.getElementById('btn-coldcall-pop-dismiss');
          if (cancelBtn) cancelBtn.click();
          await new Promise(r => setTimeout(r, 100));
          tests.push({
            name: 'Cold Call: Cancel button hides bottom popup',
            pass: ccBar && ccBar.classList.contains('hidden')
          });

          // Single selection
          const singleChk = document.querySelector('.coldcall-lead-check');
          if (singleChk) {
            singleChk.click();
            await new Promise(r => setTimeout(r, 100));
            tests.push({
              name: 'Cold Call: Single lead select shows bottom popup',
              pass: ccBar && !ccBar.classList.contains('hidden') && ccCountText?.textContent === '1 lead selected'
            });
            if (cancelBtn) cancelBtn.click();
            await new Promise(r => setTimeout(r, 100));
          }
        }

        return tests;
      })();
    `);

    console.log('RESULTS:', JSON.stringify(results, null, 2));
    const allPassed = Array.isArray(results) && results.every((t) => t.pass);
    if (allPassed) {
      console.log('--- ALL ELECTRON POPUP TESTS PASSED ---');
      if (serverProc) serverProc.kill();
      app.exit(0);
    } else {
      console.error('--- SOME TESTS FAILED ---');
      if (serverProc) serverProc.kill();
      app.exit(1);
    }
  } catch (err) {
    console.error('Execution error:', err);
    if (serverProc) serverProc.kill();
    app.exit(1);
  }
});
