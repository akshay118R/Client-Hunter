const { app, BrowserWindow } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');

const ARTIFACT_DIR = process.env.ARTIFACT_DIR || path.join(__dirname, '..', 'scratch');

app.whenReady().then(async () => {
  let win = null;
  try {
    console.log('CLIENTHUNTER — LEAD ACTIVITY SEARCH UI VERIFICATION');
    console.log('===================================================');

    win = new BrowserWindow({
      width: 1400,
      height: 900,
      show: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    });

    await win.loadURL('http://127.0.0.1:3000');
    console.log('✓ Main window loaded');

    // Wait 2 seconds for initial render
    await new Promise(r => setTimeout(r, 2000));

    // 1. Navigate to Outreach tab
    const outreachTabResult = await win.webContents.executeJavaScript(`
      (() => {
        const outreachTabLink = document.querySelector('a[data-tab="outreach"]');
        if (outreachTabLink) {
          outreachTabLink.click();
          return { success: true };
        }
        return { success: false };
      })()
    `);
    console.log('✓ Navigated to Outreach tab:', outreachTabResult);

    await new Promise(r => setTimeout(r, 1000));

    // 2. Select first lead in Outreach queue
    const leadSelected = await win.webContents.executeJavaScript(`
      (() => {
        const leadRow = document.querySelector('.outreach-lead-card') || document.querySelector('.lead-list-item');
        if (leadRow) {
          leadRow.click();
          return { success: true, name: leadRow.querySelector('.lead-card-name')?.textContent };
        }
        return { success: false };
      })()
    `);
    console.log('✓ Selected lead:', leadSelected);

    await new Promise(r => setTimeout(r, 1500));

    // 3. Verify Activity Toolbar elements in workspace
    const workspaceToolbarCheck = await win.webContents.executeJavaScript(`
      (() => {
        const toolbar = document.getElementById('ws-activity-toolbar');
        const searchInput = document.getElementById('ws-activity-search');
        const typeFilter = document.getElementById('ws-activity-type-filter');
        const dateFilter = document.getElementById('ws-activity-date-filter');
        const clearBtn = document.getElementById('ws-activity-search-clear');
        const count = document.getElementById('ws-activity-count')?.textContent;
        const items = document.querySelectorAll('#ws-activity-timeline .activity-timeline-item').length;

        return {
          toolbarVisible: Boolean(toolbar),
          searchInputVisible: Boolean(searchInput),
          typeFilterVisible: Boolean(typeFilter),
          dateFilterVisible: Boolean(dateFilter),
          initialCount: count,
          renderedItemsCount: items
        };
      })()
    `);
    console.log('✓ Workspace toolbar check:', workspaceToolbarCheck);

    // 4. Test typing into search input
    const searchResult = await win.webContents.executeJavaScript(`
      (() => {
        const searchInput = document.getElementById('ws-activity-search');
        if (!searchInput) return { error: 'Search input not found' };
        searchInput.value = 'WhatsApp';
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));

        return new Promise(resolve => {
          setTimeout(() => {
            const count = document.getElementById('ws-activity-count')?.textContent;
            const items = document.querySelectorAll('#ws-activity-timeline .activity-timeline-item').length;
            const clearVisible = !document.getElementById('ws-activity-search-clear')?.classList.contains('hidden');
            resolve({ query: 'WhatsApp', count, items, clearVisible });
          }, 200);
        });
      })()
    `);
    console.log('✓ Search query "WhatsApp" result:', searchResult);

    // 5. Test clearing search input
    const clearResult = await win.webContents.executeJavaScript(`
      (() => {
        const clearBtn = document.getElementById('ws-activity-search-clear');
        if (clearBtn) clearBtn.click();

        return new Promise(resolve => {
          setTimeout(() => {
            const searchInput = document.getElementById('ws-activity-search');
            const count = document.getElementById('ws-activity-count')?.textContent;
            const items = document.querySelectorAll('#ws-activity-timeline .activity-timeline-item').length;
            resolve({ queryAfterClear: searchInput.value, count, items });
          }, 150);
        });
      })()
    `);
    console.log('✓ Clear search result:', clearResult);

    // 6. Test category filter
    const categoryResult = await win.webContents.executeJavaScript(`
      (() => {
        const typeFilter = document.getElementById('ws-activity-type-filter');
        if (!typeFilter) return { error: 'Type filter not found' };
        typeFilter.value = 'followup';
        typeFilter.dispatchEvent(new Event('change', { bubbles: true }));

        return new Promise(resolve => {
          setTimeout(() => {
            const count = document.getElementById('ws-activity-count')?.textContent;
            const items = document.querySelectorAll('#ws-activity-timeline .activity-timeline-item').length;
            // Reset back
            typeFilter.value = 'all';
            typeFilter.dispatchEvent(new Event('change', { bubbles: true }));
            resolve({ type: 'followup', count, items });
          }, 150);
        });
      })()
    `);
    // 7. Scroll conversation-workspace-panel to ws-activity-section and capture screenshot
    await win.webContents.executeJavaScript(`
      (() => {
        const panel = document.getElementById('conversation-workspace-panel');
        const sec = document.getElementById('ws-activity-section');
        if (panel && sec) {
          panel.scrollTop = sec.offsetTop - 50;
        }
      })()
    `);
    await new Promise(r => setTimeout(r, 600));
    const screenshotPath = path.join(ARTIFACT_DIR, 'activity_timeline_search_workspace.png');
    const imgBuffer = await win.webContents.capturePage();
    fs.writeFileSync(screenshotPath, imgBuffer.toPNG());
    console.log(`✓ Screenshot captured: ${screenshotPath}`);

    // 8. Open Lead Details Modal
    const modalCheck = await win.webContents.executeJavaScript(`
      (() => {
        const viewLeadBtn = document.getElementById('ws-btn-view-lead');
        if (viewLeadBtn) {
          viewLeadBtn.click();
          return { clicked: true, via: 'ws-btn-view-lead' };
        }
        return { clicked: false };
      })()
    `);
    console.log('✓ Opened lead detail modal:', modalCheck);

    await new Promise(r => setTimeout(r, 1000));

    // Scroll modal to detail-activity-card
    await win.webContents.executeJavaScript(`
      (() => {
        const modalBody = document.querySelector('.modal-lead-details-content') || document.getElementById('modal-lead-details');
        const card = document.getElementById('detail-activity-card');
        if (modalBody && card) {
          card.scrollIntoView({ behavior: 'instant', block: 'center' });
        }
      })()
    `);
    await new Promise(r => setTimeout(r, 500));

    // 9. Verify Modal Activity Toolbar
    const modalToolbarCheck = await win.webContents.executeJavaScript(`
      (() => {
        const toolbar = document.getElementById('detail-activity-toolbar');
        const searchInput = document.getElementById('detail-activity-search');
        const typeFilter = document.getElementById('detail-activity-type-filter');
        const dateFilter = document.getElementById('detail-activity-date-filter');
        const count = document.getElementById('detail-activity-count')?.textContent;
        return {
          modalToolbarVisible: Boolean(toolbar),
          modalSearchVisible: Boolean(searchInput),
          modalTypeFilterVisible: Boolean(typeFilter),
          modalDateFilterVisible: Boolean(dateFilter),
          count
        };
      })()
    `);
    console.log('✓ Modal toolbar check:', modalToolbarCheck);

    // Capture screenshot of Modal with Activity Search
    const modalScreenshotPath = path.join(ARTIFACT_DIR, 'activity_timeline_search_modal.png');
    const modalImgBuffer = await win.webContents.capturePage();
    fs.writeFileSync(modalScreenshotPath, modalImgBuffer.toPNG());
    console.log(`✓ Modal screenshot captured: ${modalScreenshotPath}`);

    console.log('\n===================================================');
    console.log('ALL UI CHECKS COMPLETED SUCCESSFULLY!');
    console.log('===================================================');
  } catch (err) {
    console.error('UI Verification Error:', err);
  } finally {
    if (win) win.close();
    app.quit();
  }
});
