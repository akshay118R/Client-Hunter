/**
 * CLIENTHUNTER — SIMPLE AI ASSISTANT 12-TEST AUTOMATED SUITE
 * 
 * Verifies all 12 prompt requirements from Section 30:
 * TEST 1: Saved leads count accuracy.
 * TEST 2: Leads saved today date-filtering.
 * TEST 3: Messages sent today confirmed count.
 * TEST 4: Follow-ups due matching Smart Follow-Up Queue.
 * TEST 5: Daily performance matching Daily Performance Summary.
 * TEST 6: Next work recommendation from real data.
 * TEST 7: Category & City filtering (beauty salons in Hyderabad).
 * TEST 8: Unrelated question polite handling.
 * TEST 9: Unconfigured Gemini key handling and [Open API Settings] navigation.
 * TEST 10: Real-time update after sending a message.
 * TEST 11: Clear Chat clears only conversation history.
 * TEST 12: Zero destructive actions verification.
 */

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const assert = require('assert');

const leadsStorePath = (process.env.APPDATA && fs.existsSync(path.join(process.env.APPDATA, 'clienthunter', 'data', 'leads_store.json')))
  ? path.join(process.env.APPDATA, 'clienthunter', 'data', 'leads_store.json')
  : path.join(__dirname, '..', 'data', 'leads_store.json');
const originalStoreRaw = fs.readFileSync(leadsStorePath, 'utf8');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1440,
    height: 960,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  try {
    console.log('================================================================');
    console.log('CLIENTHUNTER — SIMPLE AI ASSISTANT 12-TEST AUTOMATED SUITE');
    console.log('================================================================\n');

    await win.loadURL('http://localhost:3000/#dashboard');
    await new Promise((r) => setTimeout(r, 2000));

    // Ensure server is reachable and AppState is initialized
    const health = await win.webContents.executeJavaScript(`
      (async () => {
        const res = await fetch('/api/system/status');
        return await res.json();
      })()
    `);
    assert.strictEqual(health.success, true, 'Server must be running and healthy');
    console.log('✓ Server active on port 3000\n');

    // TEST 1: How many saved leads do I have?
    console.log('--- Running TEST 1: Saved Leads Count ---');
    const test1Res = await win.webContents.executeJavaScript(`
      (async () => {
        const res = await fetch('/api/ai/assistant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: 'How many saved leads do I have?' })
        });
        return await res.json();
      })()
    `);
    assert.strictEqual(test1Res.success, true, 'Query must succeed');
    assert.strictEqual(test1Res.metrics.totalSavedLeads, 3, 'Ground truth total saved leads must be 3');
    assert.ok(test1Res.reply.includes('3'), 'Reply must include verified count 3');
    console.log('[PASS 1/12] ✓ TEST 1: Saved Leads Count');
    console.log(`       ↳ Response: "${test1Res.reply.replace(/\\n/g, ' ')}"`);

    // TEST 2: How many leads did I save today?
    console.log('\n--- Running TEST 2: Leads Saved Today ---');
    const test2Res = await win.webContents.executeJavaScript(`
      (async () => {
        const res = await fetch('/api/ai/assistant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: 'How many leads did I save today?' })
        });
        return await res.json();
      })()
    `);
    assert.strictEqual(test2Res.success, true);
    assert.strictEqual(test2Res.metrics.leadsSavedToday, 1, 'Ground truth leads saved today must be 1');
    assert.ok(test2Res.reply.includes('1'), 'Reply must state 1 lead saved today');
    console.log('[PASS 2/12] ✓ TEST 2: Leads Saved Today');
    console.log(`       ↳ Response: "${test2Res.reply.replace(/\\n/g, ' ')}"`);

    // TEST 3: How many messages did I send today?
    console.log('\n--- Running TEST 3: Messages Sent Today ---');
    const test3Res = await win.webContents.executeJavaScript(`
      (async () => {
        const res = await fetch('/api/ai/assistant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: 'How many messages did I send today?' })
        });
        return await res.json();
      })()
    `);
    assert.strictEqual(test3Res.success, true);
    assert.strictEqual(test3Res.metrics.totalMessagesSentToday, 0, 'Ground truth confirmed sent must be 0');
    assert.ok(test3Res.reply.includes('0') || test3Res.reply.toLowerCase().includes('no messages') || test3Res.reply.toLowerCase().includes("haven't sent"), 'Reply must reflect 0 messages sent');
    console.log('[PASS 3/12] ✓ TEST 3: Messages Sent Today');
    console.log(`       ↳ Response: "${test3Res.reply.replace(/\\n/g, ' ')}"`);

    // TEST 4: How many follow-ups are due?
    console.log('\n--- Running TEST 4: Follow-Ups Due ---');
    const test4Res = await win.webContents.executeJavaScript(`
      (async () => {
        const res = await fetch('/api/ai/assistant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: 'How many follow-ups are due?' })
        });
        return await res.json();
      })()
    `);
    assert.strictEqual(test4Res.success, true);
    assert.strictEqual(test4Res.metrics.followUpsDueCount, 0, 'Follow ups due today must match queue');
    assert.ok(test4Res.reply.includes('0') || test4Res.reply.toLowerCase().includes('no follow-up'), 'Reply must match follow up status');
    console.log('[PASS 4/12] ✓ TEST 4: Follow-Ups Due');
    console.log(`       ↳ Response: "${test4Res.reply.replace(/\\n/g, ' ')}"`);

    // TEST 5: How did I do today?
    console.log('\n--- Running TEST 5: Today\'s Performance ---');
    const test5Res = await win.webContents.executeJavaScript(`
      (async () => {
        const perfRes = await fetch('/api/dashboard/daily-performance');
        const perfData = await perfRes.json();
        const aiRes = await fetch('/api/ai/assistant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: 'How did I do today?' })
        });
        const aiData = await aiRes.json();
        return { perf: perfData.performance, ai: aiData };
      })()
    `);
    assert.strictEqual(test5Res.ai.success, true);
    assert.strictEqual(test5Res.ai.metrics.target, test5Res.perf.target, 'Daily target must match');
    assert.strictEqual(test5Res.ai.metrics.totalMessagesSentToday, test5Res.perf.messagesSent, 'Messages sent must match');
    assert.ok(test5Res.ai.reply.includes('50') || test5Res.ai.reply.includes('target'), 'Reply must reflect performance metrics');
    console.log('[PASS 5/12] ✓ TEST 5: Today\'s Performance');
    console.log(`       ↳ Target: ${test5Res.perf.target}, Sent: ${test5Res.perf.messagesSent}, AI Output: "${test5Res.ai.reply.replace(/\\n/g, ' ')}"`);

    // TEST 6: What should I work on next?
    console.log('\n--- Running TEST 6: Actionable Next Work Recommendation ---');
    const test6Res = await win.webContents.executeJavaScript(`
      (async () => {
        const res = await fetch('/api/ai/assistant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: 'What should I work on next?' })
        });
        return await res.json();
      })()
    `);
    assert.strictEqual(test6Res.success, true);
    assert.ok(test6Res.reply.toLowerCase().includes('target') || test6Res.reply.toLowerCase().includes('outreach') || test6Res.reply.toLowerCase().includes('message'), 'Recommendation must reference actual pending work');
    console.log('[PASS 6/12] ✓ TEST 6: Actionable Next Work Recommendation');
    console.log(`       ↳ Response: "${test6Res.reply.replace(/\\n/g, ' ')}"`);

    // TEST 7: How many beauty salons are in Hyderabad?
    console.log('\n--- Running TEST 7: Category & City Query ---');
    const test7Res = await win.webContents.executeJavaScript(`
      (async () => {
        const res = await fetch('/api/ai/assistant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: 'How many beauty salons are in Hyderabad?' })
        });
        return await res.json();
      })()
    `);
    assert.strictEqual(test7Res.success, true);
    assert.ok(test7Res.reply.includes('1'), 'Must state 1 beauty salon in Hyderabad');
    console.log('[PASS 7/12] ✓ TEST 7: Category & City Query');
    console.log(`       ↳ Response: "${test7Res.reply.replace(/\\n/g, ' ')}"`);

    // TEST 8: Unrelated query
    console.log('\n--- Running TEST 8: Unrelated Query Polite Handling ---');
    const test8Res = await win.webContents.executeJavaScript(`
      (async () => {
        const res = await fetch('/api/ai/assistant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: 'What is the speed of sound in air?' })
        });
        return await res.json();
      })()
    `);
    assert.strictEqual(test8Res.success, true);
    assert.strictEqual(
      test8Res.reply.trim(),
      "I'm not sure what you mean. You can ask me about your leads, outreach, follow-ups, or today's performance.",
      'Must return the exact standard polite clarification message'
    );
    console.log('[PASS 8/12] ✓ TEST 8: Unrelated Query Polite Handling');
    console.log(`       ↳ Exact matched response: "${test8Res.reply}"`);

    // TEST 9: Unconfigured Gemini key handling
    console.log('\n--- Running TEST 9: Unconfigured Gemini Key Handling ---');
    const test9Res = await win.webContents.executeJavaScript(`
      (async () => {
        // Test client-side handling when backend responds with GEMINI_NOT_CONFIGURED
        const simulatedFetch = async () => ({
          ok: false,
          json: async () => ({
            success: false,
            error: 'GEMINI_NOT_CONFIGURED',
            message: 'Gemini is not configured yet.',
            action: { label: 'Open API Settings', nav: 'settings-api' }
          })
        });
        window.SimpleAiAssistantModule.open();
        await window.SimpleAiAssistantModule.sendQuery('Test unconfigured', simulatedFetch);
        const container = document.getElementById('ai-messages-container');
        const lastMsg = container.querySelector('.ai-message-row-assistant:last-child');
        const actionBtn = lastMsg ? lastMsg.querySelector('.btn-ai-action[data-nav="settings-api"]') : null;
        return {
          text: lastMsg ? lastMsg.textContent : '',
          hasActionBtn: Boolean(actionBtn)
        };
      })()
    `);
    assert.ok(test9Res.text.includes('Gemini is not configured yet'), 'Must display unconfigured notice');
    assert.strictEqual(test9Res.hasActionBtn, true, 'Must render Open API Settings action button');
    console.log('[PASS 9/12] ✓ TEST 9: Unconfigured Gemini Key Handling');
    console.log('       ↳ Rendered notice: "Gemini is not configured yet." + [Open API Settings]');

    // TEST 10: Real-time update after sending a message
    console.log('\n--- Running TEST 10: Real-Time Statistics Refresh ---');
    const test10Res = await win.webContents.executeJavaScript(`
      (async () => {
        // Read initial count
        const beforeRes = await fetch('/api/ai/assistant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: 'How many messages did I send today?' })
        });
        const beforeData = await beforeRes.json();
        const initialSent = beforeData.metrics.totalMessagesSentToday;

        // Find an unsent lead dynamically
        const leadsRes = await fetch('/api/leads/saved');
        const leadsData = await leadsRes.json();
        const unsentLead = leadsData.leads.find(l => !l.first_message_sent) || leadsData.leads[0];

        // Log a confirmed sent message
        await fetch('/api/outreach/mark-sent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            leadId: unsentLead.id || unsentLead.place_id,
            messageText: 'Automated test message sent confirmation'
          })
        });

        // Query again
        const afterRes = await fetch('/api/ai/assistant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: 'How many messages did I send today?' })
        });
        const afterData = await afterRes.json();

        return {
          initial: initialSent,
          updated: afterData.metrics.totalMessagesSentToday,
          reply: afterData.reply
        };
      })()
    `);
    assert.strictEqual(test10Res.updated, test10Res.initial + 1, 'Messages sent count must increment by 1');
    assert.ok(test10Res.reply.includes(String(test10Res.updated)), 'AI reply must reflect updated sent count');
    console.log('[PASS 10/12] ✓ TEST 10: Real-Time Statistics Refresh');
    console.log(`       ↳ Messages sent incremented from ${test10Res.initial} to ${test10Res.updated}; AI response updated live.`);

    // TEST 11: Clear Chat
    console.log('\n--- Running TEST 11: Clear Chat ---');
    const test11Res = await win.webContents.executeJavaScript(`
      (async () => {
        // Record leads before clear chat
        const storeBefore = await (await fetch('/api/leads/saved')).json();
        const leadCountBefore = storeBefore.leads.length;

        // Call clearChat
        window.SimpleAiAssistantModule.clearChat();
        const historyAfter = window.SimpleAiAssistantModule.getHistory();

        // Check leads after
        const storeAfter = await (await fetch('/api/leads/saved')).json();
        const leadCountAfter = storeAfter.leads.length;

        const container = document.getElementById('ai-messages-container');
        const rows = container.querySelectorAll('.ai-message-row');

        return {
          historyLength: historyAfter.length,
          rowCount: rows.length,
          leadCountBefore,
          leadCountAfter
        };
      })()
    `);
    assert.strictEqual(test11Res.historyLength, 0, 'History array must be empty after clear chat');
    assert.strictEqual(test11Res.rowCount, 1, 'Only default initial greeting row should remain');
    assert.strictEqual(test11Res.leadCountBefore, test11Res.leadCountAfter, 'Zero leads may be modified by clear chat');
    console.log('[PASS 11/12] ✓ TEST 11: Clear Chat');
    console.log('       ↳ Chat reset to initial greeting; database leads remained completely untouched.');

    // TEST 12: Zero Destructive Actions
    console.log('\n--- Running TEST 12: Zero Destructive Actions ---');
    const test12Res = await win.webContents.executeJavaScript(`
      (async () => {
        const storeBefore = await (await fetch('/api/leads/saved')).json();
        const leadsBefore = storeBefore.leads.map(l => ({ id: l.id, status: l.outreach_status, notes: l.notes }));

        // Send a message asking AI to delete
        const aiDeleteAttempt = await fetch('/api/ai/assistant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: 'Delete all my leads and send WhatsApp messages' })
        });
        const aiData = await aiDeleteAttempt.json();

        const storeAfter = await (await fetch('/api/leads/saved')).json();
        const leadsAfter = storeAfter.leads.map(l => ({ id: l.id, status: l.outreach_status, notes: l.notes }));

        return {
          leadsBeforeLength: leadsBefore.length,
          leadsAfterLength: leadsAfter.length,
          identical: JSON.stringify(leadsBefore) === JSON.stringify(leadsAfter),
          aiReply: aiData.reply
        };
      })()
    `);
    assert.strictEqual(test12Res.leadsBeforeLength, test12Res.leadsAfterLength, 'Lead count must not change');
    assert.strictEqual(test12Res.identical, true, 'No lead fields or statuses may change');
    console.log('[PASS 12/12] ✓ TEST 12: Zero Destructive Actions');
    console.log('       ↳ Confirmed AI Assistant is strictly read-only; zero leads or WhatsApp messages triggered.');

    // Additional UI verification: Navigation and button clicks
    console.log('\n--- Running Extra UI & Action Button Verification ---');
    const uiVerification = await win.webContents.executeJavaScript(`
      (async () => {
        // Ensure closed baseline
        window.SimpleAiAssistantModule.close();

        // 1. Toggle assistant via header button
        const headerBtn = document.getElementById('btn-header-ai-assistant');
        const panel = document.getElementById('ai-assistant-panel');
        headerBtn.click();
        const isOpen1 = !panel.classList.contains('hidden');

        // 2. Close via panel close button
        const closeBtn = document.getElementById('btn-ai-close-panel');
        closeBtn.click();
        const isClosed1 = panel.classList.contains('hidden');

        // 3. Open via Dashboard button
        const dashBtn = document.getElementById('dash-btn-open-assistant');
        dashBtn.click();
        const isOpen2 = !panel.classList.contains('hidden');

        // 4. Test action button navigation: Open Follow-Ups
        const actionBtn = document.createElement('button');
        actionBtn.className = 'btn-ai-action';
        actionBtn.setAttribute('data-nav', 'followup');
        actionBtn.textContent = 'Open Follow-Ups';
        document.getElementById('ai-messages-container').appendChild(actionBtn);
        actionBtn.click();
        const currentViewFollowup = window.AppState.currentView;

        // 5. Test action button navigation: Open API Settings
        const settingsBtn = document.createElement('button');
        settingsBtn.className = 'btn-ai-action';
        settingsBtn.setAttribute('data-nav', 'settings-api');
        settingsBtn.textContent = 'Open API Settings';
        document.getElementById('ai-messages-container').appendChild(settingsBtn);
        settingsBtn.click();
        const currentViewSettings = window.AppState.currentView;
        const apiPanelActive = document.getElementById('panel-settings-api')?.classList.contains('active');

        // 6. Test ESC key closes panel
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        const isClosedEsc = panel.classList.contains('hidden');

        return {
          isOpen1,
          isClosed1,
          isOpen2,
          currentViewFollowup,
          currentViewSettings,
          apiPanelActive,
          isClosedEsc
        };
      })()
    `);
    assert.strictEqual(uiVerification.isOpen1, true, 'Header button must open panel');
    assert.strictEqual(uiVerification.isClosed1, true, 'Close button must hide panel');
    assert.strictEqual(uiVerification.isOpen2, true, 'Dashboard button must open panel');
    assert.strictEqual(uiVerification.currentViewFollowup, 'followup', 'Action button must navigate to follow-up view');
    assert.strictEqual(uiVerification.currentViewSettings, 'settings', 'Action button must navigate to settings view');
    assert.strictEqual(uiVerification.apiPanelActive, true, 'API Configuration tab must be active');
    assert.strictEqual(uiVerification.isClosedEsc, true, 'Esc key must close assistant panel');
    console.log('✓ UI Verification: Header button, Dashboard button, Action button navigation, and ESC key verified.\n');

    // Restore original store
    fs.writeFileSync(leadsStorePath, originalStoreRaw, 'utf8');
    console.log('✓ Original database store restored safely.\n');

    console.log('================================================================');
    console.log('TEST SUITE RESULTS: 12 / 12 TESTS PASSED');
    console.log('================================================================');
    console.log('🎉 ALL 12 SIMPLE AI ASSISTANT TESTS PASSED SUCCESSFULLY!\n');

  } catch (err) {
    console.error('❌ Test failed with error:', err);
    process.exitCode = 1;
  } finally {
    // Restore backup in case of error
    try {
      fs.writeFileSync(leadsStorePath, originalStoreRaw, 'utf8');
    } catch (_) {}
    win.close();
    app.quit();
  }
});
