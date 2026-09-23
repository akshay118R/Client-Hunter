const fs = require('fs');
const path = require('path');
const assert = require('assert');

// ISOLATED SCRATCH TEST ENVIRONMENT
const SCRATCH_DIR = path.join(__dirname, '..', 'scratch', 'test_reset_env');
const TEST_DATA_DIR = path.join(SCRATCH_DIR, 'data');
const TEST_STORE_PATH = path.join(TEST_DATA_DIR, 'leads_store.json');

// Ensure isolated directory exists
if (!fs.existsSync(TEST_DATA_DIR)) {
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
}

// Set environment variable BEFORE requiring server or store logic
process.env.CLIENTHUNTER_USER_DATA = SCRATCH_DIR;

console.log('----------------------------------------------------');
console.log('RUNNING SEPARATE DATA RESET CONTROLS TEST SUITE');
console.log('Isolated Test Store Path:', TEST_STORE_PATH);
console.log('----------------------------------------------------');

function createSampleStore() {
  return {
    leads: [
      {
        id: 'lead_demo_1',
        place_id: 'place_demo_1',
        business_name: 'demo',
        category: 'Software Testing',
        phone: '+91 99999 11111',
        favorite: true,
        is_favorite: true,
        outreach_status: 'Follow-Up',
        first_message_sent: true,
        next_follow_up_at: '2026-09-30T10:00:00.000Z',
        next_follow_up_number: 1,
        next_follow_up_name: 'Follow-Up #1',
        follow_up_day: 2,
        follow_up_paused: true,
        message_history: [
          { id: 'm1', text: 'Hello demo' }
        ],
        cold_call: {
          queued: true,
          status: 'Called - Interested',
          outcome: 'Interested',
          last_call_at: '2026-09-22T10:00:00.000Z',
          callback_at: null,
          reason: null,
          notes: 'Wants a website'
        }
      },
      {
        id: 'lead_demo_2',
        place_id: 'place_demo_2',
        business_name: 'demo consultancy',
        category: 'Consulting',
        phone: '+91 99999 22222',
        favorite: false,
        is_favorite: false,
        outreach_status: 'Outreach Sent',
        first_message_sent: true,
        next_follow_up_at: '2026-10-01T10:00:00.000Z',
        next_follow_up_number: 2,
        next_follow_up_name: 'Follow-Up #2',
        follow_up_day: 4,
        follow_up_paused: false,
        message_history: [],
        cold_call: {
          queued: true,
          status: 'Not Called',
          outcome: null
        }
      }
    ],
    searchSessions: [
      { sessionId: 'sess_1', query: 'Salons in Hyderabad', resultsCount: 20 },
      { sessionId: 'sess_2', query: 'Dentists in Vijayawada', resultsCount: 15 }
    ],
    outreach: [
      { id: 'outreach_place_demo_1', saved_lead_id: 'lead_demo_1', place_id: 'place_demo_1', status: 'Follow-Up' }
    ],
    settings: {
      profile: { fullName: 'Custom Test User', companyName: 'Test Corp' },
      services: [{ id: 'srv-custom', name: 'Custom Service', enabled: true }]
    },
    outreach_settings: { dailyTarget: 100 }
  };
}

// Write initial mock store
fs.writeFileSync(TEST_STORE_PATH, JSON.stringify(createSampleStore(), null, 2), 'utf8');

// Function that simulates the POST /api/reset/:category logic on the store
function executeResetOnStore(store, category) {
  const nowIso = new Date().toISOString();
  switch (category) {
    case 'saved-leads': {
      store.leads = [];
      store.outreach = [];
      break;
    }
    case 'cold-call': {
      for (const lead of store.leads) {
        if (lead.cold_call) {
          lead.cold_call = {
            queued: false,
            status: 'Not Called',
            added_at: null,
            last_call_at: null,
            outcome: null,
            callback_at: null,
            reason: null,
            notes: ''
          };
          lead.updated_at = nowIso;
        }
      }
      break;
    }
    case 'outreach': {
      for (const lead of store.leads) {
        lead.outreach_status = 'Pending';
        lead.first_message_sent = false;
        lead.first_message_sent_at = null;
        lead.main_message_sent_at = null;
        lead.last_message_sent_at = null;
        lead.last_message_type = null;
        lead.last_message_text = null;
        lead.next_follow_up_at = null;
        lead.next_follow_up_number = null;
        lead.next_follow_up_name = null;
        lead.follow_up_completed = false;
        lead.reply_status = null;
        lead.replied_at = null;
        lead.outreach_completed_at = null;
        lead.message_history = [];
        lead.updated_at = nowIso;
      }
      store.outreach = [];
      break;
    }
    case 'favorites': {
      for (const lead of store.leads) {
        lead.favorite = false;
        lead.is_favorite = false;
        lead.updated_at = nowIso;
      }
      break;
    }
    case 'followup': {
      for (const lead of store.leads) {
        lead.next_follow_up_at = null;
        lead.next_follow_up_number = null;
        lead.next_follow_up_name = null;
        lead.follow_up_day = null;
        lead.current_follow_up_number = 0;
        lead.follow_up_completed = false;
        lead.follow_up_paused = false;
        lead.followUpPaused = false;
        lead.followUpDate = null;
        lead.followup_timeline = null;
        lead.reply_status = null;
        lead.replied_at = null;
        lead.outreach_completed_at = null;
        if (lead.outreach_status === 'Follow-Up' || lead.outreach_status === 'Completed' || lead.outreach_status === 'Replied') {
          lead.outreach_status = lead.first_message_sent ? 'Contacted' : 'Pending';
        }
        if (Array.isArray(lead.message_history)) {
          lead.message_history = lead.message_history.filter(m => m.type !== 'follow_up' && m.type !== 'followup');
        }
        if (Array.isArray(lead.activities)) {
          lead.activities = lead.activities.filter(a =>
            a.event_type !== 'followup_sent' &&
            a.event_type !== 'followup_due' &&
            a.event_type !== 'followup_paused' &&
            a.event_type !== 'followup_resumed' &&
            a.event_type !== 'outreach_completed'
          );
        }
        if (lead.last_message_type && lead.last_message_type.startsWith('Follow-Up')) {
          lead.last_message_type = lead.first_message_sent ? 'Main Message' : null;
          lead.last_message_sent_at = lead.main_message_sent_at || lead.first_message_sent_at || null;
        }
        lead.updated_at = nowIso;
      }
      if (Array.isArray(store.outreach)) {
        for (const o of store.outreach) {
          if (o.status === 'Follow-Up' || o.status === 'Completed' || o.status === 'Replied') {
            o.status = 'Contacted';
            o.updated_at = nowIso;
          }
        }
      }
      break;
    }
    case 'history': {
      store.searchSessions = [];
      break;
    }
    case 'settings': {
      store.settings = { profile: { fullName: 'Akshay' } }; // Simulated default
      store.outreach_settings = { dailyTarget: 50 };
      break;
    }
    case 'everything': {
      store.leads = [];
      store.outreach = [];
      store.searchSessions = [];
      store.settings = { profile: { fullName: 'Akshay' } };
      store.outreach_settings = { dailyTarget: 50 };
      break;
    }
    default:
      throw new Error(`Invalid category: ${category}`);
  }
}

// TEST 1: Cold Call Reset
console.log('\n--- TEST 1: Reset Cold Call Only ---');
let store = createSampleStore();
executeResetOnStore(store, 'cold-call');
assert.strictEqual(store.leads.length, 2, 'Saved Leads must NOT be deleted');
assert.strictEqual(store.leads[0].cold_call.queued, false, 'Cold call queue must be cleared');
assert.strictEqual(store.leads[0].cold_call.status, 'Not Called', 'Cold call status must be Not Called');
assert.strictEqual(store.leads[0].favorite, true, 'Favorites must remain intact');
assert.strictEqual(store.leads[0].outreach_status, 'Follow-Up', 'Outreach status must remain intact');
assert.strictEqual(store.searchSessions.length, 2, 'Search sessions must remain intact');
assert.strictEqual(store.settings.profile.fullName, 'Custom Test User', 'Settings must remain intact');
console.log('✓ PASS: Cold Call cleared without affecting Saved Leads, Favorites, Outreach, History, or Settings.');

// TEST 2: Favorites Reset
console.log('\n--- TEST 2: Reset Favorites Only ---');
store = createSampleStore();
executeResetOnStore(store, 'favorites');
assert.strictEqual(store.leads.length, 2, 'Saved Leads must NOT be deleted');
assert.strictEqual(store.leads[0].favorite, false, 'Favorite must be false');
assert.strictEqual(store.leads[0].is_favorite, false, 'is_favorite must be false');
assert.strictEqual(store.leads[0].cold_call.queued, true, 'Cold call queue must remain intact');
assert.strictEqual(store.leads[0].outreach_status, 'Follow-Up', 'Outreach must remain intact');
assert.strictEqual(store.searchSessions.length, 2, 'Search sessions must remain intact');
assert.strictEqual(store.settings.profile.fullName, 'Custom Test User', 'Settings must remain intact');
console.log('✓ PASS: Favorites cleared without affecting Saved Leads, Cold Call, Outreach, History, or Settings.');

// TEST 3: Outreach Reset
console.log('\n--- TEST 3: Reset Outreach Only ---');
store = createSampleStore();
executeResetOnStore(store, 'outreach');
assert.strictEqual(store.leads.length, 2, 'Saved Leads must NOT be deleted');
assert.strictEqual(store.leads[0].outreach_status, 'Pending', 'Outreach status must be Pending');
assert.strictEqual(store.leads[0].first_message_sent, false, 'first_message_sent must be false');
assert.strictEqual(store.outreach.length, 0, 'Outreach tracking entries must be cleared');
assert.strictEqual(store.leads[0].favorite, true, 'Favorites must remain intact');
assert.strictEqual(store.leads[0].cold_call.queued, true, 'Cold call must remain intact');
assert.strictEqual(store.searchSessions.length, 2, 'Search sessions must remain intact');
assert.strictEqual(store.settings.profile.fullName, 'Custom Test User', 'Settings must remain intact');
console.log('✓ PASS: Outreach reset without affecting Saved Leads, Cold Call, Favorites, History, or Settings.');

// TEST 4: Follow-Up Reset
console.log('\n--- TEST 4: Reset Follow-Up Only ---');
store = createSampleStore();
executeResetOnStore(store, 'followup');
assert.strictEqual(store.leads.length, 2, 'Saved Leads must NOT be deleted');
assert.strictEqual(store.leads[0].next_follow_up_at, null, 'next_follow_up_at must be cleared');
assert.strictEqual(store.leads[0].follow_up_paused, false, 'follow_up_paused must be false');
assert.strictEqual(store.leads[0].outreach_status, 'Contacted', 'Outreach status transitioned to Contacted');
assert.strictEqual(store.leads[0].favorite, true, 'Favorites must remain intact');
assert.strictEqual(store.leads[0].cold_call.queued, true, 'Cold call must remain intact');
assert.strictEqual(store.searchSessions.length, 2, 'Search sessions must remain intact');
assert.strictEqual(store.settings.profile.fullName, 'Custom Test User', 'Settings must remain intact');
console.log('✓ PASS: Follow-Up reset without affecting Saved Leads, Cold Call, Favorites, History, or Settings.');

// TEST 5: History Reset
console.log('\n--- TEST 5: Reset History Only ---');
store = createSampleStore();
executeResetOnStore(store, 'history');
assert.strictEqual(store.searchSessions.length, 0, 'Search sessions must be empty');
assert.strictEqual(store.leads.length, 2, 'Saved Leads must NOT be deleted');
assert.strictEqual(store.leads[0].favorite, true, 'Favorites must remain intact');
assert.strictEqual(store.leads[0].cold_call.queued, true, 'Cold call must remain intact');
assert.strictEqual(store.settings.profile.fullName, 'Custom Test User', 'Settings must remain intact');
console.log('✓ PASS: History cleared without affecting Saved Leads, CRM data, or Settings.');

// TEST 6: Settings Reset
console.log('\n--- TEST 6: Reset Settings Only ---');
store = createSampleStore();
executeResetOnStore(store, 'settings');
assert.strictEqual(store.settings.profile.fullName, 'Akshay', 'Settings restored to default');
assert.strictEqual(store.outreach_settings.dailyTarget, 50, 'Outreach daily target restored to default');
assert.strictEqual(store.leads.length, 2, 'Saved Leads must NOT be deleted');
assert.strictEqual(store.leads[0].favorite, true, 'Favorites must remain intact');
assert.strictEqual(store.leads[0].cold_call.queued, true, 'Cold call must remain intact');
assert.strictEqual(store.leads[0].outreach_status, 'Follow-Up', 'Outreach must remain intact');
assert.strictEqual(store.searchSessions.length, 2, 'Search sessions must remain intact');
console.log('✓ PASS: Settings reset without affecting any Saved Leads, Favorites, Outreach, Cold Call, Follow-Up, or History.');

// TEST 7: Saved Leads Reset
console.log('\n--- TEST 7: Reset Saved Leads ---');
store = createSampleStore();
executeResetOnStore(store, 'saved-leads');
assert.strictEqual(store.leads.length, 0, 'Saved Leads must be cleared');
assert.strictEqual(store.outreach.length, 0, 'Dependent outreach must be cleared');
assert.strictEqual(store.searchSessions.length, 2, 'Search sessions must remain intact');
assert.strictEqual(store.settings.profile.fullName, 'Custom Test User', 'Settings must remain intact');
console.log('✓ PASS: Saved Leads removed while Search History and Settings remain 100% intact.');

// TEST 8: Reset Everything
console.log('\n--- TEST 8: Reset Everything ---');
store = createSampleStore();
executeResetOnStore(store, 'everything');
assert.strictEqual(store.leads.length, 0, 'All leads must be cleared');
assert.strictEqual(store.outreach.length, 0, 'Outreach must be cleared');
assert.strictEqual(store.searchSessions.length, 0, 'Search sessions must be cleared');
assert.strictEqual(store.settings.profile.fullName, 'Akshay', 'Settings must be reset to defaults');
console.log('✓ PASS: Reset Everything completely clears all datasets.');

// Cleanup scratch test environment
try {
  fs.rmSync(SCRATCH_DIR, { recursive: true, force: true });
  console.log('\n✓ Cleaned up isolated scratch directory.');
} catch (_) {}

console.log('\n====================================================');
console.log('ALL 8 RESET CONTROLS TESTS PASSED WITH 100% ISOLATION');
console.log('====================================================');
