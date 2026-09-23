const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1366,
    height: 768,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: false
    }
  });

  console.log('Loading http://127.0.0.1:3000/#cold-call in Electron...');
  await win.loadURL('http://127.0.0.1:3000/#cold-call');

  // Wait 2.5 seconds for data fetch and rendering
  await new Promise(r => setTimeout(r, 2500));

  const result = await win.webContents.executeJavaScript(`
    (function() {
      const cardsContainer = document.getElementById('coldcall-cards-container');
      const emptyState = document.getElementById('coldcall-empty-state');
      const showingIndicator = document.getElementById('coldcall-showing-indicator');
      const metricTotal = document.getElementById('coldcall-metric-total')?.textContent;
      const wsPhone = document.getElementById('cc-ws-phone-number')?.textContent;
      const wsName = document.getElementById('cc-ws-business-name')?.textContent;

      const cards = cardsContainer ? Array.from(cardsContainer.querySelectorAll('.coldcall-card')) : [];
      const cardDetails = cards.slice(0, 3).map(c => ({
        id: c.getAttribute('data-lead-id'),
        title: c.querySelector('.coldcall-card-title')?.textContent,
        phone: c.querySelector('.coldcall-card-phone-row span')?.textContent,
        status: c.querySelector('.coldcall-status-pill')?.textContent
      }));

      return {
        cardsCount: cards.length,
        isContainerVisible: cardsContainer && !cardsContainer.classList.contains('hidden'),
        isEmptyHidden: emptyState && emptyState.classList.contains('hidden'),
        showingText: showingIndicator ? showingIndicator.textContent.trim() : '',
        metricTotal,
        wsPhone,
        wsName,
        cardDetails
      };
    })()
  `);

  console.log('Live DOM Verification Result:\n', JSON.stringify(result, null, 2));

  // Take screenshot for visual confirmation
  const image = await win.capturePage();
  fs.writeFileSync('scratch/coldcall_live_verified.png', image.toPNG());
  console.log('Screenshot saved to scratch/coldcall_live_verified.png');

  win.close();
  app.quit();
});
