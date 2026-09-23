const { app, BrowserWindow } = require('electron');
const path = require('path');
const assert = require('assert');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: false
    }
  });

  const indexPath = path.join(__dirname, '../index.html');
  await win.loadFile(indexPath);
  await new Promise((r) => setTimeout(r, 1200));

  console.log('Testing Cold Call Queue UI Rendering with 25 leads...');

  const result = await win.webContents.executeJavaScript(`
    (async function() {
      try {
        // Switch to cold call view
        const coldCallNav = document.querySelector('.nav-link[data-tab="cold-call"]');
        if (coldCallNav) coldCallNav.click();

        // Generate 25 sample queued leads similar to real leads
        const mockLeads = [];
        for (let i = 1; i <= 25; i++) {
          mockLeads.push({
            id: 'mock_lead_' + i,
            place_id: 'mock_place_' + i,
            business_name: 'Luxury Saloon & Spa ' + i,
            phone_number: '+91 98765 000' + (i < 10 ? '0' + i : i),
            category: i % 2 === 0 ? 'Beauty Salons' : 'Spa & Wellness',
            city: i % 3 === 0 ? 'Mumbai' : 'Pune',
            lead_priority: i % 4 === 0 ? 'High' : (i % 2 === 0 ? 'Medium' : 'Low'),
            cold_call: {
              queued: true,
              status: 'Not Called',
              added_at: new Date().toISOString(),
              outcome: null,
              last_call_at: null,
              callback_at: null,
              reason: null,
              notes: ''
            }
          });
        }

        window.AppState.coldCall.leads = mockLeads;
        window.AppState.coldCall.filters = {
          status: 'ALL',
          outcome: 'ALL',
          priority: 'ALL',
          category: 'ALL',
          search: ''
        };
        window.AppState.coldCall.pagination = {
          page: 1,
          pageSize: 25
        };

        // Render cards
        window.renderColdCallCards();

        const cardsContainer = document.getElementById('coldcall-cards-container');
        const emptyState = document.getElementById('coldcall-empty-state');
        const showingIndicator = document.getElementById('coldcall-showing-indicator');
        const cardsCount = cardsContainer ? cardsContainer.querySelectorAll('.coldcall-card').length : 0;
        const isContainerVisible = cardsContainer && !cardsContainer.classList.contains('hidden');
        const isEmptyHidden = emptyState && emptyState.classList.contains('hidden');
        const indicatorText = showingIndicator ? showingIndicator.textContent.trim() : '';

        // Test Workspace Active Lead Selection
        const activeCard = cardsContainer.querySelector('.coldcall-card.active');
        const wsPhone = document.getElementById('cc-ws-phone-number')?.textContent.trim();
        const wsBizName = document.getElementById('cc-ws-business-name')?.textContent.trim();

        // Test Status Filtering
        window.AppState.coldCall.filters.status = 'Not Called';
        window.renderColdCallCards();
        const countNotCalled = cardsContainer.querySelectorAll('.coldcall-card').length;

        // Reset to ALL
        window.AppState.coldCall.filters.status = 'ALL';
        window.renderColdCallCards();
        const countReset = cardsContainer.querySelectorAll('.coldcall-card').length;

        return {
          success: true,
          cardsCount,
          isContainerVisible,
          isEmptyHidden,
          indicatorText,
          hasActiveCard: Boolean(activeCard),
          wsPhone,
          wsBizName,
          countNotCalled,
          countReset
        };
      } catch (err) {
        return {
          success: false,
          error: err.message,
          stack: err.stack
        };
      }
    })()
  `);

  console.log('Result:', JSON.stringify(result, null, 2));

  assert(result.success, result.error);
  assert.strictEqual(result.cardsCount, 25, 'Cards container must contain 25 cards');
  assert(result.isContainerVisible, 'Cards container must be visible');
  assert(result.isEmptyHidden, 'Empty state must be hidden');
  assert.strictEqual(result.indicatorText, 'Showing 25 leads', 'Indicator must say "Showing 25 leads"');
  assert(result.hasActiveCard, 'First card must be automatically active');
  assert(result.wsPhone.includes('+91 98765'), 'Workspace must show active lead phone');
  assert.strictEqual(result.countNotCalled, 25, 'Filtering by "Not Called" must return 25 leads');
  assert.strictEqual(result.countReset, 25, 'Resetting filter must return 25 leads');

  console.log('\n========================================================');
  console.log('✓ SUCCESS: 25 LEADS RENDER CORRECTLY ON COLD CALL PAGE');
  console.log('✓ NO ZERO LEADS / EMPTY STATE BUG');
  console.log('✓ FILTERING AND ACTIVE WORKSPACE WORK AS EXPECTED');
  console.log('========================================================\n');

  win.close();
  app.quit();
});
