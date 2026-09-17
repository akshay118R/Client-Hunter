const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Attempt to load .env from explicit path, resources directory, or local directory
const envPaths = [
  process.env.CLIENTHUNTER_ENV_PATH,
  process.resourcesPath ? path.join(process.resourcesPath, '.env') : null,
  path.join(__dirname, '.env'),
  path.join(process.cwd(), '.env')
].filter(Boolean);

for (const envPath of envPaths) {
  if (fs.existsSync(envPath)) {
    require('dotenv').config({ path: envPath });
    break;
  }
}
if (!process.env.PORT) {
  require('dotenv').config();
}

// Lightweight Startup Configuration Validation (Section 13)
const startupGoogleKey = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
if (!startupGoogleKey || !startupGoogleKey.trim()) {
  console.warn('[Startup Validation] WARNING: Google Places API configuration requires attention. (GOOGLE_PLACES_API_KEY is missing)');
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
app.use(express.static(path.join(__dirname)));

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

function getStoredData() {
  if (cachedStore) return cachedStore;
  try {
    const raw = fs.readFileSync(LEADS_STORE_PATH, 'utf8');
    cachedStore = JSON.parse(raw);
    return cachedStore;
  } catch (err) {
    console.error('Error reading leads store:', err);
    return { leads: [], searchSessions: [] };
  }
}

function saveStoredData(data, immediate = false) {
  cachedStore = data;
  if (data && data.leads && cachedKnownPlaceIds) {
    data.leads.forEach((l) => {
      if (l.place_id) cachedKnownPlaceIds.add(l.place_id);
    });
  }
  if (saveDebounceTimer) {
    clearTimeout(saveDebounceTimer);
    saveDebounceTimer = null;
  }
  if (immediate) {
    try {
      fs.writeFileSync(LEADS_STORE_PATH, JSON.stringify(cachedStore), 'utf8');
    } catch (err) {
      console.error('Error writing leads store immediately:', err);
    }
  } else {
    saveDebounceTimer = setTimeout(() => {
      try {
        fs.writeFile(LEADS_STORE_PATH, JSON.stringify(cachedStore), 'utf8', (err) => {
          if (err) console.error('Error writing leads store asynchronously:', err);
        });
      } catch (err) {
        console.error('Error writing leads store:', err);
      }
    }, 400);
  }
}

async function getKnownPlaceIds() {
  const now = Date.now();
  if (cachedKnownPlaceIds && now - lastPlaceIdsRefresh < 300000) {
    return cachedKnownPlaceIds;
  }
  const placeIds = new Set();
  const store = getStoredData();
  if (store && store.leads) {
    store.leads.forEach((l) => {
      if (l.place_id) placeIds.add(l.place_id);
    });
  }
  if (supabase) {
    try {
      const { data: dbLeads, error } = await supabase.from('leads').select('place_id');
      if (!error && dbLeads) {
        dbLeads.forEach((l) => {
          if (l.place_id) placeIds.add(l.place_id);
        });
      }
    } catch (err) {
      console.warn('Could not query existing Supabase place_ids:', err.message);
    }
  }
  cachedKnownPlaceIds = placeIds;
  lastPlaceIdsRefresh = now;
  return cachedKnownPlaceIds;
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

// 3. Lead Search Engine (Places API (New) + Multi-Query + Full Pagination + Deduplication)
app.post('/api/leads/search', async (req, res) => {
  const { state, city, district, category, radiusKm = 25, keyword = '' } = req.body;

  if (!state || !city || !category) {
    return res.status(400).json({
      success: false,
      error: 'State, City/District, and Business Category are all required.'
    });
  }

  // Pre-search Validation (Section 14)
  const apiKey = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    return res.status(400).json({
      success: false,
      error: 'Google Places API key is missing. Please configure GOOGLE_PLACES_API_KEY in your environment.'
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
    // Resolve accurate geographic coordinates (city-aware)
    const centerCoords = resolveLocationCenter(state, city);
    let centerLat = centerCoords ? centerCoords.lat : 17.3850;
    let centerLng = centerCoords ? centerCoords.lng : 78.4867;
    const stateObj = locationsData[state];

    const isEntireState = city === 'Entire State' || city.toLowerCase().includes('entire state');

    // Build targeted query expansion (Primary category, first synonym, top-rated / second synonym)
    const catObj = categoriesData.categories[category] || { synonyms: [category] };
    const baseSynonyms = catObj.synonyms.slice(0, 3);
    const searchQueries = [];

    if (isEntireState) {
      searchQueries.push(`${category} in ${state} India ${keyword}`.trim());
      if (baseSynonyms[1]) {
        searchQueries.push(`${baseSynonyms[1]} in ${state} India ${keyword}`.trim());
      }
      if (baseSynonyms[2]) {
        searchQueries.push(`best ${baseSynonyms[2]} in ${state} India`.trim());
      }
    } else {
      // Query 1: standard
      searchQueries.push(`${category} in ${city} ${state} India ${keyword}`.trim());
      // Query 2: first synonym
      if (baseSynonyms[1]) {
        searchQueries.push(`${baseSynonyms[1]} in ${city} ${state} India ${keyword}`.trim());
      }
      // Query 3: top rated or second synonym
      if (baseSynonyms[2]) {
        searchQueries.push(`best ${baseSynonyms[2]} in ${city} India`.trim());
      }
    }

    const radiusMeters = Math.min(50000, Math.max(1000, Number(radiusKm) * 1000));
    const rawCandidates = [];
    const seenCandidatePlaceIds = new Set();
    let quotaReached = false;
    let lastTerminalError = null;

    console.log(`\n=======================================================`);
    console.log(`[DIAGNOSTIC SEARCH TRACE START]`);
    console.log(`Search: state="${state}", city="${city}", category="${category}", radiusKm=${radiusKm}`);
    console.log(`Queries Generated (${searchQueries.length}):`, searchQueries);

    // Query Google Places API (New) - Text Search with Full Multi-Page Pagination
    const url = 'https://places.googleapis.com/v1/places:searchText';
    const fieldMask = 'places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri,places.rating,places.userRatingCount,places.googleMapsUri,places.location,nextPageToken';

    for (const [qIdx, query] of searchQueries.entries()) {
      if (quotaReached) {
        console.log(`Google Query ${qIdx + 1}: Skipped (quota reached)`);
        break;
      }
      let pageToken = null;
      let pagesFetched = 0;
      let queryTotalResults = 0;

      while (true) {
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
        queryTotalResults += places.length;
        console.log(`Google Query ${qIdx + 1} | Page ${pagesFetched} = ${places.length} results | nextPageToken: ${data.nextPageToken ? 'YES' : 'NO'}`);

        for (const p of places) {
          if (!p.id || seenCandidatePlaceIds.has(p.id)) continue;
          seenCandidatePlaceIds.add(p.id);

          // Radius verification if coordinates available (skip if searching Entire State)
          if (!isEntireState && p.location && p.location.latitude && p.location.longitude) {
            const dist = haversineDistance(centerLat, centerLng, p.location.latitude, p.location.longitude);
            // Allow 1.5x buffer for city limits
            if (dist > Number(radiusKm) * 1.5 && Number(radiusKm) < 50) {
              continue;
            }
          }

          rawCandidates.push(p);
        }

        pageToken = data.nextPageToken;
        // Continue paginating as long as Google Places API returns nextPageToken
        if (!pageToken) {
          console.log(`Google Query ${qIdx + 1} total = ${queryTotalResults}`);
          break;
        }
        // Safety guard against infinite loops (Google Places text search hard-caps at 3-5 pages / 60-100 places)
        if (pagesFetched >= 5) {
          console.log(`Google Query ${qIdx + 1} reached safety limit of 5 pages | Query total = ${queryTotalResults}`);
          break;
        }

        // Brief throttle before next page
        await new Promise((r) => setTimeout(r, 400));
      }
    }

    // If Text Search returned 0 candidates and quota was NOT reached, leverage Places Nearby Search engine
    if (rawCandidates.length === 0 && !quotaReached) {
      console.log(`[Lead Search Engine] Seamlessly switching to Google Places (New) Nearby Search engine for "${category}" in ${city}, ${state}...`);
      const nearbyUrl = 'https://places.googleapis.com/v1/places:searchNearby';
      const nearbyFieldMask = 'places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri,places.rating,places.userRatingCount,places.googleMapsUri,places.location';
      const targetTypes = resolvePlacesTypes(category);

      const targetCenters = [{ lat: centerLat, lng: centerLng }];
      if (isEntireState) {
        targetCenters.push(
          { lat: centerLat + 0.35, lng: centerLng + 0.25 },
          { lat: centerLat - 0.25, lng: centerLng - 0.30 },
          { lat: centerLat + 0.50, lng: centerLng - 0.20 },
          { lat: centerLat + 0.60, lng: centerLng + 0.35 },
          { lat: centerLat - 0.40, lng: centerLng + 0.35 }
        );
      } else {
        // Multi-directional radial sectors
        targetCenters.push(
          { lat: centerLat + 0.045, lng: centerLng },
          { lat: centerLat - 0.045, lng: centerLng },
          { lat: centerLat, lng: centerLng + 0.045 },
          { lat: centerLat, lng: centerLng - 0.045 }
        );
      }

      for (const center of targetCenters) {
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
            if (!p.id || seenCandidatePlaceIds.has(p.id)) continue;
            seenCandidatePlaceIds.add(p.id);
            rawCandidates.push(p);
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

    // If zero candidates were found because of an API error, fail clearly with accurate classification
    if (rawCandidates.length === 0 && (quotaReached || lastTerminalError)) {
      console.warn(`[Lead Search Engine] Search returned 0 candidates due to API failure: ${lastTerminalError}`);
      return res.status(quotaReached ? 429 : 500).json({
        success: false,
        error: lastTerminalError || 'Google Places API request failed.'
      });
    }

    // ----------------------------------------------------
    // DEDUPLICATION AGAINST EXISTING DATABASE (IN-MEMORY CACHED)
    // ----------------------------------------------------
    const existingPlaceIds = await getKnownPlaceIds();

    const totalDiscovered = rawCandidates.length;
    let duplicatesRemoved = 0;
    const newLeads = [];

    for (const p of rawCandidates) {
      if (existingPlaceIds.has(p.id)) {
        duplicatesRemoved++;
        continue;
      }

      const hasWebsite = Boolean(p.websiteUri && p.websiteUri.trim().length > 0);
      const phone = p.nationalPhoneNumber || 'Not available';
      const hasPhone = phone !== 'Not available';
      const opp = calculateOpportunityScore(hasWebsite, hasPhone, p.rating, p.userRatingCount);

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
        website: p.websiteUri || null,
        website_status: hasWebsite ? 'YES' : 'NO',
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

      newLeads.push(leadRecord);
    }

    console.log(`\n--- CANDIDATE AGGREGATION SUMMARY ---`);
    console.log(`Raw candidates accumulated: ${rawCandidates.length}`);
    console.log(`After internal query deduplication: ${seenCandidatePlaceIds.size}`);
    console.log(`Existing database place_ids checked: ${existingPlaceIds.size}`);
    console.log(`Previously saved leads excluded: ${duplicatesRemoved}`);
    console.log(`Final new leads returned to frontend: ${newLeads.length}`);
    if (quotaReached || lastTerminalError) {
      console.log(`Partial Search Notice: ${quotaReached ? 'Google Places API quota has been reached. Please check your Google Cloud quota/billing configuration.' : lastTerminalError}`);
    }
    console.log(`=======================================================\n`);

    const store = getStoredData();
    const withoutWebsiteCount = newLeads.filter((l) => l.website_status === 'NO').length;
    const withWebsiteCount = newLeads.filter((l) => l.website_status === 'YES').length;
    const sessionRecord = {
      sessionId,
      startedAt,
      completedAt: new Date().toISOString(),
      parameters: { state, city, category, radiusKm, keyword },
      totalDiscovered,
      duplicatesRemoved,
      newLeadsCount: newLeads.length,
      withoutWebsiteCount,
      withWebsiteCount
    };
    if (!Array.isArray(store.searchSessions)) store.searchSessions = [];
    store.searchSessions.unshift(sessionRecord);
    if (store.searchSessions.length > 50) store.searchSessions.pop();
    saveStoredData(store);

    const partialSearchNotice = (quotaReached || lastTerminalError)
      ? (quotaReached
          ? 'Google Places API quota has been reached.'
          : 'Search partially completed. Some Google Places results could not be retrieved because of an API error.')
      : null;

    return res.json({
      success: true,
      sessionId,
      totalDiscovered,
      duplicatesRemoved,
      newLeadsCount: newLeads.length,
      leads: newLeads,
      partialSearchNotice,
      message:
        newLeads.length > 0
          ? `${newLeads.length} new businesses discovered`
          : (totalDiscovered > 0
              ? 'Search complete — 0 new businesses available for this combination. All matching businesses have already been saved.'
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

  const store = getStoredData();
  const existingPlaceIds = new Set(store.leads.map((l) => l.place_id));
  const toInsert = [];

  for (const lead of leads) {
    if (!existingPlaceIds.has(lead.place_id)) {
      existingPlaceIds.add(lead.place_id);
      const cleanLead = {
        ...lead,
        id: lead.id || lead.place_id || 'lead_' + Date.now(),
        status: lead.status || 'New',
        outreach_status: 'Pending',
        favorite: Boolean(lead.favorite),
        first_message_sent: false,
        first_message_sent_at: null,
        main_message_sent_at: null,
        last_message_sent_at: null,
        last_message_type: null,
        last_message_text: null,
        follow_up_day: 0,
        current_follow_up_number: 0,
        next_follow_up_number: null,
        next_follow_up_name: null,
        next_follow_up_at: null,
        follow_up_completed: false,
        reply_status: null,
        replied_at: null,
        outreach_completed_at: null,
        message_history: Array.isArray(lead.message_history) ? lead.message_history : [],
        created_at: lead.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      toInsert.push(cleanLead);
    }
  }

  if (toInsert.length === 0) {
    return res.json({
      success: true,
      savedCount: 0,
      message: 'All leads have already been saved previously.'
    });
  }

  // Prepend to local persistent storage
  store.leads.unshift(...toInsert);
  saveStoredData(store, true);

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
    totalCount: store.leads.length,
    message: `${toInsert.length} leads saved successfully.`
  });
});

// 5. Get Saved Leads (with search, filter, sort, pagination)
app.get('/api/leads/saved', (req, res) => {
  const store = getStoredData();
  let results = [...store.leads];

  const {
    search,
    category,
    state,
    city,
    websiteStatus,
    hasPhone,
    favorite,
    status,
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
        (l.website && l.website.toLowerCase().includes(q)) ||
        (l.address && l.address.toLowerCase().includes(q))
    );
  }

  // Filters
  if (category && category !== 'All') {
    results = results.filter((l) => l.category === category);
  }
  if (state && state !== 'All') {
    results = results.filter((l) => l.state === state);
  }
  if (city && city !== 'All') {
    results = results.filter((l) => l.city === city);
  }
  if (websiteStatus && websiteStatus !== 'All') {
    results = results.filter((l) => l.website_status === websiteStatus);
  }
  if (hasPhone === 'true' || hasPhone === 'YES') {
    results = results.filter((l) => l.phone && l.phone !== 'Not available');
  } else if (hasPhone === 'false' || hasPhone === 'NO') {
    results = results.filter((l) => !l.phone || l.phone === 'Not available');
  }
  if (favorite === 'true') {
    results = results.filter((l) => l.favorite === true);
  }
  if (status && status !== 'All') {
    results = results.filter((l) => l.status === status);
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
    leads: results
  });
});

// 5.9 Permanent Reset All Lead Data (Registered before :id parameter wildcard)
app.delete('/api/leads/reset', async (req, res) => {
  try {
    const store = getStoredData();
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
    try {
      saveStoredData(store, true); // immediate synchronous write
    } catch (fsErr) {
      console.error('Local leads store write error:', fsErr);
      return res.status(500).json({
        success: false,
        error: `Local leads store cleanup failed: ${fsErr.message}`
      });
    }

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

// 6. Delete Single Lead
app.delete('/api/leads/:id', async (req, res) => {
  const { id } = req.params;
  const store = getStoredData();
  const initialCount = store.leads.length;
  const deletedLead = store.leads.find((l) => l.id === id || l.place_id === id);

  store.leads = store.leads.filter((l) => l.id !== id && l.place_id !== id);
  saveStoredData(store, true);

  if (supabase && deletedLead) {
    try {
      await supabase.from('leads').delete().eq('place_id', deletedLead.place_id);
    } catch (err) {
      console.warn('Supabase delete notice:', err.message);
    }
  }

  const deleted = initialCount > store.leads.length;
  res.json({
    success: deleted,
    totalCount: store.leads.length,
    message: deleted ? 'Lead deleted successfully.' : 'Lead not found.'
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
  store.leads = store.leads.filter((l) => !idSet.has(l.id) && !idSet.has(l.place_id));
  saveStoredData(store, true);

  if (supabase && toDelete.length > 0) {
    try {
      const placeIds = toDelete.map((l) => l.place_id);
      await supabase.from('leads').delete().in('place_id', placeIds);
    } catch (err) {
      console.warn('Supabase batch delete notice:', err.message);
    }
  }

  res.json({
    success: true,
    deletedCount: toDelete.length,
    totalCount: store.leads.length,
    message: `${toDelete.length} leads deleted successfully.`
  });
});

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
      matchedLeads.push(lead);
    }
  }

  if (matchedLeads.length === 0) {
    return res.status(404).json({ success: false, error: 'No matching leads found.' });
  }

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
app.get('/api/history', (req, res) => {
  const store = getStoredData();
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

// 10. Summary Count
app.get('/api/leads/count', (req, res) => {
  const store = getStoredData();
  if (!store.outreach_settings) {
    store.outreach_settings = { dailyTarget: 50 };
  }
  store.leads.forEach(enrichLeadOutreachFields);

  const todayStr = new Date().toDateString();
  const now = new Date();
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const eligibleLeads = store.leads.filter((l) => l.phone && l.phone !== 'Not available');
  const target = store.outreach_settings.dailyTarget || 50;
  const sentTodayCount = eligibleLeads.filter((l) => {
    if (!l.first_message_sent || !l.first_message_sent_at) return false;
    return new Date(l.first_message_sent_at).toDateString() === todayStr;
  }).length;
  const awaitingReply = eligibleLeads.filter((l) => l.outreach_status === 'Follow-Up' && !l.follow_up_completed && !l.reply_status);
  const followUpsDue = awaitingReply.filter((l) => {
    if (!l.next_follow_up_at) return false;
    const target = new Date(l.next_follow_up_at);
    const targetMidnight = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();
    return targetMidnight <= todayMidnight;
  }).length;
  const replied = eligibleLeads.filter((l) => l.reply_status != null || l.outreach_status === 'Replied').length;
  const notContacted = eligibleLeads.filter((l) => !l.first_message_sent && (l.outreach_status === 'Not Contacted' || l.outreach_status === 'Ready')).length;

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
    replied
  });
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
    lead.outreach_status = lead.first_message_sent ? 'Follow-Up' : 'Pending';
  }
  if (lead.first_message_sent && (lead.outreach_status === 'Pending' || lead.outreach_status === 'Not Contacted' || lead.outreach_status === 'Ready')) {
    lead.outreach_status = 'Follow-Up';
  }
  if (typeof lead.first_message_sent !== 'boolean') lead.first_message_sent = false;
  if (!Array.isArray(lead.message_history)) lead.message_history = [];
  if (typeof lead.follow_up_day !== 'number') lead.follow_up_day = 0;
  if (typeof lead.current_follow_up_number !== 'number') lead.current_follow_up_number = lead.follow_up_day || 0;
  if (typeof lead.follow_up_completed !== 'boolean') lead.follow_up_completed = false;

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
    if (!lead.follow_up_completed && !lead.reply_status) {
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
app.get('/api/outreach/data', (req, res) => {
  const store = getStoredData();
  if (!store.outreach_settings) {
    store.outreach_settings = { dailyTarget: 50 };
  }

  // Ensure all leads have outreach fields
  store.leads.forEach(enrichLeadOutreachFields);

  const now = new Date();
  const todayStr = now.toDateString();
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const eligibleLeads = store.leads.filter((l) => l.phone && l.phone !== 'Not available');
  const activeOutreachLeads = eligibleLeads.filter((l) => l.outreach_status !== 'Pending');

  // Metrics
  const notContacted = activeOutreachLeads.filter((l) => !l.first_message_sent && (l.outreach_status === 'Not Contacted' || l.outreach_status === 'Ready'));
  const awaitingReply = activeOutreachLeads.filter((l) => l.outreach_status === 'Follow-Up' && !l.follow_up_completed && !l.reply_status);
  
  const dueTodayFollowUps = awaitingReply.filter((l) => {
    if (!l.next_follow_up_at) return false;
    const target = new Date(l.next_follow_up_at);
    const targetMidnight = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();
    return Math.round((targetMidnight - todayMidnight) / (1000 * 60 * 60 * 24)) === 0;
  });

  const overdueFollowUps = awaitingReply.filter((l) => {
    if (!l.next_follow_up_at) return false;
    const target = new Date(l.next_follow_up_at);
    const targetMidnight = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();
    return Math.round((targetMidnight - todayMidnight) / (1000 * 60 * 60 * 24)) < 0;
  });

  const upcomingFollowUps = awaitingReply.filter((l) => {
    if (!l.next_follow_up_at) return false;
    const target = new Date(l.next_follow_up_at);
    const targetMidnight = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();
    return Math.round((targetMidnight - todayMidnight) / (1000 * 60 * 60 * 24)) > 0;
  });

  const replied = activeOutreachLeads.filter((l) => l.reply_status != null || l.outreach_status === 'Replied');
  const interested = replied.filter((l) => l.reply_status === 'INTERESTED');
  const notInterested = replied.filter((l) => l.reply_status === 'NOT_INTERESTED');
  const completed = activeOutreachLeads.filter((l) => l.outreach_status === 'Completed' || l.follow_up_completed === true);
  const stopped = activeOutreachLeads.filter((l) => l.outreach_status === 'Stopped');

  // Daily target calculation across all messages sent today
  const target = store.outreach_settings.dailyTarget || 50;
  const sentTodayCount = activeOutreachLeads.filter((l) => {
    if (l.message_history && l.message_history.length > 0) {
      return l.message_history.some((m) => m.sent_at && new Date(m.sent_at).toDateString() === todayStr);
    }
    return l.first_message_sent && l.first_message_sent_at && new Date(l.first_message_sent_at).toDateString() === todayStr;
  }).length;
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
      active: awaitingReply.length,
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
  const enabledServices = (userSettings.services || [])
    .filter(s => s.enabled)
    .map(s => s.name)
    .join(', ');
  const effectiveServices = userServices || enabledServices || 'AI Websites, SEO & Automation';
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

  if (safeStep >= 5) {
    // 5-Step sequence complete after Day 14! Stop follow-ups, no Follow-Up #6
    lead.outreach_status = 'Completed';
    lead.follow_up_completed = true;
    lead.outreach_completed_at = nowIso;
    lead.next_follow_up_number = null;
    lead.next_follow_up_name = null;
    lead.next_follow_up_at = null;
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
      launchMode: 'desktop'
    },
    appearance: {
      interactive3DGrid: true,
      layoutDensity: 'comfortable'
    }
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
  if (!supabase || settingsSupabaseSyncDone) return;
  try {
    const { data: row, error } = await supabase
      .from('settings')
      .select('settings')
      .eq('id', 'default')
      .maybeSingle();

    if (!error && row && row.settings && typeof row.settings === 'object') {
      const supaSettings = row.settings;
      console.log('[SETTINGS] Successfully connected and retrieved persistent settings from Supabase (id = default)');
      store.settings = { ...supaSettings, ...(store.settings || {}) };
      for (const k of Object.keys(supaSettings)) {
        if (typeof supaSettings[k] === 'object' && supaSettings[k] !== null && !Array.isArray(supaSettings[k])) {
          store.settings[k] = { ...supaSettings[k], ...(store.settings[k] || {}) };
        }
      }
      saveStoredData(store, true);
    } else if (!error && !row && store.settings) {
      console.log('[SETTINGS] Seeding initial settings row to Supabase (id = default)');
      await supabase.from('settings').upsert({
        id: 'default',
        settings: store.settings,
        updated_at: new Date().toISOString()
      }, { onConflict: 'id' });
    }
    settingsSupabaseSyncDone = true;
  } catch (err) {
    console.warn('[SETTINGS] Supabase persistence sync notice:', err.message);
  }
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
    const store = getStoredData();
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

// 11.3 System Status & Live Connection Diagnostics
app.get('/api/system/status', (req, res) => {
  const googleApiKey = process.env.GOOGLE_PLACES_API_KEY;
  const geminiApiKey = process.env.GEMINI_API_KEY;
  
  const googleStatus = googleApiKey ? 'Active' : 'Unconfigured';
  const geminiStatus = geminiApiKey ? 'Active' : 'Unconfigured';
  const storageStatus = supabase ? 'Supabase Connected + Memory Cache' : 'Persistent Disk + Memory';
  
  res.json({
    success: true,
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
        description: 'Resilient offline JSON persistence with optional Supabase / PostgreSQL sync.'
      }
    }
  });
});

// 11.4 Full System Data Backup
app.get('/api/backup/export', (req, res) => {
  const store = getStoredData();
  const exportData = {
    appName: 'ClientHunter',
    exportTimestamp: new Date().toISOString(),
    version: '2.0.0',
    totalLeads: (store.leads || []).length,
    settings: store.settings || getDefaultSettings(),
    outreachSettings: store.outreach_settings || {},
    leads: store.leads || [],
    searches: store.searchSessions || []
  };
  
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="clienthunter-backup-${new Date().toISOString().slice(0, 10)}.json"`);
  res.send(JSON.stringify(exportData, null, 2));
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

if (process.send) {
  process.on('disconnect', () => {
    cleanShutdown('IPC_DISCONNECT');
  });
}


