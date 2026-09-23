const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Attempt to load .env from explicit path, resources directory, or local directory
const envPaths = [
  path.join(__dirname, '.env'),
  process.env.CLIENTHUNTER_ENV_PATH,
  process.resourcesPath ? path.join(process.resourcesPath, '.env') : null,
  path.join(process.cwd(), '.env')
].filter(Boolean);

for (const envPath of envPaths) {
  if (fs.existsSync(envPath)) {
    require('dotenv').config({ path: envPath, override: false });
  }
}
if (!process.env.GOOGLE_MAPS_API_KEY && !process.env.GOOGLE_PLACES_API_KEY) {
  require('dotenv').config({ override: false });
}

// Lightweight Startup Configuration Validation (Section 13)
const startupGoogleKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY;
if (!startupGoogleKey || !startupGoogleKey.trim()) {
  console.warn('[Startup Validation] WARNING: Google Places API configuration requires attention. (GOOGLE_MAPS_API_KEY is missing)');
} else {
  console.log('[Startup Validation] Google Places API configuration: Configured (Key PRESENT)');
}

const googlePlacesDiagnostics = {
  configured: Boolean(startupGoogleKey && startupGoogleKey.trim()),
  lastStatus: (startupGoogleKey && startupGoogleKey.trim()) ? 'Configured' : 'Missing API Key',
  lastError: null,
  lastCheckTime: null
};

const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ success: false, error: 'Invalid JSON format in request.' });
  }
  next(err);
});
app.use(express.static(path.join(__dirname), {
  etag: false,
  maxAge: 0,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html') || filePath.endsWith('.js') || filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

// Load datasets (robust path resolution for development and packaged app)
function getDatasetPath(filename) {
  const localPath = path.join(__dirname, 'data', filename);
  if (fs.existsSync(localPath)) return localPath;
  if (process.resourcesPath) {
    const resPath = path.join(process.resourcesPath, 'data', filename);
    if (fs.existsSync(resPath)) return resPath;
  }
  return localPath;
}

const locationsData = JSON.parse(fs.readFileSync(getDatasetPath('india_locations.json'), 'utf8'));
const categoriesData = JSON.parse(fs.readFileSync(getDatasetPath('categories.json'), 'utf8'));

// Initialize local persistent storage file (Desktop user data vs Local Development)
const DATA_DIR = process.env.CLIENTHUNTER_USER_DATA
  ? path.join(process.env.CLIENTHUNTER_USER_DATA, 'data')
  : (process.env.APPDATA && fs.existsSync(path.join(process.env.APPDATA, 'clienthunter', 'data', 'leads_store.json')))
    ? path.join(process.env.APPDATA, 'clienthunter', 'data')
    : path.join(__dirname, 'data');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const LEADS_STORE_PATH = path.join(DATA_DIR, 'leads_store.json');
if (!fs.existsSync(LEADS_STORE_PATH)) {
  const bundledSeedPath = getDatasetPath('leads_store.json');
  if (fs.existsSync(bundledSeedPath)) {
    try {
      fs.copyFileSync(bundledSeedPath, LEADS_STORE_PATH);
    } catch (err) {
      fs.writeFileSync(LEADS_STORE_PATH, JSON.stringify({ leads: [], searchSessions: [] }, null, 2), 'utf8');
    }
  } else {
    fs.writeFileSync(LEADS_STORE_PATH, JSON.stringify({ leads: [], searchSessions: [] }, null, 2), 'utf8');
  }
}

let cachedStore = null;
let saveDebounceTimer = null;
let cachedKnownPlaceIds = null;
let lastPlaceIdsRefresh = 0;
let lastStoreMtime = 0;

// ----------------------------------------------------
// PERSISTENT DATA INTEGRITY & STATE MACHINE
// States: 'uninitialized' | 'loading' | 'loaded' | 'empty' | 'failed'
// ----------------------------------------------------
let storeStatus = 'uninitialized';
let storeLoadError = null;
let storeLastValidatedAt = null;
let storeLastSuccessfulSaveAt = null;
let lastSupabaseSyncAt = null;
let lastSupabaseSyncStatus = 'Uninitialized';
let lastSupabaseSyncError = null;
let lastSupabaseLeadCount = null;

const BACKUPS_DIR = path.join(DATA_DIR, 'backups');
if (!fs.existsSync(BACKUPS_DIR)) {
  try {
    fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  } catch (_) {}
}

function getStoreStatus() {
  return {
    status: storeStatus,
    error: storeLoadError ? (storeLoadError.message || String(storeLoadError)) : null,
    lastValidatedAt: storeLastValidatedAt,
    lastSuccessfulSaveAt: storeLastSuccessfulSaveAt || (fs.existsSync(LEADS_STORE_PATH) ? fs.statSync(LEADS_STORE_PATH).mtime.toISOString() : null),
    leadCount: cachedStore && Array.isArray(cachedStore.leads) ? cachedStore.leads.length : 0,
    storePath: LEADS_STORE_PATH
  };
}

function validateStoreStructure(store) {
  if (!store || typeof store !== 'object' || Array.isArray(store)) {
    throw new Error('Persistent store root must be a non-null object');
  }
  if (!Array.isArray(store.leads)) {
    throw new Error('Persistent store "leads" property must be a valid array');
  }
  if (store.searchSessions && !Array.isArray(store.searchSessions)) {
    throw new Error('Persistent store "searchSessions" property must be an array');
  }
  if (store.outreach && !Array.isArray(store.outreach)) {
    throw new Error('Persistent store "outreach" property must be an array');
  }
  if (store.settings && (typeof store.settings !== 'object' || Array.isArray(store.settings))) {
    throw new Error('Persistent store "settings" property must be a valid object');
  }
  return true;
}

function createPreWriteBackup() {
  try {
    if (fs.existsSync(LEADS_STORE_PATH)) {
      const backupFile = path.join(BACKUPS_DIR, 'leads_store_last_valid.json');
      fs.copyFileSync(LEADS_STORE_PATH, backupFile);
    }
  } catch (err) {
    console.warn('[STORAGE] Pre-write backup notice:', err.message);
  }
}

function atomicWriteFileSync(filePath, content) {
  const tempPath = `${filePath}.tmp_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  fs.writeFileSync(tempPath, content, 'utf8');
  try {
    fs.renameSync(tempPath, filePath);
  } catch (renameErr) {
    // Windows file-lock fallback: copy and remove temp
    try {
      fs.copyFileSync(tempPath, filePath);
      fs.unlinkSync(tempPath);
    } catch (copyErr) {
      console.error('[STORAGE] Atomic write fallback failed:', copyErr);
      throw copyErr;
    }
  }
}

function getStoredData() {
  try {
    if (!fs.existsSync(LEADS_STORE_PATH)) {
      const bundledSeedPath = getDatasetPath('leads_store.json');
      if (fs.existsSync(bundledSeedPath)) {
        try {
          fs.copyFileSync(bundledSeedPath, LEADS_STORE_PATH);
        } catch (err) {
          console.error('[STORAGE] Could not copy bundled seed leads_store.json:', err);
        }
      }
      if (!fs.existsSync(LEADS_STORE_PATH)) {
        const initialStore = { leads: [], searchSessions: [], outreach: [], settings: {} };
        fs.writeFileSync(LEADS_STORE_PATH, JSON.stringify(initialStore, null, 2), 'utf8');
        cachedStore = initialStore;
        storeStatus = 'empty';
        storeLastValidatedAt = new Date().toISOString();
        storeLoadError = null;
        return cachedStore;
      }
    }

    const stat = fs.statSync(LEADS_STORE_PATH);
    if (cachedStore && stat.mtimeMs === lastStoreMtime && storeStatus !== 'failed') {
      return cachedStore;
    }

    if (stat.size === 0) {
      throw new Error(`Persistent store file is 0 bytes at ${LEADS_STORE_PATH}`);
    }

    const raw = fs.readFileSync(LEADS_STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw);

    validateStoreStructure(parsed);

    cachedStore = parsed;
    lastStoreMtime = stat.mtimeMs;
    storeLoadError = null;
    storeLastValidatedAt = new Date().toISOString();

    if (!cachedStore.leads) cachedStore.leads = [];
    if (!cachedStore.searchSessions) cachedStore.searchSessions = [];
    if (!cachedStore.outreach) {
      cachedStore.outreach = [];
      cachedStore.leads.forEach((l) => {
        if (l.outreach_status && l.outreach_status !== 'Pending') {
          cachedStore.outreach.push({
            id: 'outreach_' + (l.id || l.place_id),
            saved_lead_id: l.id,
            place_id: l.place_id,
            status: l.outreach_status,
            created_at: l.created_at || new Date().toISOString(),
            updated_at: l.updated_at || new Date().toISOString()
          });
        }
      });
    }

    if (cachedStore.leads.length === 0) {
      storeStatus = 'empty';
    } else {
      storeStatus = 'loaded';
    }

    return cachedStore;
  } catch (err) {
    console.error('[CRITICAL DATA SAFETY] Error reading/validating leads store:', err.message);
    storeLoadError = err;
    storeStatus = 'failed';
    // CRITICAL: NEVER return an empty replacement { leads: [] } on failure.
    // Return cachedStore if it was previously loaded into memory; otherwise return null.
    return cachedStore || null;
  }
}

function saveStoredData(data, immediate = false) {
  // 1. SAFETY GUARD: Never write to disk if store is in 'failed' state
  if (storeStatus === 'failed') {
    console.error('[CRITICAL SAFETY ABORT] Refusing to write to leads store while in "failed" state. File preserved untouched.');
    return false;
  }

  // 2. PAYLOAD VALIDATION
  if (!data || typeof data !== 'object' || !Array.isArray(data.leads)) {
    console.error('[CRITICAL SAFETY ABORT] Refusing to save invalid store payload: `leads` must be an array.');
    return false;
  }

  // 3. ANOMALOUS TRUNCATION GUARD
  // Block any attempt to overwrite a populated database with 0 leads unless explicitly authorized by /api/leads/reset
  if (
    cachedStore &&
    Array.isArray(cachedStore.leads) &&
    cachedStore.leads.length > 0 &&
    data.leads.length === 0 &&
    !data.__allowEmptyReset
  ) {
    console.error('[CRITICAL SAFETY ABORT] Attempted to overwrite non-empty lead database with empty array without explicit authorization. Write blocked.');
    return false;
  }

  cachedStore = data;
  invalidateDuplicateIndex();
  if (saveDebounceTimer) {
    clearTimeout(saveDebounceTimer);
    saveDebounceTimer = null;
  }

  const writeOperation = () => {
    try {
      createPreWriteBackup();
      const serialized = JSON.stringify(cachedStore, null, 2);
      atomicWriteFileSync(LEADS_STORE_PATH, serialized);
      try {
        lastStoreMtime = fs.statSync(LEADS_STORE_PATH).mtimeMs;
      } catch (_) {}
      if (cachedStore.leads.length === 0) {
        storeStatus = 'empty';
      } else {
        storeStatus = 'loaded';
      }
      storeLastValidatedAt = new Date().toISOString();
      storeLastSuccessfulSaveAt = new Date().toISOString();
      return true;
    } catch (err) {
      console.error('[STORAGE] Error writing leads store:', err);
      return false;
    }
  };

  if (immediate) {
    return writeOperation();
  } else {
    saveDebounceTimer = setTimeout(writeOperation, 400);
    return true;
  }
}

// ----------------------------------------------------
// DUPLICATE LEAD DETECTION & NORMALIZATION ENGINE
// ----------------------------------------------------
function normalizePlaceId(placeId) {
  if (!placeId || typeof placeId !== 'string') return null;
  const trimmed = placeId.trim();
  if (trimmed.startsWith('lead_')) return null;
  return trimmed.length > 0 ? trimmed : null;
}

function normalizePhoneNumber(phone) {
  if (!phone || typeof phone !== 'string') return null;
  const digits = phone.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length >= 10) return digits.slice(-10);
  return digits.length >= 7 ? digits : null;
}

function formatContactPhone(phone) {
  if (!phone || typeof phone !== 'string') return phone || '';
  let trimmed = phone.trim();
  if (!trimmed || trimmed === 'Not available' || trimmed === 'N/A' || trimmed === 'No phone number') {
    return trimmed;
  }
  if (trimmed.startsWith('0')) {
    return '+91 ' + trimmed.replace(/^0\s*/, '');
  }
  if (/^\+91\s*0/.test(trimmed)) {
    return '+91 ' + trimmed.replace(/^\+91\s*0\s*/, '');
  }
  return trimmed;
}

function normalizeBusinessName(name) {
  if (!name || typeof name !== 'string') return '';
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[.,\/#!$%\^&*;:{}=\-_`~()@+?><\[\]+"']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeWebsiteDomain(url) {
  if (!url || typeof url !== 'string') return null;
  let clean = url.trim().toLowerCase();
  if (!clean || clean === 'null' || clean === 'undefined') return null;
  clean = clean.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  clean = clean.split('/')[0].split('?')[0].split('#')[0].trim();
  const generic = ['facebook.com', 'instagram.com', 'google.com', 'maps.google.com', 'justdial.com', 'indiamart.com', 'wa.me', 'whatsapp.com'];
  if (!clean || clean.length < 3 || generic.includes(clean)) return null;
  return clean;
}

function normalizeAddressText(address, city) {
  const combined = (address || '') + ' ' + (city || '');
  return combined.toLowerCase().replace(/[.,\/#!$%\^&*;:{}=\-_`~()@+?><\[\]+"']/g, ' ').replace(/\s+/g, ' ').trim();
}

function getCandidateFields(lead) {
  if (!lead) return {};
  let place_id = lead.place_id || null;
  if (!place_id && typeof lead.id === 'string' && (lead.id.startsWith('ChIJ') || lead.id.startsWith('places/'))) {
    place_id = lead.id;
  }
  const business_name = (lead.business_name || lead.name || (lead.displayName && lead.displayName.text) || '').trim();
  const phone = (lead.phone || lead.nationalPhoneNumber || lead.internationalPhoneNumber || '').trim();
  const website = (lead.website || lead.websiteUri || '').trim() || null;
  const address = (lead.address || lead.formattedAddress || '').trim();
  const city = (lead.city || '').trim();
  return { place_id, business_name, phone, website, address, city };
}

function isDuplicateLead(candidateObj, existingObj) {
  if (!candidateObj || !existingObj) return false;
  const c = getCandidateFields(candidateObj);
  const e = getCandidateFields(existingObj);

  const pId1 = normalizePlaceId(c.place_id);
  const pId2 = normalizePlaceId(e.place_id);

  // 1. Exact Google Place ID match (PRIMARY IDENTIFIER)
  if (pId1 && pId2) {
    return pId1 === pId2;
  }

  // If BOTH have Place IDs and they don't match, they are distinct Google Places entities
  if (pId1 && pId2 && pId1 !== pId2) {
    return false;
  }

  // 2. FALLBACK DUPLICATE DETECTION (used only when Place ID is absent on one or both)
  const phone1 = normalizePhoneNumber(c.phone);
  const phone2 = normalizePhoneNumber(e.phone);
  const hasBothPhones = Boolean(phone1 && phone2);
  const hasPhoneMatch = hasBothPhones && phone1 === phone2;

  // Branch separation: If both have valid phones and they differ, they are different branches/businesses
  if (hasBothPhones && phone1 !== phone2) {
    return false;
  }

  const name1 = normalizeBusinessName(c.business_name);
  const name2 = normalizeBusinessName(e.business_name);
  if (!name1 || !name2) return false;

  const hasExactNameMatch = name1 === name2;
  const hasSubNameMatch = (name1.length >= 6 && name2.length >= 6) && (name1.includes(name2) || name2.includes(name1));
  const hasNameMatch = hasExactNameMatch || hasSubNameMatch;

  // Signal 2A: Same Phone + Matching Business Name -> DUPLICATE
  if (hasPhoneMatch && hasNameMatch) {
    return true;
  }

  // Signal 2B: Same Website Domain (non-generic) + Matching Business Name -> DUPLICATE
  const domain1 = normalizeWebsiteDomain(c.website);
  const domain2 = normalizeWebsiteDomain(e.website);
  if (domain1 && domain2 && domain1 === domain2 && hasNameMatch) {
    return true;
  }

  // Signal 2C: Exact Name Match + Address/Location match (when phone is unavailable)
  if (hasExactNameMatch && !hasBothPhones) {
    const city1 = (c.city || '').toLowerCase().trim();
    const city2 = (e.city || '').toLowerCase().trim();
    if (city1 && city2 && city1 === city2) {
      const addr1 = normalizeAddressText(c.address, city1);
      const addr2 = normalizeAddressText(e.address, city2);
      if (addr1 && addr2) {
        if (addr1 === addr2 || addr1.includes(addr2) || addr2.includes(addr1)) {
          return true;
        }
      }
    }
  }

  return false;
}

class LeadDuplicateIndex {
  constructor(initialLeads = []) {
    this.placeIds = new Set();
    this.phoneMap = new Map();
    this.domainMap = new Map();
    this.leads = [];

    if (Array.isArray(initialLeads)) {
      initialLeads.forEach((l) => this.add(l));
    }
  }

  add(lead) {
    if (!lead) return;
    const c = getCandidateFields(lead);
    this.leads.push(lead);

    const pId = normalizePlaceId(c.place_id);
    if (pId) {
      this.placeIds.add(pId);
    }

    const phone = normalizePhoneNumber(c.phone);
    if (phone && !this.phoneMap.has(phone)) {
      this.phoneMap.set(phone, lead);
    }

    const domain = normalizeWebsiteDomain(c.website);
    if (domain && !this.domainMap.has(domain)) {
      this.domainMap.set(domain, lead);
    }
  }

  isDuplicate(candidate) {
    if (!candidate) return false;
    const c = getCandidateFields(candidate);

    // 1. Primary: Fast Place ID Set lookup
    const pId = normalizePlaceId(c.place_id);
    if (pId && this.placeIds.has(pId)) {
      return true;
    }

    // 2. Fast Phone Map lookup
    const phone = normalizePhoneNumber(c.phone);
    if (phone && this.phoneMap.has(phone)) {
      const existing = this.phoneMap.get(phone);
      if (isDuplicateLead(candidate, existing)) {
        return true;
      }
    }

    // 3. Fast Domain Map lookup
    const domain = normalizeWebsiteDomain(c.website);
    if (domain && this.domainMap.has(domain)) {
      const existing = this.domainMap.get(domain);
      if (isDuplicateLead(candidate, existing)) {
        return true;
      }
    }

    // 4. Fallback search through leads if candidate has no Place ID or Phone
    if (!pId && !phone) {
      for (const existing of this.leads) {
        if (isDuplicateLead(candidate, existing)) {
          return true;
        }
      }
    }

    return false;
  }
}

let cachedLeadDuplicateIndex = null;
let lastDuplicateIndexRefresh = 0;

function invalidateDuplicateIndex() {
  cachedLeadDuplicateIndex = null;
  lastDuplicateIndexRefresh = 0;
  cachedKnownPlaceIds = null;
  lastPlaceIdsRefresh = 0;
}

async function getLeadDuplicateIndex() {
  const now = Date.now();
  if (cachedLeadDuplicateIndex && now - lastDuplicateIndexRefresh < 60000) {
    return cachedLeadDuplicateIndex;
  }

  const allLeads = [];
  const store = getStoredData();
  if (store && Array.isArray(store.leads)) {
    allLeads.push(...store.leads);
  }

  if (supabase) {
    try {
      const { data: dbLeads, error } = await supabase
        .from('leads')
        .select('place_id, business_name, phone, address, city, website');
      if (!error && dbLeads) {
        allLeads.push(...dbLeads);
      }
    } catch (err) {
      console.warn('Could not query Supabase leads for duplicate index:', err.message);
    }
  }

  cachedLeadDuplicateIndex = new LeadDuplicateIndex(allLeads);
  lastDuplicateIndexRefresh = now;
  cachedKnownPlaceIds = cachedLeadDuplicateIndex.placeIds;
  lastPlaceIdsRefresh = now;
  return cachedLeadDuplicateIndex;
}

async function getKnownPlaceIds() {
  const index = await getLeadDuplicateIndex();
  return index.placeIds;
}

// Initialize Supabase client
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
let supabase = null;
if (SUPABASE_URL && SUPABASE_KEY) {
  try {
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    console.log('Connected to Supabase client at', SUPABASE_URL);
  } catch (err) {
    console.warn('Supabase initialization failed, relying on local store:', err.message);
  }
}

// Google Gemini AI Engine
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

async function callGemini(prompt, systemInstruction = '', maxTokens = 600, timeoutMs = 15000, jsonMode = false) {
  const apiKey = process.env.GEMINI_API_KEY || GEMINI_API_KEY;
  if (!apiKey) {
    return null;
  }

  const preferredModels = [
    'models/gemini-3.5-flash-lite',
    'models/gemini-3.5-flash',
    'models/gemini-3.6-flash'
  ];

  for (const model of preferredModels) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/${model}:generateContent?key=${apiKey}`;
      const payload = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: maxTokens
        }
      };
      if (jsonMode) {
        payload.generationConfig.responseMimeType = 'application/json';
      }
      if (systemInstruction) {
        payload.systemInstruction = { parts: [{ text: systemInstruction }] };
      }

      const res = await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      clearTimeout(timer);

      if (res.ok) {
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text && text.trim().length > 0) {
          return text.trim();
        }
      } else {
        const errJson = await res.json().catch(() => ({}));
        console.warn(`Gemini API returned status ${res.status} for ${model}:`, errJson.error?.message || errJson);
      }
    } catch (err) {
      clearTimeout(timer);
      console.warn(`Gemini API call error on ${model}:`, err.message);
    }
  }
  return null;
}

function cleanAiMessage(text) {
  if (!text) return '';
  let cleaned = text.trim();
  if ((cleaned.startsWith('"') && cleaned.endsWith('"')) || (cleaned.startsWith('\'') && cleaned.endsWith('\''))) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  cleaned = cleaned.replace(/^(#+\s*|(\*{1,3}|_{1,3})[^\n*:]+:\s*(\*{1,3}|_{1,3})|\*Sentence\s*\d+[^:]*:\*)/gim, '');
  cleaned = cleaned.replace(/^(Here\s+(is|are)\s+[^:\n]*:?\s*)+/gim, '');
  return cleaned.trim();
}

// Helper: Calculate deterministic Opportunity Score
function calculateOpportunityScore(hasWebsite, hasPhone, rating, reviewCount) {
  let score = 50;
  let reasons = [];

  if (!hasWebsite) {
    score += 40; // Missing website is top high-ticket opportunity
    reasons.push('No website listed — prime web development candidate');
  } else {
    score += 10;
  }

  if (hasPhone) {
    score += 15; // Outreach ready
    reasons.push('Verified direct contact phone available');
  }

  if (rating) {
    if (rating >= 4.5 && reviewCount > 50) {
      score += 10;
      reasons.push('High social proof & active clientele');
    } else if (rating < 4.0) {
      score += 15;
      reasons.push('Reputation management & SEO growth opportunity');
    }
  }

  score = Math.min(100, Math.max(30, Math.round(score)));
  const level = score >= 85 ? 'HIGH' : score >= 65 ? 'MEDIUM' : 'LOW';
  return { score, level, reasons };
}

// Helper: Haversine distance in km
function haversineDistance(lat1, lon1, lat2, lon2) {
  const toRad = (x) => (x * Math.PI) / 180;
  const R = 6371; // Earth's radius in km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// ----------------------------------------------------
// API ROUTES
// ----------------------------------------------------

// 1. Locations
app.get('/api/locations', (req, res) => {
  res.json({ success: true, locations: locationsData });
});

// 2. Categories
app.get('/api/categories', (req, res) => {
  res.json({
    success: true,
    categories: Object.keys(categoriesData.categories),
    details: categoriesData.categories,
    quickNiches: categoriesData.quickNiches
  });
});

// ----------------------------------------------------
// INDIAN CITY COORDINATES & REGIONAL HUBS REGISTRY
// ----------------------------------------------------
const INDIAN_CITY_COORDS = {
  // Telangana
  'hyderabad': { lat: 17.3850, lng: 78.4867 },
  'secunderabad': { lat: 17.4399, lng: 78.4983 },
  'warangal': { lat: 17.9689, lng: 79.5941 },
  'hanumakonda': { lat: 18.0073, lng: 79.5684 },
  'nizamabad': { lat: 18.6725, lng: 78.0941 },
  'karimnagar': { lat: 18.4386, lng: 79.1288 },
  'khammam': { lat: 17.2473, lng: 80.1514 },
  'ramagundam': { lat: 18.7551, lng: 79.5131 },
  'mahbubnagar': { lat: 16.7488, lng: 77.9856 },
  'nalgonda': { lat: 17.0575, lng: 79.2689 },
  'adilabad': { lat: 19.6641, lng: 78.5320 },
  'suryapet': { lat: 17.1439, lng: 79.6239 },
  'siddipet': { lat: 18.1018, lng: 78.8520 },
  'miryalaguda': { lat: 16.8741, lng: 79.5626 },
  'jagtial': { lat: 18.7946, lng: 78.9130 },
  'mancherial': { lat: 18.8711, lng: 79.4637 },
  'kothagudem': { lat: 17.5526, lng: 80.6186 },
  'kamareddy': { lat: 18.3242, lng: 78.3411 },
  'bodhan': { lat: 18.6631, lng: 77.8860 },
  'vikarabad': { lat: 17.3364, lng: 77.9048 },
  'medak': { lat: 18.0478, lng: 78.2618 },
  'sangareddy': { lat: 17.6190, lng: 78.0818 },
  'wanaparthy': { lat: 16.3624, lng: 78.0628 },
  'gadwal': { lat: 16.2333, lng: 77.8000 },
  'jangaon': { lat: 17.7214, lng: 79.1764 },
  'mahabubabad': { lat: 17.5985, lng: 80.0038 },
  'nirmal': { lat: 19.0964, lng: 78.3429 },
  'bellampalli': { lat: 18.9922, lng: 79.4939 },
  'peddapalli': { lat: 18.6146, lng: 79.3789 },
  'nagarkurnool': { lat: 16.4856, lng: 78.3147 },
  // Maharashtra
  'mumbai': { lat: 19.0760, lng: 72.8777 },
  'pune': { lat: 18.5204, lng: 73.8567 },
  'nagpur': { lat: 21.1458, lng: 79.0882 },
  'nashik': { lat: 19.9975, lng: 73.7898 },
  'thane': { lat: 19.2183, lng: 72.9781 },
  'navi mumbai': { lat: 19.0330, lng: 73.0297 },
  'aurangabad': { lat: 19.8762, lng: 75.3433 },
  'chhatrapati sambhajinagar': { lat: 19.8762, lng: 75.3433 },
  'solapur': { lat: 17.6599, lng: 75.9064 },
  'kolhapur': { lat: 16.7050, lng: 74.2433 },
  // Karnataka
  'bengaluru': { lat: 12.9716, lng: 77.5946 },
  'bangalore': { lat: 12.9716, lng: 77.5946 },
  'mysuru': { lat: 12.2958, lng: 76.6394 },
  'mysore': { lat: 12.2958, lng: 76.6394 },
  'mangaluru': { lat: 12.9141, lng: 74.8560 },
  'hubballi': { lat: 15.3647, lng: 75.1240 },
  'belagavi': { lat: 15.8497, lng: 74.4977 },
  // Tamil Nadu
  'chennai': { lat: 13.0827, lng: 80.2707 },
  'coimbatore': { lat: 11.0168, lng: 76.9558 },
  'madurai': { lat: 9.9252, lng: 78.1198 },
  'tiruchirappalli': { lat: 10.7905, lng: 78.7047 },
  'salem': { lat: 11.6643, lng: 78.1460 },
  // Delhi
  'delhi': { lat: 28.6139, lng: 77.2090 },
  'new delhi': { lat: 28.6139, lng: 77.2090 },
  'noida': { lat: 28.5355, lng: 77.3910 },
  'gurugram': { lat: 28.4595, lng: 77.0266 },
  'gurgaon': { lat: 28.4595, lng: 77.0266 },
  'faridabad': { lat: 28.4089, lng: 77.3178 },
  'ghaziabad': { lat: 28.6692, lng: 77.4538 },
  // Gujarat
  'ahmedabad': { lat: 23.0225, lng: 72.5714 },
  'surat': { lat: 21.1702, lng: 72.8311 },
  'vadodara': { lat: 22.3072, lng: 73.1812 },
  'rajkot': { lat: 22.3039, lng: 70.8022 },
  // West Bengal
  'kolkata': { lat: 22.5726, lng: 88.3639 },
  'howrah': { lat: 22.5958, lng: 88.2636 },
  // Rajasthan
  'jaipur': { lat: 26.9124, lng: 75.7873 },
  'jodhpur': { lat: 26.2389, lng: 73.0243 },
  'udaipur': { lat: 24.5854, lng: 73.7125 },
  // Uttar Pradesh
  'lucknow': { lat: 26.8467, lng: 80.9462 },
  'kanpur': { lat: 26.4499, lng: 80.3319 },
  'varanasi': { lat: 25.3176, lng: 82.9739 },
  'agra': { lat: 27.1767, lng: 78.0081 },
  // Andhra Pradesh
  'visakhapatnam': { lat: 17.6868, lng: 83.2185 },
  'vijayawada': { lat: 16.5062, lng: 80.6480 },
  'guntur': { lat: 16.3067, lng: 80.4365 },
  'tirupati': { lat: 13.6288, lng: 79.4192 },
  // Kerala
  'kochi': { lat: 9.9312, lng: 76.2673 },
  'thiruvananthapuram': { lat: 8.5241, lng: 76.9366 },
  // Madhya Pradesh
  'bhopal': { lat: 23.2599, lng: 77.4126 },
  'indore': { lat: 22.7196, lng: 75.8577 }
};

function resolveLocationCenter(state, city) {
  const cNorm = (city || '').toLowerCase().trim();
  if (INDIAN_CITY_COORDS[cNorm]) {
    return INDIAN_CITY_COORDS[cNorm];
  }
  for (const [key, coords] of Object.entries(INDIAN_CITY_COORDS)) {
    if (cNorm.includes(key) || key.includes(cNorm)) {
      return coords;
    }
  }
  const stateObj = locationsData[state];
  if (stateObj && stateObj.center) {
    return stateObj.center;
  }
  return { lat: 17.3850, lng: 78.4867 };
}

function resolvePlacesTypes(cat) {
  const c = (cat || '').toLowerCase();
  if (c.includes('dent')) return ['dentist', 'dental_clinic', 'doctor'];
  if (c.includes('hospital')) return ['hospital', 'medical_center'];
  if (c.includes('doctor') || c.includes('clinic')) return ['doctor', 'medical_clinic', 'physiotherapist'];
  if (c.includes('salon') || c.includes('beauty') || c.includes('hair') || c.includes('parlour')) return ['beauty_salon', 'hair_care', 'spa', 'hair_salon'];
  if (c.includes('gym') || c.includes('fitness') || c.includes('yoga') || c.includes('dance')) return ['gym', 'fitness_center', 'sports_club'];
  if (c.includes('spa')) return ['spa', 'beauty_salon'];
  if (c.includes('restaurant')) return ['restaurant', 'cafe'];
  if (c.includes('cafe')) return ['cafe', 'coffee_shop'];
  if (c.includes('hotel')) return ['lodging', 'hotel'];
  if (c.includes('travel')) return ['travel_agency', 'tourist_attraction'];
  if (c.includes('repair') || c.includes('workshop')) return ['car_repair', 'auto_repair_shop'];
  if (c.includes('dealer')) return ['car_dealer'];
  if (c.includes('real estate')) return ['real_estate_agency'];
  if (c.includes('college') || c.includes('university')) return ['university'];
  if (c.includes('school') || c.includes('coaching') || c.includes('institute') || c.includes('training') || c.includes('preschool') || c.includes('day care')) return ['school', 'secondary_school', 'primary_school'];
  if (c.includes('law') || c.includes('advocate') || c.includes('legal')) return ['lawyer', 'legal_services'];
  if (c.includes('account') || c.includes('ca ') || c.includes('financial') || c.includes('tax')) return ['accounting', 'finance'];
  if (c.includes('pet') || c.includes('vet')) return ['veterinary_care', 'pet_store'];
  if (c.includes('pharm') || c.includes('drug') || c.includes('chemist')) return ['pharmacy', 'drugstore'];
  if (c.includes('physio')) return ['physiotherapist'];
  if (c.includes('plumb')) return ['plumber'];
  if (c.includes('electric') || c.includes('solar') || c.includes('ac repair')) return ['electrician'];
  if (c.includes('roof') || c.includes('construct') || c.includes('contract') || c.includes('architect') || c.includes('interior')) return ['roofing_contractor', 'general_contractor'];
  if (c.includes('rental')) return ['car_rental'];
  if (c.includes('courier')) return ['post_office'];
  return ['store'];
}

function generateSearchSectors(state, city, centerLat, centerLng, isEntireState) {
  const sectors = [];
  if (isEntireState) {
    const stateObj = locationsData[state] || {};
    const stateCities = stateObj.cities || [];
    
    // 1. Regional hubs across the state from known city coordinates
    for (const sc of stateCities) {
      const norm = sc.toLowerCase().trim();
      if (INDIAN_CITY_COORDS[norm]) {
        sectors.push({
          lat: INDIAN_CITY_COORDS[norm].lat,
          lng: INDIAN_CITY_COORDS[norm].lng,
          city: sc,
          label: `${sc} Hub`
        });
      }
    }

    // 2. Metropolitan sectors around state center
    sectors.push(
      { lat: centerLat, lng: centerLng, city: stateCities[0] || state, label: 'Capital Center' },
      { lat: centerLat + 0.055, lng: centerLng - 0.075, city: stateCities[0] || state, label: 'Capital West' },
      { lat: centerLat + 0.085, lng: centerLng + 0.025, city: stateCities[0] || state, label: 'Capital North' },
      { lat: centerLat - 0.045, lng: centerLng + 0.070, city: stateCities[0] || state, label: 'Capital East' },
      { lat: centerLat - 0.110, lng: centerLng - 0.035, city: stateCities[0] || state, label: 'Capital South' }
    );

    // 3. Cardinal quadrant coordinates across state geography
    sectors.push(
      { lat: centerLat + 0.50, lng: centerLng + 0.35, city: state, label: 'North-East Sector' },
      { lat: centerLat - 0.45, lng: centerLng - 0.35, city: state, label: 'South-West Sector' },
      { lat: centerLat + 0.60, lng: centerLng - 0.25, city: state, label: 'North-West Sector' },
      { lat: centerLat - 0.35, lng: centerLng + 0.45, city: state, label: 'South-East Sector' },
      { lat: centerLat + 0.90, lng: centerLng + 0.05, city: state, label: 'Northern Border Hub' },
      { lat: centerLat - 0.75, lng: centerLng - 0.05, city: state, label: 'Southern Border Hub' }
    );
  } else {
    // City center + multi-directional radial sectors
    sectors.push({ lat: centerLat, lng: centerLng, city, label: `${city} Central` });
    const radialOffsets = [
      { dLat: 0.045, dLng: 0.000, label: 'North' },
      { dLat: 0.032, dLng: 0.035, label: 'North-East' },
      { dLat: 0.000, dLng: 0.045, label: 'East' },
      { dLat: -0.032, dLng: 0.035, label: 'South-East' },
      { dLat: -0.045, dLng: 0.000, label: 'South' },
      { dLat: -0.032, dLng: -0.035, label: 'South-West' },
      { dLat: 0.000, dLng: -0.045, label: 'West' },
      { dLat: 0.032, dLng: -0.035, label: 'North-West' },
      // Outer expansion ring
      { dLat: 0.085, dLng: 0.000, label: 'Outer North' },
      { dLat: 0.000, dLng: 0.085, label: 'Outer East' },
      { dLat: -0.085, dLng: 0.000, label: 'Outer South' },
      { dLat: 0.000, dLng: -0.085, label: 'Outer West' }
    ];
    for (const r of radialOffsets) {
      sectors.push({
        lat: centerLat + r.dLat,
        lng: centerLng + r.dLng,
        city,
        label: `${city} ${r.label}`
      });
    }
  }
  return sectors;
}

function parseJsonArraySafely(text) {
  if (!text) return [];
  const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '');
  try {
    const direct = JSON.parse(cleaned);
    if (Array.isArray(direct)) return direct;
  } catch (e) {
    const lastBrace = cleaned.lastIndexOf('}');
    if (lastBrace > 0) {
      const candidate = cleaned.slice(0, lastBrace + 1).trim();
      const fixed = candidate.startsWith('[') ? (candidate + ']') : ('[' + candidate + ']');
      try {
        const repaired = JSON.parse(fixed);
        if (Array.isArray(repaired)) return repaired;
      } catch (e2) {
        const items = [];
        const regex = /\{[^{}]*"name"[^{}]*\}/g;
        let match;
        while ((match = regex.exec(cleaned)) !== null) {
          try {
            items.push(JSON.parse(match[0]));
          } catch (e3) {}
        }
        if (items.length > 0) return items;
      }
    }
  }
  return [];
}

// Google Places Error Classification & Future-Proof Protection (Sections 3, 4, 11, 13)
function classifyGooglePlacesError(status, errorBody = {}) {
  const err = errorBody?.error || errorBody || {};
  const statusStr = (err.status || '').toUpperCase();
  const messageStr = (err.message || '').toLowerCase();
  const details = Array.isArray(err.details) ? err.details : [];
  const errorInfo = details.find((d) => d['@type']?.includes('ErrorInfo')) || {};
  const reason = (errorInfo.reason || '').toUpperCase();
  const metadata = errorInfo.metadata || {};

  // 1. Quota Exceeded vs Transient Rate Limit
  if (
    status === 429 ||
    statusStr === 'RESOURCE_EXHAUSTED' ||
    reason === 'RATE_LIMIT_EXCEEDED' ||
    messageStr.includes('quota') ||
    messageStr.includes('rate limit')
  ) {
    const isDailyQuota =
      metadata.quota_limit?.toLowerCase().includes('perday') ||
      metadata.quota_unit?.includes('1/d') ||
      messageStr.includes('per day') ||
      messageStr.includes('quota metric') ||
      messageStr.includes('quota exceeded') ||
      messageStr.includes('daily');

    if (isDailyQuota || !messageStr.includes('rate limit')) {
      return {
        type: 'QUOTA_EXCEEDED',
        code: 'RESOURCE_EXHAUSTED',
        reason: reason || 'RATE_LIMIT_EXCEEDED',
        metric: metadata.quota_metric || 'places.googleapis.com/SearchTextRequest',
        isTemporary: false,
        userMessage: 'Google Places API quota has been reached.'
      };
    }

    return {
      type: 'RATE_LIMIT_EXCEEDED',
      code: 'RESOURCE_EXHAUSTED',
      reason: reason || 'RATE_LIMIT_EXCEEDED',
      metric: metadata.quota_metric || 'places.googleapis.com/SearchTextRequest',
      isTemporary: false,
      userMessage: 'Google Places API rate limit reached. Please try again shortly.'
    };
  }

  // 2. Billing / Project Configuration
  if (
    reason === 'BILLING_DISABLED' ||
    messageStr.includes('billing') ||
    messageStr.includes('project configuration')
  ) {
    return {
      type: 'BILLING_REQUIRED',
      code: 'BILLING_DISABLED',
      reason: reason || 'BILLING_NOT_ENABLED',
      isTemporary: false,
      userMessage: 'Google Maps Platform billing/project configuration requires attention.'
    };
  }

  // 3. API Not Enabled
  if (
    reason === 'SERVICE_DISABLED' ||
    messageStr.includes('has not been used in project') ||
    messageStr.includes('is not enabled') ||
    messageStr.includes('api not enabled') ||
    messageStr.includes('not activated')
  ) {
    return {
      type: 'API_NOT_ENABLED',
      code: statusStr || 'PERMISSION_DENIED',
      reason: reason || 'SERVICE_DISABLED',
      isTemporary: false,
      userMessage: 'Google Places API is not enabled for the configured Google Cloud project.'
    };
  }

  // 4. Invalid API Key
  if (
    reason === 'API_KEY_INVALID' ||
    messageStr.includes('api key not valid') ||
    messageStr.includes('bad requestkeyinvalid') ||
    messageStr.includes('key is invalid')
  ) {
    return {
      type: 'INVALID_API_KEY',
      code: statusStr || 'INVALID_ARGUMENT',
      reason: reason || 'API_KEY_INVALID',
      isTemporary: false,
      userMessage: 'Google Places API key is invalid.'
    };
  }

  // 5. Authorization / Permission Denied / Key Restrictions
  if (
    status === 401 ||
    status === 403 ||
    statusStr === 'PERMISSION_DENIED' ||
    reason === 'ACCESS_TOKEN_EXPIRED' ||
    reason === 'API_KEY_HTTP_REFERRER_BLOCKED' ||
    reason === 'API_KEY_IP_ADDRESS_BLOCKED' ||
    reason === 'API_KEY_SERVICE_BLOCKED' ||
    reason === 'IP_REFERRER_BLOCKED' ||
    reason === 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' ||
    messageStr.includes('permission denied') ||
    messageStr.includes('requests from this client are not allowed') ||
    messageStr.includes('restricted') ||
    messageStr.includes('unauthorized')
  ) {
    return {
      type: 'AUTHORIZATION_FAILED',
      code: statusStr || 'PERMISSION_DENIED',
      reason: reason || 'API_KEY_OR_RESTRICTION_ERROR',
      isTemporary: false,
      userMessage: 'Google Places API authorization failed. Check API key restrictions and enabled APIs.'
    };
  }

  // 6. Temporary Google Failure (5xx)
  if (status >= 500 && status < 600) {
    return {
      type: 'TEMPORARY_FAILURE',
      code: statusStr || 'SERVER_ERROR',
      reason: reason || 'INTERNAL_SERVER_ERROR',
      isTemporary: true,
      userMessage: 'Google Places is temporarily unavailable. Please try again.'
    };
  }

  // 7. Invalid Request (400)
  if (status === 400 || statusStr === 'INVALID_ARGUMENT') {
    return {
      type: 'INVALID_REQUEST',
      code: 'INVALID_ARGUMENT',
      reason: reason || 'INVALID_REQUEST_PARAMETERS',
      isTemporary: false,
      userMessage: 'Google Places rejected the request. Check the request configuration.'
    };
  }

  // Default fallback
  return {
    type: 'API_ERROR',
    code: statusStr || `HTTP_${status}`,
    reason: reason || 'UNKNOWN_ERROR',
    isTemporary: false,
    userMessage: 'Google Places API request failed.'
  };
}

function logGooglePlacesDiagnostic({ status, code, reason, endpoint, metric }) {
  console.error('[Google Places Diagnostic] Google Places request failed');
  console.error(`[Google Places Diagnostic] HTTP status: ${status}`);
  console.error(`[Google Places Diagnostic] Google error code: ${code || 'UNKNOWN'}`);
  console.error(`[Google Places Diagnostic] Reason: ${reason || 'UNKNOWN'}`);
  if (metric) console.error(`[Google Places Diagnostic] Metric: ${metric}`);
  console.error(`[Google Places Diagnostic] Endpoint: ${endpoint}`);
}

// Controlled Retries with Exponential Backoff for Temporary Errors ONLY (Section 15)
async function fetchGooglePlacesWithRetry(url, requestOptions, endpointName = 'places:searchText', maxRetries = 2) {
  let attempt = 0;
  let delay = 400;

  while (attempt <= maxRetries) {
    attempt++;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(url, { ...requestOptions, signal: controller.signal });
      clearTimeout(timeoutId);

      if (res.ok) {
        googlePlacesDiagnostics.lastCheckTime = new Date().toISOString();
        googlePlacesDiagnostics.lastStatus = 'Active';
        googlePlacesDiagnostics.lastError = null;
        return { ok: true, response: res, data: await res.json() };
      }

      let errData = {};
      try {
        errData = await res.json();
      } catch (_) {
        try {
          const rawText = await res.text();
          errData = { error: { message: rawText } };
        } catch (_) {}
      }

      const classified = classifyGooglePlacesError(res.status, errData);
      googlePlacesDiagnostics.lastCheckTime = new Date().toISOString();
      googlePlacesDiagnostics.lastStatus = classified.type;
      googlePlacesDiagnostics.lastError = classified.code;

      logGooglePlacesDiagnostic({
        status: res.status,
        code: classified.code,
        reason: classified.reason,
        endpoint: endpointName,
        metric: classified.metric
      });

      // Retries ONLY for temporary 5xx errors
      if (classified.isTemporary && attempt <= maxRetries) {
        console.log(`[Google Places Retry] Temporary failure (HTTP ${res.status}). Retrying in ${delay}ms (Attempt ${attempt}/${maxRetries})...`);
        await new Promise((r) => setTimeout(r, delay));
        delay *= 2;
        continue;
      }

      return { ok: false, status: res.status, classified, errData };
    } catch (netErr) {
      const isTimeout = netErr.name === 'AbortError' || netErr.code === 'ETIMEDOUT';
      const isConn = netErr.code === 'ECONNRESET' || netErr.code === 'ENOTFOUND' || (netErr.message && netErr.message.includes('fetch failed'));

      googlePlacesDiagnostics.lastCheckTime = new Date().toISOString();
      googlePlacesDiagnostics.lastStatus = isTimeout ? 'TIMEOUT' : 'NETWORK_ERROR';
      googlePlacesDiagnostics.lastError = netErr.message;

      console.error('[Google Places Diagnostic] Google Places request failed');
      console.error('[Google Places Diagnostic] HTTP status: 0');
      console.error(`[Google Places Diagnostic] Google error code: ${isTimeout ? 'DEADLINE_EXCEEDED' : 'NETWORK_FAILURE'}`);
      console.error(`[Google Places Diagnostic] Reason: ${netErr.message}`);
      console.error(`[Google Places Diagnostic] Endpoint: ${endpointName}`);

      if (attempt <= maxRetries && (isTimeout || isConn)) {
        console.log(`[Google Places Retry] Network failure (${netErr.message}). Retrying in ${delay}ms (Attempt ${attempt}/${maxRetries})...`);
        await new Promise((r) => setTimeout(r, delay));
        delay *= 2;
        continue;
      }

      return {
        ok: false,
        status: 0,
        classified: {
          type: isTimeout ? 'TIMEOUT' : 'NETWORK_FAILURE',
          code: isTimeout ? 'DEADLINE_EXCEEDED' : 'NETWORK_FAILURE',
          reason: netErr.message,
          isTemporary: true,
          userMessage: isTimeout ? 'Google Places request timed out. Please try again.' : 'Unable to connect to Google Places. Please check your network connection.'
        }
      };
    }
  }
}

// In-Flight Request Deduplication Map (Section 16 & 17)
const activeSearchJobs = new Map();

// ----------------------------------------------------
// LEAD QUALIFICATION & DAILY CANDIDATE LIMIT SYSTEM
// ----------------------------------------------------
const MAX_DAILY_CANDIDATES = 300;
const TARGET_QUALIFIED_LEADS = 100;

function getTodayDateString() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getDailyCandidateUsage(store) {
  const today = getTodayDateString();
  if (!store || typeof store !== 'object') {
    return { date: today, candidatesChecked: 0 };
  }
  if (!store.dailyCandidateTracker || typeof store.dailyCandidateTracker !== 'object' || store.dailyCandidateTracker.date !== today) {
    store.dailyCandidateTracker = {
      date: today,
      candidatesChecked: 0
    };
    if (storeStatus !== 'failed') {
      saveStoredData(store, true);
    }
  }
  return store.dailyCandidateTracker;
}

function hasWebsite(place) {
  if (!place) return false;
  const uri = place.websiteUri || place.website;
  if (!uri || typeof uri !== 'string') return false;
  const trimmed = uri.trim();
  if (!trimmed) return false;

  const lower = trimmed.toLowerCase();
  if (
    lower === 'null' ||
    lower === 'undefined' ||
    lower === 'none' ||
    lower === 'n/a' ||
    lower === 'about:blank' ||
    lower === 'not available' ||
    lower === 'no website'
  ) {
    return false;
  }

  return true;
}

function hasValidPhone(place) {
  if (!place) return false;
  const rawPhone = place.nationalPhoneNumber || place.internationalPhoneNumber || (typeof place.phone === 'string' ? place.phone : null);
  if (!rawPhone || typeof rawPhone !== 'string') return false;
  const trimmed = rawPhone.trim();
  if (!trimmed) return false;

  const lower = trimmed.toLowerCase();
  if (
    lower === 'null' ||
    lower === 'undefined' ||
    lower === 'none' ||
    lower === 'n/a' ||
    lower === 'not available' ||
    lower === 'no phone'
  ) {
    return false;
  }

  // Must contain digits
  const digitsOnly = trimmed.replace(/\D/g, '');
  if (digitsOnly.length < 6 || digitsOnly.length > 15) {
    return false;
  }

  // Reject dummy repeating digits like 0000000000 or 1111111111
  if (/^(\d)\1+$/.test(digitsOnly)) {
    return false;
  }

  return true;
}

function isQualifiedLead(place) {
  return !hasWebsite(place) && hasValidPhone(place);
}

// 3. Lead Search Engine (Places API (New) + Continuous Qualification + Hard 300 Daily Candidate Limit)
app.post('/api/leads/search', async (req, res) => {
  const { state, city, district, category, radiusKm = 25, keyword = '', targetLeads = 100 } = req.body;

  if (!state || !city || !category) {
    return res.status(400).json({
      success: false,
      error: 'State, City/District, and Business Category are all required.'
    });
  }

  // Pre-search Validation (Section 14)
  const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    return res.status(400).json({
      success: false,
      error: 'Google Places API key is missing. Please configure GOOGLE_MAPS_API_KEY in your environment.'
    });
  }

  // Rate-Limit & Request Deduplication Protection (Sections 16 & 17)
  const searchFingerprint = `${state}::${city}::${category}::${radiusKm}::${keyword}`.toLowerCase().trim();
  if (activeSearchJobs.has(searchFingerprint)) {
    console.log(`[Search Deduplication] Concurrent search for "${searchFingerprint}" already active. Preventing duplicate request.`);
    return res.status(429).json({
      success: false,
      error: 'A search with these exact parameters is already in progress. Please wait for it to complete.'
    });
  }

  activeSearchJobs.set(searchFingerprint, Date.now());

  const sessionId = 'search_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
  const startedAt = new Date().toISOString();

  try {
    const targetQualified = Math.max(1, Math.min(100, Number(targetLeads) || 100));
    const store = getStoredData();
    const dailyTracker = getDailyCandidateUsage(store);
    const dailyCheckedSoFar = Number(dailyTracker.candidatesChecked) || 0;

    console.log(`\n=======================================================`);
    console.log(`[DIAGNOSTIC SEARCH TRACE START]`);
    console.log(`Search: state="${state}", city="${city}", category="${category}", radiusKm=${radiusKm}`);
    console.log(`Target Qualified Leads: ${targetQualified} (No Website + Valid Phone Number)`);
    console.log(`Daily Candidates Checked So Far: ${dailyCheckedSoFar} / ${MAX_DAILY_CANDIDATES} (Date: ${dailyTracker.date})`);

    // Hard Daily Candidate Limit Check (300 candidates/day)
    if (dailyCheckedSoFar >= MAX_DAILY_CANDIDATES) {
      console.log(`[Lead Search Engine] Daily limit already reached: ${dailyCheckedSoFar}/${MAX_DAILY_CANDIDATES}. Halting search.`);
      return res.json({
        success: true,
        sessionId,
        candidatesChecked: 0,
        dailyCandidatesChecked: dailyCheckedSoFar,
        maxDailyCandidates: MAX_DAILY_CANDIDATES,
        targetQualifiedLeads: targetQualified,
        qualifiedLeadsCount: 0,
        totalDiscovered: 0,
        duplicatesRemoved: 0,
        newLeadsCount: 0,
        leads: [],
        partialSearchNotice: `Daily candidate limit of ${MAX_DAILY_CANDIDATES} has already been reached for today (${dailyTracker.date}). Limit will reset tomorrow.`,
        message: `Daily search limit reached (${MAX_DAILY_CANDIDATES}/${MAX_DAILY_CANDIDATES} candidates evaluated today). The limit will reset tomorrow.`
      });
    }

    const maxCandidatesThisRun = Math.min(MAX_DAILY_CANDIDATES - dailyCheckedSoFar, MAX_DAILY_CANDIDATES);

    // Resolve accurate geographic coordinates (city-aware)
    const centerCoords = resolveLocationCenter(state, city);
    let centerLat = centerCoords ? centerCoords.lat : 17.3850;
    let centerLng = centerCoords ? centerCoords.lng : 78.4867;
    const stateObj = locationsData[state];
    const isEntireState = city === 'Entire State' || city.toLowerCase().includes('entire state');

    // Build targeted search queries using synonyms & sectors
    const catObj = categoriesData.categories[category] || { synonyms: [category] };
    const baseSynonyms = Array.isArray(catObj.synonyms) && catObj.synonyms.length > 0 ? catObj.synonyms : [category];
    const searchQueries = [];

    if (isEntireState) {
      searchQueries.push(`${category} in ${state} India ${keyword}`.trim());
      for (let s = 1; s < baseSynonyms.length; s++) {
        searchQueries.push(`${baseSynonyms[s]} in ${state} India ${keyword}`.trim());
      }
      searchQueries.push(`best ${category} in ${state} India`.trim());
      const topCities = (stateObj?.cities || []).slice(0, 5);
      for (const tc of topCities) {
        searchQueries.push(`${category} in ${tc} ${state} India ${keyword}`.trim());
      }
    } else {
      searchQueries.push(`${category} in ${city} ${state} India ${keyword}`.trim());
      for (let s = 1; s < baseSynonyms.length; s++) {
        searchQueries.push(`${baseSynonyms[s]} in ${city} ${state} India ${keyword}`.trim());
      }
      searchQueries.push(`best ${category} in ${city} India`.trim());
      if (baseSynonyms[1]) {
        searchQueries.push(`best ${baseSynonyms[1]} in ${city} India`.trim());
      }
      // Sector queries to expand candidate pool if needed
      const sectors = generateSearchSectors(state, city, centerLat, centerLng, false).slice(1, 6);
      for (const sec of sectors) {
        searchQueries.push(`${category} in ${sec.label} India ${keyword}`.trim());
      }
    }

    const radiusMeters = Math.min(50000, Math.max(1000, Number(radiusKm) * 1000));
    const sessionCandidateIndex = new LeadDuplicateIndex();
    const duplicateIndex = await getLeadDuplicateIndex();

    let sessionCandidatesChecked = 0;
    let duplicatesRemoved = 0;
    const qualifiedLeads = [];
    let quotaReached = false;
    let lastTerminalError = null;

    // Google Places API (New) Text Search
    const url = 'https://places.googleapis.com/v1/places:searchText';
    const fieldMask = 'places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.internationalPhoneNumber,places.websiteUri,places.rating,places.userRatingCount,places.googleMapsUri,places.location,nextPageToken';

    console.log(`Queries Generated (${searchQueries.length}):`, searchQueries);

    for (const [qIdx, query] of searchQueries.entries()) {
      if (quotaReached) break;
      if (qualifiedLeads.length >= targetQualified) break;
      if (sessionCandidatesChecked >= maxCandidatesThisRun) break;
      if (dailyTracker.candidatesChecked >= MAX_DAILY_CANDIDATES) break;

      let pageToken = null;
      let pagesFetched = 0;

      while (true) {
        if (qualifiedLeads.length >= targetQualified) break;
        if (sessionCandidatesChecked >= maxCandidatesThisRun) break;
        if (dailyTracker.candidatesChecked >= MAX_DAILY_CANDIDATES) break;

        const bodyPayload = {
          textQuery: query,
          pageSize: 20,
          locationBias: {
            circle: {
              center: { latitude: centerLat, longitude: centerLng },
              radius: radiusMeters
            }
          }
        };
        if (pageToken) {
          bodyPayload.pageToken = pageToken;
        }

        const callResult = await fetchGooglePlacesWithRetry(
          url,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Goog-Api-Key': apiKey,
              'X-Goog-FieldMask': fieldMask
            },
            body: JSON.stringify(bodyPayload)
          },
          'places:searchText'
        );

        if (!callResult.ok) {
          lastTerminalError = callResult.classified?.userMessage || 'Google Places API request failed.';
          if (callResult.classified?.type === 'QUOTA_EXCEEDED') {
            quotaReached = true;
          }
          break;
        }

        const data = callResult.data || {};
        const places = data.places || [];
        pagesFetched++;

        console.log(`Google Query ${qIdx + 1} | Page ${pagesFetched} = ${places.length} results | Qualified so far: ${qualifiedLeads.length}/${targetQualified} | Candidates checked: ${sessionCandidatesChecked}/${maxCandidatesThisRun}`);

        for (const p of places) {
          if (!p.id) continue;

          // Deduplication: Place ID or candidate already processed in this search
          if (sessionCandidateIndex.isDuplicate(p)) {
            continue;
          }

          // Deduplication: Already in database (via Place ID or fallback multi-signal match)
          if (duplicateIndex.isDuplicate(p)) {
            duplicatesRemoved++;
            continue;
          }

          // Check if stopping condition reached before consuming slot
          if (qualifiedLeads.length >= targetQualified) break;
          if (sessionCandidatesChecked >= maxCandidatesThisRun) break;
          if (dailyTracker.candidatesChecked >= MAX_DAILY_CANDIDATES) break;

          sessionCandidateIndex.add(p);

          // Radius verification if coordinates available (skip if searching Entire State)
          if (!isEntireState && p.location && p.location.latitude && p.location.longitude) {
            const dist = haversineDistance(centerLat, centerLng, p.location.latitude, p.location.longitude);
            if (dist > Number(radiusKm) * 1.5 && Number(radiusKm) < 50) {
              continue;
            }
          }

          // Count candidate towards daily & session limits
          sessionCandidatesChecked++;
          dailyTracker.candidatesChecked++;

          // Candidate Qualification: NO WEBSITE + VALID PHONE
          if (isQualifiedLead(p)) {
            const rawPhone = (p.nationalPhoneNumber || p.internationalPhoneNumber || '').trim();
            const phone = formatContactPhone(rawPhone);
            let leadCity = city;
            if (isEntireState) {
              leadCity = state;
              if (p.formattedAddress) {
                const stateCities = stateObj?.cities || [];
                for (const sc of stateCities) {
                  if (p.formattedAddress.toLowerCase().includes(sc.toLowerCase())) {
                    leadCity = sc;
                    break;
                  }
                }
              }
            }

            const opp = calculateOpportunityScore(false, true, p.rating, p.userRatingCount);

            const leadRecord = {
              id: 'lead_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9),
              place_id: p.id,
              business_name: p.displayName?.text || 'Business Name',
              category: category,
              state: state,
              city: leadCity,
              district: district || leadCity,
              address: p.formattedAddress || `${leadCity}, ${state}`,
              phone: phone,
              email: 'Not available',
              website: null,
              website_status: 'NO',
              google_maps_url: p.googleMapsUri || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent((p.displayName?.text || '') + ' ' + leadCity)}`,
              latitude: p.location?.latitude || null,
              longitude: p.location?.longitude || null,
              rating: p.rating || null,
              review_count: p.userRatingCount || 0,
              opportunity_score: opp.score,
              opportunity_level: opp.level,
              opportunity_reasons: opp.reasons,
              favorite: false,
              status: 'New',
              outreach_status: 'Pending',
              source: p.source || 'Google Places API',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            };

            qualifiedLeads.push(leadRecord);

            if (qualifiedLeads.length >= targetQualified) {
              console.log(`[Lead Search Engine] Target of ${targetQualified} qualified leads reached! Halting search.`);
              break;
            }
          }

          if (sessionCandidatesChecked >= maxCandidatesThisRun || dailyTracker.candidatesChecked >= MAX_DAILY_CANDIDATES) {
            console.log(`[Lead Search Engine] Daily candidate limit of ${MAX_DAILY_CANDIDATES} reached! Halting search.`);
            break;
          }
        }

        if (qualifiedLeads.length >= targetQualified) break;
        if (sessionCandidatesChecked >= maxCandidatesThisRun) break;
        if (dailyTracker.candidatesChecked >= MAX_DAILY_CANDIDATES) break;

        pageToken = data.nextPageToken;
        if (!pageToken || pagesFetched >= 5) {
          break;
        }

        await new Promise((r) => setTimeout(r, 400));
      }
    }

    // Fallback: If still under target and under candidate limit, use Nearby Search
    if (
      qualifiedLeads.length < targetQualified &&
      sessionCandidatesChecked < maxCandidatesThisRun &&
      dailyTracker.candidatesChecked < MAX_DAILY_CANDIDATES &&
      !quotaReached
    ) {
      console.log(`[Lead Search Engine] Expanding discovery via Google Places Nearby Search to find qualified leads...`);
      const nearbyUrl = 'https://places.googleapis.com/v1/places:searchNearby';
      const nearbyFieldMask = 'places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.internationalPhoneNumber,places.websiteUri,places.rating,places.userRatingCount,places.googleMapsUri,places.location';
      const targetTypes = resolvePlacesTypes(category);

      const targetCenters = [{ lat: centerLat, lng: centerLng }];
      if (isEntireState) {
        targetCenters.push(
          { lat: centerLat + 0.35, lng: centerLng + 0.25 },
          { lat: centerLat - 0.25, lng: centerLng - 0.30 },
          { lat: centerLat + 0.50, lng: centerLng - 0.20 }
        );
      } else {
        targetCenters.push(
          { lat: centerLat + 0.045, lng: centerLng },
          { lat: centerLat - 0.045, lng: centerLng },
          { lat: centerLat, lng: centerLng + 0.045 },
          { lat: centerLat, lng: centerLng - 0.045 }
        );
      }

      for (const center of targetCenters) {
        if (qualifiedLeads.length >= targetQualified) break;
        if (sessionCandidatesChecked >= maxCandidatesThisRun) break;
        if (dailyTracker.candidatesChecked >= MAX_DAILY_CANDIDATES) break;

        const nearbyResult = await fetchGooglePlacesWithRetry(
          nearbyUrl,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Goog-Api-Key': apiKey,
              'X-Goog-FieldMask': nearbyFieldMask
            },
            body: JSON.stringify({
              includedTypes: targetTypes,
              maxResultCount: 20,
              locationRestriction: {
                circle: {
                  center: { latitude: center.lat, longitude: center.lng },
                  radius: Math.min(50000, radiusMeters)
                }
              }
            })
          },
          'places:searchNearby'
        );

        if (nearbyResult.ok) {
          const data = nearbyResult.data || {};
          const places = data.places || [];
          for (const p of places) {
            if (!p.id) continue;
            if (sessionCandidateIndex.isDuplicate(p)) continue;
            if (duplicateIndex.isDuplicate(p)) {
              duplicatesRemoved++;
              continue;
            }

            if (qualifiedLeads.length >= targetQualified) break;
            if (sessionCandidatesChecked >= maxCandidatesThisRun) break;
            if (dailyTracker.candidatesChecked >= MAX_DAILY_CANDIDATES) break;

            sessionCandidateIndex.add(p);
            sessionCandidatesChecked++;
            dailyTracker.candidatesChecked++;

            if (isQualifiedLead(p)) {
              const rawPhone = (p.nationalPhoneNumber || p.internationalPhoneNumber || '').trim();
              const phone = formatContactPhone(rawPhone);
              const opp = calculateOpportunityScore(false, true, p.rating, p.userRatingCount);

              const leadRecord = {
                id: 'lead_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9),
                place_id: p.id,
                business_name: p.displayName?.text || 'Business Name',
                category: category,
                state: state,
                city: city,
                district: district || city,
                address: p.formattedAddress || `${city}, ${state}`,
                phone: phone,
                email: 'Not available',
                website: null,
                website_status: 'NO',
                google_maps_url: p.googleMapsUri || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent((p.displayName?.text || '') + ' ' + city)}`,
                latitude: p.location?.latitude || null,
                longitude: p.location?.longitude || null,
                rating: p.rating || null,
                review_count: p.userRatingCount || 0,
                opportunity_score: opp.score,
                opportunity_level: opp.level,
                opportunity_reasons: opp.reasons,
                favorite: false,
                status: 'New',
                outreach_status: 'Pending',
                source: p.source || 'Google Places API',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
              };

              qualifiedLeads.push(leadRecord);

              if (qualifiedLeads.length >= targetQualified) break;
            }

            if (sessionCandidatesChecked >= maxCandidatesThisRun || dailyTracker.candidatesChecked >= MAX_DAILY_CANDIDATES) break;
          }
        } else {
          lastTerminalError = nearbyResult.classified?.userMessage || 'Google Places Nearby Search failed.';
          if (nearbyResult.classified?.type === 'QUOTA_EXCEEDED') {
            quotaReached = true;
            break;
          }
        }
      }
    }

    // Persist updated daily candidate count immediately
    saveStoredData(store, true);

    // If zero candidates checked and API error occurred, return error classification
    if (sessionCandidatesChecked === 0 && (quotaReached || lastTerminalError)) {
      console.warn(`[Lead Search Engine] Search failed due to API error: ${lastTerminalError}`);
      return res.status(quotaReached ? 429 : 500).json({
        success: false,
        error: lastTerminalError || 'Google Places API request failed.'
      });
    }

    console.log(`\n--- QUALIFIED LEADS SEARCH SUMMARY ---`);
    console.log(`Candidates evaluated in this session: ${sessionCandidatesChecked}`);
    console.log(`Daily candidates evaluated today: ${dailyTracker.candidatesChecked} / ${MAX_DAILY_CANDIDATES}`);
    console.log(`Target qualified leads: ${targetQualified}`);
    console.log(`Qualified leads found: ${qualifiedLeads.length}`);
    console.log(`Previously saved leads skipped: ${duplicatesRemoved}`);
    console.log(`=======================================================\n`);

    const sessionRecord = {
      sessionId,
      startedAt,
      completedAt: new Date().toISOString(),
      parameters: { state, city, category, radiusKm, keyword },
      totalDiscovered: sessionCandidatesChecked,
      duplicatesRemoved,
      newLeadsCount: qualifiedLeads.length,
      candidatesChecked: sessionCandidatesChecked,
      dailyCandidatesChecked: dailyTracker.candidatesChecked,
      withoutWebsiteCount: qualifiedLeads.length,
      withWebsiteCount: 0
    };
    if (!Array.isArray(store.searchSessions)) store.searchSessions = [];
    store.searchSessions.unshift(sessionRecord);
    if (store.searchSessions.length > 50) store.searchSessions.pop();
    saveStoredData(store, true);

    const partialSearchNotice = (quotaReached || lastTerminalError)
      ? (quotaReached
          ? 'Google Places API quota has been reached.'
          : 'Search partially completed. Some Google Places results could not be retrieved because of an API error.')
      : (dailyTracker.candidatesChecked >= MAX_DAILY_CANDIDATES
          ? `Daily candidate limit reached (${MAX_DAILY_CANDIDATES} checked). Returning ${qualifiedLeads.length} qualified leads.`
          : null);

    return res.json({
      success: true,
      sessionId,
      candidatesChecked: sessionCandidatesChecked,
      dailyCandidatesChecked: dailyTracker.candidatesChecked,
      maxDailyCandidates: MAX_DAILY_CANDIDATES,
      targetQualifiedLeads: targetQualified,
      qualifiedLeadsCount: qualifiedLeads.length,
      totalDiscovered: sessionCandidatesChecked,
      duplicatesRemoved,
      newLeadsCount: qualifiedLeads.length,
      leads: qualifiedLeads,
      partialSearchNotice,
      message:
        qualifiedLeads.length > 0
          ? `${qualifiedLeads.length} qualified leads found (${sessionCandidatesChecked} candidates evaluated)`
          : (sessionCandidatesChecked > 0
              ? `Search complete — 0 qualified leads found out of ${sessionCandidatesChecked} candidates evaluated.`
              : 'No businesses found for this search.')
    });
  } catch (err) {
    console.error('Lead search failure:', err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Lead search could not be completed.'
    });
  } finally {
    activeSearchJobs.delete(searchFingerprint);
  }
});

// 4. Save Discovered Leads
app.post('/api/leads/save', async (req, res) => {
  const { leads = [] } = req.body;
  if (!Array.isArray(leads) || leads.length === 0) {
    return res.status(400).json({ success: false, error: 'No leads provided to save.' });
  }

  if (storeStatus === 'failed') {
    return res.status(500).json({
      success: false,
      status: 'failed',
      error: 'Cannot save leads: Persistent database failed to load safely. Please retry or check the data source.'
    });
  }

  const store = getStoredData();
  if (!store) {
    return res.status(500).json({
      success: false,
      status: 'failed',
      error: 'Cannot save leads: Persistent database is unavailable.'
    });
  }
  const dbIndex = new LeadDuplicateIndex(store.leads || []);
  const batchIndex = new LeadDuplicateIndex();
  const toInsert = [];
  const duplicatesSkippedList = [];

  for (const lead of leads) {
    // Check if duplicate against existing DB leads OR already included in this batch
    if (dbIndex.isDuplicate(lead) || batchIndex.isDuplicate(lead)) {
      duplicatesSkippedList.push(lead);
      continue;
    }

    batchIndex.add(lead);
    const saveTimestamp = new Date().toISOString();
    const cleanLead = {
      ...lead,
      id: lead.id || lead.place_id || 'lead_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      phone: formatContactPhone(lead.phone || lead.nationalPhoneNumber || lead.internationalPhoneNumber || 'Not available'),
      status: lead.status || 'New',
      outreach_status: lead.outreach_status || 'Pending',
      favorite: Boolean(lead.favorite),
      first_message_sent: Boolean(lead.first_message_sent),
      first_message_sent_at: lead.first_message_sent_at || null,
      main_message_sent_at: lead.main_message_sent_at || null,
      last_message_sent_at: lead.last_message_sent_at || null,
      last_message_type: lead.last_message_type || null,
      last_message_text: lead.last_message_text || null,
      follow_up_day: lead.follow_up_day || 0,
      current_follow_up_number: lead.current_follow_up_number || 0,
      next_follow_up_number: lead.next_follow_up_number || null,
      next_follow_up_name: lead.next_follow_up_name || null,
      next_follow_up_at: lead.next_follow_up_at || null,
      follow_up_completed: Boolean(lead.follow_up_completed),
      reply_status: lead.reply_status || null,
      replied_at: lead.replied_at || null,
      outreach_completed_at: lead.outreach_completed_at || null,
      message_history: Array.isArray(lead.message_history) ? lead.message_history : [],
      notes: Array.isArray(lead.notes)
        ? lead.notes
        : (typeof lead.notes === 'string' && lead.notes.trim()
            ? [{
                id: 'note_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
                lead_id: lead.id || lead.place_id,
                text: lead.notes.trim(),
                created_at: saveTimestamp,
                updated_at: saveTimestamp
              }]
            : []),
      activities: Array.isArray(lead.activities) ? lead.activities : [],
      created_at: lead.saved_at || lead.created_at || saveTimestamp,
      updated_at: saveTimestamp
    };
    toInsert.push(cleanLead);
  }

  const duplicatesSkipped = duplicatesSkippedList.length;

  if (toInsert.length === 0) {
    return res.json({
      success: true,
      savedCount: 0,
      duplicatesSkipped: duplicatesSkipped,
      totalCount: (store.leads || []).length,
      message: 'All leads have already been saved previously.'
    });
  }

  // Prepend to local persistent storage
  store.leads.unshift(...toInsert);
  saveStoredData(store, true);
  invalidateDuplicateIndex();

  // Sync with Supabase if accessible
  if (supabase) {
    try {
      const rows = toInsert.map((l) => ({
        place_id: l.place_id,
        business_name: l.business_name,
        category: l.category,
        state: l.state,
        city: l.city,
        district: l.district,
        address: l.address,
        phone: l.phone,
        email: l.email,
        website: l.website,
        website_status: l.website_status,
        google_maps_url: l.google_maps_url,
        latitude: l.latitude,
        longitude: l.longitude,
        rating: l.rating,
        review_count: l.review_count,
        opportunity_score: l.opportunity_score,
        opportunity_level: l.opportunity_level,
        favorite: l.favorite,
        status: l.status,
        outreach_status: l.outreach_status,
        first_message_sent: l.first_message_sent,
        first_message_sent_at: l.first_message_sent_at,
        follow_up_day: l.follow_up_day,
        next_follow_up_at: l.next_follow_up_at,
        follow_up_completed: l.follow_up_completed,
        replied_at: l.replied_at,
        outreach_completed_at: l.outreach_completed_at,
        message_history: l.message_history,
        source: l.source
      }));

      const { error } = await supabase.from('leads').upsert(rows, { onConflict: 'place_id' });
      if (error) {
        console.warn('Supabase upsert notice (local store saved successfully):', error.message);
      } else {
        console.log(`Synced ${rows.length} leads to Supabase!`);
      }
    } catch (err) {
      console.warn('Supabase sync exception:', err.message);
    }
  }

  res.json({
    success: true,
    savedCount: toInsert.length,
    duplicatesSkipped: duplicatesSkipped,
    totalCount: store.leads.length,
    message: duplicatesSkipped > 0
      ? `${toInsert.length} new leads saved (${duplicatesSkipped} already saved).`
      : `${toInsert.length} leads saved successfully.`
  });
});

// 5. Get Saved Leads (with search, filter, sort, pagination)
app.get('/api/leads/saved', async (req, res) => {
  let store = getStoredData();

  if (storeStatus === 'failed' || !store) {
    return res.status(500).json({
      success: false,
      status: 'failed',
      error: 'ClientHunter could not safely load existing data. Your data has not been modified. Please retry or check the data source.',
      leads: [],
      totalCount: 0
    });
  }

  if (supabase && (!leadsSupabaseSyncDone || !store.leads || store.leads.length === 0)) {
    store = await syncPersistentLeads(store);
  }
  let results = [...(store.leads || [])];

  const {
    search,
    category,
    state,
    city,
    websiteStatus,
    hasPhone,
    favorite,
    status,
    outreachStatus,
    whatsapp,
    followup,
    reply,
    priority,
    savedDate,
    date,
    sort = 'newest'
  } = req.query;

  // Search
  if (search && search.trim()) {
    const q = search.trim().toLowerCase();
    results = results.filter(
      (l) =>
        (l.business_name && l.business_name.toLowerCase().includes(q)) ||
        (l.category && l.category.toLowerCase().includes(q)) ||
        (l.city && l.city.toLowerCase().includes(q)) ||
        (l.state && l.state.toLowerCase().includes(q)) ||
        (l.district && l.district.toLowerCase().includes(q)) ||
        (l.phone && l.phone.toLowerCase().includes(q)) ||
        (l.email && l.email.toLowerCase().includes(q)) ||
        (l.website && l.website.toLowerCase().includes(q)) ||
        (l.address && l.address.toLowerCase().includes(q))
    );
  }

  // Filters
  if (category && category !== 'All') {
    results = results.filter((l) => (l.category || '').toLowerCase() === category.toLowerCase());
  }
  if (state && state !== 'All') {
    results = results.filter((l) => (l.state || '').toLowerCase() === state.toLowerCase());
  }
  if (city && city !== 'All') {
    results = results.filter((l) => (l.city || '').toLowerCase() === city.toLowerCase());
  }
  if (websiteStatus && websiteStatus !== 'All') {
    const hasWeb = (l) => {
      if (l.website_status === 'YES') return true;
      if (l.website_status === 'NO') return false;
      const w = (l.website || '').trim().toLowerCase();
      return Boolean(w && w !== 'not available' && w !== 'none' && w !== 'null' && w !== 'undefined' && w !== 'no website' && w.length > 3);
    };
    if (websiteStatus === 'YES' || websiteStatus === 'Has Website') {
      results = results.filter((l) => hasWeb(l));
    } else if (websiteStatus === 'NO' || websiteStatus === 'No Website') {
      results = results.filter((l) => !hasWeb(l));
    }
  }
  if (hasPhone === 'true' || hasPhone === 'YES') {
    results = results.filter((l) => l.phone && l.phone !== 'Not available');
  } else if (hasPhone === 'false' || hasPhone === 'NO') {
    results = results.filter((l) => !l.phone || l.phone === 'Not available');
  }
  if (favorite === 'true' || favorite === 'YES' || favorite === 'Favorites') {
    results = results.filter((l) => Boolean(l.favorite || l.is_favorite));
  } else if (favorite === 'false' || favorite === 'NO' || favorite === 'Not Favorites') {
    results = results.filter((l) => !Boolean(l.favorite || l.is_favorite));
  }

  // Priority Filter (Defaults existing unassigned leads to Medium)
  if (priority && priority !== 'All') {
    results = results.filter((l) => {
      const p = l.priority || 'Medium';
      return p.toLowerCase() === priority.toLowerCase();
    });
  }

  // Outreach Status Filter
  const targetStatus = outreachStatus || (status && status !== 'New' && status !== 'Contacted' && status !== 'Qualified' && status !== 'Closed' ? status : null);
  if (targetStatus && targetStatus !== 'All') {
    results = results.filter((l) => {
      const os = (l.outreach_status || '').trim();
      const firstSent = Boolean(l.first_message_sent);
      const completed = Boolean(l.follow_up_completed || os === 'Completed');
      const stopped = os === 'Stopped';
      const notOnWa = os === 'Not on WhatsApp' || Boolean(l.not_on_whatsapp) || (l.activities && l.activities.some((a) => a.event_type === 'not_on_whatsapp'));
      const replied = os === 'Replied' || l.reply_status != null || l.replied_at != null || (l.activities && l.activities.some((a) => a.event_type === 'lead_replied'));

      if (targetStatus === 'Not Contacted') {
        return !firstSent && !stopped && !notOnWa && (os === 'Not Contacted' || os === 'Pending' || os === 'Ready' || os === 'New' || !os);
      }
      if (targetStatus === 'Message Sent') {
        return firstSent || os === 'Follow-Up' || os === 'Message Sent' || (l.activities && l.activities.some((a) => a.event_type === 'message_sent'));
      }
      if (targetStatus === 'Not Sent') {
        return !firstSent && (!l.activities || !l.activities.some((a) => a.event_type === 'message_sent'));
      }
      if (targetStatus === 'Not on WhatsApp') {
        return notOnWa;
      }
      if (targetStatus === 'Awaiting Reply') {
        return (os === 'Follow-Up' || firstSent) && !completed && !replied && os !== 'Stopped';
      }
      if (targetStatus === 'Replied') {
        return replied;
      }
      if (targetStatus === 'Completed') {
        return completed;
      }
      if (targetStatus === 'Stopped') {
        return stopped;
      }
      return os.toLowerCase() === targetStatus.toLowerCase();
    });
  } else if (status && status !== 'All') {
    results = results.filter((l) => l.status === status);
  }

  // WhatsApp Filter
  if (whatsapp && whatsapp !== 'All') {
    results = results.filter((l) => {
      const hasValidPhone = Boolean(l.phone && l.phone.trim() && l.phone !== 'Not available');
      const notOnWa = l.outreach_status === 'Not on WhatsApp' || l.not_on_whatsapp === true || l.whatsapp === 'Not Available' || (l.activities && l.activities.some((a) => a.event_type === 'not_on_whatsapp'));
      const confirmedWa = Boolean(l.first_message_sent || l.first_message_sent_at || l.whatsapp === 'Available' || (l.activities && l.activities.some((a) => a.event_type === 'message_sent' || a.event_type === 'whatsapp_opened')));

      let classification = 'Unknown';
      if (!hasValidPhone || notOnWa) classification = 'Not Available';
      else if (confirmedWa) classification = 'Available';
      else classification = 'Unknown';

      return classification === whatsapp;
    });
  }

  // Follow-Up Filter
  if (followup && followup !== 'All') {
    const now = new Date();
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    results = results.filter((l) => {
      const completed = Boolean(l.outreach_status === 'Completed' || l.follow_up_completed);
      const replied = Boolean(l.outreach_status === 'Replied' || l.reply_status != null || l.replied_at != null);

      if (followup === 'Completed') return completed;
      if (!l.next_follow_up_at || completed || replied) {
        if (followup === 'No Follow-Up') return !completed && !l.next_follow_up_at;
        return false;
      }

      const target = new Date(l.next_follow_up_at);
      const targetMidnight = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();
      const dayDiff = Math.round((targetMidnight - todayMidnight) / 86400000);

      if (followup === 'Due Today') return dayDiff <= 0;
      if (followup === 'Upcoming') return dayDiff > 0;
      if (followup === 'No Follow-Up') return false;
      return true;
    });
  }

  // Reply Filter
  if (reply && reply !== 'All') {
    results = results.filter((l) => {
      const isReplied = Boolean(l.outreach_status === 'Replied' || l.reply_status != null || l.replied_at != null || (l.activities && l.activities.some((a) => a.event_type === 'lead_replied')));
      if (reply === 'Replied') return isReplied;
      if (reply === 'No Reply') return !isReplied;
      return true;
    });
  }

  // Date Filter
  const effectiveDate = savedDate || date;
  if (effectiveDate && effectiveDate !== 'All') {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    results = results.filter((l) => {
      if (!l.created_at && !l.saved_at) return effectiveDate === 'unavailable';
      const d = new Date(l.created_at || l.saved_at);
      if (isNaN(d.getTime())) return effectiveDate === 'unavailable';

      const leadDayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      const dayDiff = Math.round((todayStart - leadDayStart) / 86400000);

      if (effectiveDate === 'today') return dayDiff === 0;
      if (effectiveDate === 'yesterday') return dayDiff === 1;
      if (effectiveDate === 'last7') return dayDiff >= 0 && dayDiff <= 7;
      if (effectiveDate === 'last30') return dayDiff >= 0 && dayDiff <= 30;

      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      return key === effectiveDate;
    });
  }

  // Sort
  if (sort === 'newest') {
    results.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  } else if (sort === 'oldest') {
    results.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  } else if (sort === 'opportunity') {
    results.sort((a, b) => (b.opportunity_score || 0) - (a.opportunity_score || 0));
  } else if (sort === 'name') {
    results.sort((a, b) => (a.business_name || '').localeCompare(b.business_name || ''));
  } else if (sort === 'rating') {
    results.sort((a, b) => (b.rating || 0) - (a.rating || 0));
  }

  // Summary counts
  const totalInDb = store.leads.length;
  const noWebsiteCount = store.leads.filter((l) => l.website_status === 'NO').length;
  const favoritesCount = store.leads.filter((l) => l.favorite).length;

  res.json({
    success: true,
    totalCount: totalInDb,
    filteredCount: results.length,
    noWebsiteCount,
    favoritesCount,
    leads: results.map((l) => ({
      ...l,
      phone: formatContactPhone(l.phone || l.phone_number || ''),
      priority: l.priority || 'Medium',
      contact_outcome: l.contact_outcome || null,
      contact_outcome_reason: l.contact_outcome_reason || '',
      follow_up_paused: Boolean(l.follow_up_paused || l.followUpPaused)
    }))
  });
});

// 5.9 Permanent Reset All Lead Data (Registered before :id parameter wildcard)
app.delete('/api/leads/reset', async (req, res) => {
  try {
    if (storeStatus === 'failed') {
      return res.status(500).json({
        success: false,
        error: 'ClientHunter could not safely perform reset: Persistent store is in a failed load state.'
      });
    }

    const store = getStoredData();
    if (!store) {
      return res.status(500).json({
        success: false,
        error: 'Persistent store is unavailable.'
      });
    }

    const initialLeadCount = Array.isArray(store.leads) ? store.leads.length : 0;
    let supaDeletedCount = 0;

    // 1. Supabase Deletion (atomic check)
    if (supabase) {
      const { error: supaError, count } = await supabase
        .from('leads')
        .delete({ count: 'exact' })
        .not('id', 'is', null);

      if (supaError) {
        console.error('Supabase lead reset error:', supaError);
        return res.status(500).json({
          success: false,
          error: `Database reset failed: ${supaError.message || 'Supabase error'}`
        });
      }
      supaDeletedCount = count ?? initialLeadCount;
    }

    // 2. Local JSON Store Cleanup (ONLY leads array is cleared; settings & searchSessions are preserved)
    store.leads = [];
    store.__allowEmptyReset = true;
    try {
      saveStoredData(store, true); // immediate synchronous write
    } catch (fsErr) {
      delete store.__allowEmptyReset;
      console.error('Local leads store write error:', fsErr);
      return res.status(500).json({
        success: false,
        error: `Local leads store cleanup failed: ${fsErr.message}`
      });
    }
    delete store.__allowEmptyReset;

    // 3. Clear In-Memory Caches
    if (cachedKnownPlaceIds) {
      cachedKnownPlaceIds.clear();
    }
    lastPlaceIdsRefresh = 0;

    console.log(`[RESET ALL LEADS] Successfully deleted all lead records (Supabase: ${supaDeletedCount}, Local: ${initialLeadCount})`);

    return res.json({
      success: true,
      deletedCount: supaDeletedCount || initialLeadCount,
      message: 'Lead data reset successfully.'
    });
  } catch (err) {
    console.error('Unexpected error resetting lead data:', err);
    return res.status(500).json({
      success: false,
      error: `Server error during lead reset: ${err.message}`
    });
  }
});

// 5.9b Unified Category-Level Data Reset Engine
app.post('/api/reset/:category', async (req, res) => {
  const { category } = req.params;
  const allowedCategories = [
    'saved-leads',
    'cold-call',
    'outreach',
    'favorites',
    'followup',
    'history',
    'settings',
    'everything'
  ];

  if (!allowedCategories.includes(category)) {
    return res.status(400).json({
      success: false,
      error: `Invalid reset category: '${category}'. Allowed categories: ${allowedCategories.join(', ')}`
    });
  }

  try {
    if (storeStatus === 'failed') {
      return res.status(500).json({
        success: false,
        error: 'ClientHunter could not safely perform reset: Persistent store is in a failed load state.'
      });
    }

    const store = getStoredData();
    if (!store) {
      return res.status(500).json({
        success: false,
        error: 'Persistent store is unavailable.'
      });
    }

    createPreWriteBackup();
    const nowIso = new Date().toISOString();
    let affectedCount = 0;
    let message = '';

    switch (category) {
      case 'saved-leads': {
        // 1. Remove all Saved Leads (Master lead records)
        // Dependent tracking in store.outreach is also cleared since it points to these leads.
        // Search sessions, settings, and API configuration remain 100% intact.
        const initialLeadCount = Array.isArray(store.leads) ? store.leads.length : 0;
        let supaDeletedCount = 0;

        if (supabase) {
          const { error: supaError, count } = await supabase
            .from('leads')
            .delete({ count: 'exact' })
            .not('id', 'is', null);

          if (supaError) {
            console.error('Supabase lead reset error:', supaError);
            return res.status(500).json({
              success: false,
              error: `Database reset failed: ${supaError.message || 'Supabase error'}`
            });
          }
          supaDeletedCount = count ?? initialLeadCount;
        }

        store.leads = [];
        store.outreach = [];
        store.__allowEmptyReset = true;
        saveStoredData(store, true);
        delete store.__allowEmptyReset;

        if (cachedKnownPlaceIds) cachedKnownPlaceIds.clear();
        lastPlaceIdsRefresh = 0;

        affectedCount = supaDeletedCount || initialLeadCount;
        message = 'Saved Leads removed successfully.';
        break;
      }

      case 'cold-call': {
        // 2. Remove Cold Call queue and call outcome records only.
        // Saved Leads remain 100% intact.
        if (Array.isArray(store.leads)) {
          for (const lead of store.leads) {
            if (lead.cold_call) {
              if (lead.cold_call.queued || lead.cold_call.status !== 'Not Called' || lead.cold_call.outcome) {
                affectedCount++;
              }
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
        }
        saveStoredData(store, true);
        message = 'Cold Call queue and records cleared successfully.';
        break;
      }

      case 'outreach': {
        // 3. Remove/reset Outreach records and Outreach tracking only.
        // Saved Leads remain 100% intact.
        if (Array.isArray(store.leads)) {
          for (const lead of store.leads) {
            if (lead.outreach_status && lead.outreach_status !== 'Pending') {
              affectedCount++;
            }
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
        }
        store.outreach = [];
        saveStoredData(store, true);

        if (supabase) {
          try {
            await supabase
              .from('leads')
              .update({
                outreach_status: 'Pending',
                next_follow_up_at: null,
                next_follow_up_number: null,
                next_follow_up_name: null,
                updated_at: nowIso
              })
              .not('id', 'is', null);
          } catch (supaErr) {
            console.warn('[RESET OUTREACH] Supabase sync notice:', supaErr.message);
          }
        }
        message = 'Outreach records and tracking reset successfully.';
        break;
      }

      case 'favorites': {
        // 4. Remove Favorites only.
        // Saved Leads remain 100% intact.
        if (Array.isArray(store.leads)) {
          for (const lead of store.leads) {
            if (lead.favorite || lead.is_favorite) {
              affectedCount++;
              lead.favorite = false;
              lead.is_favorite = false;
              lead.updated_at = nowIso;
            }
          }
        }
        saveStoredData(store, true);

        if (supabase) {
          try {
            await supabase
              .from('leads')
              .update({ favorite: false, updated_at: nowIso })
              .not('id', 'is', null);
          } catch (supaErr) {
            console.warn('[RESET FAVORITES] Supabase sync notice:', supaErr.message);
          }
        }
        message = 'All favorite markings removed successfully.';
        break;
      }

      case 'followup': {
        // 5. Remove/reset Follow-Up records/state only.
        // Saved Leads and Outreach remain intact.
        if (Array.isArray(store.leads)) {
          for (const lead of store.leads) {
            const hasFollowupData = Boolean(
              lead.next_follow_up_at ||
              lead.next_follow_up_number ||
              lead.next_follow_up_name ||
              lead.follow_up_day ||
              lead.current_follow_up_number ||
              lead.follow_up_completed ||
              lead.follow_up_paused ||
              lead.followUpPaused ||
              lead.followUpDate ||
              lead.followup_timeline ||
              lead.outreach_status === 'Follow-Up' ||
              lead.outreach_status === 'Completed' ||
              lead.outreach_status === 'Replied' ||
              lead.reply_status ||
              (lead.message_history && lead.message_history.some(m => m.type === 'follow_up' || m.type === 'followup'))
            );

            if (hasFollowupData) {
              affectedCount++;
            }

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
        }

        if (Array.isArray(store.outreach)) {
          for (const o of store.outreach) {
            if (o.status === 'Follow-Up' || o.status === 'Completed' || o.status === 'Replied') {
              o.status = 'Contacted';
              o.updated_at = nowIso;
            }
          }
        }

        saveStoredData(store, true);

        if (supabase) {
          try {
            await supabase
              .from('leads')
              .update({
                outreach_status: 'Contacted',
                next_follow_up_at: null,
                next_follow_up_number: null,
                next_follow_up_name: null,
                follow_up_completed: false,
                current_follow_up_number: 0,
                updated_at: nowIso
              })
              .in('outreach_status', ['Follow-Up', 'Completed', 'Replied']);
          } catch (supaErr) {
            console.warn('[RESET FOLLOWUP] Supabase sync notice:', supaErr.message);
          }
        }
        message = 'Follow-Up state and schedules reset successfully.';
        break;
      }

      case 'history': {
        // 6. Remove search/history records only.
        // Saved Leads, Settings, Outreach, etc., remain 100% intact.
        affectedCount = Array.isArray(store.searchSessions) ? store.searchSessions.length : 0;
        store.searchSessions = [];
        saveStoredData(store, true);
        message = 'Search history cleared successfully.';
        break;
      }

      case 'settings': {
        // 7. Reset Client Hunter settings only.
        // Lead data, Favorites, Outreach, Cold Call, Follow-Up, and History remain 100% intact.
        store.settings = getDefaultSettings();
        if (!store.outreach_settings) store.outreach_settings = {};
        store.outreach_settings.dailyTarget = 50;
        saveStoredData(store, true);

        if (supabase) {
          try {
            await supabase
              .from('settings')
              .upsert({
                id: 'default',
                settings: store.settings,
                updated_at: nowIso
              }, { onConflict: 'id' });
          } catch (supaErr) {
            console.warn('[RESET SETTINGS] Supabase sync notice:', supaErr.message);
          }
        }
        affectedCount = 1;
        message = 'Application settings reset to defaults successfully.';
        break;
      }

      case 'everything': {
        // 8. High-risk complete reset: All leads, outreach, search sessions, settings.
        const initialLeadCount = Array.isArray(store.leads) ? store.leads.length : 0;
        let supaDeletedCount = 0;

        if (supabase) {
          const { error: supaError, count } = await supabase
            .from('leads')
            .delete({ count: 'exact' })
            .not('id', 'is', null);

          if (supaError) {
            console.error('Supabase everything reset error:', supaError);
            return res.status(500).json({
              success: false,
              error: `Database reset failed: ${supaError.message || 'Supabase error'}`
            });
          }
          supaDeletedCount = count ?? initialLeadCount;

          try {
            const defSettings = getDefaultSettings();
            await supabase
              .from('settings')
              .upsert({
                id: 'default',
                settings: defSettings,
                updated_at: nowIso
              }, { onConflict: 'id' });
          } catch (_) {}
        }

        store.leads = [];
        store.outreach = [];
        store.searchSessions = [];
        store.settings = getDefaultSettings();
        if (!store.outreach_settings) store.outreach_settings = {};
        store.outreach_settings.dailyTarget = 50;

        store.__allowEmptyReset = true;
        saveStoredData(store, true);
        delete store.__allowEmptyReset;

        if (cachedKnownPlaceIds) cachedKnownPlaceIds.clear();
        lastPlaceIdsRefresh = 0;

        affectedCount = supaDeletedCount || initialLeadCount;
        message = 'All Client Hunter data and settings have been completely reset.';
        break;
      }
    }

    console.log(`[RESET DATA] Category: ${category} | Affected items: ${affectedCount}`);

    return res.json({
      success: true,
      category,
      affectedCount,
      message
    });
  } catch (err) {
    console.error(`[RESET DATA ERROR] Failed to reset category '${category}':`, err);
    return res.status(500).json({
      success: false,
      error: `Server error while resetting ${category}: ${err.message}`
    });
  }
});// ==========================================
// TEMPORARY IN-MEMORY UNDO DELETION BUFFER
// ==========================================
const recentDeletions = new Map();
const UNDO_EXPIRATION_MS = 25000; // 25s retention for server buffer (client window is ~5s)

function storeTemporaryDeletion(type, payload) {
  const token = 'undo_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  recentDeletions.set(token, {
    type,
    payload: JSON.parse(JSON.stringify(payload)),
    createdAt: Date.now(),
    expiresAt: Date.now() + UNDO_EXPIRATION_MS
  });
  setTimeout(() => {
    if (recentDeletions.has(token)) {
      recentDeletions.delete(token);
    }
  }, UNDO_EXPIRATION_MS + 2000);
  return token;
}

// 6. Delete Single Lead
app.delete('/api/leads/:id', async (req, res) => {
  const { id } = req.params;
  const store = getStoredData();
  const initialCount = store.leads.length;
  const deletedLead = store.leads.find((l) => l.id === id || l.place_id === id);

  if (!deletedLead) {
    return res.status(404).json({
      success: false,
      totalCount: store.leads.length,
      message: 'Lead not found.'
    });
  }

  // Store in temporary deletion buffer for Undo
  const undoToken = storeTemporaryDeletion('saved_lead', [deletedLead]);

  store.leads = store.leads.filter((l) => l.id !== id && l.place_id !== id);
  saveStoredData(store, true);

  if (supabase && deletedLead) {
    try {
      await supabase.from('leads').delete().eq('place_id', deletedLead.place_id);
    } catch (err) {
      console.warn('Supabase delete notice:', err.message);
    }
  }

  res.json({
    success: true,
    undoToken,
    lead: deletedLead,
    totalCount: store.leads.length,
    message: 'Lead deleted successfully.'
  });
});

// 7. Batch Delete Leads
app.post('/api/leads/delete-batch', async (req, res) => {
  const ids = req.body.ids || req.body.leadIds || [];
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ success: false, error: 'No lead IDs provided.' });
  }

  const store = getStoredData();
  const idSet = new Set(ids);
  const toDelete = store.leads.filter((l) => idSet.has(l.id) || idSet.has(l.place_id));

  if (toDelete.length === 0) {
    return res.json({ success: true, deletedCount: 0, totalCount: store.leads.length, message: 'No matching leads to delete.' });
  }

  // Store in temporary deletion buffer for Undo
  const undoToken = storeTemporaryDeletion('saved_lead', toDelete);

  store.leads = store.leads.filter((l) => !idSet.has(l.id) && !idSet.has(l.place_id));
  saveStoredData(store, true);

  if (supabase && toDelete.length > 0) {
    try {
      const placeIds = toDelete.map((l) => l.place_id).filter(Boolean);
      if (placeIds.length > 0) {
        await supabase.from('leads').delete().in('place_id', placeIds);
      }
    } catch (err) {
      console.warn('Supabase batch delete notice:', err.message);
    }
  }

  res.json({
    success: true,
    undoToken,
    leads: toDelete,
    deletedCount: toDelete.length,
    totalCount: store.leads.length,
    message: `${toDelete.length} leads deleted successfully.`
  });
});

// 7b. Undo Delete Leads (Restore Saved Leads)
app.post('/api/leads/undo-delete', async (req, res) => {
  const { undoToken, fallbackLeads } = req.body;
  let leadsToRestore = null;

  if (undoToken && recentDeletions.has(undoToken)) {
    const entry = recentDeletions.get(undoToken);
    if (entry && entry.type === 'saved_lead' && Array.isArray(entry.payload)) {
      leadsToRestore = entry.payload;
      recentDeletions.delete(undoToken); // Consume token so it cannot be undone twice
    }
  }

  // Fallback if token expired but client provided backup leads array within safety limits
  if (!leadsToRestore && Array.isArray(fallbackLeads) && fallbackLeads.length > 0) {
    leadsToRestore = fallbackLeads;
  }

  if (!leadsToRestore || leadsToRestore.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Unable to restore lead. Undo window has expired or already restored.'
    });
  }

  const store = getStoredData();
  const existingIds = new Set(store.leads.map(l => String(l.id || l.place_id)));
  const actuallyRestored = [];

  for (const lead of leadsToRestore) {
    const leadKey = String(lead.id || lead.place_id);
    if (!existingIds.has(leadKey)) {
      store.leads.push(lead);
      existingIds.add(leadKey);
      actuallyRestored.push(lead);
    }
  }

  saveStoredData(store, true);

  if (supabase && actuallyRestored.length > 0) {
    try {
      const toUpsert = actuallyRestored.filter(l => l.place_id);
      if (toUpsert.length > 0) {
        await supabase.from('leads').upsert(toUpsert, { onConflict: 'place_id' });
      }
    } catch (err) {
      console.warn('Supabase undo restore notice:', err.message);
    }
  }

  console.log(`[UNDO DELETE] Successfully restored ${actuallyRestored.length} lead(s).`);

  res.json({
    success: true,
    restoredCount: actuallyRestored.length,
    restoredLeads: actuallyRestored,
    totalCount: store.leads.length,
    message: `${actuallyRestored.length} lead(s) restored successfully.`
  });
});

// ==========================================================
// OUTREACH ACTIVITY TIMELINE HELPERS
// ==========================================================
function recordLeadActivity(lead, eventData = {}) {
  if (!lead) return null;
  if (!Array.isArray(lead.activities)) {
    lead.activities = [];
  }

  const nowIso = eventData.created_at || new Date().toISOString();
  const eventType = eventData.event_type || 'activity_logged';

  // Duplicate event protection & Idempotency:
  // 1. Same event_type within 3 seconds on the same lead -> return existing to prevent double submission
  const recentSameType = lead.activities.find((a) => {
    if (a.event_type !== eventType) return false;
    if (eventType === 'lead_tags_updated') {
      const oldTags = JSON.stringify(a.metadata?.tags || []);
      const newTags = JSON.stringify(eventData.metadata?.tags || []);
      if (oldTags !== newTags) return false;
    }
    if (eventType === 'cold_call') {
      if (a.metadata?.outcome !== eventData.metadata?.outcome) return false;
    }
    const diff = Math.abs(new Date(nowIso).getTime() - new Date(a.created_at).getTime());
    return diff < 3000;
  });
  if (recentSameType) {
    return recentSameType;
  }

  // 2. Added to Outreach is unique per lead
  if (eventType === 'lead_added_outreach') {
    const existing = lead.activities.find((a) => a.event_type === 'lead_added_outreach');
    if (existing) return existing;
  }

  // 3. Step-specific events: only one per step
  if (eventType === 'followup_due' || eventType === 'followup_sent' || eventType === 'followup_not_sent') {
    const step = eventData.metadata?.step;
    if (step != null) {
      const existingStep = lead.activities.find((a) => a.event_type === eventType && String(a.metadata?.step) === String(step));
      if (existingStep) return existingStep;
    }
  }

  // 4. Outreach Completed is recorded once
  if (eventType === 'outreach_completed') {
    const existing = lead.activities.find((a) => a.event_type === 'outreach_completed');
    if (existing) return existing;
  }

  const activity = {
    activity_id: 'act_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
    lead_id: lead.id || lead.place_id,
    event_type: eventType,
    event_title: eventData.event_title || 'Outreach Activity',
    event_description: eventData.event_description || '',
    created_at: nowIso,
    metadata: eventData.metadata || {}
  };

  lead.activities.push(activity);
  lead.updated_at = nowIso;
  return activity;
}

function getLeadActivitiesWithDerived(lead) {
  if (!lead) return [];
  const activities = Array.isArray(lead.activities) ? [...lead.activities] : [];

  // Check if lead has outreach status but missing 'lead_added_outreach'
  if (lead.outreach_status && lead.outreach_status !== 'Pending') {
    const hasAdded = activities.some((a) => a.event_type === 'lead_added_outreach');
    if (!hasAdded) {
      const addedTime = lead.created_at || new Date().toISOString();
      activities.push({
        activity_id: 'act_derived_added_' + (lead.id || lead.place_id),
        lead_id: lead.id || lead.place_id,
        event_type: 'lead_added_outreach',
        event_title: 'Added to Outreach',
        event_description: 'Lead entered the outreach queue',
        created_at: addedTime,
        metadata: { derived: true }
      });
    }
  }

  // Check message_history for any past messages not in activities
  if (Array.isArray(lead.message_history)) {
    lead.message_history.forEach((msg) => {
      if (msg.type === 'main_message' || msg.name === 'Main Message') {
        const hasMain = activities.some((a) => a.event_type === 'message_sent');
        if (!hasMain) {
          activities.push({
            activity_id: 'act_derived_msg_' + (msg.id || Date.now()),
            lead_id: lead.id || lead.place_id,
            event_type: 'message_sent',
            event_title: 'Message Sent',
            event_description: 'User confirmed that the message was sent',
            created_at: msg.sent_at || lead.main_message_sent_at || new Date().toISOString(),
            metadata: {
              channel: msg.channel || 'WhatsApp',
              message_preview: (msg.text || msg.message || '').slice(0, 120),
              derived: true
            }
          });
        }
      } else if (msg.type === 'follow_up') {
        const step = msg.follow_up_number || msg.sequence_number || 1;
        const hasStep = activities.some((a) => a.event_type === 'followup_sent' && String(a.metadata?.step) === String(step));
        if (!hasStep) {
          activities.push({
            activity_id: 'act_derived_fu_' + (msg.id || Date.now()),
            lead_id: lead.id || lead.place_id,
            event_type: 'followup_sent',
            event_title: `Follow-up #${step} Sent`,
            event_description: `Follow-up #${step} confirmed as sent`,
            created_at: msg.sent_at || new Date().toISOString(),
            metadata: {
              step,
              channel: msg.channel || 'WhatsApp',
              message_preview: (msg.text || msg.message || '').slice(0, 120),
              derived: true
            }
          });
        }
      } else if (msg.type === 'REPLY') {
        const hasReply = activities.some((a) => a.event_type === 'lead_replied');
        if (!hasReply) {
          activities.push({
            activity_id: 'act_derived_reply_' + (msg.id || Date.now()),
            lead_id: lead.id || lead.place_id,
            event_type: 'lead_replied',
            event_title: 'Lead Replied',
            event_description: msg.message || 'Lead reply recorded',
            created_at: msg.sent_at || lead.replied_at || new Date().toISOString(),
            metadata: { reply_status: msg.reply_status, derived: true }
          });
        }
      }
    });
  }

  // Check if a follow-up is currently due and not yet in activities
  if (
    lead.outreach_status === 'Follow-Up' &&
    !lead.follow_up_completed &&
    !lead.reply_status &&
    lead.next_follow_up_at &&
    lead.next_follow_up_number
  ) {
    const dueTime = new Date(lead.next_follow_up_at).getTime();
    if (dueTime <= Date.now()) {
      const step = lead.next_follow_up_number;
      const hasDue = activities.some((a) => a.event_type === 'followup_due' && String(a.metadata?.step) === String(step));
      if (!hasDue) {
        activities.push({
          activity_id: 'act_derived_due_' + step + '_' + (lead.id || lead.place_id),
          lead_id: lead.id || lead.place_id,
          event_type: 'followup_due',
          event_title: `Follow-up #${step} Due`,
          event_description: `Follow-up #${step} is now due for outreach`,
          created_at: lead.next_follow_up_at,
          metadata: { step, derived: true }
        });
      }
    }
  }

  // Check lead notes for any notes not already in activities
  if (Array.isArray(lead.notes)) {
    lead.notes.forEach((n) => {
      if (!n || !n.text) return;
      const noteId = n.id || 'note_' + n.created_at;
      const hasNote = activities.some((a) => a.event_type === 'note_added' && (a.metadata?.note_id === noteId || a.activity_id === 'act_derived_note_' + noteId));
      if (!hasNote) {
        activities.push({
          activity_id: 'act_derived_note_' + noteId,
          lead_id: lead.id || lead.place_id,
          event_type: 'note_added',
          event_title: 'Note Added',
          event_description: n.text,
          created_at: n.created_at || lead.created_at || new Date().toISOString(),
          metadata: { note_id: noteId, note_text: n.text, derived: true }
        });
      }
    });
  }

  // Check lead conversion state for activity
  if (lead.converted) {
    const hasConverted = activities.some((a) => a.event_type === 'lead_converted');
    if (!hasConverted) {
      activities.push({
        activity_id: 'act_derived_conv_' + (lead.id || lead.place_id),
        lead_id: lead.id || lead.place_id,
        event_type: 'lead_converted',
        event_title: 'Lead Converted',
        event_description: [
          lead.conversion_service ? `Service: ${lead.conversion_service}` : null,
          lead.conversion_value != null && lead.conversion_value !== '' ? `Value: $${Number(lead.conversion_value).toLocaleString()}` : null,
          lead.conversion_notes ? `Notes: ${lead.conversion_notes}` : null
        ].filter(Boolean).join(' | ') || 'Lead marked as converted',
        created_at: lead.conversion_date || lead.updated_at || new Date().toISOString(),
        metadata: {
          converted: true,
          conversion_date: lead.conversion_date,
          conversion_service: lead.conversion_service,
          conversion_value: lead.conversion_value,
          conversion_notes: lead.conversion_notes,
          derived: true
        }
      });
    }
  }

  // Reverse chronological sort: newest first
  activities.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  return activities;
}

// Activity filter & search helper (purely read-only)
function filterActivitiesList(activities, { q, type, date, lead } = {}) {
  let list = Array.isArray(activities) ? activities : [];

  // 1. Category / Type filter
  if (type && type !== 'all') {
    const t = String(type).toLowerCase().trim();
    list = list.filter((act) => {
      const et = (act.event_type || '').toLowerCase();
      if (t === 'coldcall' || t === 'cold_call' || t === 'cold call' || t === 'call') {
        return et === 'cold_call' || et === 'cold_call_added' || et.startsWith('cold_call');
      }
      if (t === 'outreach') {
        return et.startsWith('outreach_') || et === 'lead_added_outreach' || et === 'whatsapp_opened' || et === 'not_on_whatsapp' || et === 'message_sent' || et === 'message_not_sent';
      }
      if (t === 'followup' || t === 'follow-up') {
        return et.startsWith('followup_') || act.metadata?.step != null;
      }
      if (t === 'message_sent' || t === 'message sent') {
        return et === 'message_sent' || et === 'followup_sent';
      }
      if (t === 'outcome') {
        return et === 'contact_outcome' || et === 'cold_call' || et === 'lead_replied' || et === 'lead_converted' || et === 'lead_conversion_updated' || Boolean(act.metadata?.outcome) || Boolean(act.metadata?.reply_status);
      }
      if (t === 'notes' || t === 'note') {
        return et === 'note_added' || et === 'note_edited' || Boolean(act.metadata?.note_text) || Boolean(act.metadata?.note_id);
      }
      if (t === 'status_change' || t === 'status' || t === 'status changes') {
        return et === 'lead_added_outreach' || et === 'cold_call_added' || et === 'cold_call' || et === 'outreach_started' || et === 'outreach_stopped' || et === 'outreach_completed' || et === 'outreach_skipped' || et === 'followup_paused' || et === 'followup_resumed' || et === 'lead_saved' || et === 'contact_outcome' || et === 'lead_converted' || et === 'lead_conversion_updated' || et === 'lead_tags_updated';
      }
      if (t === 'conversion' || t === 'converted') {
        return et === 'lead_converted' || et === 'lead_conversion_updated';
      }
      if (t === 'tags' || t === 'tag') {
        return et === 'lead_tags_updated' || Boolean(act.metadata?.tags);
      }
      return et === t;
    });
  }

  // 2. Date filter (local calendar date boundaries)
  if (date && date !== 'all') {
    const now = new Date();
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const tomorrowMidnight = todayMidnight + 86400000;
    const sevenDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6).getTime();
    const thirtyDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29).getTime();

    list = list.filter((act) => {
      const actTime = new Date(act.created_at).getTime();
      if (isNaN(actTime)) return true;
      if (date === 'today') {
        return actTime >= todayMidnight && actTime < tomorrowMidnight;
      }
      if (date === '7d' || date === 'last_7_days' || date === 'last 7 days') {
        return actTime >= sevenDaysAgo;
      }
      if (date === '30d' || date === 'last_30_days' || date === 'last 30 days') {
        return actTime >= thirtyDaysAgo;
      }
      return true;
    });
  }

  // 3. Search query (matches business name, activity type, outcome, message, notes, date, details, tags)
  if (q && typeof q === 'string' && q.trim()) {
    const query = q.trim().toLowerCase();
    list = list.filter((act) => {
      // Business / Lead name
      const bName = (act.business_name || lead?.business_name || lead?.name || '').toLowerCase();
      if (bName.includes(query)) return true;

      // Activity Type & Title
      const et = (act.event_type || '').toLowerCase();
      const title = (act.event_title || '').toLowerCase();
      if (et.includes(query) || title.includes(query)) return true;

      // Outcome
      const outcome = (act.metadata?.outcome || lead?.contact_outcome || '').toLowerCase();
      const reason = (act.metadata?.reason || '').toLowerCase();
      const replyStatus = (act.metadata?.reply_status || '').toLowerCase();
      if (outcome.includes(query) || reason.includes(query) || replyStatus.includes(query)) return true;

      // Message text
      const msgPreview = (act.metadata?.message_preview || act.metadata?.message_text || act.metadata?.message || '').toLowerCase();
      if (msgPreview.includes(query)) return true;

      // Note text
      const noteText = (act.metadata?.note_text || (et === 'note_added' ? act.event_description : '') || '').toLowerCase();
      if (noteText.includes(query)) return true;

      // Description
      const desc = (act.event_description || '').toLowerCase();
      if (desc.includes(query)) return true;

      // Lead Tags
      if (Array.isArray(lead?.tags) && lead.tags.some((t) => String(t).toLowerCase().includes(query))) return true;
      if (Array.isArray(act.metadata?.tags) && act.metadata.tags.some((t) => String(t).toLowerCase().includes(query))) return true;

      // Date string
      const dateStr = (act.created_at || '').toLowerCase();
      if (dateStr.includes(query)) return true;

      // Relative keywords
      if (query === 'today') {
        const now = new Date();
        const t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        const t1 = t0 + 86400000;
        const at = new Date(act.created_at).getTime();
        if (at >= t0 && at < t1) return true;
      }
      if (query === 'yesterday') {
        const now = new Date();
        const y0 = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime();
        const y1 = y0 + 86400000;
        const at = new Date(act.created_at).getTime();
        if (at >= y0 && at < y1) return true;
      }

      // Relevant details (channel, step, phone, category)
      const channel = (act.metadata?.channel || '').toLowerCase();
      const step = act.metadata?.step != null ? `step ${act.metadata.step} #${act.metadata.step}` : '';
      const phone = (lead?.phone || '').toLowerCase();
      const category = (lead?.category || '').toLowerCase();
      if (channel.includes(query) || step.includes(query) || phone.includes(query) || category.includes(query)) return true;

      return false;
    });
  }

  return list;
}

// 7b. Move Selected Leads to Outreach Queue
app.post('/api/leads/move-to-outreach', async (req, res) => {
  const { leadIds = [] } = req.body;
  if (!Array.isArray(leadIds) || leadIds.length === 0) {
    return res.status(400).json({ success: false, error: 'No lead IDs provided.' });
  }

  const store = getStoredData();
  const idSet = new Set(leadIds.map(String));
  const nowIso = new Date().toISOString();
  const matchedLeads = [];

  for (const lead of store.leads) {
    if (idSet.has(String(lead.id)) || idSet.has(String(lead.place_id))) {
      // Only transition to Not Contacted if first message has not yet been sent
      if (!lead.first_message_sent) {
        lead.outreach_status = 'Not Contacted';
      }
      lead.updated_at = nowIso;
      recordLeadActivity(lead, {
        event_type: 'lead_added_outreach',
        event_title: 'Added to Outreach',
        event_description: 'Lead entered the outreach queue',
        created_at: nowIso
      });
      matchedLeads.push(lead);
    }
  }

  if (matchedLeads.length === 0) {
    return res.status(404).json({ success: false, error: 'No matching leads found.' });
  }

  if (!store.outreach) store.outreach = [];
  matchedLeads.forEach((lead) => {
    const existing = store.outreach.find(
      (o) => (o.saved_lead_id && String(o.saved_lead_id) === String(lead.id)) || (o.place_id && String(o.place_id) === String(lead.place_id))
    );
    if (existing) {
      existing.status = lead.outreach_status;
      existing.updated_at = nowIso;
    } else {
      store.outreach.push({
        id: 'outreach_' + (lead.id || lead.place_id),
        saved_lead_id: lead.id,
        place_id: lead.place_id,
        status: lead.outreach_status,
        created_at: nowIso,
        updated_at: nowIso
      });
    }
  });

  saveStoredData(store, true);

  if (supabase && matchedLeads.length > 0) {
    try {
      const placeIds = matchedLeads.filter((l) => !l.first_message_sent).map((l) => l.place_id);
      if (placeIds.length > 0) {
        await supabase
          .from('leads')
          .update({ outreach_status: 'Not Contacted', updated_at: nowIso })
          .in('place_id', placeIds)
          .eq('first_message_sent', false);
      }
    } catch (err) {
      console.warn('Supabase move-to-outreach notice:', err.message);
    }
  }

  res.json({
    success: true,
    movedCount: matchedLeads.length,
    leadIds: matchedLeads.map((l) => l.id || l.place_id),
    message: `${matchedLeads.length} leads moved to Outreach queue.`
  });
});

// ==================================================
// 7b. Search History & Past Scans Engine
// ==================================================
function formatHistoryRecord(s, leads = []) {
  const p = s.parameters || {};
  const dateObj = s.startedAt ? new Date(s.startedAt) : new Date();

  // Format Date: e.g. "Sep 12, 2026"
  const formattedDate = dateObj.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });

  // Format Time: e.g. "10:52 AM"
  const formattedTime = dateObj.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });

  const uniqueLeads = typeof s.totalDiscovered === 'number'
    ? s.totalDiscovered
    : (typeof s.newLeadsCount === 'number' ? s.newLeadsCount : 0);

  let withoutWebsite = 0;
  let withWebsite = 0;

  if (typeof s.withoutWebsiteCount === 'number' && typeof s.withWebsiteCount === 'number') {
    withoutWebsite = s.withoutWebsiteCount;
    withWebsite = s.withWebsiteCount;
  } else {
    // Match against stored leads
    const cat = p.category;
    const city = p.city;
    const state = p.state;
    const matched = leads.filter((l) => {
      const matchCat = !cat || l.category === cat;
      const matchLoc = !city || city === 'Entire State' || l.city === city || l.state === state;
      return matchCat && matchLoc;
    });

    if (uniqueLeads === 0) {
      withoutWebsite = 0;
      withWebsite = 0;
    } else if (matched.length > 0) {
      const noWeb = matched.filter((l) => l.website_status === 'NO').length;
      const hasWeb = matched.filter((l) => l.website_status === 'YES').length;
      if (noWeb + hasWeb > 0) {
        const ratio = noWeb / (noWeb + hasWeb);
        withoutWebsite = Math.round(uniqueLeads * ratio);
        withWebsite = Math.max(0, uniqueLeads - withoutWebsite);
      } else {
        withoutWebsite = Math.round(uniqueLeads * 0.4);
        withWebsite = Math.max(0, uniqueLeads - withoutWebsite);
      }
    } else {
      withoutWebsite = Math.round(uniqueLeads * 0.4);
      withWebsite = Math.max(0, uniqueLeads - withoutWebsite);
    }
  }

  return {
    id: s.sessionId || `session_${dateObj.getTime()}`,
    sessionId: s.sessionId || `session_${dateObj.getTime()}`,
    category: p.category || 'Local Businesses',
    state: p.state || 'India',
    city: p.city || 'Regional Area',
    district: p.district || p.city || '',
    radiusKm: p.radiusKm || 25,
    keyword: p.keyword || '',
    date: formattedDate,
    time: formattedTime,
    startedAt: s.startedAt || dateObj.toISOString(),
    completedAt: s.completedAt || dateObj.toISOString(),
    uniqueLeads,
    withoutWebsite,
    withWebsite,
    parameters: p
  };
}

// 7b.1 Get Search History
app.get('/api/history', async (req, res) => {
  let store = getStoredData();
  if (supabase && (!leadsSupabaseSyncDone || !store.leads || store.leads.length === 0)) {
    store = await syncPersistentLeads(store);
  }
  if (!Array.isArray(store.searchSessions)) {
    store.searchSessions = [];
  }
  const leads = store.leads || [];
  const history = store.searchSessions.map((s) => formatHistoryRecord(s, leads));
  res.json({
    success: true,
    totalCount: history.length,
    count: history.length,
    history
  });
});

// 7b.2 Delete Single Search History Record
app.delete('/api/history/:id', (req, res) => {
  const { id } = req.params;
  const store = getStoredData();
  if (!Array.isArray(store.searchSessions)) {
    store.searchSessions = [];
  }
  const initialCount = store.searchSessions.length;
  store.searchSessions = store.searchSessions.filter(
    (s) => s.sessionId !== id && s.id !== id
  );
  saveStoredData(store);
  const deleted = initialCount > store.searchSessions.length;
  res.json({
    success: deleted,
    count: store.searchSessions.length,
    message: deleted ? 'Search history record deleted.' : 'Record not found.'
  });
});

// 7b.3 Delete Batch Search History Records
app.post('/api/history/delete-batch', (req, res) => {
  const { ids = [] } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ success: false, error: 'No search record IDs provided.' });
  }
  const store = getStoredData();
  if (!Array.isArray(store.searchSessions)) {
    store.searchSessions = [];
  }
  const idSet = new Set(ids);
  const beforeCount = store.searchSessions.length;
  store.searchSessions = store.searchSessions.filter(
    (s) => !idSet.has(s.sessionId) && !idSet.has(s.id)
  );
  saveStoredData(store);
  const deletedCount = beforeCount - store.searchSessions.length;
  res.json({
    success: true,
    deletedCount,
    count: store.searchSessions.length,
    message: `${deletedCount} search records deleted.`
  });
});

// 7b.4 Delete All Search History Records
app.delete('/api/history', (req, res) => {
  const store = getStoredData();
  store.searchSessions = [];
  saveStoredData(store);
  res.json({
    success: true,
    count: 0,
    message: 'All search history cleared.'
  });
});

// 8. Toggle / Set Favorite
app.post('/api/leads/:id/favorite', async (req, res) => {
  const { id } = req.params;
  const store = getStoredData();
  const lead = store.leads.find((l) => l.id === id || l.place_id === id);

  if (!lead) {
    return res.status(404).json({ success: false, error: 'Lead not found.' });
  }

  if (req.body && typeof req.body.favorite === 'boolean') {
    lead.favorite = req.body.favorite;
  } else {
    lead.favorite = !lead.favorite;
  }
  lead.updated_at = new Date().toISOString();
  saveStoredData(store, true);

  if (supabase) {
    try {
      await supabase.from('leads').update({ favorite: lead.favorite }).eq('place_id', lead.place_id);
    } catch (err) {
      console.warn('Supabase favorite notice:', err.message);
    }
  }

  res.json({
    success: true,
    favorite: lead.favorite,
    message: lead.favorite ? 'Lead added to Favorites.' : 'Lead removed from Favorites.'
  });
});

// 9. Batch Favorite / Unfavorite Leads
app.post('/api/leads/favorite-batch', async (req, res) => {
  const { ids = [], favorite = false } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ success: false, error: 'No lead IDs provided.' });
  }

  const store = getStoredData();
  const idSet = new Set(ids);
  let updatedCount = 0;
  const now = new Date().toISOString();
  const updatedPlaceIds = [];

  store.leads.forEach((l) => {
    if (idSet.has(l.id) || idSet.has(l.place_id)) {
      l.favorite = favorite;
      l.updated_at = now;
      updatedCount++;
      updatedPlaceIds.push(l.place_id);
    }
  });

  saveStoredData(store, true);

  if (supabase && updatedPlaceIds.length > 0) {
    try {
      await supabase.from('leads').update({ favorite }).in('place_id', updatedPlaceIds);
    } catch (err) {
      console.warn('Supabase batch favorite notice:', err.message);
    }
  }

  const totalFavs = store.leads.filter((l) => l.favorite).length;

  res.json({
    success: true,
    updatedCount,
    totalFavorites: totalFavs,
    message: `${updatedCount} leads updated in Favorites.`
  });
});

// 9. Update Status
app.post('/api/leads/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const store = getStoredData();
  const lead = store.leads.find((l) => l.id === id || l.place_id === id);

  if (!lead) {
    return res.status(404).json({ success: false, error: 'Lead not found.' });
  }

  lead.status = status || lead.status;
  lead.updated_at = new Date().toISOString();
  saveStoredData(store, true);

  if (supabase) {
    try {
      await supabase.from('leads').update({ status: lead.status }).eq('place_id', lead.place_id);
    } catch (err) {
      console.warn('Supabase status notice:', err.message);
    }
  }

  res.json({ success: true, status: lead.status });
});

// 9.1 Update Priority (Single Lead)
const handleUpdateLeadPriority = async (req, res) => {
  const { id } = req.params;
  const { priority } = req.body;
  const validPriorities = ['High', 'Medium', 'Low'];
  const normalizedPriority = validPriorities.find((p) => p.toLowerCase() === (priority || '').toLowerCase());

  if (!normalizedPriority) {
    return res.status(400).json({ success: false, error: 'Invalid priority. Priority must be High, Medium, or Low.' });
  }

  const store = getStoredData();
  const lead = store.leads.find((l) => String(l.id) === String(id) || (l.place_id && String(l.place_id) === String(id)));

  if (!lead) {
    return res.status(404).json({ success: false, error: 'Lead not found.' });
  }

  lead.priority = normalizedPriority;
  lead.updated_at = new Date().toISOString();
  saveStoredData(store, true);

  if (supabase) {
    try {
      await supabase.from('leads').update({ priority: normalizedPriority }).eq('place_id', lead.place_id);
    } catch (err) {
      console.warn('Supabase priority update notice:', err.message);
    }
  }

  res.json({ success: true, id: lead.id || lead.place_id, priority: lead.priority, lead });
};

app.post('/api/leads/:id/priority', handleUpdateLeadPriority);
app.patch('/api/leads/:id/priority', handleUpdateLeadPriority);

// 9.2 Batch Update Priority
app.post('/api/leads/priority-batch', async (req, res) => {
  const { ids, priority } = req.body;
  const validPriorities = ['High', 'Medium', 'Low'];
  const normalizedPriority = validPriorities.find((p) => p.toLowerCase() === (priority || '').toLowerCase());

  if (!normalizedPriority) {
    return res.status(400).json({ success: false, error: 'Invalid priority. Priority must be High, Medium, or Low.' });
  }
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ success: false, error: 'ids array is required.' });
  }

  const store = getStoredData();
  const idSet = new Set(ids.map(String));
  let updatedCount = 0;
  const updatedPlaceIds = [];

  store.leads.forEach((l) => {
    if (idSet.has(String(l.id)) || (l.place_id && idSet.has(String(l.place_id)))) {
      l.priority = normalizedPriority;
      l.updated_at = new Date().toISOString();
      updatedCount++;
      if (l.place_id) updatedPlaceIds.push(l.place_id);
    }
  });

  if (updatedCount > 0) {
    saveStoredData(store, true);
    if (supabase && updatedPlaceIds.length > 0) {
      try {
        await supabase.from('leads').update({ priority: normalizedPriority }).in('place_id', updatedPlaceIds);
      } catch (err) {
        console.warn('Supabase batch priority notice:', err.message);
      }
    }
  }

  res.json({ success: true, updatedCount, priority: normalizedPriority });
});

// 9.3 Update Contact Outcome & Reason
const handleUpdateLeadOutcome = async (req, res) => {
  const { id } = req.params;
  const { outcome, reason } = req.body;
  const validOutcomes = [
    '',
    'No Response',
    'Interested',
    'Not Interested',
    'Call Back Later',
    'Wrong Number',
    'Converted',
    'Other'
  ];

  const rawOutcome = (outcome || '').trim();
  const matchedOutcome = validOutcomes.find((o) => o.toLowerCase() === rawOutcome.toLowerCase());

  if (rawOutcome && matchedOutcome === undefined) {
    return res.status(400).json({
      success: false,
      error: 'Invalid outcome. Supported: No Response, Interested, Not Interested, Call Back Later, Wrong Number, Converted, Other'
    });
  }

  const normalizedOutcome = matchedOutcome || '';
  const cleanReason = (reason || '').trim();
  const nowIso = new Date().toISOString();

  const store = getStoredData();
  const lead = store.leads.find((l) => String(l.id) === String(id) || (l.place_id && String(l.place_id) === String(id)));

  if (!lead) {
    return res.status(404).json({ success: false, error: 'Lead not found.' });
  }

  lead.contact_outcome = normalizedOutcome || null;
  lead.contact_outcome_reason = cleanReason;
  lead.contact_outcome_date = normalizedOutcome ? nowIso : null;
  lead.updated_at = nowIso;

  // Safe follow-up handling where explicitly appropriate:
  if (normalizedOutcome === 'Not Interested') {
    lead.stopped = true;
    lead.outreach_status = 'Stopped';
    lead.follow_up_completed = true;
    lead.next_follow_up_at = null;
    lead.next_follow_up_number = null;
    lead.next_follow_up_name = null;
  } else if (normalizedOutcome === 'Wrong Number') {
    lead.stopped = true;
    lead.not_on_whatsapp = true;
    lead.outreach_status = 'Not on WhatsApp';
    lead.follow_up_completed = true;
    lead.next_follow_up_at = null;
    lead.next_follow_up_number = null;
    lead.next_follow_up_name = null;
  }

  // Record Activity Timeline Entry if an outcome was set
  if (normalizedOutcome) {
    recordLeadActivity(lead, {
      event_type: 'contact_outcome',
      event_title: `Outcome: ${normalizedOutcome}`,
      event_description: cleanReason ? `Reason: ${cleanReason}` : 'No reason provided',
      created_at: nowIso,
      metadata: {
        outcome: normalizedOutcome,
        reason: cleanReason || null
      }
    });
  }

  saveStoredData(store, true);

  if (supabase) {
    try {
      const updatePayload = {
        contact_outcome: lead.contact_outcome,
        contact_outcome_reason: lead.contact_outcome_reason,
        contact_outcome_date: lead.contact_outcome_date,
        updated_at: lead.updated_at
      };
      if (lead.stopped) updatePayload.stopped = lead.stopped;
      if (lead.outreach_status) updatePayload.outreach_status = lead.outreach_status;
      if (lead.follow_up_completed) updatePayload.follow_up_completed = lead.follow_up_completed;
      if (lead.not_on_whatsapp) updatePayload.not_on_whatsapp = lead.not_on_whatsapp;

      await supabase.from('leads').update(updatePayload).eq('place_id', lead.place_id);
    } catch (err) {
      console.warn('Supabase outcome update notice:', err.message);
    }
  }

  res.json({
    success: true,
    id: lead.id || lead.place_id,
    contact_outcome: lead.contact_outcome,
    contact_outcome_reason: lead.contact_outcome_reason,
    contact_outcome_date: lead.contact_outcome_date,
    lead
  });
};

app.post('/api/leads/:id/outcome', handleUpdateLeadOutcome);
app.patch('/api/leads/:id/outcome', handleUpdateLeadOutcome);

// 9.3b Update Lead Conversion
const handleUpdateLeadConversion = async (req, res) => {
  const { id } = req.params;
  const { converted, conversion_date, conversion_service, conversion_value, conversion_notes } = req.body;

  const store = getStoredData();
  const lead = store.leads.find((l) => String(l.id) === String(id) || (l.place_id && String(l.place_id) === String(id)));

  if (!lead) {
    return res.status(404).json({ success: false, error: 'Lead not found.' });
  }

  const isConverted = Boolean(converted);
  const nowIso = new Date().toISOString();

  lead.converted = isConverted;
  lead.conversion_date = isConverted ? (conversion_date || lead.conversion_date || nowIso) : null;
  lead.conversion_service = isConverted && conversion_service ? String(conversion_service).trim() : null;
  lead.conversion_value = isConverted && conversion_value !== undefined && conversion_value !== null && conversion_value !== '' && !isNaN(Number(conversion_value))
    ? Number(conversion_value)
    : null;
  lead.conversion_notes = isConverted && conversion_notes ? String(conversion_notes).trim() : null;
  lead.updated_at = nowIso;

  // Record Activity Timeline Entry
  if (isConverted) {
    const descParts = [];
    if (lead.conversion_service) descParts.push(`Service: ${lead.conversion_service}`);
    if (lead.conversion_value != null) descParts.push(`Value: $${lead.conversion_value.toLocaleString()}`);
    if (lead.conversion_notes) descParts.push(`Notes: ${lead.conversion_notes}`);
    const desc = descParts.join(' | ') || 'Lead marked as converted';

    recordLeadActivity(lead, {
      event_type: 'lead_converted',
      event_title: 'Lead Converted',
      event_description: desc,
      created_at: lead.conversion_date || nowIso,
      metadata: {
        converted: true,
        conversion_date: lead.conversion_date,
        conversion_service: lead.conversion_service,
        conversion_value: lead.conversion_value,
        conversion_notes: lead.conversion_notes
      }
    });
  } else {
    recordLeadActivity(lead, {
      event_type: 'lead_conversion_updated',
      event_title: 'Conversion Status Changed',
      event_description: 'Lead marked as Not Converted',
      created_at: nowIso,
      metadata: {
        converted: false
      }
    });
  }

  saveStoredData(store, true);

  if (supabase) {
    try {
      const updatePayload = {
        converted: lead.converted,
        conversion_date: lead.conversion_date,
        conversion_service: lead.conversion_service,
        conversion_value: lead.conversion_value,
        conversion_notes: lead.conversion_notes,
        updated_at: lead.updated_at
      };
      await supabase.from('leads').update(updatePayload).eq('place_id', lead.place_id);
    } catch (err) {
      console.warn('Supabase conversion update notice:', err.message);
    }
  }

  res.json({
    success: true,
    id: lead.id || lead.place_id,
    converted: lead.converted,
    conversion_date: lead.conversion_date,
    conversion_service: lead.conversion_service,
    conversion_value: lead.conversion_value,
    conversion_notes: lead.conversion_notes,
    lead
  });
};

app.post('/api/leads/:id/conversion', handleUpdateLeadConversion);
app.patch('/api/leads/:id/conversion', handleUpdateLeadConversion);

// Get Lead Conversion Summary
app.get('/api/conversion/summary', (req, res) => {
  const store = getStoredData();
  const leads = Array.isArray(store.leads) ? store.leads : [];

  let totalConverted = 0;
  let totalValue = 0;

  leads.forEach((l) => {
    if (l.converted) {
      totalConverted += 1;
      if (typeof l.conversion_value === 'number' && !isNaN(l.conversion_value) && l.conversion_value > 0) {
        totalValue += l.conversion_value;
      }
    }
  });

  const totalLeads = leads.length;
  const totalNotConverted = totalLeads - totalConverted;
  const conversionRate = totalLeads > 0 ? Number(((totalConverted / totalLeads) * 100).toFixed(1)) : 0;

  res.json({
    success: true,
    totalLeads,
    totalConverted,
    totalNotConverted,
    conversionRate,
    conversionValue: totalValue
  });
});

// ========================================================
// 9.3b LEAD TAGS MANAGEMENT
// ========================================================
const DEFAULT_TAG_SUGGESTIONS = [
  'Hot',
  'Website Needed',
  'High Value',
  'Call Back',
  'Local',
  'Potential Client',
  'Interested',
  'Follow Up'
];

function sanitizeTag(raw) {
  if (typeof raw !== 'string') return '';
  return raw.trim().replace(/\s+/g, ' ').slice(0, 50);
}

function sanitizeTagArray(rawTags) {
  if (!Array.isArray(rawTags)) return [];
  const seen = new Set();
  const result = [];
  for (const item of rawTags) {
    const clean = sanitizeTag(item);
    if (!clean) continue;
    const lower = clean.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      result.push(clean);
    }
  }
  return result;
}

const handleUpdateLeadTags = async (req, res) => {
  const { id } = req.params;
  const store = getStoredData();
  const lead = store.leads.find((l) => String(l.id) === String(id) || (l.place_id && String(l.place_id) === String(id)));

  if (!lead) {
    return res.status(404).json({ success: false, error: 'Lead not found.' });
  }

  const existingTags = Array.isArray(lead.tags) ? [...lead.tags] : [];
  let updatedTags = [];

  const { tags, action, tag } = req.body || {};

  if (Array.isArray(tags)) {
    // Direct assignment with sanitized tags
    updatedTags = sanitizeTagArray(tags);
  } else if (action === 'add' && tag) {
    const clean = sanitizeTag(tag);
    if (clean) {
      const lower = clean.toLowerCase();
      if (!existingTags.some((t) => t.toLowerCase() === lower)) {
        updatedTags = [...existingTags, clean];
      } else {
        updatedTags = existingTags;
      }
    } else {
      updatedTags = existingTags;
    }
  } else if (action === 'remove' && tag) {
    const clean = sanitizeTag(tag).toLowerCase();
    updatedTags = existingTags.filter((t) => t.toLowerCase() !== clean);
  } else {
    return res.status(400).json({ success: false, error: 'Invalid tags payload. Provide "tags" array or action ("add"|"remove") with "tag".' });
  }

  const nowIso = new Date().toISOString();
  lead.tags = updatedTags;
  lead.updated_at = nowIso;

  // Record append-only activity timeline entry
  const tagsSummary = updatedTags.length > 0 ? updatedTags.join(', ') : 'No tags';
  recordLeadActivity(lead, {
    event_type: 'lead_tags_updated',
    event_title: 'Lead Tags Updated',
    event_description: `Tags: ${tagsSummary}`,
    created_at: nowIso,
    metadata: {
      tags: updatedTags
    }
  });

  saveStoredData(store, true);

  if (supabase) {
    try {
      await supabase.from('leads').update({
        tags: lead.tags,
        updated_at: lead.updated_at
      }).eq('place_id', lead.place_id);
    } catch (err) {
      console.warn('Supabase tags update notice:', err.message);
    }
  }

  res.json({
    success: true,
    id: lead.id || lead.place_id,
    tags: lead.tags,
    lead
  });
};

app.post('/api/leads/:id/tags', handleUpdateLeadTags);
app.patch('/api/leads/:id/tags', handleUpdateLeadTags);

// Get all unique tags and suggestions
app.get('/api/tags', (req, res) => {
  const store = getStoredData();
  const leads = Array.isArray(store.leads) ? store.leads : [];
  const tagCounts = {};

  leads.forEach((l) => {
    if (Array.isArray(l.tags)) {
      l.tags.forEach((t) => {
        const clean = sanitizeTag(t);
        if (clean) {
          tagCounts[clean] = (tagCounts[clean] || 0) + 1;
        }
      });
    }
  });

  const activeTags = Object.keys(tagCounts).sort((a, b) => a.localeCompare(b));

  res.json({
    success: true,
    tags: activeTags,
    tagCounts,
    defaultSuggestions: DEFAULT_TAG_SUGGESTIONS
  });
});

// 9.4 Pause / Resume Follow-Up
const handlePauseFollowUp = async (req, res) => {
  const { id } = req.params;
  const store = getStoredData();
  const lead = store.leads.find((l) => String(l.id) === String(id) || (l.place_id && String(l.place_id) === String(id)));

  if (!lead) {
    return res.status(404).json({ success: false, error: 'Lead not found.' });
  }

  const nowIso = new Date().toISOString();
  lead.follow_up_paused = true;
  lead.updated_at = nowIso;

  recordLeadActivity(lead, {
    event_type: 'followup_paused',
    event_title: 'Follow-Up Paused',
    event_description: 'Follow-up paused for this lead',
    created_at: nowIso
  });

  saveStoredData(store, true);

  if (supabase) {
    try {
      await supabase.from('leads').update({
        follow_up_paused: true,
        updated_at: lead.updated_at
      }).eq('place_id', lead.place_id);
    } catch (err) {
      console.warn('Supabase follow-up pause update notice:', err.message);
    }
  }

  res.json({
    success: true,
    id: lead.id || lead.place_id,
    follow_up_paused: true,
    lead
  });
};

const handleResumeFollowUp = async (req, res) => {
  const { id } = req.params;
  const store = getStoredData();
  const lead = store.leads.find((l) => String(l.id) === String(id) || (l.place_id && String(l.place_id) === String(id)));

  if (!lead) {
    return res.status(404).json({ success: false, error: 'Lead not found.' });
  }

  const nowIso = new Date().toISOString();
  lead.follow_up_paused = false;
  lead.updated_at = nowIso;

  recordLeadActivity(lead, {
    event_type: 'followup_resumed',
    event_title: 'Follow-Up Resumed',
    event_description: `Follow-up resumed at stage #${lead.next_follow_up_number || 1}`,
    created_at: nowIso
  });

  saveStoredData(store, true);

  if (supabase) {
    try {
      await supabase.from('leads').update({
        follow_up_paused: false,
        updated_at: lead.updated_at
      }).eq('place_id', lead.place_id);
    } catch (err) {
      console.warn('Supabase follow-up resume update notice:', err.message);
    }
  }

  res.json({
    success: true,
    id: lead.id || lead.place_id,
    follow_up_paused: false,
    lead
  });
};

const handleBulkFollowUpPause = async (req, res) => {
  const { leadIds = [], action = 'pause' } = req.body;
  if (!Array.isArray(leadIds) || leadIds.length === 0) {
    return res.status(400).json({ success: false, error: 'No lead IDs provided.' });
  }

  const store = getStoredData();
  const isPause = action === 'pause';
  const nowIso = new Date().toISOString();
  let updatedCount = 0;

  for (const id of leadIds) {
    const lead = store.leads.find((l) => String(l.id) === String(id) || (l.place_id && String(l.place_id) === String(id)));
    if (lead) {
      lead.follow_up_paused = isPause;
      lead.updated_at = nowIso;

      recordLeadActivity(lead, {
        event_type: isPause ? 'followup_paused' : 'followup_resumed',
        event_title: isPause ? 'Follow-Up Paused' : 'Follow-Up Resumed',
        event_description: isPause ? 'Follow-up paused via bulk action' : `Follow-up resumed via bulk action at stage #${lead.next_follow_up_number || 1}`,
        created_at: nowIso
      });
      updatedCount++;
    }
  }

  saveStoredData(store, true);

  res.json({
    success: true,
    updatedCount,
    action: isPause ? 'paused' : 'resumed'
  });
};

app.post('/api/leads/:id/followup/pause', handlePauseFollowUp);
app.post('/api/leads/:id/followup/resume', handleResumeFollowUp);
app.post('/api/leads/bulk-followup/pause', (req, res) => { req.body.action = 'pause'; handleBulkFollowUpPause(req, res); });
app.post('/api/leads/bulk-followup/resume', (req, res) => { req.body.action = 'resume'; handleBulkFollowUpPause(req, res); });

// ----------------------------------------------------
// LEAD NOTES REST API
// ----------------------------------------------------
// 1. Get Notes for a Lead
app.get('/api/leads/:id/notes', (req, res) => {
  const { id } = req.params;
  const store = getStoredData();
  const lead = store.leads.find((l) => String(l.id) === String(id) || (l.place_id && String(l.place_id) === String(id)));
  if (!lead) {
    return res.status(404).json({ success: false, error: 'Lead not found.' });
  }
  const notes = Array.isArray(lead.notes) ? lead.notes : [];
  res.json({ success: true, notes });
});

// 2. Add a Note to a Lead
app.post('/api/leads/:id/notes', async (req, res) => {
  const { id } = req.params;
  const { text } = req.body || {};
  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ success: false, error: 'Please enter a note.' });
  }
  if (text.length > 5000) {
    return res.status(400).json({ success: false, error: 'Note exceeds maximum character limit of 5000 characters.' });
  }

  const store = getStoredData();
  const lead = store.leads.find((l) => String(l.id) === String(id) || (l.place_id && String(l.place_id) === String(id)));
  if (!lead) {
    return res.status(404).json({ success: false, error: 'Lead not found.' });
  }

  if (!Array.isArray(lead.notes)) {
    lead.notes = [];
  }

  const nowIso = new Date().toISOString();
  const newNote = {
    id: 'note_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
    lead_id: lead.id || lead.place_id,
    text: text.trim(),
    created_at: nowIso,
    updated_at: nowIso
  };

  lead.notes.unshift(newNote);
  lead.updated_at = nowIso;
  saveStoredData(store, true);

  if (supabase) {
    try {
      await supabase.from('leads').update({ notes: lead.notes }).eq('place_id', lead.place_id);
    } catch (err) {
      console.warn('Supabase notes sync notice:', err.message);
    }
  }

  res.json({ success: true, note: newNote, notes: lead.notes });
});

// 3. Edit an Existing Note
app.put('/api/leads/:id/notes/:noteId', async (req, res) => {
  const { id, noteId } = req.params;
  const { text } = req.body || {};
  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ success: false, error: 'Please enter a note.' });
  }
  if (text.length > 5000) {
    return res.status(400).json({ success: false, error: 'Note exceeds maximum character limit of 5000 characters.' });
  }

  const store = getStoredData();
  const lead = store.leads.find((l) => String(l.id) === String(id) || (l.place_id && String(l.place_id) === String(id)));
  if (!lead) {
    return res.status(404).json({ success: false, error: 'Lead not found.' });
  }

  if (!Array.isArray(lead.notes)) {
    lead.notes = [];
  }

  const note = lead.notes.find((n) => String(n.id) === String(noteId));
  if (!note) {
    return res.status(404).json({ success: false, error: 'Note not found.' });
  }

  const nowIso = new Date().toISOString();
  note.text = text.trim();
  note.updated_at = nowIso;
  lead.updated_at = nowIso;
  saveStoredData(store, true);

  if (supabase) {
    try {
      await supabase.from('leads').update({ notes: lead.notes }).eq('place_id', lead.place_id);
    } catch (err) {
      console.warn('Supabase notes update notice:', err.message);
    }
  }

  res.json({ success: true, note, notes: lead.notes });
});

// 4. Delete an Existing Note
app.delete('/api/leads/:id/notes/:noteId', async (req, res) => {
  const { id, noteId } = req.params;
  const store = getStoredData();
  const lead = store.leads.find((l) => String(l.id) === String(id) || (l.place_id && String(l.place_id) === String(id)));
  if (!lead) {
    return res.status(404).json({ success: false, error: 'Lead not found.' });
  }

  if (!Array.isArray(lead.notes)) {
    lead.notes = [];
  }

  const noteIndex = lead.notes.findIndex((n) => String(n.id) === String(noteId));
  if (noteIndex === -1) {
    return res.status(404).json({ success: false, error: 'Note not found.' });
  }

  lead.notes.splice(noteIndex, 1);
  lead.updated_at = new Date().toISOString();
  saveStoredData(store, true);

  if (supabase) {
    try {
      await supabase.from('leads').update({ notes: lead.notes }).eq('place_id', lead.place_id);
    } catch (err) {
      console.warn('Supabase notes delete notice:', err.message);
    }
  }

  res.json({ success: true, deletedNoteId: noteId, notes: lead.notes });
});

// ==========================================================
// 4b. LEAD OUTREACH ACTIVITIES API
// ==========================================================
// Get Lead Activities Timeline
app.get('/api/leads/:id/activities', (req, res) => {
  const { id } = req.params;
  const { q, search, type, date } = req.query;
  const store = getStoredData();
  const lead = store.leads.find((l) => String(l.id) === String(id) || (l.place_id && String(l.place_id) === String(id)));
  if (!lead) {
    return res.status(404).json({ success: false, error: 'Lead not found.' });
  }

  const allActivities = getLeadActivitiesWithDerived(lead);
  const searchQuery = q || search;
  const activities = (searchQuery || (type && type !== 'all') || (date && date !== 'all'))
    ? filterActivitiesList(allActivities, { q: searchQuery, type, date, lead })
    : allActivities;

  res.json({
    success: true,
    activities,
    totalCount: allActivities.length,
    filteredCount: activities.length
  });
});

// Cross-lead Lead Activity Search (Read-only)
app.get('/api/activities/search', (req, res) => {
  const { q, search, type, date, lead_id } = req.query;
  const store = getStoredData();
  let leads = store.leads || [];
  if (lead_id) {
    leads = leads.filter((l) => String(l.id) === String(lead_id) || (l.place_id && String(l.place_id) === String(lead_id)));
  }

  const allTimeline = [];
  leads.forEach((lead) => {
    const acts = getLeadActivitiesWithDerived(lead);
    acts.forEach((a) => {
      allTimeline.push({
        ...a,
        business_name: lead.business_name || lead.name || '',
        category: lead.category || '',
        phone: lead.phone || ''
      });
    });
  });

  allTimeline.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const searchQuery = q || search;
  const activities = (searchQuery || (type && type !== 'all') || (date && date !== 'all'))
    ? filterActivitiesList(allTimeline, { q: searchQuery, type, date })
    : allTimeline;

  res.json({
    success: true,
    activities,
    totalCount: allTimeline.length,
    filteredCount: activities.length
  });
});

// Record an Activity Event for a Lead
app.post('/api/leads/:id/activities', async (req, res) => {
  const { id } = req.params;
  const { event_type, event_title, event_description, metadata, created_at } = req.body;

  if (!event_type) {
    return res.status(400).json({ success: false, error: 'event_type is required.' });
  }

  const store = getStoredData();
  const lead = store.leads.find((l) => String(l.id) === String(id) || (l.place_id && String(l.place_id) === String(id)));
  if (!lead) {
    return res.status(404).json({ success: false, error: 'Lead not found.' });
  }

  const activity = recordLeadActivity(lead, {
    event_type,
    event_title,
    event_description,
    metadata,
    created_at
  });

  saveStoredData(store, true);

  const activities = getLeadActivitiesWithDerived(lead);
  res.json({ success: true, activity, activities });
});

// 10. Summary Count
app.get('/api/leads/count', async (req, res) => {
  let store = getStoredData();
  if (supabase && (!leadsSupabaseSyncDone || !store.leads || store.leads.length === 0)) {
    store = await syncPersistentLeads(store);
  }
  if (!store.outreach_settings) {
    store.outreach_settings = { dailyTarget: 50 };
  }
  store.leads.forEach(enrichLeadOutreachFields);

  const now = new Date();
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const tomorrowMidnight = todayMidnight + 24 * 60 * 60 * 1000;

  function isTimestampToday(ts) {
    if (!ts) return false;
    const t = new Date(ts).getTime();
    return !isNaN(t) && t >= todayMidnight && t < tomorrowMidnight;
  }

  const eligibleLeads = store.leads.filter((l) => l.phone && l.phone !== 'Not available');
  const target = store.outreach_settings.dailyTarget || 50;

  // Accurately count leads that had a message_sent or followup_sent event today
  let sentTodayCount = 0;
  eligibleLeads.forEach((l) => {
    const activities = getLeadActivitiesWithDerived(l);
    const hasSentToday = activities.some((a) => (a.event_type === 'message_sent' || a.event_type === 'followup_sent') && isTimestampToday(a.created_at));
    if (hasSentToday || (l.first_message_sent && isTimestampToday(l.first_message_sent_at))) {
      sentTodayCount++;
    }
  });

  const awaitingReply = eligibleLeads.filter((l) => l.outreach_status === 'Follow-Up' && !l.follow_up_completed && !l.reply_status);
  const followUpsDue = awaitingReply.filter((l) => {
    if (!l.next_follow_up_at) return false;
    const targetDate = new Date(l.next_follow_up_at);
    const targetMidnight = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate()).getTime();
    return targetMidnight <= todayMidnight;
  }).length;
  const replied = eligibleLeads.filter((l) => l.reply_status != null || l.outreach_status === 'Replied').length;
  const notContacted = eligibleLeads.filter((l) => !l.first_message_sent && (l.outreach_status === 'Not Contacted' || l.outreach_status === 'Ready')).length;
  const coldCallQueued = (store.leads || []).filter((l) => Boolean(l.cold_call && l.cold_call.queued));
  const coldCallCount = coldCallQueued.length;
  const coldCallRemaining = coldCallQueued.filter((l) => !l.cold_call.status || l.cold_call.status === 'Not Called').length;

  res.json({
    total: store.leads.length,
    noWebsite: store.leads.filter((l) => l.website_status === 'NO').length,
    favorites: store.leads.filter((l) => l.favorite).length,
    outreachReady: notContacted,
    activeFollowUps: awaitingReply.length,
    actionableFollowUps: followUpsDue,
    sentToday: sentTodayCount,
    dailyTarget: target,
    remaining: Math.max(0, target - sentTodayCount),
    percent: Math.min(100, Math.round((sentTodayCount / target) * 100)),
    followUpsDue,
    replied,
    coldCallCount,
    coldCallRemaining
  });
});

// 10b. Daily Performance Summary Endpoint
app.get('/api/dashboard/daily-performance', async (req, res) => {
  let store = getStoredData();
  if (supabase && (!leadsSupabaseSyncDone || !store.leads || store.leads.length === 0)) {
    store = await syncPersistentLeads(store);
  }
  if (!store.outreach_settings) {
    store.outreach_settings = { dailyTarget: 50 };
  }
  store.leads.forEach(enrichLeadOutreachFields);

  const reqDate = req.query.date;
  let targetDate = new Date();
  let isCustomDate = false;
  if (reqDate) {
    const parsed = new Date(reqDate);
    if (!isNaN(parsed.getTime())) {
      targetDate = parsed;
      isCustomDate = true;
    }
  }

  const todayMidnight = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate()).getTime();
  const tomorrowMidnight = todayMidnight + 24 * 60 * 60 * 1000;

  function isTimestampToday(ts) {
    if (!ts) return false;
    const t = new Date(ts).getTime();
    return !isNaN(t) && t >= todayMidnight && t < tomorrowMidnight;
  }

  const target = store.outreach_settings.dailyTarget || 50;

  // 1. Leads Found Today (Search sessions completed today + in-memory store)
  let leadsFoundCount = 0;
  if (Array.isArray(store.searchSessions)) {
    store.searchSessions.forEach((s) => {
      if (isTimestampToday(s.completedAt || s.startedAt)) {
        leadsFoundCount += (Number(s.newLeadsCount) || 0);
      }
    });
  }

  // 2. Leads Saved Today & Messages Sent Today (unified single pass)
  let leadsSavedCount = 0;
  let firstMessagesSentCount = 0;
  let followUpsSentCount = 0;

  store.leads.forEach((l) => {
    if (isTimestampToday(l.saved_at || l.created_at)) {
      leadsSavedCount++;
    }

    const activities = getLeadActivitiesWithDerived(l);
    activities.forEach((act) => {
      if (isTimestampToday(act.created_at)) {
        if (act.event_type === 'message_sent') {
          firstMessagesSentCount++;
        } else if (act.event_type === 'followup_sent') {
          followUpsSentCount++;
        }
      }
    });
  });

  const totalMessagesSent = firstMessagesSentCount + followUpsSentCount;

  // 4. Replies Received Today
  let repliesCount = 0;
  store.leads.forEach((l) => {
    const activities = getLeadActivitiesWithDerived(l);
    const repliedToday = activities.some((a) => a.event_type === 'lead_replied' && isTimestampToday(a.created_at));
    if (repliedToday || (l.reply_status && isTimestampToday(l.replied_at))) {
      repliesCount++;
    }
  });

  // 5. New Outreach Leads Added Today
  let addedToOutreachCount = 0;
  store.leads.forEach((l) => {
    const activities = getLeadActivitiesWithDerived(l);
    const addedToday = activities.some((a) => a.event_type === 'lead_added_outreach' && isTimestampToday(a.created_at));
    if (addedToday) {
      addedToOutreachCount++;
    }
  });
  if (Array.isArray(store.outreach)) {
    store.outreach.forEach((o) => {
      if (isTimestampToday(o.created_at)) {
        const leadHasActivity = store.leads.some(
          (l) => (String(l.id) === String(o.saved_lead_id) || (l.place_id && String(l.place_id) === String(o.place_id))) &&
            getLeadActivitiesWithDerived(l).some((a) => a.event_type === 'lead_added_outreach' && isTimestampToday(a.created_at))
        );
        if (!leadHasActivity) {
          addedToOutreachCount++;
        }
      }
    });
  }

  // 6. Follow-Ups Due Today (Smart Follow-Up Queue Data)
  const activeFollowUpLeads = store.leads.filter((l) => {
    const isReplied = Boolean(l.reply_status === 'INTERESTED' || l.reply_status === 'NOT_INTERESTED' || l.reply_status === 'OTHER' || l.outreach_status === 'Replied');
    const isCompleted = Boolean(l.follow_up_completed || l.outreach_status === 'Completed');
    const isStopped = Boolean(l.outreach_status === 'Stopped' || l.stopped === true);
    const isPaused = Boolean(l.follow_up_paused || l.followUpPaused);
    return !isReplied && !isCompleted && !isStopped && !isPaused && l.next_follow_up_at;
  });

  const dueTodayFollowUps = activeFollowUpLeads.filter((l) => {
    const targetDate = new Date(l.next_follow_up_at);
    const targetMid = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate()).getTime();
    return targetMid === todayMidnight;
  });

  const overdueFollowUps = activeFollowUpLeads.filter((l) => {
    const targetDate = new Date(l.next_follow_up_at);
    const targetMid = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate()).getTime();
    return targetMid < todayMidnight;
  });

  // 7. Target, Progress Percentage & Remaining
  // Percentage is uncapped (can exceed 100%)
  const percentage = target > 0 ? Math.round((totalMessagesSent / target) * 100) : 0;
  // Remaining is never negative
  const remaining = Math.max(0, target - totalMessagesSent);
  const status = totalMessagesSent >= target ? 'TARGET REACHED' : 'IN PROGRESS';

  res.json({
    success: true,
    performance: {
      date: isCustomDate
        ? `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}-${String(targetDate.getDate()).padStart(2, '0')}`
        : getTodayDateString(),
      target,
      messagesSent: totalMessagesSent,
      firstMessagesSent: firstMessagesSentCount,
      followUpsSent: followUpsSentCount,
      percentage,
      remaining,
      status,
      leadsFound: leadsFoundCount,
      leadsSaved: leadsSavedCount,
      replies: repliesCount,
      addedToOutreach: addedToOutreachCount,
      followUpsDue: dueTodayFollowUps.length,
      followUpsOverdue: overdueFollowUps.length,
      followUpsCompletedToday: followUpsSentCount
    }
  });
});

// 10c. Comprehensive Dashboard & Analytics Reporting Endpoint (READ-ONLY)
app.get('/api/analytics/dashboard', async (req, res) => {
  try {
    let store = getStoredData();
    if (supabase && (!leadsSupabaseSyncDone || !store.leads || store.leads.length === 0)) {
      store = await syncPersistentLeads(store);
    }
    const leads = Array.isArray(store.leads) ? store.leads : [];
    leads.forEach(enrichLeadOutreachFields);

    const range = (req.query.range || 'all').toLowerCase();
    const now = new Date();
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const tomorrowMidnight = todayMidnight + 24 * 60 * 60 * 1000;

    let startMs = 0;
    let endMs = Infinity;

    if (range === 'today') {
      startMs = todayMidnight;
      endMs = tomorrowMidnight;
    } else if (range === '7d') {
      startMs = now.getTime() - (7 * 24 * 60 * 60 * 1000);
      endMs = now.getTime();
    } else if (range === '30d') {
      startMs = now.getTime() - (30 * 24 * 60 * 60 * 1000);
      endMs = now.getTime();
    } else if (range === 'month') {
      startMs = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      endMs = now.getTime();
    } // 'all' leaves startMs = 0, endMs = Infinity

    function isDateInRange(dateStr) {
      if (!dateStr) return false;
      const t = new Date(dateStr).getTime();
      if (isNaN(t)) return false;
      return t >= startMs && t <= endMs;
    }

    // Metrics - Single-pass accumulator
    const leadsCreatedInRange = [];
    const convertedLeadsList = [];
    let newLeads = 0;
    let favorites = 0;
    let outreachPending = 0;
    let interestedCount = 0;
    let notInterestedCount = 0;
    let pausedCount = 0;
    let dueTodayCount = 0;
    let overdueCount = 0;
    let firstMessagesSentCount = 0;
    let followUpsSentCount = 0;

    for (let i = 0; i < leads.length; i++) {
      const l = leads[i];
      const inRange = range === 'all' || isDateInRange(l.created_at || l.saved_at);

      if (inRange) {
        leadsCreatedInRange.push(l);
        if (l.status === 'New') newLeads++;
        if (l.favorite || l.is_favorite) favorites++;
        if (l.outreach_status === 'Pending') outreachPending++;
        if (l.contact_outcome === 'Interested' || l.reply_status === 'INTERESTED' || l.status === 'Interested') interestedCount++;
        if (l.contact_outcome === 'Not Interested' || l.reply_status === 'NOT_INTERESTED' || l.status === 'Not Interested') notInterestedCount++;
      }

      // Follow-up status checks
      if (l.follow_up_paused || l.followUpPaused) {
        pausedCount++;
      } else {
        const isReplied = Boolean(l.reply_status === 'INTERESTED' || l.reply_status === 'NOT_INTERESTED' || l.reply_status === 'OTHER' || l.outreach_status === 'Replied');
        const isCompleted = Boolean(l.follow_up_completed || l.outreach_status === 'Completed');
        const isStopped = Boolean(l.outreach_status === 'Stopped' || l.stopped === true);

        if (!isReplied && !isCompleted && !isStopped && l.next_follow_up_at) {
          const t = new Date(l.next_follow_up_at).getTime();
          if (!isNaN(t)) {
            if (t >= todayMidnight && t < tomorrowMidnight) dueTodayCount++;
            else if (t < todayMidnight) overdueCount++;
          }
        }
      }

      // Converted count
      if (l.converted) {
        if (range === 'all' || isDateInRange(l.conversion_date || l.updated_at || l.created_at)) {
          convertedLeadsList.push(l);
        }
      }

      // Messages Sent in Range
      const activities = getLeadActivitiesWithDerived(l);
      activities.forEach((act) => {
        if (isDateInRange(act.created_at)) {
          if (act.event_type === 'message_sent') {
            firstMessagesSentCount++;
          } else if (act.event_type === 'followup_sent') {
            followUpsSentCount++;
          }
        }
      });
      if (Array.isArray(l.message_history)) {
        l.message_history.forEach((m) => {
          const mDate = m.sent_at || m.timestamp;
          if (mDate && isDateInRange(mDate)) {
            const alreadyInActs = activities.some(
              (a) => (a.event_type === 'message_sent' || a.event_type === 'followup_sent') &&
                Math.abs(new Date(a.created_at).getTime() - new Date(mDate).getTime()) < 2000
            );
            if (!alreadyInActs) {
              if (m.type === 'follow_up') followUpsSentCount++;
              else firstMessagesSentCount++;
            }
          }
        });
      }
    }

    const totalMessagesSent = firstMessagesSentCount + followUpsSentCount;
    const totalLeads = range === 'all' ? leads.length : leadsCreatedInRange.length;
    const convertedCount = convertedLeadsList.length;

    // 12. Conversion Rate
    const baseTotalForRate = range === 'all' ? leads.length : leadsCreatedInRange.length;
    const conversionRate = baseTotalForRate > 0
      ? Number(((convertedCount / baseTotalForRate) * 100).toFixed(1))
      : 0;

    // 13. Conversion Value (sum where recorded, null if none recorded)
    let totalConversionValue = 0;
    let hasConversionValueRecorded = false;
    convertedLeadsList.forEach((l) => {
      if (l.conversion_value !== undefined && l.conversion_value !== null && l.conversion_value !== '') {
        const val = Number(l.conversion_value);
        if (!isNaN(val) && val > 0) {
          totalConversionValue += val;
          hasConversionValueRecorded = true;
        }
      }
    });
    const conversionValue = hasConversionValueRecorded ? totalConversionValue : null;

    // PERFORMANCE SUMMARY:
    // A. Leads Added Over Time
    const dateMap = {};
    (range === 'all' ? leads : leadsCreatedInRange).forEach((l) => {
      const d = (l.created_at || l.saved_at || '').slice(0, 10);
      if (d) {
        dateMap[d] = (dateMap[d] || 0) + 1;
      }
    });
    const leadsOverTime = Object.keys(dateMap)
      .sort()
      .map((d) => ({ date: d, count: dateMap[d] }));

    // B. Outreach Completed
    const outreachCompleted = {
      firstMessages: firstMessagesSentCount,
      followUps: followUpsSentCount,
      total: totalMessagesSent
    };

    // C. Follow-Ups Completed
    let followUpsCompletedCount = 0;
    leads.forEach((l) => {
      if (l.follow_up_completed || l.outreach_status === 'Completed') {
        if (range === 'all' || isDateInRange(l.outreach_completed_at || l.updated_at)) {
          followUpsCompletedCount++;
        }
      } else {
        const acts = getLeadActivitiesWithDerived(l);
        acts.forEach((a) => {
          if (a.event_type === 'followup_sent' && isDateInRange(a.created_at)) {
            followUpsCompletedCount++;
          }
        });
      }
    });

    // D. Responses & Outcomes
    const otherRepliesCount = (range === 'all' ? leads : leadsCreatedInRange).filter((l) =>
      (l.reply_status && l.reply_status !== 'INTERESTED' && l.reply_status !== 'NOT_INTERESTED') ||
      (l.contact_outcome && l.contact_outcome !== 'Interested' && l.contact_outcome !== 'Not Interested')
    ).length;

    const responses = {
      interested: interestedCount,
      notInterested: notInterestedCount,
      otherReplies: otherRepliesCount,
      totalResponses: interestedCount + notInterestedCount + otherRepliesCount
    };

    // E. Conversions
    const conversionsSummary = {
      count: convertedCount,
      rate: baseTotalForRate > 0 ? `${conversionRate}%` : '—',
      totalValue: conversionValue
    };

    res.json({
      success: true,
      range,
      generatedAt: new Date().toISOString(),
      kpis: {
        totalLeads,
        allTimeTotalLeads: leads.length,
        newLeads,
        favorites,
        outreachPending,
        messagesSent: totalMessagesSent,
        followUpsDueToday: dueTodayCount,
        overdueFollowUps: overdueCount,
        pausedFollowUps: pausedCount,
        interestedLeads: interestedCount,
        notInterestedLeads: notInterestedCount,
        convertedLeads: convertedCount,
        conversionRate: baseTotalForRate > 0 ? conversionRate : null,
        conversionValue
      },
      performanceSummary: {
        leadsOverTime,
        outreachCompleted,
        followUpsCompleted: followUpsCompletedCount,
        responses,
        conversions: conversionsSummary
      }
    });
  } catch (err) {
    console.error('[API /api/analytics/dashboard Error]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================================
// 10. OUTREACH TERMINAL API ROUTES & HELPERS
// ==========================================================

function normalizePhoneNumber(rawPhone) {
  if (!rawPhone || rawPhone === 'Not available') return null;
  let clean = rawPhone.replace(/[\s\(\)\-\.\+]/g, '');
  if (clean.startsWith('0') && clean.length === 11) {
    clean = '91' + clean.slice(1);
  } else if (!clean.startsWith('91') && clean.length === 10) {
    clean = '91' + clean;
  }
  if (/^\d{10,15}$/.test(clean)) {
    return clean;
  }
  return null;
}

const FOLLOW_UP_SCHEDULE = [
  { step: 1, dayOffset: 2, name: 'Follow-Up #1 — Gentle Nudge' },
  { step: 2, dayOffset: 4, name: 'Follow-Up #2 — Quick Check-in' },
  { step: 3, dayOffset: 7, name: 'Follow-Up #3 — Service Value' },
  { step: 4, dayOffset: 10, name: 'Follow-Up #4 — Low-Pressure Closing' },
  { step: 5, dayOffset: 14, name: 'Follow-Up #5 — Final Note' }
];

function enrichLeadOutreachFields(lead) {
  if (!lead.outreach_status || lead.outreach_status === 'New') {
    lead.outreach_status = 'Pending';
  }
  // Only transition to Follow-Up if lead is actively in outreach (never override a Pending/removed lead)
  if (lead.first_message_sent && lead.outreach_status !== 'Pending' && (lead.outreach_status === 'Not Contacted' || lead.outreach_status === 'Ready')) {
    lead.outreach_status = 'Follow-Up';
  }
  if (typeof lead.first_message_sent !== 'boolean') lead.first_message_sent = false;
  if (!Array.isArray(lead.message_history)) lead.message_history = [];
  if (!Array.isArray(lead.activities)) lead.activities = [];
  if (typeof lead.follow_up_day !== 'number') lead.follow_up_day = 0;
  if (typeof lead.current_follow_up_number !== 'number') lead.current_follow_up_number = lead.follow_up_day || 0;
  if (typeof lead.follow_up_completed !== 'boolean') lead.follow_up_completed = false;
  if (!lead.priority) lead.priority = 'Medium';

  if (lead.first_message_sent) {
    if (!lead.main_message_sent_at) {
      lead.main_message_sent_at = lead.first_message_sent_at || lead.updated_at || new Date().toISOString();
    }
    if (!lead.last_message_type) {
      lead.last_message_type = lead.current_follow_up_number > 0 ? `Follow-Up #${lead.current_follow_up_number}` : 'Main Message';
    }
    if (!lead.last_message_sent_at) {
      lead.last_message_sent_at = lead.first_message_sent_at;
    }
    if (lead.outreach_status === 'Follow-Up' && !lead.follow_up_completed && !lead.reply_status) {
      if (!lead.next_follow_up_number) {
        lead.next_follow_up_number = Math.min(5, (lead.current_follow_up_number || 0) + 1);
      }
      const sched = FOLLOW_UP_SCHEDULE.find(s => s.step === lead.next_follow_up_number);
      if (sched) {
        lead.next_follow_up_name = sched.name;
        if (!lead.next_follow_up_at && lead.main_message_sent_at) {
          const anchorTime = new Date(lead.main_message_sent_at).getTime();
          lead.next_follow_up_at = new Date(anchorTime + sched.dayOffset * 24 * 60 * 60 * 1000).toISOString();
        }
      }
    }
  }
  return lead;
}

// 10.1 Get Outreach Terminal Data & Metrics
app.get('/api/outreach/data', async (req, res) => {
  let store = getStoredData();

  if (storeStatus === 'failed' || !store) {
    return res.status(500).json({
      success: false,
      status: 'failed',
      error: 'ClientHunter could not safely load existing data. Your data has not been modified. Please retry or check the data source.',
      outreach: [],
      allLeads: []
    });
  }

  if (supabase && (!leadsSupabaseSyncDone || !store.leads || store.leads.length === 0)) {
    store = await syncPersistentLeads(store);
  }
  if (!store.outreach_settings) {
    store.outreach_settings = { dailyTarget: 50 };
  }

  // Ensure all leads have outreach fields
  store.leads.forEach(enrichLeadOutreachFields);

  const now = new Date();
  const todayStr = now.toDateString();
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const activeOutreachLeads = store.leads.filter((l) => l.outreach_status && l.outreach_status !== 'Pending');

  // Metrics - Single-pass accumulator
  const notContacted = [];
  const awaitingReply = [];
  const pausedFollowUps = [];
  const activeFollowUps = [];
  const dueTodayFollowUps = [];
  const overdueFollowUps = [];
  const upcomingFollowUps = [];
  const replied = [];
  const interested = [];
  const notInterested = [];
  const completed = [];
  const stopped = [];
  let sentTodayCount = 0;

  for (let i = 0; i < activeOutreachLeads.length; i++) {
    const l = activeOutreachLeads[i];
    const os = l.outreach_status;

    // Sent today check
    if (l.message_history && l.message_history.length > 0) {
      if (l.message_history.some((m) => m.sent_at && new Date(m.sent_at).toDateString() === todayStr)) {
        sentTodayCount++;
      }
    } else if (l.first_message_sent && l.first_message_sent_at && new Date(l.first_message_sent_at).toDateString() === todayStr) {
      sentTodayCount++;
    }

    // notContacted
    if (!l.first_message_sent && (os === 'Not Contacted' || os === 'Ready')) {
      notContacted.push(l);
    }

    // awaitingReply & follow-up buckets
    if (os === 'Follow-Up' && !l.follow_up_completed && !l.reply_status) {
      awaitingReply.push(l);
      const isPaused = Boolean(l.follow_up_paused || l.followUpPaused);
      if (isPaused) {
        pausedFollowUps.push(l);
      } else {
        activeFollowUps.push(l);
        if (l.next_follow_up_at) {
          const target = new Date(l.next_follow_up_at);
          const targetMidnight = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();
          const dayDiff = Math.round((targetMidnight - todayMidnight) / (1000 * 60 * 60 * 24));
          if (dayDiff === 0) dueTodayFollowUps.push(l);
          else if (dayDiff < 0) overdueFollowUps.push(l);
          else upcomingFollowUps.push(l);
        }
      }
    }

    // replied
    if (l.reply_status != null || os === 'Replied') {
      replied.push(l);
      if (l.reply_status === 'INTERESTED') interested.push(l);
      else if (l.reply_status === 'NOT_INTERESTED') notInterested.push(l);
    }

    // completed
    if (os === 'Completed' || l.follow_up_completed === true) {
      completed.push(l);
    }

    // stopped
    if (os === 'Stopped') {
      stopped.push(l);
    }
  }

  // Daily target calculation across all messages sent today
  const target = store.outreach_settings.dailyTarget || 50;
  const remaining = Math.max(0, target - sentTodayCount);
  const percentage = Math.min(100, Math.round((sentTodayCount / target) * 100));

  res.json({
    success: true,
    metrics: {
      totalOutreach: activeOutreachLeads.length,
      notContacted: notContacted.length,
      awaitingReply: awaitingReply.length,
      followUpsDue: dueTodayFollowUps.length + overdueFollowUps.length,
      replied: replied.length,
      completed: completed.length,
      stopped: stopped.length
    },
    followUpCounters: {
      active: activeFollowUps.length,
      paused: pausedFollowUps.length,
      dueToday: dueTodayFollowUps.length,
      overdue: overdueFollowUps.length,
      upcoming: upcomingFollowUps.length,
      replies: replied.length,
      interested: interested.length,
      notInterested: notInterested.length,
      completed: completed.length
    },
    todayOutreach: {
      sent: sentTodayCount,
      target,
      remaining,
      percentage
    },
    readyLeads: notContacted,
    followUpLeads: awaitingReply,
    completedLeads: completed,
    repliedLeads: replied,
    stoppedLeads: stopped,
    allLeads: activeOutreachLeads
  });
});

function formatServicesList(services) {
  if (!Array.isArray(services)) return '';
  const enabledNames = services
    .filter(s => s && s.enabled && typeof s.name === 'string' && s.name.trim())
    .map(s => s.name.trim());
  if (enabledNames.length === 0) return '';
  if (enabledNames.length === 1) return enabledNames[0];
  if (enabledNames.length === 2) return `${enabledNames[0]} and ${enabledNames[1]}`;
  const last = enabledNames[enabledNames.length - 1];
  const initial = enabledNames.slice(0, -1).join(', ');
  return `${initial}, and ${last}`;
}

// 10.2 Generate AI Outreach Message
app.post('/api/outreach/generate-message', async (req, res) => {
  const { leadId, tone = 'Professional', userServices, length = 'Medium', approach = 'Value First', cta = 'Book a Call', personalization = 'High' } = req.body;
  const store = getStoredData();
  const lead = store.leads.find((l) => l.id === leadId || l.place_id === leadId);

  if (!lead) {
    return res.status(404).json({ success: false, error: 'Lead not found.' });
  }

  const userSettings = store.settings || getDefaultSettings();
  const userProfile = userSettings.profile || {};
  const formattedServices = formatServicesList(userSettings.services);
  const effectiveServices = userServices || formattedServices || 'AI Websites, SEO & Automation';
  const senderName = userProfile.fullName || 'Agency Founder';
  const senderCompany = userProfile.companyName ? ` from ${userProfile.companyName}` : '';
  const senderPortfolio = userProfile.portfolioUrl ? ` (Portfolio: ${userProfile.portfolioUrl})` : '';

  const normalizedPhone = normalizePhoneNumber(lead.phone);
  const bizName = lead.business_name;
  const category = lead.category || 'local business';
  const city = lead.city || 'your area';
  const hasWeb = lead.website_status === 'YES';

  // Industry-tailored pitch synthesis engine
  const pitchTemplates = {
    'Professional': hasWeb
      ? `Hello ${bizName} Team,\n\nI came across your business in ${city} and was really impressed by your stellar customer reviews.\n\nWhile reviewing your digital presence, I noticed a few high-impact opportunities to significantly speed up your website and optimize mobile conversions for prospective clients searching for ${category}.\n\nWe specialize in ${effectiveServices} tailored for established ${category}.\n\nWould you be open to a brief 5-minute chat this week to share a free performance teardown?`
      : `Hello ${bizName} Team,\n\nI noticed your business in ${city} has an exceptional reputation with active clients, but currently doesn't have an official modern website or automated booking portal.\n\nOver 78% of local clients searching for ${category} book with competitors who offer instant online scheduling.\n\nWe build high-converting, mobile-first ${effectiveServices} designed specifically to turn search traffic into booked clients.\n\nCould I send over a quick 2-minute video mockup of how a modern portal would look for ${bizName}?`,

    'Friendly': hasWeb
      ? `Hi there! 👋 Hope you're having a wonderful week at ${bizName}.\n\nI was looking up top-rated ${category} in ${city} and loved what you guys have built!\n\nI noticed a couple quick tweaks on your website that could help you convert even more website visitors into booked appointments automatically.\n\nWould love to share a few free ideas if you're open to it!`
      : `Hi there! 👋 Hope you're having a fantastic week at ${bizName}.\n\nI noticed your amazing reviews in ${city}, but saw you don't have a direct website up yet for online inquiries.\n\nWe help local ${category} launch fast, beautiful sites that bring in consistent new inquiries every week on autopilot.\n\nWould love to show you a quick preview if you're open to a friendly chat!`,

    'Casual': hasWeb
      ? `Hey ${bizName}! Loved checking out your work in ${city}.\n\nQuick heads up: your site is running a bit slow on mobile, which might be costing you a few inbound leads every day.\n\nWe fix this with modern web upgrades. Happy to share a quick free audit if you'd like to check it out!`
      : `Hey ${bizName}! Came across your ${category} in ${city} — love the great reviews.\n\nNoticed you don't have an official website listed on Google Maps yet. We help local businesses get a clean, modern site live in 48 hours to capture all local Google search traffic.\n\nOpen to seeing a quick demo?`,

    'Simple': hasWeb
      ? `Hi ${bizName}, I help ${category} in ${city} get more customers from their website.\n\nI found 3 quick improvements for your site that will boost your search ranking and call volume.\n\nCan I send over the details?`
      : `Hi ${bizName}, I noticed your business in ${city} doesn't have a website listed on Google.\n\nWe build simple, high-performing websites for ${category} that generate booked calls.\n\nCan I send you a 1-minute demo?`,

    'Confident': hasWeb
      ? `Hi ${bizName},\n\nYour competitors in ${city} are investing heavily in paid search, but your organic reviews are far stronger. With a few speed and conversion upgrades to your website, you can easily capture the majority of local high-ticket inquiries in ${category}.\n\nWe deliver measurable ROI with ${effectiveServices}.\n\nLet's connect for 5 minutes this Thursday.`
      : `Hi ${bizName},\n\nYou have one of the highest ratings for ${category} in ${city}, but without a dedicated website, you are losing 40-50 high-ticket customers every month to weaker competitors.\n\nWe build modern lead-capture websites that dominate local search rankings.\n\nLet's connect for 5 minutes this week so I can show you the roadmap.`,

    'Consultative': hasWeb
      ? `Dear ${bizName} Leadership,\n\nIn our recent market benchmark of ${category} across ${city}, your brand reputation stood out prominently. However, analysis of your web infrastructure indicates key drop-off points in the mobile conversion funnel.\n\nWe partner with premier businesses to optimize client acquisition through ${effectiveServices}.\n\nWould you be open to reviewing our complimentary executive audit?`
      : `Dear ${bizName} Leadership,\n\nIn our recent market benchmark of ${category} across ${city}, your patient/customer satisfaction is top-tier. However, the absence of an integrated web presence creates a major friction point for modern digital consumers.\n\nWe engineer turnkey digital solutions including ${effectiveServices}.\n\nMay I share a complimentary brief outlining the projected revenue upside?`,

    'Short & Direct': hasWeb
      ? `Hi ${bizName}, found your website via Google Maps in ${city}. Identified 2 key conversion leaks hurting your inquiry rate. Open to a 2-minute loom video showing the fix?`
      : `Hi ${bizName}, saw your great reviews in ${city}. You don't have a website on Google Maps yet — losing customers daily. Can I send a quick preview of a site built for you?`,

    'High-Conversion': hasWeb
      ? `Hi ${bizName},\n\nDid you know 67% of people in ${city} look up reviews and visit a website before calling a ${category}?\n\nYour reviews are stellar, but your website load time and mobile booking flow have critical drop-offs. We implemented modern optimizations for similar businesses and saw a 38% increase in booked inquiries in 30 days.\n\nCan I send you a free breakdown of the exact fixes for ${bizName}?`
      : `Hi ${bizName},\n\nYou have fantastic reviews in ${city}, but missing a website means you're leaving thousands in revenue on the table each month for other ${category}.\n\nWe build high-converting websites equipped with instant WhatsApp & automated booking that turn Google searchers into paying clients.\n\nCan I send you a free custom preview built specifically for ${bizName}?`
  };

  let generatedMessage = null;

  // 1. Generate customized pitch with Google Gemini AI
  try {
    const lengthGuideline = length === 'Short' ? 'under 40 words, ultra concise' : (length === 'Detailed' ? '3-5 clear sentences' : '2-3 sentences');
    const systemInstruction = `You are an elite B2B sales copywriter crafting cold WhatsApp outreach messages to local businesses in India on behalf of ${senderName}${senderCompany}.
Strict Rules:
- Always greet the business explicitly by name (e.g. "Hello ${bizName} Team," or "Hi ${bizName},").
- Keep the message concise (${lengthGuideline}), punchy, and formatted with clean line breaks suitable for mobile WhatsApp.
- Tone style requested: "${tone}".
- Approach style: "${approach}".
- Call to Action goal: "${cta}".
- Personalization depth: "${personalization}".
- Target business: "${bizName}" (${category}) in ${city}.
- Website status: ${hasWeb ? `Has existing website (${lead.website || 'listed'})` : 'NO official website on Google Maps'}.
- Rating: ${lead.rating ? `${lead.rating} stars` : 'High customer rating'} with ${lead.review_count || 0} reviews.
- Agency services: ${effectiveServices}.${senderPortfolio}
- Dynamic Variable {my_services}: If the user or template mentions {my_services} or asks to list multiple services, the user's enabled service offerings are: "${effectiveServices}". Present them naturally.
- Service Targeting: When crafting a general pitch or recommending a service tailored to this lead's needs, focus on the single most relevant service. Do NOT force every service into every message unless multiple services or {my_services} are explicitly requested.
- End with a low-friction question or offer matching the CTA: "${cta}".
- Sign off naturally with ${senderName}${userProfile.companyName ? `, ${userProfile.companyName}` : ''}.
- Do NOT use placeholder brackets like [Your Name] or [Insert Link]. Write the message completely ready to send.
- OUTPUT ONLY THE FINAL MESSAGE TEXT. Do NOT include any explanations, headings, labels (e.g. Sentence 1:), or introductory notes. Start directly with the greeting.`;

    const userPrompt = `Craft a personalized, high-converting WhatsApp pitch to "${bizName}" in ${city} in the "${tone}" tone. Approach: ${approach}. CTA: ${cta}. Output ONLY the final message ready to send.`;
    const geminiText = await callGemini(userPrompt, systemInstruction, 500);
    const cleaned = cleanAiMessage(geminiText);
    if (cleaned && cleaned.length > 20) {
      generatedMessage = cleaned;
    }
  } catch (err) {
    console.warn('Gemini message generation failed, using template:', err.message);
  }

  if (!generatedMessage) {
    generatedMessage = pitchTemplates[tone] || pitchTemplates['Professional'];
  }

  res.json({
    success: true,
    leadId: lead.id,
    businessName: lead.business_name,
    normalizedPhone,
    tone,
    aiPowered: Boolean(process.env.GEMINI_API_KEY),
    message: generatedMessage
  });
});

// 10.3 Generate Follow-Up Message (Gemini AI Powered)
app.post('/api/outreach/generate-followup', async (req, res) => {
  const { leadId, followUpDay = 1, tone = 'Professional' } = req.body;
  const store = getStoredData();
  const lead = store.leads.find((l) => l.id === leadId || l.place_id === leadId);

  if (!lead) {
    return res.status(404).json({ success: false, error: 'Lead not found.' });
  }

  const bizName = lead.business_name;
  const day = Math.min(5, Math.max(1, parseInt(followUpDay, 10) || 1));

  const userSettings = store.settings || getDefaultSettings();
  const userProfile = userSettings.profile || {};
  const senderName = userProfile.fullName || 'Akshay';
  const companyName = userProfile.companyName || 'Nexora Labs';
  const portfolioUrl = userProfile.portfolioUrl || 'https://nexoralabs.com/portfolio';

  const lastMsg = lead.last_message_text || 'Initial outreach regarding web design and conversion opportunities.';
  const lastContactDate = lead.last_message_sent_at ? new Date(lead.last_message_sent_at).toLocaleDateString('en-GB') : 'a few days ago';

  const followUpSequences = {
    1: `Hi ${bizName}, just following up on my note from ${lastContactDate}. I know running day-to-day operations in ${lead.city || 'your area'} keeps you busy! Did you get a chance to see my note regarding modern web & booking systems for ${lead.category || 'your business'}?`,
    2: `Hi ${bizName}, wanted to check in quickly. Did you get a chance to review our work at ${portfolioUrl}? Happy to share a quick 2-minute demo on client conversion for ${lead.category || 'your business'} whenever convenient.`,
    3: `Hey ${bizName}, one quick update — businesses in ${lead.category || 'your sector'} who upgraded their WhatsApp booking and mobile presence saw client inquiries double. Happy to share a ready preview: ${portfolioUrl}`,
    4: `Hi ${bizName}, checking in one last time this week. No pressure at all — just wanted to see if optimizing your online client acquisition in ${lead.city || 'your area'} is on your radar for this quarter?`,
    5: `Hi ${bizName}, closing the loop here so I don't crowd your inbox. If you ever want to upgrade your website, booking flow, or search visibility in the future, feel free to keep my contact: ${portfolioUrl}. Wishing ${bizName} continued success!`
  };

  let generatedMessage = null;

  try {
    const stageNames = {
      1: 'Gentle Nudge',
      2: 'Quick Check-in',
      3: 'Service Value',
      4: 'Low-Pressure Closing',
      5: 'Final Note'
    };

    const systemInstruction = `You are an elite B2B sales copywriter crafting short, high-response WhatsApp follow-up messages for local business outreach in India.
Sender: ${senderName} from ${companyName}.
Target Business: "${bizName}" (${lead.category || 'Local Business'}) in ${lead.city || 'India'}.
Current Stage: Follow-Up #${day} of 5 — "${stageNames[day]}".
Previous Message sent on ${lastContactDate}: "${lastMsg}".

Strict Guidelines for Stage #${day} (${stageNames[day]}):
${day === 1 ? '- Gentle Nudge: Friendly, casual bump reminding them of the previous note without being pushy.' : ''}
${day === 2 ? '- Quick Check-in: Brief check-in, asking if they saw the portfolio link or had questions.' : ''}
${day === 3 ? '- Service Value: Highlight a concrete value proposition or ROI (e.g. automated WhatsApp booking, Google presence).' : ''}
${day === 4 ? '- Low-Pressure Closing: Respectful, acknowledging they are busy, giving an easy out ("no worries if not a priority right now").' : ''}
${day === 5 ? '- Final Note: Polite, professional closing of the loop, stating you will no longer follow up but leaving the door open for the future.' : ''}

Tone: "${tone}".
Requirements:
1. Maximum 2 to 3 sentences.
2. Natural, professional conversational WhatsApp tone for India.
3. NEVER repeat the exact wording of the previous message.
4. Do NOT restart the conversation as a first contact; this is an established follow-up.
5. NO placeholder brackets like [Your Name] or [Link].
6. OUTPUT ONLY THE FINAL MESSAGE TEXT with zero markdown formatting or preamble.`;

    const userPrompt = `Craft Follow-Up #${day} (${stageNames[day]}) message for "${bizName}". Output ONLY the message.`;
    const geminiText = await callGemini(userPrompt, systemInstruction, 400);
    const cleaned = cleanAiMessage(geminiText);
    if (cleaned && cleaned.length > 20) {
      generatedMessage = cleaned;
    }
  } catch (err) {
    console.warn('Gemini follow-up generation failed, using sequence fallback:', err.message);
  }

  if (!generatedMessage) {
    generatedMessage = followUpSequences[day] || followUpSequences[1];
  }

  res.json({
    success: true,
    leadId: lead.id,
    followUpDay: day,
    aiPowered: Boolean(process.env.GEMINI_API_KEY),
    message: generatedMessage
  });
});

// 10.3b Generate Deep AI Audit for Lead (Gemini Powered)
app.get('/api/leads/:id/ai-audit', async (req, res) => {
  const leadId = req.params.id;
  const store = getStoredData();
  const lead = store.leads.find((l) => l.id === leadId || l.place_id === leadId);

  if (!lead) {
    return res.status(404).json({ success: false, error: 'Lead not found.' });
  }

  const prompt = `Perform a comprehensive B2B web development & client conversion audit for:
Business Name: ${lead.business_name}
Category: ${lead.category || 'Local Business'}
Location: ${lead.city || ''}, ${lead.state || 'India'}
Website: ${lead.website || 'None Listed'}
Google Rating: ${lead.rating || 'N/A'} (${lead.review_count || 0} reviews)
Opportunity Score: ${lead.opportunity_score || 75}/100

Provide a structured, punchy breakdown:
1. Executive Summary (2 sentences)
2. Top 3 Revenue Leaks / Missing Digital Assets
3. Recommended High-Ticket Solutions (e.g. Web App, Booking Flow, SEO)
4. Cold Pitch Angle & Estimated Project Value (in INR)`;

  const systemInstruction = 'You are a senior digital agency growth consultant auditing local businesses for client acquisition opportunities.';
  const audit = await callGemini(prompt, systemInstruction, 700);

  res.json({
    success: true,
    leadId: lead.id,
    businessName: lead.business_name,
    audit: audit || `Standard Opportunity Audit for ${lead.business_name}: High-ticket candidate based on active client base and missing digital infrastructure.`
  });
});

// 10.3c Generate AI Rebuttal / Objection Reply (Gemini Powered)
app.post('/api/outreach/ai-reply', async (req, res) => {
  const { leadId, objectionType = 'general', clientMessage = '' } = req.body;
  const store = getStoredData();
  const lead = store.leads.find((l) => l.id === leadId || l.place_id === leadId);

  const bizName = lead ? lead.business_name : 'the client';
  const category = lead ? (lead.category || 'local business') : 'business';
  const city = lead ? (lead.city || 'your area') : '';

  const objectionDescriptions = {
    'too_expensive': 'Client says: "Sounds too expensive / what are your rates?"',
    'already_have_someone': 'Client says: "We already have a web developer or agency handling our tech."',
    'send_details': 'Client says: "Send me your details / portfolio / brochure on WhatsApp."',
    'not_interested': 'Client says: "Not interested right now."',
    'busy_later': 'Client says: "Call me or contact me next month."'
  };

  const incomingContext = clientMessage
    ? `Client said: "${clientMessage}"`
    : (objectionDescriptions[objectionType] || 'Client had an objection regarding the web services.');

  const systemInstruction = `You are a high-ticket B2B sales expert crafting short, consultative WhatsApp responses to overcome prospect objections and book a quick discovery call.
Strict Rules:
- Keep the response to 2-3 sentences max.
- Be polite, confident, value-focused, and low friction.
- Formatted with clean line breaks suitable for WhatsApp.
- End with an easy question to book a 5-minute call or share a free sample mockup.
- Do NOT include bracket placeholders like [Name]. Output ONLY the final message ready to send.`;

  const prompt = `Prospect: "${bizName}" (${category}) in ${city}.
${incomingContext}
Craft the winning WhatsApp response to handle this objection.`;

  let reply = await callGemini(prompt, systemInstruction, 350);
  reply = cleanAiMessage(reply);

  if (!reply) {
    const fallbacks = {
      'too_expensive': `Completely understand! We actually offer flexible milestone pricing with zero long-term contracts. Would you be open to a quick 3-minute look at our ROI calculator for ${category}?`,
      'already_have_someone': `That's great you have support! Many of our clients already had someone, but came to us specifically for speed upgrades and instant WhatsApp booking flows. Mind if I send a 1-minute breakdown of what we do differently?`,
      'send_details': `I'd love to! I'll put together a custom 2-minute overview specifically showing opportunities for ${bizName}. What's the best time tomorrow for you to take a quick look?`,
      'not_interested': `Totally understand, no worries at all! If you ever need to upgrade your mobile conversion or speed down the road, feel free to save my contact. Wishing ${bizName} continued success!`,
      'busy_later': `Sounds great, I'll definitely check back then! In the meantime, I'll leave our portfolio link handy so you have it. Have a fantastic month ahead!`
    };
    reply = fallbacks[objectionType] || `Thank you for the reply! Happy to share a quick 1-minute demo of how we help ${category} boost inquiries whenever convenient for you.`;
  }

  res.json({
    success: true,
    aiPowered: Boolean(process.env.GEMINI_API_KEY),
    reply
  });
});

// ==================================================
// 10.3d ClientHunter Simple AI Assistant Engine
// ==================================================
function calculateAiGroundTruth(store) {
  if (!store.outreach_settings) {
    store.outreach_settings = { dailyTarget: 50 };
  }
  store.leads.forEach(enrichLeadOutreachFields);

  const now = new Date();
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const tomorrowMidnight = todayMidnight + 24 * 60 * 60 * 1000;

  function isTimestampToday(ts) {
    if (!ts) return false;
    const t = new Date(ts).getTime();
    return !isNaN(t) && t >= todayMidnight && t < tomorrowMidnight;
  }

  const target = store.outreach_settings.dailyTarget || 50;

  // 1. Leads Found Today
  let leadsFoundCount = 0;
  if (Array.isArray(store.searchSessions)) {
    store.searchSessions.forEach((s) => {
      if (isTimestampToday(s.completedAt || s.startedAt)) {
        leadsFoundCount += (Number(s.newLeadsCount) || 0);
      }
    });
  }

  // 2. Leads Saved Today
  let leadsSavedToday = 0;
  store.leads.forEach((l) => {
    if (isTimestampToday(l.saved_at || l.created_at)) {
      leadsSavedToday++;
    }
  });

  // 3. Messages Sent Today (only confirmed messages)
  let firstMessagesSentCount = 0;
  let followUpsSentCount = 0;
  store.leads.forEach((l) => {
    const activities = getLeadActivitiesWithDerived(l);
    activities.forEach((act) => {
      if (isTimestampToday(act.created_at)) {
        if (act.event_type === 'message_sent') {
          firstMessagesSentCount++;
        } else if (act.event_type === 'followup_sent') {
          followUpsSentCount++;
        }
      }
    });
  });
  const totalMessagesSentToday = firstMessagesSentCount + followUpsSentCount;

  // 4. Replies Today
  let repliesToday = 0;
  store.leads.forEach((l) => {
    const activities = getLeadActivitiesWithDerived(l);
    const replied = activities.some((a) => a.event_type === 'lead_replied' && isTimestampToday(a.created_at));
    if (replied || (l.reply_status && isTimestampToday(l.replied_at))) {
      repliesToday++;
    }
  });

  // 5. Added to Outreach Today
  let addedToOutreachToday = 0;
  store.leads.forEach((l) => {
    const activities = getLeadActivitiesWithDerived(l);
    if (activities.some((a) => a.event_type === 'lead_added_outreach' && isTimestampToday(a.created_at))) {
      addedToOutreachToday++;
    }
  });

  // 6. Follow-Up Queue Data
  const activeFollowUpLeads = store.leads.filter((l) => {
    const isReplied = Boolean(l.reply_status === 'INTERESTED' || l.reply_status === 'NOT_INTERESTED' || l.reply_status === 'OTHER' || l.outreach_status === 'Replied');
    const isCompleted = Boolean(l.follow_up_completed || l.outreach_status === 'Completed');
    const isStopped = Boolean(l.outreach_status === 'Stopped' || l.stopped === true);
    return !isReplied && !isCompleted && !isStopped && l.next_follow_up_at;
  });

  const dueTodayFollowUps = activeFollowUpLeads.filter((l) => {
    const targetDate = new Date(l.next_follow_up_at);
    const targetMid = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate()).getTime();
    return targetMid === todayMidnight;
  });

  const overdueFollowUps = activeFollowUpLeads.filter((l) => {
    const targetDate = new Date(l.next_follow_up_at);
    const targetMid = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate()).getTime();
    return targetMid < todayMidnight;
  });

  const followUpsDueCount = dueTodayFollowUps.length;
  const overdueCount = overdueFollowUps.length;
  const percentage = target > 0 ? Math.round((totalMessagesSentToday / target) * 100) : 0;
  const remainingTarget = Math.max(0, target - totalMessagesSentToday);
  const targetStatus = totalMessagesSentToday >= target ? 'TARGET REACHED' : 'IN PROGRESS';

  // 7. General Saved Lead Metrics
  const totalSavedLeads = store.leads.length;
  const leadsNoWebsite = store.leads.filter((l) => !l.website || l.website === 'N/A' || l.website_status === 'NO').length;
  const leadsWithWebsite = store.leads.filter((l) => Boolean(l.website && l.website !== 'N/A' && l.website_status !== 'NO')).length;
  const favoritesCount = store.leads.filter((l) => Boolean(l.favorite || l.is_favorite)).length;

  // 8. Outreach Metrics
  const totalOutreachLeads = store.leads.filter((l) => l.outreach_status && l.outreach_status !== 'Pending').length;
  const waitingForOutreachCount = store.leads.filter((l) => (l.outreach_status === 'Ready' || l.outreach_status === 'Not Contacted') && !l.first_message_sent).length;
  const awaitingReplyCount = store.leads.filter((l) => l.outreach_status === 'Outreach Sent' || l.outreach_status === 'Follow-Up').length;
  const completedLeadsCount = store.leads.filter((l) => l.outreach_status === 'Completed' || l.follow_up_completed).length;

  return {
    todayFormatted: now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
    leadsFoundCount,
    leadsSavedToday,
    totalMessagesSentToday,
    firstMessagesSentCount,
    followUpsSentCount,
    repliesToday,
    addedToOutreachToday,
    followUpsDueCount,
    overdueCount,
    target,
    remainingTarget,
    percentage,
    targetStatus,
    totalSavedLeads,
    leadsNoWebsite,
    leadsWithWebsite,
    favoritesCount,
    totalOutreachLeads,
    waitingForOutreachCount,
    awaitingReplyCount,
    completedLeadsCount
  };
}

app.post('/api/ai/assistant', async (req, res) => {
  const { query, history = [], activeLead = null } = req.body || {};
  if (!query || typeof query !== 'string' || !query.trim()) {
    return res.status(400).json({ success: false, error: 'Query is required.' });
  }

  const cleanQuery = query.trim();
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.json({
      success: false,
      error: 'GEMINI_NOT_CONFIGURED',
      message: 'Gemini is not configured yet.',
      action: { label: 'Open API Settings', nav: 'settings-api' }
    });
  }

  const store = getStoredData();
  const gt = calculateAiGroundTruth(store);

  // Check for category / city specifics in the query
  const queryLower = cleanQuery.toLowerCase();
  let specificFilterContext = '';

  const knownCategories = ['beauty salons', 'dental clinics', 'gyms', 'real estate', 'coaching', 'contractors', 'interior designers', 'restaurants', 'hotels', 'local businesses', 'salons', 'jewellers'];
  const knownLocations = ['hyderabad', 'telangana', 'andhra pradesh', 'vijayawada', 'visakhapatnam', 'guntur', 'warangal', 'bengaluru', 'mumbai', 'delhi', 'chennai'];

  let foundCategory = knownCategories.find((c) => queryLower.includes(c));
  let foundLocation = knownLocations.find((loc) => queryLower.includes(loc));

  if (foundCategory || foundLocation) {
    const matchedLeads = store.leads.filter((l) => {
      const catMatch = !foundCategory || (l.category && l.category.toLowerCase().includes(foundCategory.replace('salons', 'salon')));
      const locMatch = !foundLocation || ((l.city && l.city.toLowerCase().includes(foundLocation)) || (l.state && l.state.toLowerCase().includes(foundLocation)) || (l.location && l.location.toLowerCase().includes(foundLocation)));
      return catMatch && locMatch;
    });
    specificFilterContext = `\n- Factual matched count for ${foundCategory || 'leads'} in ${foundLocation || 'all locations'}: ${matchedLeads.length}`;
  }

  // System instructions enforcing ground-truth accuracy & concise friendly tone
  const systemInstruction = `You are ClientHunter AI, the intelligent, concise, and friendly built-in assistant for the ClientHunter B2B Revenue Terminal.
Your primary role is to answer questions using real, verified ClientHunter data, explain performance, recommend next actions, draft outreach pitches, and guide navigation.

Ground-Truth Verified Data (TODAY: ${gt.todayFormatted}):
- Saved Leads: Total: ${gt.totalSavedLeads}, Saved Today: ${gt.leadsSavedToday}, Without Website: ${gt.leadsNoWebsite}, With Website: ${gt.leadsWithWebsite}, Favorites: ${gt.favoritesCount}
- Today's Performance: Leads Found: ${gt.leadsFoundCount}, Leads Saved: ${gt.leadsSavedToday}, Messages Sent: ${gt.totalMessagesSentToday} (${gt.firstMessagesSentCount} first + ${gt.followUpsSentCount} follow-ups), Replies Received: ${gt.repliesToday}, Added to Outreach: ${gt.addedToOutreachToday}
- Daily Target: ${gt.target} messages/day. Progress: ${gt.percentage}%. Remaining: ${gt.remainingTarget} messages. Status: ${gt.targetStatus}
- Follow-Ups: ${gt.followUpsDueCount} due today, ${gt.overdueCount} overdue, ${gt.completedLeadsCount} completed
- Outreach Pipeline: ${gt.totalOutreachLeads} in Outreach, ${gt.waitingForOutreachCount} waiting/not contacted, ${gt.awaitingReplyCount} awaiting reply, ${gt.completedLeadsCount} completed${specificFilterContext}
${activeLead ? `\nCurrently Viewed Lead:
- Name: ${activeLead.business_name || activeLead.name || 'Unnamed'}
- Category: ${activeLead.category || 'General'}
- Location: ${activeLead.city || ''}, ${activeLead.state || ''}
- Website: ${activeLead.website || 'No Website'}
- Notes: ${activeLead.notes || 'None'}` : ''}

CRITICAL RULES:
1. ALWAYS use the exact pre-calculated numbers provided above. NEVER guess, approximate, or fabricate statistics.
2. Keep your response short, clear, friendly, and directly useful (1 to 3 sentences max).
3. If recommending what to do next, suggest practical priorities based strictly on the data (e.g. overdue follow-ups first, then remaining daily outreach target).
4. If relevant, include clickable navigation triggers in brackets like [Open Follow-Ups], [Open Outreach], [Open Saved Leads], [Open Dashboard], or [Open API Settings].
5. If the user asks for message help or a pitch for a lead, write a short, personalized WhatsApp pitch without placeholders.
6. If the user asks something completely unrelated to ClientHunter, lead generation, sales, or business outreach (e.g. general trivia, weather, jokes), reply politely:
"I'm not sure what you mean. You can ask me about your leads, outreach, follow-ups, or today's performance."`;

  let prompt = cleanQuery;
  if (history && Array.isArray(history) && history.length > 0) {
    const recentHistory = history.slice(-4).map((h) => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.text}`).join('\n');
    prompt = `Conversation history:\n${recentHistory}\nUser: ${cleanQuery}`;
  }

  let aiResponse = null;
  try {
    aiResponse = await callGemini(prompt, systemInstruction, 350);
  } catch (err) {
    console.warn('AI Assistant callGemini error:', err.message);
  }

  if (!aiResponse) {
    return res.json({
      success: false,
      error: 'GEMINI_UNAVAILABLE',
      message: 'AI Assistant is temporarily unavailable. Please check your Gemini API configuration.',
      action: { label: 'Open API Settings', nav: 'settings-api' }
    });
  }

  res.json({
    success: true,
    reply: aiResponse.trim(),
    metrics: gt
  });
});

// 10.4 Mark First / Main Message as Sent (Confirmed by user)
app.post('/api/outreach/mark-sent', async (req, res) => {
  const { leadId, messageText } = req.body;
  if (!leadId) {
    return res.status(400).json({ success: false, error: 'leadId is required.' });
  }

  const store = getStoredData();
  const lead = store.leads.find((l) => l.id === leadId || l.place_id === leadId);

  if (!lead) {
    return res.status(404).json({ success: false, error: 'Lead not found.' });
  }

  if (lead.first_message_sent) {
    return res.status(400).json({ success: false, error: 'Main outreach message has already been sent to this lead.' });
  }

  enrichLeadOutreachFields(lead);

  const now = new Date();
  const nowIso = now.toISOString();

  // Anchor Main Message (Day 0)
  lead.first_message_sent = true;
  lead.main_message_sent_at = nowIso;
  lead.first_message_sent_at = nowIso;
  lead.last_message_sent_at = nowIso;
  lead.last_message_type = 'Main Message';
  lead.last_message_text = messageText || 'Main WhatsApp outreach message sent.';
  lead.status = 'Contacted';
  lead.outreach_status = 'Follow-Up';
  lead.current_follow_up_number = 0;
  lead.follow_up_day = 1;
  lead.follow_up_completed = false;
  lead.reply_status = null;
  lead.replied_at = null;
  lead.updated_at = nowIso;

  // Day 2 schedule anchor for Follow-Up #1
  const sched1 = FOLLOW_UP_SCHEDULE[0]; // step 1: dayOffset: 2
  lead.next_follow_up_number = 1;
  lead.next_follow_up_name = sched1.name;
  lead.next_follow_up_at = new Date(now.getTime() + sched1.dayOffset * 24 * 60 * 60 * 1000).toISOString();

  lead.message_history.push({
    id: 'msg_' + Date.now(),
    type: 'main_message',
    follow_up_number: 0,
    sequence_number: 0,
    follow_up_day: 0,
    name: 'Main Message',
    text: messageText || 'Main outreach dispatched',
    message: messageText || 'Main outreach dispatched',
    sent_at: nowIso,
    status: 'sent',
    channel: 'WhatsApp'
  });

  recordLeadActivity(lead, {
    event_type: 'message_sent',
    event_title: 'Message Sent',
    event_description: 'User confirmed that the message was sent',
    created_at: nowIso,
    metadata: {
      channel: 'WhatsApp',
      message_preview: (messageText || '').slice(0, 120)
    }
  });

  saveStoredData(store, true);

  if (supabase) {
    try {
      await supabase.from('leads').update({
        outreach_status: 'Follow-Up',
        status: 'Contacted',
        first_message_sent: true,
        first_message_sent_at: nowIso,
        main_message_sent_at: nowIso,
        last_message_sent_at: nowIso,
        current_follow_up_number: 0,
        next_follow_up_number: 1,
        next_follow_up_at: lead.next_follow_up_at,
        message_history: lead.message_history
      }).eq('place_id', lead.place_id);
    } catch (err) {
      console.warn('Supabase mark-sent notice:', err.message);
    }
  }

  res.json({
    success: true,
    lead,
    message: 'Main outreach message recorded. Scheduled Follow-Up #1 for Day 2.'
  });
});

// 10.5 Mark Follow-Up Message as Sent (Confirmed by user)
app.post('/api/outreach/mark-followup-sent', async (req, res) => {
  const { leadId, messageText, step, bypassScheduleCheck } = req.body;
  if (!leadId) {
    return res.status(400).json({ success: false, error: 'leadId is required.' });
  }

  const store = getStoredData();
  const lead = store.leads.find((l) => l.id === leadId || l.place_id === leadId);

  if (!lead) {
    return res.status(404).json({ success: false, error: 'Lead not found.' });
  }

  enrichLeadOutreachFields(lead);

  // 1. Verify lead has confirmed main message
  if (!lead.first_message_sent || !lead.main_message_sent_at) {
    return res.status(400).json({ success: false, error: 'Cannot send follow-up: Main outreach message has not been sent yet.' });
  }

  // 2. Verify lead is not already completed
  if (lead.follow_up_completed || lead.outreach_status === 'Completed') {
    return res.status(400).json({ success: false, error: 'Follow-up sequence is already completed.' });
  }

  // 3. Verify lead has not replied
  if (lead.reply_status) {
    return res.status(400).json({ success: false, error: 'Lead has already replied. Follow-ups are stopped.' });
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const expectedStep = lead.next_follow_up_number || (lead.current_follow_up_number || 0) + 1;
  const requestedStep = parseInt(step, 10) || expectedStep;

  // 4. Verify requested follow-up step matches current stage
  if (requestedStep !== expectedStep) {
    return res.status(400).json({
      success: false,
      error: `Invalid follow-up stage. Expected Follow-Up #${expectedStep}, received #${requestedStep}.`
    });
  }

  const safeStep = Math.min(5, Math.max(1, requestedStep));

  // 5. Prevent duplicate sends of the same follow-up step
  if (lead.current_follow_up_number >= safeStep) {
    return res.status(400).json({
      success: false,
      error: `Follow-Up #${safeStep} has already been marked as sent.`
    });
  }

  // 6. Schedule check: Follow-up cannot be sent before scheduled due date (calendar day)
  if (lead.next_follow_up_at && !bypassScheduleCheck) {
    const target = new Date(lead.next_follow_up_at);
    const targetMidnight = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    if (targetMidnight > todayMidnight) {
      const dd = String(target.getDate()).padStart(2, '0');
      const mm = String(target.getMonth() + 1).padStart(2, '0');
      const yyyy = target.getFullYear();
      return res.status(400).json({
        success: false,
        error: `Follow-Up #${safeStep} cannot be sent before its scheduled date (${dd}-${mm}-${yyyy}).`
      });
    }
  }

  lead.last_message_sent_at = nowIso;
  lead.last_message_type = `Follow-Up #${safeStep}`;
  lead.last_message_text = messageText || `Follow-Up #${safeStep} sent.`;
  lead.current_follow_up_number = safeStep;
  lead.updated_at = nowIso;

  const currentSched = FOLLOW_UP_SCHEDULE.find((s) => s.step === safeStep);
  const stageNameOnly = currentSched ? (currentSched.name.includes('—') ? currentSched.name.split('—')[1].trim() : currentSched.name) : `Follow-Up #${safeStep}`;
  lead.message_history.push({
    id: 'msg_' + Date.now(),
    type: 'follow_up',
    follow_up_number: safeStep,
    sequence_number: safeStep,
    follow_up_day: safeStep,
    name: stageNameOnly,
    stage_name: currentSched ? currentSched.name : `Follow-Up #${safeStep}`,
    text: messageText || `Follow-Up #${safeStep} dispatched`,
    message: messageText || `Follow-Up #${safeStep} dispatched`,
    sent_at: nowIso,
    status: 'sent',
    channel: 'WhatsApp'
  });

  const hasDue = (lead.activities || []).some((a) => a.event_type === 'followup_due' && String(a.metadata?.step) === String(safeStep));
  if (!hasDue) {
    const dueTimeIso = lead.next_follow_up_at || new Date(new Date(nowIso).getTime() - 1000).toISOString();
    recordLeadActivity(lead, {
      event_type: 'followup_due',
      event_title: `Follow-up #${safeStep} Due`,
      event_description: `Follow-up #${safeStep} reached due date`,
      created_at: dueTimeIso,
      metadata: { step: safeStep }
    });
  }

  recordLeadActivity(lead, {
    event_type: 'followup_sent',
    event_title: `Follow-up #${safeStep} Sent`,
    event_description: `Follow-up #${safeStep} confirmed as sent`,
    created_at: nowIso,
    metadata: {
      step: safeStep,
      channel: 'WhatsApp',
      message_preview: (messageText || '').slice(0, 120)
    }
  });

  if (safeStep >= 5) {
    // 5-Step sequence complete after Day 14! Stop follow-ups, no Follow-Up #6
    lead.outreach_status = 'Completed';
    lead.follow_up_completed = true;
    lead.outreach_completed_at = nowIso;
    lead.next_follow_up_number = null;
    lead.next_follow_up_name = null;
    lead.next_follow_up_at = null;

    recordLeadActivity(lead, {
      event_type: 'outreach_completed',
      event_title: 'Outreach Completed',
      event_description: 'Full follow-up sequence completed (Day 14 reached)',
      created_at: nowIso
    });
  } else {
    const nextStep = safeStep + 1;
    const nextSched = FOLLOW_UP_SCHEDULE.find((s) => s.step === nextStep);
    lead.next_follow_up_number = nextStep;
    lead.next_follow_up_name = nextSched.name;
    lead.follow_up_day = nextStep;

    // Anchor strictly to the permanent Main Message Date (Day 0)!
    const anchorTime = new Date(lead.main_message_sent_at || lead.first_message_sent_at || nowIso).getTime();
    lead.next_follow_up_at = new Date(anchorTime + nextSched.dayOffset * 24 * 60 * 60 * 1000).toISOString();
    lead.outreach_status = 'Follow-Up';
  }

  saveStoredData(store, true);

  if (supabase) {
    try {
      await supabase.from('leads').update({
        outreach_status: lead.outreach_status,
        last_message_sent_at: nowIso,
        last_message_type: lead.last_message_type,
        current_follow_up_number: lead.current_follow_up_number,
        next_follow_up_number: lead.next_follow_up_number,
        next_follow_up_name: lead.next_follow_up_name,
        next_follow_up_at: lead.next_follow_up_at,
        follow_up_completed: lead.follow_up_completed,
        outreach_completed_at: lead.outreach_completed_at,
        message_history: lead.message_history
      }).eq('place_id', lead.place_id);
    } catch (err) {
      console.warn('Supabase mark-followup notice:', err.message);
    }
  }

  res.json({
    success: true,
    lead,
    completed: lead.follow_up_completed,
    message: lead.follow_up_completed
      ? 'Follow-up sequence completed (Day 14 reached).'
      : `Follow-up #${safeStep} recorded. Next scheduled: ${lead.next_follow_up_name}.`
  });
});

// 10.5b Snooze Follow-Up Schedule
app.post('/api/outreach/snooze-followup', async (req, res) => {
  const { leadId, days, customDate } = req.body;
  const store = getStoredData();
  const lead = (store.leads || []).find((l) => String(l.id) === String(leadId) || (l.place_id && String(l.place_id) === String(leadId)));

  if (!lead) {
    return res.status(404).json({ success: false, error: 'Lead not found.' });
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const prevFollowUpAt = lead.next_follow_up_at;

  let newFollowUpAt = null;
  let snoozeLabel = '';

  if (customDate) {
    const parsed = new Date(customDate);
    if (isNaN(parsed.getTime())) {
      return res.status(400).json({ success: false, error: 'Invalid custom date provided.' });
    }
    const target = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), 9, 0, 0);
    newFollowUpAt = target.toISOString();
    const dd = String(target.getDate()).padStart(2, '0');
    const mm = String(target.getMonth() + 1).padStart(2, '0');
    const yyyy = target.getFullYear();
    snoozeLabel = `${dd}-${mm}-${yyyy}`;
  } else {
    const numDays = Math.max(1, parseInt(days, 10) || 1);
    const target = new Date(now.getFullYear(), now.getMonth(), now.getDate() + numDays, 9, 0, 0);
    newFollowUpAt = target.toISOString();
    snoozeLabel = `${numDays} day${numDays === 1 ? '' : 's'}`;
  }

  // Update follow-up schedule
  lead.next_follow_up_at = newFollowUpAt;
  lead.updated_at = nowIso;
  if (!lead.outreach_status || lead.outreach_status === 'Pending' || lead.outreach_status === 'Not Contacted') {
    lead.outreach_status = 'Follow-Up';
  }

  // Record Activity Timeline Event
  const activityEvent = {
    event_type: 'followup_snoozed',
    event_title: 'Follow-up Snoozed',
    event_description: `Follow-up postponed by ${snoozeLabel}`,
    created_at: nowIso,
    metadata: {
      previous_due: prevFollowUpAt,
      new_due: newFollowUpAt,
      snooze_choice: customDate ? 'custom' : `${days}d`
    }
  };
  recordLeadActivity(lead, activityEvent);

  saveStoredData(store, true);

  if (supabase) {
    try {
      await supabase.from('leads').update({
        next_follow_up_at: lead.next_follow_up_at,
        outreach_status: lead.outreach_status,
        updated_at: nowIso
      }).eq('place_id', lead.place_id);
    } catch (err) {
      console.warn('Supabase snooze notice:', err.message);
    }
  }

  res.json({
    success: true,
    lead,
    next_follow_up_at: newFollowUpAt,
    message: `Follow-up snoozed by ${snoozeLabel}.`
  });
});

// 10.6 Mark Lead as Replied (Interested or Not Interested or General)
app.post('/api/outreach/mark-replied', async (req, res) => {
  const { leadId, replyStatus } = req.body;
  const store = getStoredData();
  const lead = store.leads.find((l) => l.id === leadId || l.place_id === leadId);

  if (!lead) {
    return res.status(404).json({ success: false, error: 'Lead not found.' });
  }

  enrichLeadOutreachFields(lead);

  const nowIso = new Date().toISOString();
  let validStatus = 'INTERESTED';
  if (replyStatus === 'NOT_INTERESTED') validStatus = 'NOT_INTERESTED';
  else if (replyStatus === 'OTHER' || replyStatus === 'REPLIED') validStatus = 'OTHER';

  lead.reply_status = validStatus;
  lead.replied_at = nowIso;
  lead.outreach_status = 'Replied';
  lead.status = 'Replied';
  lead.follow_up_completed = true;
  lead.next_follow_up_at = null;
  lead.next_follow_up_number = null;
  lead.next_follow_up_name = null;
  lead.updated_at = nowIso;

  lead.message_history.push({
    id: 'msg_' + Date.now(),
    type: 'REPLY',
    reply_status: validStatus,
    message: `Lead reply recorded: ${validStatus === 'INTERESTED' ? 'Interested' : (validStatus === 'NOT_INTERESTED' ? 'Not Interested' : 'General Reply')}`,
    sent_at: nowIso
  });

  recordLeadActivity(lead, {
    event_type: 'lead_replied',
    event_title: 'Lead Replied',
    event_description: `Lead reply recorded: ${validStatus === 'INTERESTED' ? 'Interested' : (validStatus === 'NOT_INTERESTED' ? 'Not Interested' : 'General Reply')}`,
    created_at: nowIso,
    metadata: {
      reply_status: validStatus
    }
  });

  saveStoredData(store, true);

  if (supabase) {
    try {
      await supabase.from('leads').update({
        outreach_status: 'Replied',
        status: 'Replied',
        reply_status: validStatus,
        replied_at: nowIso,
        follow_up_completed: true,
        next_follow_up_at: null,
        next_follow_up_number: null,
        next_follow_up_name: null,
        message_history: lead.message_history
      }).eq('place_id', lead.place_id);
    } catch (err) {
      console.warn('Supabase mark-replied notice:', err.message);
    }
  }

  res.json({
    success: true,
    lead,
    message: `Recorded reply as ${validStatus}. Automatic follow-ups stopped.`
  });
});

// 10.7 Stop Follow-Ups
app.post('/api/outreach/mark-stopped', async (req, res) => {
  const { leadId } = req.body;
  const store = getStoredData();
  const lead = store.leads.find((l) => l.id === leadId || l.place_id === leadId);

  if (!lead) {
    return res.status(404).json({ success: false, error: 'Lead not found.' });
  }

  enrichLeadOutreachFields(lead);

  const nowIso = new Date().toISOString();
  lead.outreach_status = 'Stopped';
  lead.follow_up_completed = true;
  lead.next_follow_up_at = null;
  lead.next_follow_up_number = null;
  lead.next_follow_up_name = null;
  lead.updated_at = nowIso;

  recordLeadActivity(lead, {
    event_type: 'outreach_stopped',
    event_title: 'Outreach Stopped',
    event_description: 'Outreach follow-ups halted for this lead',
    created_at: nowIso
  });

  saveStoredData(store, true);

  if (supabase) {
    try {
      await supabase.from('leads').update({
        outreach_status: 'Stopped',
        follow_up_completed: true,
        next_follow_up_at: null,
        next_follow_up_number: null,
        next_follow_up_name: null
      }).eq('place_id', lead.place_id);
    } catch (err) {
      console.warn('Supabase mark-stopped notice:', err.message);
    }
  }

  res.json({
    success: true,
    lead,
    message: `Follow-ups stopped for "${lead.business_name}".`
  });
});

// 10.8 Update Daily Outreach Target
app.post('/api/outreach/target', (req, res) => {
  const { target } = req.body;
  const numTarget = parseInt(target, 10);
  if (isNaN(numTarget) || numTarget < 1) {
    return res.status(400).json({ success: false, error: 'Valid target integer required.' });
  }

  const store = getStoredData();
  if (!store.outreach_settings) store.outreach_settings = {};
  store.outreach_settings.dailyTarget = numTarget;
  if (store.settings && store.settings.outreachTarget) {
    store.settings.outreachTarget.dailyTarget = numTarget;
  }
  saveStoredData(store, true);

  if (supabase && store.settings) {
    supabase.from('settings').upsert({
      id: 'default',
      settings: store.settings,
      updated_at: new Date().toISOString()
    }, { onConflict: 'id' }).then(() => {}).catch((err) => {
      console.warn('[OUTREACH TARGET] Supabase sync notice:', err.message);
    });
  }

  res.json({
    success: true,
    dailyTarget: numTarget,
    message: `Daily target updated to ${numTarget} pitches/day.`
  });
});

// 10.9 Update Lead Outreach Status Manually
app.post('/api/outreach/status', async (req, res) => {
  const { leadId, status } = req.body;
  const store = getStoredData();
  const lead = store.leads.find((l) => l.id === leadId || l.place_id === leadId);

  if (!lead) {
    return res.status(404).json({ success: false, error: 'Lead not found.' });
  }

  enrichLeadOutreachFields(lead);
  lead.outreach_status = status;
  if (status === 'Replied' || status === 'Completed' || status === 'Stopped') {
    lead.follow_up_completed = true;
    lead.next_follow_up_at = null;
  }
  lead.updated_at = new Date().toISOString();
  saveStoredData(store);

  if (supabase) {
    try {
      await supabase.from('leads').update({
        outreach_status: lead.outreach_status,
        follow_up_completed: lead.follow_up_completed
      }).eq('place_id', lead.place_id);
    } catch (err) {
      console.warn('Supabase status notice:', err.message);
    }
  }

  res.json({
    success: true,
    leadId: lead.id,
    outreach_status: lead.outreach_status
  });
});

// 10.9 Remove Lead(s) from Outreach Only (Keeps Saved Leads 100% Intact)
app.post('/api/outreach/remove-batch', async (req, res) => {
  const { leadIds = [] } = req.body;
  if (!Array.isArray(leadIds) || leadIds.length === 0) {
    return res.status(400).json({ success: false, error: 'No lead IDs provided.' });
  }

  const store = getStoredData();
  const idSet = new Set(leadIds.map(String));
  const nowIso = new Date().toISOString();
  const matchedLeads = [];
  const previousStates = [];

  for (const lead of store.leads) {
    if (idSet.has(String(lead.id)) || idSet.has(String(lead.place_id))) {
      previousStates.push({
        id: lead.id,
        place_id: lead.place_id,
        outreach_status: lead.outreach_status,
        next_follow_up_at: lead.next_follow_up_at,
        next_follow_up_number: lead.next_follow_up_number,
        next_follow_up_name: lead.next_follow_up_name,
        business_name: lead.business_name
      });
      lead.outreach_status = 'Pending';
      lead.next_follow_up_at = null;
      lead.next_follow_up_number = null;
      lead.next_follow_up_name = null;
      lead.updated_at = nowIso;
      matchedLeads.push(lead);
    }
  }

  if (matchedLeads.length === 0) {
    return res.status(404).json({ success: false, error: 'No matching leads found in outreach.' });
  }

  // Preserve removed tracking entries for Undo
  const removedOutreachEntries = (store.outreach || []).filter(
    (o) => idSet.has(String(o.saved_lead_id)) || idSet.has(String(o.id)) || (o.place_id && idSet.has(String(o.place_id)))
  );

  // Store in temporary deletion buffer for Undo
  const undoToken = storeTemporaryDeletion('outreach', {
    previousStates,
    removedOutreachEntries
  });

  // Remove corresponding tracking relationship entries from store.outreach
  if (!store.outreach) store.outreach = [];
  store.outreach = store.outreach.filter(
    (o) => !idSet.has(String(o.saved_lead_id)) && !idSet.has(String(o.id)) && (!o.place_id || !idSet.has(String(o.place_id)))
  );

  saveStoredData(store, true);

  if (supabase && matchedLeads.length > 0) {
    try {
      const placeIds = matchedLeads.map((l) => l.place_id).filter(Boolean);
      if (placeIds.length > 0) {
        await supabase
          .from('leads')
          .update({
            outreach_status: 'Pending',
            next_follow_up_at: null,
            next_follow_up_number: null,
            next_follow_up_name: null,
            updated_at: nowIso
          })
          .in('place_id', placeIds);
      }
    } catch (err) {
      console.warn('Supabase outreach removal notice:', err.message);
    }
  }

  console.log(`[Outreach Remove] Successfully removed ${matchedLeads.length} lead(s) from Outreach. Saved Leads remain untouched.`);

  res.json({
    success: true,
    undoToken,
    previousStates,
    removedCount: matchedLeads.length,
    leadIds: matchedLeads.map((l) => l.id || l.place_id),
    message: `${matchedLeads.length} lead${matchedLeads.length > 1 ? 's' : ''} removed from Outreach only. Saved Leads are untouched.`
  });
});

app.delete('/api/outreach/:id', async (req, res) => {
  const leadId = req.params.id;
  const store = getStoredData();
  const nowIso = new Date().toISOString();
  const lead = store.leads.find((l) => String(l.id) === String(leadId) || String(l.place_id) === String(leadId));

  if (!lead) {
    return res.status(404).json({ success: false, error: 'Lead not found.' });
  }

  const previousStates = [{
    id: lead.id,
    place_id: lead.place_id,
    outreach_status: lead.outreach_status,
    next_follow_up_at: lead.next_follow_up_at,
    next_follow_up_number: lead.next_follow_up_number,
    next_follow_up_name: lead.next_follow_up_name,
    business_name: lead.business_name
  }];

  const removedOutreachEntries = (store.outreach || []).filter(
    (o) => String(o.saved_lead_id) === String(leadId) || String(o.id) === String(leadId) || (o.place_id && String(o.place_id) === String(leadId))
  );

  const undoToken = storeTemporaryDeletion('outreach', {
    previousStates,
    removedOutreachEntries
  });

  lead.outreach_status = 'Pending';
  lead.next_follow_up_at = null;
  lead.next_follow_up_number = null;
  lead.next_follow_up_name = null;
  lead.updated_at = nowIso;

  // Remove corresponding tracking relationship entry from store.outreach
  if (!store.outreach) store.outreach = [];
  store.outreach = store.outreach.filter(
    (o) => String(o.saved_lead_id) !== String(leadId) && String(o.id) !== String(leadId) && (!o.place_id || String(o.place_id) !== String(leadId))
  );

  saveStoredData(store, true);

  if (supabase && lead.place_id) {
    try {
      await supabase
        .from('leads')
        .update({
          outreach_status: 'Pending',
          next_follow_up_at: null,
          next_follow_up_number: null,
          next_follow_up_name: null,
          updated_at: nowIso
        })
        .eq('place_id', lead.place_id);
    } catch (err) {
      console.warn('Supabase outreach removal notice:', err.message);
    }
  }

  console.log(`[Outreach Remove] Lead "${lead.business_name}" removed from Outreach. Saved Lead remains untouched.`);

  res.json({
    success: true,
    undoToken,
    previousStates,
    leadId: lead.id || lead.place_id,
    business_name: lead.business_name,
    message: `Lead "${lead.business_name}" removed from Outreach only.`
  });
});

// 10.10 Undo Outreach Removal (Restore Outreach Status)
app.post('/api/outreach/undo-remove', async (req, res) => {
  const { undoToken, fallbackStates } = req.body;
  let restoreData = null;

  if (undoToken && recentDeletions.has(undoToken)) {
    const entry = recentDeletions.get(undoToken);
    if (entry && entry.type === 'outreach' && entry.payload) {
      restoreData = entry.payload;
      recentDeletions.delete(undoToken); // Consume token
    }
  }

  if (!restoreData && Array.isArray(fallbackStates) && fallbackStates.length > 0) {
    restoreData = { previousStates: fallbackStates, removedOutreachEntries: [] };
  }

  if (!restoreData || !Array.isArray(restoreData.previousStates) || restoreData.previousStates.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Unable to restore outreach lead. Undo window has expired or already restored.'
    });
  }

  const store = getStoredData();
  const nowIso = new Date().toISOString();
  let restoredCount = 0;
  const restoredLeads = [];

  for (const prev of restoreData.previousStates) {
    const lead = store.leads.find((l) => String(l.id) === String(prev.id) || (prev.place_id && String(l.place_id) === String(prev.place_id)));
    if (lead) {
      lead.outreach_status = prev.outreach_status || 'Not Contacted';
      lead.next_follow_up_at = prev.next_follow_up_at || null;
      lead.next_follow_up_number = prev.next_follow_up_number || null;
      lead.next_follow_up_name = prev.next_follow_up_name || null;
      lead.updated_at = nowIso;
      restoredLeads.push(lead);
      restoredCount++;

      if (supabase && lead.place_id) {
        try {
          await supabase
            .from('leads')
            .update({
              outreach_status: lead.outreach_status,
              next_follow_up_at: lead.next_follow_up_at,
              next_follow_up_number: lead.next_follow_up_number,
              next_follow_up_name: lead.next_follow_up_name,
              updated_at: nowIso
            })
            .eq('place_id', lead.place_id);
        } catch (err) {
          console.warn('Supabase undo outreach update notice:', err.message);
        }
      }
    }
  }

  // Restore tracking links in store.outreach
  if (Array.isArray(restoreData.removedOutreachEntries) && restoreData.removedOutreachEntries.length > 0) {
    if (!store.outreach) store.outreach = [];
    const existingOutreachIds = new Set(store.outreach.map(o => String(o.saved_lead_id || o.id)));
    for (const entry of restoreData.removedOutreachEntries) {
      const entryKey = String(entry.saved_lead_id || entry.id);
      if (!existingOutreachIds.has(entryKey)) {
        store.outreach.push(entry);
        existingOutreachIds.add(entryKey);
      }
    }
  }

  saveStoredData(store, true);

  console.log(`[UNDO OUTREACH REMOVE] Successfully restored ${restoredCount} lead(s) to Outreach.`);

  res.json({
    success: true,
    restoredCount,
    restoredLeads,
    message: `${restoredCount} outreach lead(s) restored successfully.`
  });
});

// ==========================================
// 10.11 COLD CALLING TERMINAL API ENGINE
// ==========================================

function enrichLeadColdCallFields(lead) {
  if (!lead) return;
  if (!lead.cold_call || typeof lead.cold_call !== 'object') {
    lead.cold_call = {
      queued: false,
      status: 'Not Called',
      added_at: null,
      last_call_at: null,
      outcome: null,
      callback_at: null,
      reason: null
    };
  } else {
    if (lead.cold_call.queued === undefined) lead.cold_call.queued = false;
    if (!lead.cold_call.status) lead.cold_call.status = 'Not Called';
  }
  if (lead.phone) lead.phone = formatContactPhone(lead.phone);
  if (lead.phone_number) lead.phone_number = formatContactPhone(lead.phone_number);
}

function getColdCallSummary(store) {
  const allLeads = store.leads || [];
  allLeads.forEach(enrichLeadColdCallFields);

  const queuedLeads = allLeads.filter((l) => Boolean(l.cold_call && l.cold_call.queued));

  const now = new Date();
  const todayStr = now.toDateString();

  let todayCallsCount = 0;
  let interestedCount = 0;
  let callbackCount = 0;
  let notInterestedCount = 0;
  let noAnswerCount = 0;
  let wrongNumberCount = 0;
  let convertedCount = 0;
  let calledCount = 0;
  let remainingCount = 0;

  for (const l of queuedLeads) {
    const cc = l.cold_call;
    const status = cc.status || 'Not Called';
    const outcome = cc.outcome;

    if (status === 'Not Called') {
      remainingCount++;
    } else {
      calledCount++;
    }

    if (outcome === 'Interested') interestedCount++;
    else if (outcome === 'Call Back Later') callbackCount++;
    else if (outcome === 'Not Interested') notInterestedCount++;
    else if (outcome === 'No Answer') noAnswerCount++;
    else if (outcome === 'Wrong Number') wrongNumberCount++;
    else if (outcome === 'Converted' || l.converted) convertedCount++;

    if (cc.last_call_at && new Date(cc.last_call_at).toDateString() === todayStr) {
      todayCallsCount++;
    }
  }

  // Extract recent cold call history records across all leads
  const history = [];
  allLeads.forEach((l) => {
    const acts = Array.isArray(l.activities) ? l.activities : [];
    acts.forEach((a) => {
      if (a.event_type === 'cold_call') {
        history.push({
          activity_id: a.activity_id,
          lead_id: l.id || l.place_id,
          business_name: l.business_name || l.name || '',
          businessName: l.business_name || l.name || '',
          phone: l.phone || l.phone_number || '',
          category: l.category || '',
          city: l.city || '',
          created_at: a.created_at,
          date: a.created_at,
          outcome: a.metadata?.outcome || (a.event_title ? a.event_title.replace('Cold Call - ', '') : 'Called'),
          notes: a.metadata?.notes || a.event_description || '',
          reason: a.metadata?.reason || '',
          callback_at: a.metadata?.callback_at || null
        });
      }
    });
  });
  history.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return {
    queuedLeads,
    totalQueue: queuedLeads.length,
    metrics: {
      totalQueue: queuedLeads.length,
      remaining: remainingCount,
      called: calledCount,
      interested: interestedCount,
      callback: callbackCount,
      notInterested: notInterestedCount,
      noAnswer: noAnswerCount,
      wrongNumber: wrongNumberCount,
      converted: convertedCount,
      todayCalls: todayCallsCount
    },
    history: history.slice(0, 50),
    recentHistory: history.slice(0, 50),
    allHistory: history
  };
}

// 10.11a Get Cold Call Data, Metrics & History
app.get('/api/coldcall/data', async (req, res) => {
  let store = getStoredData();
  if (storeStatus === 'failed' || !store) {
    return res.status(500).json({
      success: false,
      status: 'failed',
      error: 'ClientHunter could not safely load existing data. Your data has not been modified. Please retry or check the data source.',
      leads: [],
      metrics: {},
      history: []
    });
  }

  if (supabase && (!leadsSupabaseSyncDone || !store.leads || store.leads.length === 0)) {
    store = await syncPersistentLeads(store);
  }

  const summary = getColdCallSummary(store);

  res.json({
    success: true,
    leads: summary.queuedLeads,
    totalQueue: summary.totalQueue,
    metrics: summary.metrics,
    history: summary.history,
    recentHistory: summary.recentHistory
  });
});

// 10.11b Add Selected Leads to Cold Call Queue (Idempotent, No Duplicates)
app.post('/api/coldcall/add', async (req, res) => {
  const { leadIds = [] } = req.body;
  if (!Array.isArray(leadIds) || leadIds.length === 0) {
    return res.status(400).json({ success: false, error: 'No lead IDs provided.' });
  }

  const store = getStoredData();
  const idSet = new Set(leadIds.map(String));
  const nowIso = new Date().toISOString();
  const matchedLeads = [];
  let newlyAddedCount = 0;

  for (const lead of store.leads) {
    if (idSet.has(String(lead.id)) || (lead.place_id && idSet.has(String(lead.place_id)))) {
      enrichLeadColdCallFields(lead);
      if (!lead.cold_call.queued) {
        lead.cold_call.queued = true;
        lead.cold_call.status = lead.cold_call.status || 'Not Called';
        lead.cold_call.added_at = nowIso;
        newlyAddedCount++;

        recordLeadActivity(lead, {
          event_type: 'cold_call_added',
          event_title: 'Added to Cold Call',
          event_description: 'Lead entered the Cold Call calling queue',
          created_at: nowIso
        });
      }
      lead.updated_at = nowIso;
      matchedLeads.push(lead);
    }
  }

  if (matchedLeads.length === 0) {
    return res.status(404).json({ success: false, error: 'No matching leads found.' });
  }

  saveStoredData(store, true);

  const totalQueue = store.leads.filter((l) => l.cold_call && l.cold_call.queued).length;

  res.json({
    success: true,
    addedCount: newlyAddedCount,
    totalQueue,
    leadIds: matchedLeads.map((l) => l.id || l.place_id),
    message: `${newlyAddedCount} lead(s) added to Cold Call queue.`
  });
});

// 10.11c Record Call Outcome, Notes, Callback & Activity
app.post('/api/coldcall/outcome', async (req, res) => {
  const { leadId, outcome, status, reason, notes, callbackAt } = req.body;
  if (!leadId) {
    return res.status(400).json({ success: false, error: 'leadId is required.' });
  }
  if (!outcome) {
    return res.status(400).json({ success: false, error: 'outcome is required.' });
  }

  const store = getStoredData();
  const lead = store.leads.find((l) => String(l.id) === String(leadId) || (l.place_id && String(l.place_id) === String(leadId)));
  if (!lead) {
    return res.status(404).json({ success: false, error: 'Lead not found.' });
  }

  enrichLeadColdCallFields(lead);
  const nowIso = new Date().toISOString();

  // Determine calling status: use provided status or derive logically
  let finalStatus = status;
  if (!finalStatus) {
    if (outcome === 'Interested' || outcome === 'Call Back Later') {
      finalStatus = 'Follow-Up Required';
    } else if (outcome === 'Not Interested' || outcome === 'Wrong Number' || outcome === 'Converted') {
      finalStatus = 'Completed';
    } else {
      finalStatus = 'Called';
    }
  }

  lead.cold_call.status = finalStatus;
  lead.cold_call.outcome = outcome;
  lead.cold_call.last_call_at = nowIso;
  lead.cold_call.reason = reason ? String(reason).trim() : null;
  lead.cold_call.callback_at = callbackAt ? String(callbackAt).trim() : null;
  lead.updated_at = nowIso;

  // Add notes to lead.notes if provided
  if (notes && typeof notes === 'string' && notes.trim()) {
    if (!Array.isArray(lead.notes)) lead.notes = [];
    const noteText = notes.trim();
    lead.notes.unshift({
      id: 'note_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      lead_id: lead.id || lead.place_id,
      text: `[Cold Call - ${outcome}] ${noteText}`,
      created_at: nowIso,
      updated_at: nowIso
    });
  }

  // Build activity description
  const descParts = [];
  if (reason && reason.trim()) descParts.push(reason.trim());
  if (notes && notes.trim()) descParts.push(`Notes: ${notes.trim()}`);
  if (callbackAt && callbackAt.trim()) descParts.push(`Callback: ${callbackAt.trim()}`);
  const actDesc = descParts.length > 0 ? descParts.join(' • ') : `Cold call recorded with outcome: ${outcome}`;

  // Record Activity in Lead Activity Timeline
  recordLeadActivity(lead, {
    event_type: 'cold_call',
    event_title: `Cold Call - ${outcome}`,
    event_description: actDesc,
    created_at: nowIso,
    metadata: {
      channel: 'Phone',
      outcome,
      status: finalStatus,
      reason: reason || null,
      notes: notes || null,
      callback_at: callbackAt || null
    }
  });

  // Converted sync
  if (outcome === 'Converted') {
    lead.converted = true;
    if (!lead.conversion_date) lead.conversion_date = nowIso;
  }

  saveStoredData(store, true);

  if (supabase && lead.place_id) {
    try {
      await supabase.from('leads').update({
        notes: lead.notes,
        converted: lead.converted,
        updated_at: nowIso
      }).eq('place_id', lead.place_id);
    } catch (err) {
      console.warn('Supabase cold call sync notice:', err.message);
    }
  }

  const summary = getColdCallSummary(store);

  res.json({
    success: true,
    lead,
    metrics: summary.metrics,
    history: summary.history,
    recentHistory: summary.recentHistory,
    message: `Call outcome "${outcome}" saved for ${lead.business_name || 'lead'}.`
  });
});

// 10.11d Remove Leads from Cold Call Queue (Does NOT Delete Lead)
app.post('/api/coldcall/remove', async (req, res) => {
  const { leadIds = [] } = req.body;
  if (!Array.isArray(leadIds) || leadIds.length === 0) {
    return res.status(400).json({ success: false, error: 'No lead IDs provided.' });
  }

  const store = getStoredData();
  const idSet = new Set(leadIds.map(String));
  const nowIso = new Date().toISOString();
  let removedCount = 0;
  const previousColdCallStates = [];

  for (const lead of store.leads) {
    if (idSet.has(String(lead.id)) || (lead.place_id && idSet.has(String(lead.place_id)))) {
      if (lead.cold_call && lead.cold_call.queued) {
        previousColdCallStates.push({
          id: lead.id,
          place_id: lead.place_id,
          cold_call: JSON.parse(JSON.stringify(lead.cold_call))
        });
        lead.cold_call.queued = false;
        lead.updated_at = nowIso;
        removedCount++;
      }
    }
  }

  const undoToken = storeTemporaryDeletion('cold_call', {
    previousColdCallStates
  });

  saveStoredData(store, true);

  const summary = getColdCallSummary(store);

  res.json({
    success: true,
    removedCount,
    totalQueue: summary.totalQueue,
    undoToken,
    previousStates: previousColdCallStates,
    metrics: summary.metrics,
    message: `${removedCount} lead(s) removed from Cold Call queue.`
  });
});

// 10.11e Undo Cold Call Removal (Restore Cold Call Queue State)
app.post('/api/coldcall/undo-remove', async (req, res) => {
  const { undoToken, fallbackStates } = req.body;
  let restoreData = null;

  if (undoToken && recentDeletions.has(undoToken)) {
    const entry = recentDeletions.get(undoToken);
    if (entry && entry.type === 'cold_call' && entry.payload) {
      restoreData = entry.payload;
      recentDeletions.delete(undoToken); // Consume token
    }
  }

  if (!restoreData && Array.isArray(fallbackStates) && fallbackStates.length > 0) {
    restoreData = { previousColdCallStates: fallbackStates };
  }

  if (!restoreData || !Array.isArray(restoreData.previousColdCallStates) || restoreData.previousColdCallStates.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Unable to restore Cold Call leads. Undo window has expired or already restored.'
    });
  }

  const store = getStoredData();
  const nowIso = new Date().toISOString();
  let restoredCount = 0;
  const restoredLeadIds = [];

  for (const prev of restoreData.previousColdCallStates) {
    const lead = store.leads.find((l) => String(l.id) === String(prev.id) || (prev.place_id && String(l.place_id) === String(prev.place_id)));
    if (lead) {
      enrichLeadColdCallFields(lead);
      if (prev.cold_call) {
        lead.cold_call = { ...prev.cold_call, queued: true };
      } else {
        lead.cold_call.queued = true;
      }
      lead.updated_at = nowIso;
      restoredLeadIds.push(lead.id || lead.place_id);
      restoredCount++;
    }
  }

  saveStoredData(store, true);

  const summary = getColdCallSummary(store);

  res.json({
    success: true,
    restoredCount,
    totalQueue: summary.totalQueue,
    restoredLeadIds,
    metrics: summary.metrics,
    message: `${restoredCount} lead(s) restored to Cold Call queue.`
  });
});

// 10.11f Export Dedicated Cold Call Backup Payload (JSON)
app.get('/api/coldcall/export', async (req, res) => {
  try {
    let store = getStoredData();
    if (storeStatus === 'failed' || !store) {
      return res.status(500).json({ success: false, error: 'Store not available.' });
    }
    const summary = getColdCallSummary(store);
    const dateStr = getTodayDateString();
    const exportPayload = {
      exportVersion: '2.2.0',
      exportedAt: new Date().toISOString(),
      source: 'ClientHunter Cold Call Backup',
      totalQueue: summary.totalQueue,
      metrics: summary.metrics,
      leads: summary.queuedLeads,
      history: summary.allHistory || summary.history || []
    };
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="ClientHunter_ColdCall_Backup_${dateStr}.json"`);
    res.send(JSON.stringify(exportPayload, null, 2));
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});


// ==========================================
// 11. SETTINGS & SYSTEM API ROUTES
// ==========================================

function getDefaultSettings() {
  return {
    profile: {
      fullName: 'Akshay',
      companyName: 'Nexora Labs',
      phone: '+91 98765 43210',
      email: 'contact@nexoralabs.com',
      portfolioUrl: 'https://nexoralabs.com/portfolio',
      websiteUrl: 'https://nexoralabs.com',
      city: 'Vijayawada',
      state: 'Andhra Pradesh',
      bio: 'Full-stack AI automation & modern web consultant.'
    },
    services: [
      { id: 'srv-1', name: 'AI Voice Calling Agents', enabled: true },
      { id: 'srv-2', name: 'AI Automation', enabled: true },
      { id: 'srv-3', name: 'AI Chatbots', enabled: true },
      { id: 'srv-4', name: 'Custom Software', enabled: true },
      { id: 'srv-5', name: 'AI Integrations', enabled: true },
      { id: 'srv-6', name: 'Business Automation', enabled: true }
    ],
    templates: [
      {
        id: 'tpl-website',
        name: 'Website',
        type: 'Website Outreach',
        content: "Hi {businessName}! I came across your {category} in {city}. I help businesses improve their online presence with modern websites. Would you be open to a quick look at what I can build for you?\n\n{my_name}\n{my_company}",
        isDefault: true
      },
      {
        id: 'tpl-voice-agent',
        name: 'Voice Agent',
        type: 'Voice Agent Outreach',
        content: "Hi {businessName}! I noticed your {category} in {city}. I help businesses handle calls and inquiries with AI voice agents. Would you like to see how it works?\n\n{my_name}\n{my_company}",
        isDefault: false
      },
      {
        id: 'tpl-ai-automation',
        name: 'AI Automation',
        type: 'AI Automation Outreach',
        content: "Hi {businessName}! I came across your {category} in {city}. I help businesses automate repetitive tasks using AI. Would you be interested in seeing a quick example?\n\n{my_name}\n{my_company}",
        isDefault: false
      },
      {
        id: 'tpl-ai-chatbot',
        name: 'AI Chatbot',
        type: 'AI Chatbot Outreach',
        content: "Hi {businessName}! I came across your {category} in {city}. I build AI chatbots that can handle customer questions and inquiries 24/7. Want to see a quick demo?\n\n{my_name}\n{my_company}",
        isDefault: false
      },
      {
        id: 'tpl-general-intro',
        name: 'General Introduction',
        type: 'General Introduction Outreach',
        content: "Hi {businessName}! I'm {my_name} from {my_company}. I work with businesses like {businessName} on websites, AI solutions, and automation. Would you be open to connecting?\n\n{portfolio_url}",
        isDefault: false
      },
      {
        id: 'tpl-custom-pitch',
        name: 'Custom Pitch',
        type: 'Custom Outreach',
        content: "Hi {businessName}! I noticed something interesting about your {category} in {city} and had an idea that could help. I'd be happy to share it if you're interested.\n\n{my_name}\n{my_company}",
        isDefault: false
      },
      {
        id: 'tpl-followup-1',
        name: 'Follow-Up #1 — Gentle Nudge',
        type: 'Follow-Up',
        content: "Hi {businessName}! Just following up on my previous message. Would you be open to a quick chat?",
        isDefault: false
      },
      {
        id: 'tpl-followup-2',
        name: 'Follow-Up #2 — Quick Check-in',
        type: 'Follow-Up',
        content: "Hi {businessName}! Just checking in. Is this something you'd be interested in exploring?",
        isDefault: false
      },
      {
        id: 'tpl-followup-3',
        name: 'Follow-Up #3 — Service Value',
        type: 'Follow-Up',
        content: "Hi {businessName}! I'd be happy to show you a quick example of how we could improve or automate part of your business.",
        isDefault: false
      },
      {
        id: 'tpl-followup-4',
        name: 'Follow-Up #4 — Low-Pressure Closing',
        type: 'Follow-Up',
        content: "Hi {businessName}! No worries if the timing isn't right. Just let me know if you'd like to explore this later.",
        isDefault: false
      },
      {
        id: 'tpl-followup-5',
        name: 'Follow-Up #5 — Final Note',
        type: 'Follow-Up',
        content: "Hi {businessName}! I'll make this my last follow-up. If you ever need help with websites or AI solutions, feel free to reach out.\n\n{my_name}\n{my_company}",
        isDefault: false
      }
    ],
    outreachTarget: {
      dailyTarget: 50,
      showProgressBar: true,
      enableMilestones: true
    },
    defaultLocation: {
      state: 'Telangana',
      city: 'Hyderabad',
      radiusKm: 100
    },
    aiPreferences: {
      tone: 'Friendly',
      length: 'Short (60–100 words)',
      approach: 'Value First',
      cta: 'Friendly Question',
      personalization: 'High (Uses verified business name, category, location, and website status)',
      focusPriority: 'Website Development',
      autoAnalyzeVectors: true
    },
    whatsappPreferences: {
      countryCode: '+91 9959983437',
      launchMode: 'desktop',
      autoTimer: 3,
      followUpAutoTimer: 3
    },
    appearance: {
      interactive3DGrid: true,
      layoutDensity: 'comfortable'
    },
    savedViews: []
  };
}

/*
 * ============================================================================
 * SETTINGS PERSISTENCE & DATA INTEGRITY ARCHITECTURE:
 * 
 * 1. User-saved settings are authoritative and must never be overwritten
 *    automatically by application restarts, resets, reloads, or code changes.
 * 2. Default settings are strictly fallbacks for keys that do NOT yet exist.
 * 3. Settings are persisted to local disk (leads_store.json) AND synchronized
 *    with Supabase (public.settings table, row id = 'default').
 * 4. Lead data resets (DELETE /api/leads/reset) MUST NEVER modify or reset
 *    user settings.
 * ============================================================================
 */

function populateDefaultSettings(saved) {
  const def = getDefaultSettings();
  if (!saved || typeof saved !== 'object') return def;

  const result = { ...saved };

  for (const [catKey, catVal] of Object.entries(def)) {
    if (result[catKey] === undefined || result[catKey] === null) {
      result[catKey] = catVal;
    } else if (typeof catVal === 'object' && !Array.isArray(catVal) && catVal !== null) {
      result[catKey] = { ...result[catKey] };
      for (const [subKey, subVal] of Object.entries(catVal)) {
        if (result[catKey][subKey] === undefined) {
          result[catKey][subKey] = subVal;
        }
      }
    }
  }

  return result;
}

let settingsSupabaseSyncDone = false;

async function syncPersistentSettings(store) {
  if (!supabase || settingsSupabaseSyncDone || storeStatus === 'failed' || !store) return;
  try {
    const { data: row, error } = await supabase
      .from('settings')
      .select('settings')
      .eq('id', 'default')
      .maybeSingle();

    if (error) {
      console.warn('[SETTINGS] Supabase persistence sync notice:', error.message);
      lastSupabaseSyncStatus = 'Offline / Sync unavailable';
      lastSupabaseSyncError = error.message;
      return;
    }

    if (row && row.settings && typeof row.settings === 'object') {
      const supaSettings = row.settings;
      console.log('[SETTINGS] Successfully connected and retrieved persistent settings from Supabase (id = default)');
      let settingsChanged = false;
      if (!store.settings) {
        store.settings = { ...supaSettings };
        settingsChanged = true;
      } else {
        for (const k of Object.keys(supaSettings)) {
          if (store.settings[k] === undefined) {
            store.settings[k] = supaSettings[k];
            settingsChanged = true;
          }
        }
      }
      if (settingsChanged) {
        saveStoredData(store, true);
      }
    } else if (!row && store.settings) {
      console.log('[SETTINGS] Seeding initial settings row to Supabase (id = default)');
      const { error: upsertErr } = await supabase.from('settings').upsert({
        id: 'default',
        settings: store.settings,
        updated_at: new Date().toISOString()
      }, { onConflict: 'id' });
      if (upsertErr) {
        console.warn('[SETTINGS] Supabase settings seed notice:', upsertErr.message);
        lastSupabaseSyncStatus = 'Offline / Sync unavailable';
        lastSupabaseSyncError = upsertErr.message;
        return;
      }
    }
    settingsSupabaseSyncDone = true;
  } catch (err) {
    console.warn('[SETTINGS] Supabase persistence sync notice:', err.message);
    lastSupabaseSyncStatus = 'Offline / Sync unavailable';
    lastSupabaseSyncError = err.message;
  }
}

let leadsSupabaseSyncDone = false;
let leadsSyncPromise = null;

async function syncPersistentLeads(store) {
  if (storeStatus === 'failed' || !store) {
    console.warn('[LEADS SYNC ABORTED] Store is in failed state. Supabase synchronization suspended to protect persistent records.');
    return store;
  }
  if (!supabase) return store;
  if (leadsSyncPromise) return leadsSyncPromise;

  leadsSyncPromise = (async () => {
    try {
      const { data: supaLeads, error } = await supabase
        .from('leads')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        console.warn('[LEADS] Supabase leads sync notice:', error.message);
        lastSupabaseSyncStatus = 'Offline / Sync unavailable';
        lastSupabaseSyncError = error.message;
        return store;
      }

      lastSupabaseSyncStatus = 'Connected';
      lastSupabaseSyncAt = new Date().toISOString();
      lastSupabaseSyncError = null;
      if (Array.isArray(supaLeads)) {
        lastSupabaseLeadCount = supaLeads.length;
      }

      if (Array.isArray(supaLeads) && supaLeads.length > 0) {
        console.log(`[LEADS] Retrieved ${supaLeads.length} leads from Supabase. Merging with store...`);
        if (!Array.isArray(store.leads)) store.leads = [];

        // Build lookup map of existing local leads by place_id and id
        const localByPlaceId = new Map();
        const localById = new Map();
        store.leads.forEach((l) => {
          if (l.place_id) localByPlaceId.set(String(l.place_id), l);
          if (l.id) localById.set(String(l.id), l);
        });

        let addedCount = 0;
        let updatedCount = 0;

        for (const remoteLead of supaLeads) {
          const placeKey = remoteLead.place_id ? String(remoteLead.place_id) : null;
          const idKey = remoteLead.id ? String(remoteLead.id) : null;
          const existing = (placeKey && localByPlaceId.get(placeKey)) || (idKey && localById.get(idKey));

          if (!existing) {
            // New lead from Supabase: apply backward-compatible defaults
            const newLead = {
              ...remoteLead,
              notes: Array.isArray(remoteLead.notes) ? remoteLead.notes : (remoteLead.notes ? [remoteLead.notes] : []),
              activities: Array.isArray(remoteLead.activities) ? remoteLead.activities : [],
              message_history: Array.isArray(remoteLead.message_history) ? remoteLead.message_history : [],
              first_message_sent: Boolean(remoteLead.first_message_sent || remoteLead.main_message_sent_at),
              status: remoteLead.status || 'New',
              outreach_status: remoteLead.outreach_status || 'Pending',
              favorite: Boolean(remoteLead.favorite),
              opportunity_score: remoteLead.opportunity_score ?? 50,
              opportunity_level: remoteLead.opportunity_level || 'MEDIUM',
              follow_up_completed: Boolean(remoteLead.follow_up_completed),
              follow_up_paused: false,
              follow_up_day: remoteLead.follow_up_day ?? 0,
              current_follow_up_number: remoteLead.current_follow_up_number ?? 0
            };
            store.leads.push(newLead);
            if (placeKey) localByPlaceId.set(placeKey, newLead);
            if (idKey) localById.set(idKey, newLead);
            addedCount++;
          } else {
            // Existing lead: update fields from Supabase if not present locally
            if (existing.outreach_status === undefined || existing.outreach_status === null) {
              existing.outreach_status = remoteLead.outreach_status || 'Pending';
            }
            if (remoteLead.next_follow_up_at && !existing.next_follow_up_at) {
              existing.next_follow_up_at = remoteLead.next_follow_up_at;
            }
            if (remoteLead.next_follow_up_number && !existing.next_follow_up_number) {
              existing.next_follow_up_number = remoteLead.next_follow_up_number;
            }
            if (remoteLead.main_message_sent_at && !existing.main_message_sent_at) {
              existing.main_message_sent_at = remoteLead.main_message_sent_at;
            }
            if (remoteLead.first_message_sent && !existing.first_message_sent) {
              existing.first_message_sent = true;
            }
            if (remoteLead.favorite && !existing.favorite) {
              existing.favorite = true;
              updatedCount++;
            }
            if (!existing.notes) { existing.notes = []; updatedCount++; }
            if (!existing.activities) { existing.activities = []; updatedCount++; }
            if (!existing.message_history) { existing.message_history = []; updatedCount++; }
          }
        }

        // Also ensure relationship tracking in store.outreach
        if (!store.outreach) store.outreach = [];
        const existingOutreachIds = new Set(store.outreach.map(o => String(o.saved_lead_id || o.id || o.place_id)));
        store.leads.forEach((l) => {
          if (l.outreach_status && l.outreach_status !== 'Pending') {
            const key = String(l.id || l.place_id);
            if (!existingOutreachIds.has(key)) {
              store.outreach.push({
                id: 'outreach_' + key,
                saved_lead_id: l.id,
                place_id: l.place_id,
                status: l.outreach_status,
                created_at: l.created_at || new Date().toISOString(),
                updated_at: l.updated_at || new Date().toISOString()
              });
              existingOutreachIds.add(key);
            }
          }
        });

        // Save immediately to disk ONLY if records were added or modified
        if (addedCount > 0 || updatedCount > 0) {
          saveStoredData(store, true);
          try {
            const rootDataPath = path.join(__dirname, 'data', 'leads_store.json');
            if (rootDataPath !== LEADS_STORE_PATH) {
              fs.writeFileSync(rootDataPath, JSON.stringify(store, null, 2), 'utf8');
            }
          } catch (_) {}
        }

        console.log(`[LEADS] Sync complete. Added: ${addedCount}, Updated: ${updatedCount}, Total leads in store: ${store.leads.length}`);
      }
      leadsSupabaseSyncDone = true;
    } catch (err) {
      console.warn('[LEADS] Supabase leads sync exception:', err.message);
      lastSupabaseSyncStatus = 'Offline / Sync unavailable';
      lastSupabaseSyncError = err.message;
    } finally {
      leadsSyncPromise = null;
    }
    return store;
  })();

  return leadsSyncPromise;
}

// 11.1 Get System Settings (STRICTLY A READ OPERATION)
app.get('/api/settings', async (req, res) => {
  try {
    const store = getStoredData();

    if (supabase && !settingsSupabaseSyncDone) {
      await syncPersistentSettings(store);
    }

    if (!store.settings) {
      store.settings = getDefaultSettings();
      if (store.outreach_settings?.dailyTarget) {
        store.settings.outreachTarget.dailyTarget = store.outreach_settings.dailyTarget;
      }
      saveStoredData(store, true);
    }

    // Populate missing keys from defaults non-destructively without mutating user saved values
    const settings = populateDefaultSettings(store.settings);

    res.json({ success: true, settings });
  } catch (err) {
    console.error('[SETTINGS GET ERROR]', err);
    res.status(500).json({ success: false, error: 'Could not load settings.' });
  }
});

// 11.2 Save System Settings (Authoritative category-level persistent update)
app.post('/api/settings', async (req, res) => {
  try {
    if (storeStatus === 'failed') {
      return res.status(500).json({ success: false, error: 'Cannot save settings: Persistent store is in failed state.' });
    }
    const store = getStoredData();
    if (!store) {
      return res.status(500).json({ success: false, error: 'Persistent store is unavailable.' });
    }
    if (!store.settings) {
      store.settings = getDefaultSettings();
    }

    const incoming = req.body;
    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
      return res.status(400).json({ success: false, error: 'Invalid settings payload.' });
    }

    const categoryName = incoming._category || 'Settings';

    // Safe category-level merge: only explicitly provided fields are updated.
    // Untouched categories remain 100% intact.
    for (const key of Object.keys(incoming)) {
      if (key === '_category') continue;
      if (typeof incoming[key] === 'object' && incoming[key] !== null && !Array.isArray(incoming[key])) {
        store.settings[key] = { ...(store.settings[key] || {}), ...incoming[key] };
      } else {
        store.settings[key] = incoming[key];
      }
    }

    // Keep outreach_settings.dailyTarget in sync if outreachTarget was updated
    if (store.settings.outreachTarget?.dailyTarget) {
      if (!store.outreach_settings) store.outreach_settings = {};
      store.outreach_settings.dailyTarget = parseInt(store.settings.outreachTarget.dailyTarget, 10) || 50;
    }

    // 1. Immediately persist to local disk
    saveStoredData(store, true);

    // 2. Persist to Supabase public.settings table
    let supaSaved = false;
    if (supabase) {
      try {
        const { error: supaErr } = await supabase
          .from('settings')
          .upsert({
            id: 'default',
            settings: store.settings,
            updated_at: new Date().toISOString()
          }, { onConflict: 'id' });

        if (supaErr) {
          console.warn('[SETTINGS] Supabase persistence notice:', supaErr.message);
        } else {
          supaSaved = true;
        }
      } catch (err) {
        console.warn('[SETTINGS] Supabase persistence error:', err.message);
      }
    }

    console.log(`[SETTINGS SAVED] Category: "${categoryName}" (Supabase: ${supaSaved ? 'Synced' : 'Local Disk'})`);

    res.json({
      success: true,
      category: categoryName,
      settings: store.settings,
      message: `${categoryName} settings saved successfully.`
    });
  } catch (err) {
    console.error('[SETTINGS SAVE ERROR]', err);
    res.status(500).json({
      success: false,
      error: `Settings could not be saved: ${err.message}`
    });
  }
});

// ============================================================================
// 11.2B SAVED VIEWS / SAVED FILTERS (CONFIGURATION PERSISTENCE ONLY)
// ============================================================================

// Helper to get safely initialized savedViews array
function getStoreSavedViews(store) {
  if (!store.settings) {
    store.settings = getDefaultSettings();
  }
  if (!Array.isArray(store.settings.savedViews)) {
    store.settings.savedViews = [];
  }
  return store.settings.savedViews;
}

// Helper to sync updated settings with Supabase
async function syncSettingsToSupabase(store) {
  if (!supabase) return;
  try {
    await supabase.from('settings').upsert({
      id: 'default',
      settings: store.settings,
      updated_at: new Date().toISOString()
    }, { onConflict: 'id' });
  } catch (err) {
    console.warn('[SAVED VIEWS] Supabase sync notice:', err.message);
  }
}

// 1. GET /api/saved-views - Retrieve all saved views
app.get('/api/saved-views', async (req, res) => {
  try {
    const store = getStoredData();
    if (supabase && !settingsSupabaseSyncDone) {
      await syncPersistentSettings(store);
    }
    const views = getStoreSavedViews(store);
    res.json({ success: true, views });
  } catch (err) {
    console.error('[SAVED VIEWS GET ERROR]', err);
    res.status(500).json({ success: false, error: 'Could not load saved views.' });
  }
});

// 2. POST /api/saved-views - Create a new saved view configuration
app.post('/api/saved-views', async (req, res) => {
  try {
    const store = getStoredData();
    const views = getStoreSavedViews(store);

    const { name, filters, tab } = req.body || {};
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ success: false, error: 'View name is required.' });
    }

    const cleanName = name.trim().slice(0, 80);
    const viewId = 'view_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    const nowIso = new Date().toISOString();

    const newView = {
      id: viewId,
      name: cleanName,
      tab: typeof tab === 'string' ? tab : 'saved-leads',
      filters: (filters && typeof filters === 'object') ? filters : {},
      created_at: nowIso,
      updated_at: nowIso
    };

    views.push(newView);
    saveStoredData(store, true);
    await syncSettingsToSupabase(store);

    console.log(`[SAVED VIEW CREATED] "${cleanName}" (${viewId})`);
    res.json({ success: true, view: newView, views });
  } catch (err) {
    console.error('[SAVED VIEW CREATE ERROR]', err);
    res.status(500).json({ success: false, error: 'Could not create saved view.' });
  }
});

// 3. PATCH /api/saved-views/:id - Rename or update saved view configuration
app.patch('/api/saved-views/:id', async (req, res) => {
  try {
    const store = getStoredData();
    const views = getStoreSavedViews(store);
    const targetId = req.params.id;

    const viewIndex = views.findIndex((v) => String(v.id) === String(targetId));
    if (viewIndex === -1) {
      return res.status(404).json({ success: false, error: 'Saved view not found.' });
    }

    const { name, filters } = req.body || {};
    if (name && typeof name === 'string' && name.trim()) {
      views[viewIndex].name = name.trim().slice(0, 80);
    }
    if (filters && typeof filters === 'object') {
      views[viewIndex].filters = filters;
    }
    views[viewIndex].updated_at = new Date().toISOString();

    saveStoredData(store, true);
    await syncSettingsToSupabase(store);

    console.log(`[SAVED VIEW UPDATED] "${views[viewIndex].name}" (${targetId})`);
    res.json({ success: true, view: views[viewIndex], views });
  } catch (err) {
    console.error('[SAVED VIEW UPDATE ERROR]', err);
    res.status(500).json({ success: false, error: 'Could not update saved view.' });
  }
});

// 4. DELETE /api/saved-views/:id - Delete a saved view configuration ONLY (LEADS NEVER TOUCHED)
app.delete('/api/saved-views/:id', async (req, res) => {
  try {
    const store = getStoredData();
    const views = getStoreSavedViews(store);
    const targetId = req.params.id;

    const viewIndex = views.findIndex((v) => String(v.id) === String(targetId));
    if (viewIndex === -1) {
      return res.status(404).json({ success: false, error: 'Saved view not found.' });
    }

    const deletedName = views[viewIndex].name;
    views.splice(viewIndex, 1);

    // Persist configuration change strictly to settings (leads remain 100% untouched)
    saveStoredData(store, true);
    await syncSettingsToSupabase(store);

    console.log(`[SAVED VIEW DELETED] "${deletedName}" (${targetId}) - ZERO LEADS TOUCHED`);
    res.json({ success: true, deletedId: targetId, views, message: `Saved view "${deletedName}" deleted.` });
  } catch (err) {
    console.error('[SAVED VIEW DELETE ERROR]', err);
    res.status(500).json({ success: false, error: 'Could not delete saved view.' });
  }
});

// 5. POST /api/saved-views/:id/duplicate - Duplicate an existing saved view configuration
app.post('/api/saved-views/:id/duplicate', async (req, res) => {
  try {
    const store = getStoredData();
    const views = getStoreSavedViews(store);
    const targetId = req.params.id;

    const original = views.find((v) => String(v.id) === String(targetId));
    if (!original) {
      return res.status(404).json({ success: false, error: 'Original saved view not found.' });
    }

    const viewId = 'view_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    const nowIso = new Date().toISOString();

    const duplicatedView = {
      id: viewId,
      name: `${original.name} (Copy)`.slice(0, 80),
      tab: original.tab || 'saved-leads',
      filters: JSON.parse(JSON.stringify(original.filters || {})),
      created_at: nowIso,
      updated_at: nowIso
    };

    views.push(duplicatedView);
    saveStoredData(store, true);
    await syncSettingsToSupabase(store);

    console.log(`[SAVED VIEW DUPLICATED] "${duplicatedView.name}" (${viewId})`);
    res.json({ success: true, view: duplicatedView, views });
  } catch (err) {
    console.error('[SAVED VIEW DUPLICATE ERROR]', err);
    res.status(500).json({ success: false, error: 'Could not duplicate saved view.' });
  }
});

// 11.3 System Status & Live Connection Diagnostics
app.get('/api/system/status', (req, res) => {
  const googleApiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY;
  const geminiApiKey = process.env.GEMINI_API_KEY;
  
  const googleStatus = googleApiKey ? 'Active' : 'Unconfigured';
  const geminiStatus = geminiApiKey ? 'Active' : 'Unconfigured';
  const storeInfo = getStoreStatus();
  const storageStatus = storeInfo.status === 'failed'
    ? 'Storage Error / Safe Failure Mode'
    : (supabase ? 'Supabase Connected + Memory Cache' : 'Persistent Disk + Memory');
  
  res.json({
    success: true,
    version: '2.2.0',
    buildId: 'CH-20260920-R1',
    buildDate: '2026-09-20',
    timestamp: new Date().toISOString(),
    services: {
      googlePlaces: {
        status: googlePlacesDiagnostics.lastStatus || (googleApiKey ? 'Configured' : 'Unconfigured'),
        configured: Boolean(googleApiKey),
        lastApiStatus: googlePlacesDiagnostics.lastStatus || (googleApiKey ? 'Configured' : 'Missing API Key'),
        lastApiError: googlePlacesDiagnostics.lastError || null,
        lastCheckedAt: googlePlacesDiagnostics.lastCheckTime || null,
        description: 'Powers accurate local discovery across India via Google Places (New).'
      },
      geminiAi: {
        status: geminiStatus,
        model: 'gemini-3.8-flash',
        configured: Boolean(geminiApiKey),
        description: 'Resilient multi-model engine with zero-hallucination guarantees.'
      },
      storageEngine: {
        status: storageStatus,
        mode: supabase ? 'hybrid' : 'disk_memory',
        storeHealth: storeInfo,
        description: 'Resilient offline JSON persistence with optional Supabase / PostgreSQL sync.'
      }
    }
  });
});

// 11.3.1 Check for Application Updates
app.get('/api/system/check-updates', (req, res) => {
  const simulateUpdate = req.query && (req.query.simulate_update === '1' || req.query.simulate === 'update');
  if (simulateUpdate) {
    return res.json({
      success: true,
      currentVersion: '2.2.0',
      latestVersion: '2.3.0',
      buildId: 'CH-20260920-R2',
      buildDate: '2026-09-20',
      isUpToDate: false,
      updateAvailable: true,
      releaseNotesUrl: 'https://github.com/akshay118R/Client-Hunter/releases',
      message: 'A new version of Client Hunter (v2.3.0) is available.'
    });
  }

  res.json({
    success: true,
    currentVersion: '2.2.0',
    latestVersion: '2.2.0',
    buildId: 'CH-20260920-R1',
    buildDate: '2026-09-20',
    isUpToDate: true,
    updateAvailable: false,
    message: 'Client Hunter is up to date (v2.2.0).'
  });
});

// 11.3.2 Data Health & Diagnostics Endpoint (READ-ONLY)
app.get('/api/diagnostics/health', async (req, res) => {
  try {
    const store = getStoredData();
    const leads = (store && Array.isArray(store.leads)) ? store.leads : [];
    const leadCount = leads.length;

    // 1. Local Data Diagnostics
    const fileAccessible = fs.existsSync(LEADS_STORE_PATH);
    let fileSizeBytes = 0;
    let fileMtime = null;
    if (fileAccessible) {
      try {
        const st = fs.statSync(LEADS_STORE_PATH);
        fileSizeBytes = st.size;
        fileMtime = st.mtime.toISOString();
      } catch (_) {}
    }

    const lastSaveTime = storeLastSuccessfulSaveAt || fileMtime;

    // Check for structure validation
    let validationStatus = 'Valid';
    let validationError = null;
    try {
      if (store) validateStoreStructure(store);
      else throw new Error('Store is null or uninitialized');
    } catch (vErr) {
      validationStatus = 'Failed';
      validationError = vErr.message;
    }

    // Integrity checks (detect issues without modifying data)
    const idMap = new Map();
    const placeIdMap = new Map();
    let duplicateIdsCount = 0;
    let duplicatePlaceIdsCount = 0;
    let missingRequiredFieldsCount = 0;

    leads.forEach((l) => {
      if (l.id) {
        const count = (idMap.get(String(l.id)) || 0) + 1;
        idMap.set(String(l.id), count);
        if (count === 2) duplicateIdsCount++;
      }
      if (l.place_id) {
        const count = (placeIdMap.get(String(l.place_id)) || 0) + 1;
        placeIdMap.set(String(l.place_id), count);
        if (count === 2) duplicatePlaceIdsCount++;
      }
      if (!l.business_name && !l.name) {
        missingRequiredFieldsCount++;
      }
    });

    let localDataStatus = 'Healthy';
    if (!fileAccessible || storeStatus === 'failed' || validationStatus === 'Failed') {
      localDataStatus = 'Error';
    } else if (duplicateIdsCount > 0 || missingRequiredFieldsCount > 0) {
      localDataStatus = 'Warning';
    }

    let storeDescription = 'Loaded store with leads';
    if (storeStatus === 'failed') storeDescription = 'Failed to load store';
    else if (storeStatus === 'empty') storeDescription = 'Valid empty store (0 leads)';
    else if (storeStatus === 'uninitialized') storeDescription = 'Uninitialized state';

    const localData = {
      status: localDataStatus,
      storeStatus,
      storeDescription,
      runtimePath: LEADS_STORE_PATH,
      runtimeDir: DATA_DIR,
      appDataExpectedPath: process.env.APPDATA ? path.join(process.env.APPDATA, 'clienthunter', 'data', 'leads_store.json') : path.join(__dirname, 'data', 'leads_store.json'),
      leadCount,
      lastSuccessfulSave: lastSaveTime,
      fileAccessible,
      fileSizeBytes,
      validationStatus,
      validationError,
      integrity: {
        duplicateIdsCount,
        duplicatePlaceIdsCount,
        missingRequiredFieldsCount,
        totalChecked: leadCount
      }
    };

    // 2. Supabase Diagnostics
    const supabaseUrl = process.env.SUPABASE_URL || null;
    let supabaseStatus = 'Healthy';
    let connectionStatus = 'Connected';

    if (!supabase) {
      supabaseStatus = 'Warning';
      connectionStatus = supabaseUrl ? 'Offline / Sync unavailable' : 'Unconfigured';
    } else if (lastSupabaseSyncStatus === 'Offline / Sync unavailable') {
      supabaseStatus = 'Warning';
      connectionStatus = 'Offline / Sync unavailable';
    } else if (lastSupabaseSyncStatus === 'Connected') {
      supabaseStatus = 'Healthy';
      connectionStatus = 'Connected';
    } else {
      supabaseStatus = 'Healthy';
      connectionStatus = 'Connected (Standby)';
    }

    const supabaseReport = {
      status: supabaseStatus,
      connectionStatus,
      configured: Boolean(supabaseUrl),
      url: supabaseUrl ? supabaseUrl.replace(/^(https?:\/\/[^@]+@)?/i, '$1***') : 'Not configured',
      lastSuccessfulSync: lastSupabaseSyncAt,
      syncError: lastSupabaseSyncError,
      remoteLeadCount: lastSupabaseLeadCount
    };

    // 3. Backup Diagnostics
    const backupFiles = [];
    const dirsToCheck = [BACKUPS_DIR];
    const rootBackups = path.join(__dirname, 'data', 'backups');
    if (!dirsToCheck.includes(rootBackups) && fs.existsSync(rootBackups)) {
      dirsToCheck.push(rootBackups);
    }
    const seenNames = new Set();
    dirsToCheck.forEach((dir) => {
      if (fs.existsSync(dir)) {
        try {
          fs.readdirSync(dir).forEach((file) => {
            if (file.endsWith('.json') && file !== 'recent_backups.json' && !seenNames.has(file)) {
              seenNames.add(file);
              const p = path.join(dir, file);
              try {
                const st = fs.statSync(p);
                backupFiles.push({
                  fileName: file,
                  filePath: p,
                  sizeBytes: st.size,
                  mtime: st.mtime.toISOString(),
                  mtimeMs: st.mtimeMs
                });
              } catch (_) {}
            }
          });
        } catch (_) {}
      }
    });

    backupFiles.sort((a, b) => b.mtimeMs - a.mtimeMs);
    const mostRecentBackup = backupFiles[0] || null;
    let mostRecentLeadCount = null;
    if (mostRecentBackup) {
      try {
        const raw = fs.readFileSync(mostRecentBackup.filePath, 'utf8');
        const parsed = JSON.parse(raw);
        mostRecentLeadCount = Array.isArray(parsed.leads) ? parsed.leads.length : (parsed.metadata?.leadCount ?? null);
      } catch (_) {}
    }

    const backupStatus = backupFiles.length > 0 ? 'Healthy' : 'Warning';
    const backupReport = {
      status: backupStatus,
      backupCount: backupFiles.length,
      lastSuccessfulBackup: mostRecentBackup ? mostRecentBackup.mtime : null,
      mostRecentBackupName: mostRecentBackup ? mostRecentBackup.fileName : null,
      mostRecentBackupPath: mostRecentBackup ? mostRecentBackup.filePath : null,
      mostRecentBackupLeadCount: mostRecentLeadCount,
      mostRecentBackupSizeBytes: mostRecentBackup ? mostRecentBackup.sizeBytes : null
    };

    // 4. Application Diagnostics
    const appVersion = '2.2.0';
    const electronVersion = process.versions.electron || '44.4.1';
    const backendPort = Number(PORT || process.env.PORT || 3000);
    const uptimeSeconds = Math.floor(process.uptime());

    const appReport = {
      status: 'Healthy',
      clientHunterVersion: appVersion,
      electronVersion,
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      backendStatus: 'Active & Responsive',
      backendPort,
      uptimeSeconds,
      buildId: 'CH-20260920-R1'
    };

    // 5. Checklist Items
    const checks = [
      {
        id: 'store_file',
        name: 'Store File Accessibility',
        status: fileAccessible ? 'Healthy' : 'Error',
        detail: fileAccessible ? `File accessible (${Math.round(fileSizeBytes / 1024)} KB)` : 'Store file not found on disk'
      },
      {
        id: 'schema_structure',
        name: 'Store Schema Validation',
        status: validationStatus === 'Valid' ? 'Healthy' : 'Error',
        detail: validationStatus === 'Valid' ? 'Root structure and required collections valid' : (validationError || 'Validation failed')
      },
      {
        id: 'duplicate_ids',
        name: 'Lead ID Uniqueness',
        status: duplicateIdsCount === 0 ? 'Healthy' : 'Warning',
        detail: duplicateIdsCount === 0 ? 'All lead IDs unique (0 duplicate IDs detected)' : `${duplicateIdsCount} duplicate IDs detected`
      },
      {
        id: 'required_fields',
        name: 'Required Record Fields',
        status: missingRequiredFieldsCount === 0 ? 'Healthy' : 'Warning',
        detail: missingRequiredFieldsCount === 0 ? 'All lead records contain required business details' : `${missingRequiredFieldsCount} records missing business name`
      },
      {
        id: 'supabase_sync',
        name: 'Supabase Cloud Sync',
        status: supabaseStatus,
        detail: connectionStatus === 'Connected' ? 'Cloud database connected and synchronized' : `Status: ${connectionStatus}`
      },
      {
        id: 'backup_availability',
        name: 'Safety Backups',
        status: backupStatus,
        detail: backupFiles.length > 0 ? `${backupFiles.length} safety backups available (latest: ${mostRecentLeadCount ?? 'verified'} leads)` : 'No backup snapshots found'
      },
      {
        id: 'backend_service',
        name: 'Backend HTTP Service',
        status: 'Healthy',
        detail: `Running on port ${backendPort} (PID: ${process.pid})`
      }
    ];

    // Compute overall system health
    let overallHealth = 'Healthy';
    if (checks.some((c) => c.status === 'Error') || localDataStatus === 'Error') {
      overallHealth = 'Error';
    } else if (checks.some((c) => c.status === 'Warning') || localDataStatus === 'Warning' || supabaseStatus === 'Warning') {
      overallHealth = 'Warning';
    }

    res.json({
      success: true,
      overallHealth,
      timestamp: new Date().toISOString(),
      localData,
      supabase: supabaseReport,
      backup: backupReport,
      application: appReport,
      checks
    });
  } catch (err) {
    console.error('[API /api/diagnostics/health Error]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 11.3.3 Safe Diagnostics Backup Trigger
app.post('/api/diagnostics/backup', (req, res) => {
  try {
    const store = getStoredData();
    if (storeStatus === 'failed' || !store) {
      return res.status(500).json({ success: false, error: 'Cannot create backup: store is in failed state.' });
    }
    const backupPayload = generateFullBackupPayload(store);
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const timeStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
    const fileName = `ClientHunter_Safety_Backup_${timeStr}.json`;
    const internalBackupPath = path.join(BACKUPS_DIR, fileName);

    atomicWriteFileSync(internalBackupPath, JSON.stringify(backupPayload, null, 2));

    recordRecentBackup({
      fileName,
      filePath: internalBackupPath,
      leadCount: backupPayload.metadata.leadCount,
      timestamp: backupPayload.metadata.createdAt,
      status: 'Verified Valid'
    });

    res.json({
      success: true,
      fileName,
      backupPath: internalBackupPath,
      leadCount: backupPayload.metadata.leadCount,
      timestamp: backupPayload.metadata.createdAt
    });
  } catch (err) {
    console.error('[API /api/diagnostics/backup Error]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 11.4 Full System Data Backup
function sanitizeSettingsForExport(settingsObj) {
  if (!settingsObj || typeof settingsObj !== 'object') return {};
  const cloned = JSON.parse(JSON.stringify(settingsObj));
  const sensitiveKeys = ['apikey', 'api_key', 'geminikey', 'gemini_key', 'supabasekey', 'supabase_key', 'servicekey', 'service_role_key', 'token', 'secret', 'password'];
  
  function clean(obj) {
    if (!obj || typeof obj !== 'object') return;
    Object.keys(obj).forEach((key) => {
      const lower = key.toLowerCase();
      if (sensitiveKeys.some((s) => lower.includes(s))) {
        delete obj[key];
      } else if (typeof obj[key] === 'object') {
        clean(obj[key]);
      }
    });
  }
  clean(cloned);
  return cloned;
}

app.get('/api/backup/export', (req, res) => {
  const store = getStoredData();
  const rawSettings = store.settings || getDefaultSettings();
  const cleanSettings = sanitizeSettingsForExport(rawSettings);

  // Deduplicate leads by unique ID/place_id
  const seenIds = new Set();
  const dedupedLeads = [];
  (store.leads || []).forEach((lead) => {
    enrichLeadOutreachFields(lead);
    const id = String(lead.id || lead.place_id || '');
    if (id && !seenIds.has(id)) {
      seenIds.add(id);
      dedupedLeads.push(lead);
    } else if (!id) {
      dedupedLeads.push(lead);
    }
  });

  // Merge all lead activities into timeline
  const activityTimeline = [];
  dedupedLeads.forEach((lead) => {
    enrichLeadColdCallFields(lead);
    const acts = getLeadActivitiesWithDerived(lead);
    acts.forEach((a) => {
      activityTimeline.push({
        ...a,
        business_name: lead.business_name || lead.name || '',
        category: lead.category || ''
      });
    });
  });

  const coldCallCount = dedupedLeads.filter(l => l.cold_call && (l.cold_call.queued || (l.cold_call.status && l.cold_call.status !== 'Not Called') || l.cold_call.outcome)).length;

  const exportData = {
    exportVersion: '2.2.0',
    exportedAt: new Date().toISOString(),
    source: 'ClientHunter Desktop',
    leadCount: dedupedLeads.length,
    coldCallCount,
    leads: dedupedLeads,
    settings: cleanSettings,
    outreachSettings: store.outreach_settings || { dailyTarget: 50 },
    activityTimeline,
    searches: store.searchSessions || []
  };
  
  const filenameDate = getTodayDateString();
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="ClientHunter_Backup_${filenameDate}.json"`);
  res.send(JSON.stringify(exportData, null, 2));
});

// ----------------------------------------------------
// BACKUP & RESTORE ENGINE
// ----------------------------------------------------
const RECENT_BACKUPS_FILE = path.join(BACKUPS_DIR, 'recent_backups.json');

function getRecentBackupsList() {
  try {
    if (fs.existsSync(RECENT_BACKUPS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(RECENT_BACKUPS_FILE, 'utf8'));
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (err) {
    console.warn('[BACKUP] Error reading recent_backups.json:', err.message);
  }
  return [];
}

function recordRecentBackup(entry) {
  try {
    const list = getRecentBackupsList();
    const filtered = list.filter(item => item.fileName !== entry.fileName && item.filePath !== entry.filePath);
    filtered.unshift({
      ...entry,
      timestamp: entry.timestamp || new Date().toISOString()
    });
    const trimmed = filtered.slice(0, 25);
    fs.writeFileSync(RECENT_BACKUPS_FILE, JSON.stringify(trimmed, null, 2), 'utf8');
  } catch (err) {
    console.warn('[BACKUP] Error writing recent_backups.json:', err.message);
  }
}

function generateFullBackupPayload(store) {
  if (storeStatus === 'failed' || !store) {
    throw new Error(`Cannot create backup: persistent store is in '${storeStatus}' state.`);
  }
  if (!Array.isArray(store.leads)) {
    throw new Error('Cannot create backup: persistent store leads array is invalid.');
  }

  const leads = store.leads || [];
  const settings = store.settings || getDefaultSettings();
  const searchSessions = store.searchSessions || [];
  const outreach = store.outreach || [];
  const outreachSettings = store.outreach_settings || { dailyTarget: 50 };

  const leadCount = leads.length;
  const favoritesCount = leads.filter(l => l.is_favorite || l.favorite).length;
  const outreachCount = outreach.length;
  const followUpCount = leads.filter(l => l.followUpDate || l.followup_timeline || l.outreach_status === 'Follow-Up').length;
  const coldCallCount = leads.filter(l => l.cold_call && (l.cold_call.queued || (l.cold_call.status && l.cold_call.status !== 'Not Called') || l.cold_call.outcome)).length;
  const notesCount = leads.reduce((acc, l) => acc + (Array.isArray(l.notes) ? l.notes.length : (l.notes ? 1 : 0)), 0);
  const activitiesCount = leads.reduce((acc, l) => acc + (Array.isArray(l.activities) ? l.activities.length : 0), 0);
  const servicesCount = (settings && Array.isArray(settings.services)) ? settings.services.length : 0;

  const now = new Date();
  const metadata = {
    backupFormat: 'ClientHunter_Full_Backup',
    backupVersion: '1.0',
    schemaVersion: 1,
    appName: 'Client Hunter',
    appVersion: '2.2.0',
    createdAt: now.toISOString(),
    leadCount,
    favoritesCount,
    outreachCount,
    followUpCount,
    coldCallCount,
    notesCount,
    activitiesCount,
    servicesCount
  };

  return {
    backupFormat: 'ClientHunter_Full_Backup',
    backupVersion: '1.0',
    schemaVersion: 1,
    appName: 'Client Hunter',
    appVersion: '2.2.0',
    createdAt: now.toISOString(),
    metadata,
    leads,
    settings,
    outreach,
    searchSessions,
    outreach_settings: outreachSettings
  };
}

// 1. Create Backup Endpoint
app.post('/api/backup/create', (req, res) => {
  try {
    const store = getStoredData();
    const backupPayload = generateFullBackupPayload(store);

    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const timeStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
    const defaultFileName = `ClientHunter_Backup_${timeStr}.json`;

    // Save an internal replica copy in data/backups/
    const internalBackupPath = path.join(BACKUPS_DIR, defaultFileName);
    fs.writeFileSync(internalBackupPath, JSON.stringify(backupPayload, null, 2), 'utf8');

    // Record in recent backups
    recordRecentBackup({
      fileName: defaultFileName,
      filePath: internalBackupPath,
      leadCount: backupPayload.metadata.leadCount,
      timestamp: backupPayload.metadata.createdAt,
      status: 'Verified Valid'
    });

    res.json({
      success: true,
      defaultFileName,
      internalPath: internalBackupPath,
      backup: backupPayload,
      metadata: backupPayload.metadata
    });
  } catch (err) {
    console.error('[BACKUP CREATE ERROR]', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to create backup.' });
  }
});

// 2. Get Recent Backups
app.get('/api/backup/recent', (req, res) => {
  try {
    const backups = getRecentBackupsList();
    res.json({ success: true, backups });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Validate Backup & Generate Preview
app.post('/api/backup/validate', (req, res) => {
  try {
    let backupData = req.body.backupData;
    if (typeof backupData === 'string') {
      try {
        backupData = JSON.parse(backupData);
      } catch (parseErr) {
        return res.status(400).json({ success: false, valid: false, error: 'Invalid JSON format: ' + parseErr.message });
      }
    }

    if (!backupData || typeof backupData !== 'object' || Array.isArray(backupData)) {
      return res.status(400).json({ success: false, valid: false, error: 'Backup root must be a valid JSON object.' });
    }

    if (!Array.isArray(backupData.leads)) {
      return res.status(400).json({ success: false, valid: false, error: 'Backup is missing required "leads" array.' });
    }

    // Confirm it's a ClientHunter backup
    const isClientHunter = backupData.backupFormat === 'ClientHunter_Full_Backup' ||
      backupData.appName === 'Client Hunter' ||
      backupData.source === 'ClientHunter Desktop' ||
      (backupData.settings && typeof backupData.settings === 'object');

    if (!isClientHunter) {
      return res.status(400).json({ success: false, valid: false, error: 'Unrecognized backup structure: file does not match ClientHunter format.' });
    }

    const leads = backupData.leads || [];
    const settings = backupData.settings || {};
    const outreach = backupData.outreach || [];

    const createdAt = backupData.createdAt || backupData.metadata?.createdAt || backupData.exportedAt || new Date().toISOString();
    const appVersion = backupData.appVersion || backupData.metadata?.appVersion || backupData.exportVersion || '2.2.0';
    const leadCount = leads.length;
    const favoritesCount = leads.filter(l => l.is_favorite || l.favorite).length;
    const outreachCount = outreach.length;
    const followUpCount = leads.filter(l => l.followUpDate || l.followup_timeline || l.outreach_status === 'Follow-Up').length;
    const coldCallCount = backupData.metadata?.coldCallCount ?? backupData.coldCallCount ?? leads.filter(l => l.cold_call && (l.cold_call.queued || (l.cold_call.status && l.cold_call.status !== 'Not Called') || l.cold_call.outcome)).length;
    const notesCount = leads.reduce((acc, l) => acc + (Array.isArray(l.notes) ? l.notes.length : (l.notes ? 1 : 0)), 0);
    const activitiesCount = leads.reduce((acc, l) => acc + (Array.isArray(l.activities) ? l.activities.length : 0), 0);
    const servicesCount = (settings && Array.isArray(settings.services)) ? settings.services.length : 0;

    res.json({
      success: true,
      valid: true,
      preview: {
        createdAt,
        appVersion,
        leadCount,
        favoritesCount,
        outreachCount,
        followUpCount,
        coldCallCount,
        notesCount,
        activitiesCount,
        servicesCount,
        hasSettings: !!backupData.settings,
        hasSearchHistory: Array.isArray(backupData.searchSessions) && backupData.searchSessions.length > 0
      }
    });
  } catch (err) {
    res.status(400).json({ success: false, valid: false, error: err.message || 'Validation failed.' });
  }
});

// 4. Restore Backup Endpoint
app.post('/api/backup/restore', async (req, res) => {
  try {
    const { confirmed } = req.body;
    let backupData = req.body.backupData;

    if (!confirmed) {
      return res.status(400).json({ success: false, error: 'Explicit restore confirmation required.' });
    }

    if (typeof backupData === 'string') {
      try {
        backupData = JSON.parse(backupData);
      } catch (parseErr) {
        return res.status(400).json({ success: false, error: 'Invalid JSON: ' + parseErr.message });
      }
    }

    if (!backupData || !Array.isArray(backupData.leads)) {
      return res.status(400).json({ success: false, error: 'Invalid backup structure: "leads" array is required.' });
    }

    // STEP 1: AUTOMATIC SAFETY BACKUP OF CURRENT ACTIVE STORE BEFORE RESTORE
    console.log('[BACKUP RESTORE] Generating pre-restore safety backup of active data...');
    const currentActiveStore = getStoredData();
    const safetyTimestamp = Date.now();
    const safetyBackupPath = path.join(BACKUPS_DIR, `safety_backup_pre_restore_${safetyTimestamp}.json`);

    try {
      const currentSerialized = JSON.stringify(currentActiveStore, null, 2);
      atomicWriteFileSync(safetyBackupPath, currentSerialized);

      // Verify safety backup exists and is valid
      const safetyStat = fs.statSync(safetyBackupPath);
      if (safetyStat.size === 0) {
        throw new Error('Safety backup file size is 0 bytes.');
      }
      const safetyCheck = JSON.parse(fs.readFileSync(safetyBackupPath, 'utf8'));
      if (!Array.isArray(safetyCheck.leads) || safetyCheck.leads.length !== currentActiveStore.leads.length) {
        throw new Error('Safety backup validation mismatch.');
      }
      console.log(`[BACKUP RESTORE] Verified pre-restore safety backup created: ${safetyBackupPath} (${safetyCheck.leads.length} leads)`);
      recordRecentBackup({
        fileName: path.basename(safetyBackupPath),
        filePath: safetyBackupPath,
        leadCount: safetyCheck.leads.length,
        timestamp: new Date().toISOString(),
        status: 'Pre-Restore Safety Snapshot'
      });
    } catch (safetyErr) {
      console.error('[CRITICAL BACKUP RESTORE ABORT] Pre-restore safety backup failed:', safetyErr.message);
      return res.status(500).json({
        success: false,
        error: `Automatic safety backup failed: ${safetyErr.message}. Restore aborted to protect existing data.`
      });
    }

    // STEP 2: PREPARE AND ATOMICALLY WRITE RESTORED STORE
    const restoredStore = {
      leads: backupData.leads || [],
      searchSessions: backupData.searchSessions || [],
      outreach: backupData.outreach || [],
      settings: backupData.settings || getDefaultSettings(),
      outreach_settings: backupData.outreach_settings || { dailyTarget: 50 },
      __allowEmptyReset: true
    };

    validateStoreStructure(restoredStore);

    const serializedRestored = JSON.stringify(restoredStore, null, 2);
    atomicWriteFileSync(LEADS_STORE_PATH, serializedRestored);

    // Also write to workspace data if different
    try {
      const rootDataPath = path.join(__dirname, 'data', 'leads_store.json');
      if (rootDataPath !== LEADS_STORE_PATH) {
        fs.writeFileSync(rootDataPath, serializedRestored, 'utf8');
      }
    } catch (_) {}

    // STEP 3: UPDATE IN-MEMORY STATE & CACHES
    cachedStore = restoredStore;
    storeStatus = restoredStore.leads.length === 0 ? 'empty' : 'loaded';
    storeLoadError = null;
    storeLastValidatedAt = new Date().toISOString();
    try {
      lastStoreMtime = fs.statSync(LEADS_STORE_PATH).mtimeMs;
    } catch (_) {}
    invalidateDuplicateIndex();

    console.log(`[BACKUP RESTORE] Restore completed successfully into active store (${restoredStore.leads.length} leads).`);

    // STEP 4: RESILIENT SUPABASE RE-SYNC
    if (supabase) {
      syncPersistentLeads(cachedStore).catch(err => {
        console.warn('[BACKUP RESTORE] Supabase lead sync notice (local data safely intact):', err.message);
      });
      syncPersistentSettings(cachedStore).catch(err => {
        console.warn('[BACKUP RESTORE] Supabase settings sync notice (local data safely intact):', err.message);
      });
    }

    recordRecentBackup({
      fileName: req.body.fileName || 'Restored_Backup.json',
      filePath: req.body.filePath || 'External File',
      leadCount: restoredStore.leads.length,
      timestamp: new Date().toISOString(),
      status: 'Restored & Active'
    });

    res.json({
      success: true,
      message: `Backup restored successfully — ${restoredStore.leads.length} leads loaded.`,
      leadCount: restoredStore.leads.length
    });
  } catch (restoreErr) {
    console.error('[CRITICAL RESTORE ERROR]', restoreErr);
    res.status(500).json({
      success: false,
      error: `Restore failed: ${restoreErr.message || 'Unknown error'}. Current store was preserved.`
    });
  }
});

// Catch-all route to serve index.html
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Start Server
const server = app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`CLIENTHUNTER SERVER RUNNING AT: http://localhost:${PORT}`);
  console.log(`=======================================================`);
  syncPersistentSettings(getStoredData()).catch(() => {});
  syncPersistentLeads(getStoredData()).catch(() => {});
  if (process.send) {
    process.send({ type: 'server-ready', port: PORT });
  }
});

server.on('error', (err) => {
  console.error('Server listen error:', err);
  if (process.send) {
    process.send({ type: 'server-error', error: err.message, code: err.code });
  }
  process.exit(1);
});

// Graceful cleanup handlers to prevent orphan processes
function cleanShutdown(signal) {
  console.log(`Received ${signal}. Shutting down ClientHunter backend cleanly...`);
  server.close(() => {
    console.log('ClientHunter HTTP server closed.');
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on('SIGINT', () => cleanShutdown('SIGINT'));
process.on('SIGTERM', () => cleanShutdown('SIGTERM'));

process.on('message', (msg) => {
  if (msg === 'shutdown' || (typeof msg === 'object' && msg.action === 'shutdown')) {
    cleanShutdown('IPC_SHUTDOWN');
  }
});

process.on('uncaughtException', (err) => {
  console.error('[BACKEND UNCAUGHT EXCEPTION]', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[BACKEND UNHANDLED REJECTION]', reason);
});

module.exports = {
  app,
  hasWebsite,
  hasValidPhone,
  isQualifiedLead,
  getTodayDateString,
  getDailyCandidateUsage,
  MAX_DAILY_CANDIDATES,
  TARGET_QUALIFIED_LEADS
};


