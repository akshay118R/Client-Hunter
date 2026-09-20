# CLIENTHUNTER — COMPLETE APPLICATION WORKFLOW & DATA ARCHITECTURE AUDIT

> **AUDIT CLASSIFICATION:** READ-ONLY TECHNICAL AUDIT & ARCHITECTURAL SPECIFICATION  
> **APPLICATION:** Client Hunter (Version 2.1.0)  
> **RUNTIME ENVIRONMENT:** Windows x64 · Electron 44.4.1 · Node.js Express 5.2.1 · Supabase PostgreSQL  
> **AUDIT COMPLIANCE:** Zero source code changes · Zero database modifications · Zero data loss · Zero secret exposure

---

## TABLE OF CONTENTS
1. [Application Overview](#1-application-overview)
2. [Project File Structure](#2-project-file-structure)
3. [Data Architecture — Most Important](#3-data-architecture--most-important)
4. [Lead Data Model](#4-lead-data-model)
5. [Complete Lead Lifecycle](#5-complete-lead-lifecycle)
6. [Find Leads Workflow](#6-find-leads-workflow)
7. [Save Lead Workflow](#7-save-lead-workflow)
8. [Saved Leads Workflow](#8-saved-leads-workflow)
9. [Outreach Workflow](#9-outreach-workflow)
10. [Follow-Up Workflow](#10-follow-up-workflow)
11. [History / Activity System](#11-history--activity-system)
12. [Settings Subsystem](#12-settings-subsystem)
13. [My Services](#13-my-services)
14. [AI / Gemini Workflow](#14-ai--gemini-workflow)
15. [WhatsApp Workflow](#15-whatsapp-workflow)
16. [Duplicate Protection Engine](#16-duplicate-protection-engine)
17. [Delete Operations — Critical Master Table](#17-delete-operations--critical-master-table)
18. [Data-Safety & Data-Loss Risk Audit](#18-data-safety--data-loss-risk-audit)
19. [Frontend ↔ Backend End-to-End Traces](#19-frontend--backend-end-to-end-traces)
20. [Complete API Endpoints Catalog](#20-complete-api-endpoints-catalog)
21. [Supabase / Database Architecture Audit](#21-supabase--database-architecture-audit)
22. [Application Startup Sequence](#22-application-startup-sequence)
23. [Application Build & EXE Architecture](#23-application-build--exe-architecture)
24. [Update Safety & User Data Isolation](#24-update-safety--user-data-isolation)
25. [Current Feature Inventory](#25-current-feature-inventory)
26. [Complete System Dependency Map](#26-complete-system-dependency-map)
27. [Rules for Future ClientHunter Changes](#27-rules-for-future-clienthunter-changes)
28. [Final Synthesis Report (Sections A through T)](#28-final-synthesis-report)
29. [Audit Verification & Compliance Confirmation](#29-audit-verification--compliance-confirmation)

---

# 1. APPLICATION OVERVIEW

| Attribute | Specification / Discovered Architecture |
| :--- | :--- |
| **Application Name** | **Client Hunter** (`clienthunter`, internal version `2.1.0`) |
| **Application Type** | Standalone Native Desktop CRM & Autonomous Client Acquisition Terminal |
| **Frontend Technology** | Vanilla ES6+ JavaScript (`main.js`, 12,044 lines), Semantic HTML5 (`index.html`, 3,800+ lines), Custom Vanilla CSS (`styles.css`, 243 KB), FontAwesome 6 Pro icons, Google Fonts (Outfit, Inter, Space Grotesk, Plus Jakarta Sans) |
| **Backend Technology** | Node.js Express 5.2.1 REST API (`server.js`, 5,227 lines), CORS middleware, Dotenv 17.4.2 |
| **Database & Storage** | **Dual Hybrid Storage:**<br>1. Local Persistent JSON Database (`leads_store.json`) with in-memory caching and immediate/debounced disk writes.<br>2. Remote PostgreSQL Cloud Database hosted on Supabase (`@supabase/supabase-js` v2.116.0) with Row Level Security (RLS).<br>3. Browser `localStorage` strictly for client-side settings caching. |
| **Desktop Packaging** | **Electron** (v44.4.1) & **electron-builder** (v26.15.3), producing 64-bit Windows NSIS Installers (`Client Hunter-Setup.exe`) and Portable Binaries (`Client Hunter-Portable.exe`). |
| **Runtime Architecture** | Multi-process: Main Electron process (`electron/main.js`) forks Express backend as a child process (`ELECTRON_RUN_AS_NODE=1`), verifies HTTP probe readiness at `127.0.0.1:{port}/api/system/status`, and presents UI in a sandboxed, context-isolated Chromium window with a secure native preload bridge (`electron/preload.js`). |
| **External APIs & Services** | 1. **Google Places API (New)** (`https://places.googleapis.com/v1/places:searchText`) for candidate discovery.<br>2. **Google Gemini API** (`https://generativelanguage.googleapis.com/v1beta/models/gemini-*`) for pitch copywriting and objection handling.<br>3. **WhatsApp Click-to-Chat** (`whatsapp://send` protocol & `https://wa.me/` web fallback). |
| **Authentication** | Permissive single-tenant desktop authentication with Supabase Service Role and Anon policies. No login barrier is imposed on the local desktop terminal. |
| **Lead Discovery Provider** | Google Places API (New) Text Search with coordinate bias, radial boundary checks, synonym generation, multi-stage duplicate filtering, and candidate qualification rules. |

### High-Level Architectural Flow Diagram

```text
               ┌─────────────────────────────────────────────────────────────┐
               │                        DESKTOP USER                         │
               └──────────────────────────────┬──────────────────────────────┘
                                              │ Interacts via Mouse / Keyboard
                                              ▼
               ┌─────────────────────────────────────────────────────────────┐
               │                 ELECTRON DESKTOP RUNTIME                    │
               │   • BrowserWindow (Sandboxed, ContextIsolated, Cache-Free)  │
               │   • Preload Bridge (window.desktopApp: saveExportFile)       │
               │   • Native External URL Delegator (wa.me, google.com/maps)  │
               └──────────────────────────────┬──────────────────────────────┘
                                              │ HTTP Requests (localhost:PORT)
                                              ▼
               ┌─────────────────────────────────────────────────────────────┐
               │             EXPRESS REST BACKEND (server.js)                │
               │   • Search Engine (Radius, Synonyms, Sectors)                │
               │   • Candidate Qualification (No Website + Valid Phone)      │
               │   • Multi-Signal Deduplication (Place ID, Phone, Domain)    │
               │   • Outreach & 5-Step Scheduled Follow-Up State Engine      │
               │   • Deterministic Opportunity Scoring Engine                │
               │   • Ground-Truth AI Assistant Engine                        │
               └───────────────┬─────────────────────────────┬───────────────┘
                               │                             │
         Local Filesystem I/O  │                             │ Remote HTTPS API Calls
                               ▼                             ▼
  ┌────────────────────────────────────────┐  ┌──────────────────────────────────────┐
  │         PERSISTENT LOCAL DATA          │  │       EXTERNAL CLOUD SERVICES        │
  │ • leads_store.json (AppData / Local)   │  │ • Supabase PostgreSQL (leads,        │
  │   - leads: []                          │  │   settings tables)                   │
  │   - searchSessions: []                 │  │ • Google Places API (New)            │
  │   - outreach: []                       │  │ • Google Gemini AI (3.5 / 3.6 Flash) │
  │   - settings: {}                       │  │ • WhatsApp Web / Desktop Protocol   │
  │ • india_locations.json                 │  └──────────────────────────────────────┘
  │ • categories.json                      │
  └────────────────────────────────────────┘
```

---

# 2. PROJECT FILE STRUCTURE

```text
ClientHunter/
├── .env                                # Active runtime environment configuration (SECRET PRESENT — DO NOT DISPLAY)
├── .env.example                        # Template declaring PORT, GOOGLE_MAPS_API_KEY, SUPABASE_URL, GEMINI_API_KEY
├── package.json                        # NPM manifest, dependencies, and electron-builder NSIS/Portable build configs
├── package-lock.json                   # Lockfile fixing exact dependency tree
├── index.html                          # Single-page application UI structure (all 9 views, modals, templates)
├── main.js                             # Complete frontend reactive client (state, table renderers, handlers, timers)
├── server.js                           # Express backend API, Google Places search, Gemini engine, local store I/O
├── styles.css                          # Complete styling design system, CSS variables, dark theme, responsive grid
├── supabase_schema.sql                 # SQL definitions for public.leads, public.settings, indexes, and RLS policies
│
├── electron/                           # Native desktop wrapper files
│   ├── main.js                         # Process lifecycle, port conflict manager, backend spawn, window management
│   └── preload.js                      # Context-isolated bridge exposing window.desktopApp (safe file export IPC)
│
├── data/                               # Local persistent database and seed datasets
│   ├── leads_store.json                # Master local JSON database (leads, outreach links, settings, search history)
│   ├── india_locations.json            # Reference dictionary of 28 Indian States and their respective Cities
│   ├── categories.json                 # Reference dictionary of 150+ business niches, synonyms, and search keywords
│   └── backups/                        # Automatic & test backups of leads_store and Supabase data
│       ├── appdata_leads_store_backup_20260919.json
│       ├── leads_store_pre_priority_appdata_1789815622217.json
│       ├── leads_store_pre_priority_local_1789815622217.json
│       └── supabase_leads_backup_20260919.json
│
├── assets/                             # Visual media and application branding
│   ├── icon.ico                        # 256x256 Windows executable icon
│   ├── icon.png                        # Application PNG icon
│   └── logo.png                        # ClientHunter header and sidebar logo
│
├── fonts/                              # Bundled typography assets
│   └── GeistPixel-Circle.woff2         # Pixel display font
│
├── dist/                               # Output directory for electron-builder binaries (DO NOT MODIFY)
│   ├── Client Hunter-Portable.exe      # 115 MB Standalone portable executable
│   ├── Client Hunter-Setup.exe         # 116 MB NSIS installer executable
│   └── win-unpacked/                   # Unpacked portable binaries for direct execution
│
├── tests/                              # Regression & invariant validation suites (27 automated tests)
│   ├── test_outreach_delete.js         # Proves deleting from outreach leaves saved leads untouched
│   ├── test_date_organization.js       # Proves Saved Leads accordion date grouping & formatting
│   ├── test_duplicate_protection.js    # Proves multi-signal lead duplicate engine
│   ├── test_smart_followup_queue.js    # Proves 5-step follow-up scheduling and due-date logic
│   └── ... (23 other test scripts)
│
└── scratch/                            # Diagnostic verification scripts & reference screenshots
```

### Detailed File Analysis

| File / Directory | Subsystem | Purpose & Dependencies | Modifying Risk to Data |
| :--- | :--- | :--- | :--- |
| `data/leads_store.json` | Data Storage | Master local database storing all saved leads, outreach links, search sessions, and settings. | **CRITICAL RISK:** Direct manual alteration can corrupt JSON structure or wipe active leads. |
| `server.js` | Backend API | Contains all Express routes, Places API callers, Supabase sync, and duplicate detection. | **HIGH RISK:** Changes to sync logic, deduplication, or schema sanitization can cause lead loss. |
| `main.js` | Frontend Client | Drives UI rendering, date-accordion grouping, WhatsApp launch, filters, and modal dialogues. | **MEDIUM-HIGH RISK:** Altering client state mutation or delete dispatchers can trigger accidental deletes. |
| `electron/main.js` | Desktop Lifecycle | Spawns Node backend, configures `%APPDATA%` data directory, manages port binding. | **HIGH RISK:** Changing `CLIENTHUNTER_USER_DATA` can detach the app from existing user databases. |
| `package.json` | Config & Build | Defines `extraResources` (`.env`, `data`, `assets`) and electron-builder packaging rules. | **HIGH RISK:** Changing `extraResources` or directories can cause updates to overwrite user data. |
| `supabase_schema.sql` | Database Schema | Declares Supabase `public.leads` schema, unique constraints (`place_id`), and RLS policies. | **HIGH RISK:** Running `DROP` or altering column definitions can cause Supabase sync errors. |

---

# 3. DATA ARCHITECTURE — MOST IMPORTANT

ClientHunter uses a **Hybrid Dual-Store Architecture** with an **in-memory caching layer** and **optimistic client caching**:

```text
               ┌──────────────────────────────────────────────────┐
               │              CLIENTHUNTER STORAGE                │
               └───────────┬──────────────────────────┬───────────┘
                           │                          │
              PRIMARY DESKTOP STORAGE        OPTIONAL CLOUD PERSISTENCE
                           │                          │
                           ▼                          ▼
               ┌───────────────────────┐  ┌───────────────────────┐
               │   leads_store.json    │  │  Supabase PostgreSQL  │
               │  (AppData / Local)    │  │  (Remote Database)    │
               └───────────────────────┘  └───────────────────────┘
```

### Storage Locations Breakdown

| Data Entity | Primary Physical Storage | Exact Key / Table Name | Sync Mechanism | Read / Write Locations |
| :--- | :--- | :--- | :--- | :--- |
| **Real Leads (Discovered)** | Transient Backend / Frontend Memory | `AppState.pendingDiscoveredLeads` | Not persisted until user clicks "Save" | Memory only (`POST /api/leads/search`) |
| **Saved Leads** | Local JSON File + Supabase PostgreSQL | Table: `public.leads`<br>JSON: `leads_store.json` (`leads: []`) | Bidirectional startup merge & immediate push on save | Read: `/api/leads/saved`<br>Write: `/api/leads/save`<br>Delete: `/api/leads/:id` |
| **Favorites** | Stored inside Lead Record | Field: `lead.favorite = true`<br>Column: `public.leads.favorite` | Persisted within the lead record | Read: `/api/leads/saved` (filtered)<br>Write: `/api/leads/:id/favorite` |
| **Outreach Records** | Stored inside Lead Record + Link Array | Fields: `lead.outreach_status`, `first_message_sent`, etc.<br>JSON: `leads_store.json` (`outreach: []`) | Persisted directly on the lead and in relationship tracker | Read: `/api/outreach/data`<br>Write: `/api/leads/move-to-outreach`<br>Remove: `/api/outreach/remove-batch` |
| **Follow-Up Records** | Stored inside Lead Record | Fields: `next_follow_up_at`, `current_follow_up_number`, `reply_status` | Part of the lead record | Read: `/api/outreach/data`<br>Write: `/api/outreach/mark-followup-sent` |
| **History (Searches)** | Local JSON File | JSON: `leads_store.json` (`searchSessions: []`) | Appended on each completed search session | Read: `/api/history`<br>Delete: `/api/history/:id` |
| **History (Lead Activities)** | Stored inside Lead Record | Field: `lead.activities: []`<br>Column: `public.leads.activities` | Persisted within the lead record | Read: `/api/leads/:id/activities`<br>Write: `/api/leads/:id/activities` |
| **Lead Notes** | Stored inside Lead Record | Field: `lead.notes: []`<br>Column: `public.leads.notes` | Persisted within the lead record | Read: `/api/leads/:id/notes`<br>Write: `/api/leads/:id/notes` |
| **Settings** | Local JSON + Supabase + `localStorage` | JSON: `leads_store.json` (`settings: {}`)<br>Table: `public.settings` (`id = 'default'`)<br>Browser: `clienthunter_settings` | Merged on read; written to all 3 layers on update | Read: `/api/settings`<br>Write: `/api/settings` |
| **My Services** | Stored inside Settings | `store.settings.services: []` | Synchronized via Settings pipeline | UI: Settings Tab 2 (`saveCategory('services')`) |
| **Templates** | Stored inside Settings | `store.settings.templates: []` | Synchronized via Settings pipeline | UI: Settings Tab 3 (`saveSettings({ templates })`) |
| **AI Preferences** | Stored inside Settings | `store.settings.aiPreferences: {}` | Synchronized via Settings pipeline | UI: Settings Tab 5 (`saveCategory('aiPreferences')`) |
| **AI Secret Key** | `.env` File (Filesystem) | `GEMINI_API_KEY` | Read into `process.env` on startup | Startup loader (`server.js: line 440`) |
| **WhatsApp Preferences** | Stored inside Settings | `store.settings.whatsappPreferences: {}` | Synchronized via Settings pipeline | UI: Settings Tab 8 (`saveCategory('whatsappPreferences')`) |
| **Application Preferences** | Stored inside Settings | `outreachTarget`, `defaultLocation`, `appearance` | Synchronized via Settings pipeline | UI: Settings Tabs 1, 4, 6 |

### Exact Filesystem Resolution for `leads_store.json`

`server.js` resolves the storage file via an adaptive 3-tier hierarchy:
1. **Tier 1 (Packaged Desktop Execution):** If `process.env.CLIENTHUNTER_USER_DATA` is injected by Electron, it resolves to `%APPDATA%\clienthunter\data\leads_store.json`.
2. **Tier 2 (Installed Fallback):** If `process.env.APPDATA` contains `%APPDATA%\clienthunter\data\leads_store.json`, it resolves to that file.
3. **Tier 3 (Local Development):** Falls back to `__dirname/data/leads_store.json` in the project root directory.

> [!IMPORTANT]
> During startup, if `leads_store.json` does not exist in Tier 1, it copies the initial seed from `__dirname/data/leads_store.json`. If it already exists, **it never overwrites the file**. Furthermore, during any Supabase synchronization, if the active path is in `%APPDATA%`, `server.js` automatically mirrors the updated database back to the project root `data/leads_store.json` to keep both stores in sync.

---

# 4. LEAD DATA MODEL

Every lead record in ClientHunter adheres to the following unified schema:

```text
Lead Schema
├── id                              (String / UUID) Primary identifier
├── place_id                        (String) Google Places Entity Identifier (UNIQUE)
├── business_name                   (String) Business trade name
├── category                        (String) Operating commercial niche
├── state                           (String) Indian State
├── city                            (String) Operating City or District
├── district                        (String) District jurisdiction
├── address                         (String) Formatted street address
├── phone                           (String) Standardized contact number
├── email                           (String) Email address (defaults to 'Not available')
├── website                         (String) Official website URL or null
├── website_status                  (String) 'YES' or 'NO'
├── google_maps_url                 (String) Google Maps direct CID / Place URL
├── latitude                        (Number) Coordinate latitude
├── longitude                       (Number) Coordinate longitude
├── rating                          (Number) Average Google star rating (e.g. 4.8)
├── review_count                    (Integer) Total verified Google reviews
├── opportunity_score               (Integer) Deterministic conversion score (30 to 100)
├── opportunity_level               (String) 'HIGH' (>=85), 'MEDIUM' (>=65), 'LOW' (<65)
├── favorite                        (Boolean) Starred flag for Favorites tab
├── status                          (String) 'New', 'Contacted', 'SAVED', 'Replied'
├── outreach_status                 (String) 'Pending', 'Ready', 'Not Contacted', 'Follow-Up', 'Completed', 'Replied', 'Stopped'
├── first_message_sent              (Boolean) True if main outreach pitch was dispatched
├── first_message_sent_at           (ISO String) Timestamp of main pitch
├── main_message_sent_at            (ISO String) Permanent Day 0 anchor timestamp
├── last_message_sent_at            (ISO String) Timestamp of most recent dispatch
├── last_message_type               (String) 'Main Message', 'Follow-Up #1' ... 'Follow-Up #5'
├── last_message_text               (String) Copy of the most recently sent message
├── follow_up_day                   (Integer) Follow-up stage counter (0 to 5)
├── current_follow_up_number        (Integer) Current completed step (0 to 5)
├── next_follow_up_number           (Integer) Upcoming step (1 to 5) or null
├── next_follow_up_name             (String) E.g. 'Follow-Up #1 — Gentle Nudge'
├── next_follow_up_at               (ISO String) Scheduled target date for next message
├── follow_up_completed             (Boolean) True when Day 14 sequence is done
├── reply_status                    (String) 'INTERESTED', 'NOT_INTERESTED', 'OTHER' or null
├── replied_at                      (ISO String) Timestamp of client reply
├── outreach_completed_at           (ISO String) Timestamp when sequence finished
├── message_history                 (Array of Objects) Full chronological message log
├── notes                           (Array of Objects) Timestamped user notes
├── activities                      (Array of Objects) Chronological audit events
├── source                          (String) Default: 'Google Places API'
├── created_at                      (ISO String) Date lead was initially saved
├── saved_at                        (ISO String) Creation alias for UI grouping
└── updated_at                      (ISO String) Last mutation timestamp
```

### Deep Field Attribute Analysis

| Field Name | Type | Creation Point | Required? | Backward Compatibility Behavior |
| :--- | :--- | :--- | :--- | :--- |
| `place_id` | String | `search` / `save` | **YES** | Primary deduplication key. Old manual leads without it default to synthetic `lead_...`. |
| `business_name` | String | `search` / `save` | **YES** | Displayed in every table, header, and injected into AI prompts (`{businessName}`). |
| `phone` | String | `search` | NO | If absent, qualified search drops candidate. Saved leads show "Not available". |
| `website_status` | String | `search` | NO | Defaults to `'NO'`. Evaluated by Opportunity Scorer and filter chips. |
| `opportunity_score`| Integer | `server.js` | NO | Calculated via deterministic rubric (`calculateOpportunityScore`). Defaults to 50. |
| `outreach_status` | String | `save` / `move` | NO | Defaults to `'Pending'`. Missing values auto-enriched by `enrichLeadOutreachFields`. |
| `main_message_sent_at`| String | `mark-sent` | NO | Permanent anchor for Day 0. If missing on old sent leads, falls back to `first_message_sent_at`. |
| `next_follow_up_at`| String | `mark-sent` | NO | Calendar timestamp. If missing on active follow-ups, calculated automatically from Day 0. |
| `notes` | Array | `save` / notes API| NO | Backward-compatible: strings like `"note text"` auto-convert to `[{ id, text, created_at }]`. |
| `activities` | Array | `recordLeadActivity`| NO | Defaults to `[]`. Derived events auto-injected if historical activity records are missing. |
| `message_history` | Array | `mark-sent` | NO | Chronological log of dispatched WhatsApp copies. Defaults to `[]`. |

---

# 5. COMPLETE LEAD LIFECYCLE

```text
1. FIND LEADS (Discovery)
   ├── User selects State, City, Category, Radius
   ├── Google Places API (New) returns candidate pool
   ├── Multi-Signal Deduplication checks existing DB
   └── Candidate Qualifier filters: NO WEBSITE + VALID PHONE
         │
         ▼
2. PENDING DISCOVERY LIST
   ├── Results rendered in Live Discovered Leads Table
   ├── Opportunity Scores calculated (High/Medium/Low)
   └── Leads remain in transient memory until saved
         │
         ▼ (User clicks "Save Lead" or "Save All Qualified")
3. SAVED LEADS (Core Database)
   ├── Lead persisted to leads_store.json & Supabase
   ├── Indexed by Saved Date (DD Month YYYY Accordion)
   ├── outreach_status initialized to 'Pending'
   └── Full note-taking & status updates enabled
         │
         ├──► FAVORITES (User clicks Star icon)
         │    └── favorite flag = true; appears in Favorites tab
         │
         ▼ (User clicks "Move to Outreach")
4. OUTREACH TERMINAL
   ├── outreach_status transitions: 'Pending' ──► 'Not Contacted' / 'Ready'
   ├── Lead enters Outreach Queue & Ready sub-tab
   ├── Relationship entry recorded in store.outreach
   └── User opens AI Outreach Composer
         │
         ▼ (User clicks "Open WhatsApp" -> wa.me / desktop launched)
5. CONFIRMATION STEP (Safe Send Workflow)
   ├── Application presents confirmation modal:
   │    ├── [ ✕ No, Not Sent ] ──► Remains in Outreach Queue untouched
   │    ├── [ Not on WhatsApp ] ──► outreach_status = 'Stopped'; logged
   │    └── [ ✓ Yes, Message Sent ] ──► Transitions to Follow-Up
   │
   ▼
6. FOLLOW-UP ENGINE (Day 0 Anchor Established)
   ├── outreach_status = 'Follow-Up'
   ├── main_message_sent_at anchored to current timestamp
   ├── Schedule generated:
   │    ├── Step 1 (Day 2):  Follow-Up #1 — Gentle Nudge
   │    ├── Step 2 (Day 4):  Follow-Up #2 — Quick Check-in
   │    ├── Step 3 (Day 7):  Follow-Up #3 — Service Value
   │    ├── Step 4 (Day 10): Follow-Up #4 — Low-Pressure Closing
   │    └── Step 5 (Day 14): Follow-Up #5 — Final Note
   │
   ├──► PROSPECT REPLIES (User clicks "Reply")
   │    ├── Reply Modal: [ Interested ] | [ Not Interested ] | [ Other ]
   │    └── outreach_status = 'Replied'; automatic follow-ups halted
   │
   ├──► USER SNOOZES (User clicks "Snooze")
   │    └── next_follow_up_at pushed back (+1 day, +3 days, next week)
   │
   ▼ (User completes all 5 follow-up dispatches)
7. OUTREACH COMPLETED
   ├── outreach_status = 'Completed'
   ├── follow_up_completed = true
   └── Lead archived in Completed tab
```

---

# 6. FIND LEADS WORKFLOW

1. **User Action:** The user inputs Search Parameters:
   - State (e.g., Telangana)
   - City / District (e.g., Hyderabad, or "Entire State")
   - Business Category (selected from 150+ categories in `categories.json`)
   - Search Radius (5 to 100 km, default 25 km)
   - Optional Custom Keyword (e.g., "luxury", "24/7", "clinic")
   - Target Qualified Leads (default 100)
2. **Rate Limit & Deduplication Check:** Backend checks `activeSearchJobs` using fingerprint `${state}::${city}::${category}::${radiusKm}::${keyword}`. If an identical search is active, returns HTTP 429.
3. **Hard Daily Candidate Limit:** A daily ceiling of **300 candidates evaluated per day** (`MAX_DAILY_CANDIDATES = 300`) is tracked in `store.dailyCandidateTracker`. If consumed, search halts with user-friendly notification.
4. **Geographic Resolution:** Coordinates are resolved from `INDIAN_CITY_COORDS` (e.g., Hyderabad -> `17.3850, 78.4867`). If "Entire State", queries are fanned out across top 5 cities.
5. **Query Expansion:** Synonyms and sectors are generated from `categoriesData.categories[category].synonyms`.
6. **API Execution:** Calls Google Places API (New) Text Search (`https://places.googleapis.com/v1/places:searchText`) with `FieldMask`:
   `places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.internationalPhoneNumber,places.websiteUri,places.rating,places.userRatingCount,places.googleMapsUri,places.location,nextPageToken`.
7. **Deduplication:**
   - Evaluates `sessionCandidateIndex.isDuplicate(p)` (in-session deduplication).
   - Evaluates `duplicateIndex.isDuplicate(p)` against entire local store and Supabase table.
8. **Qualification Evaluation:**
   - Evaluates `isQualifiedLead(p)`: Candidate **MUST NOT have an active website (`!places.websiteUri`)** and **MUST have a valid phone number (`nationalPhoneNumber || internationalPhoneNumber`)**.
9. **Scoring:** Calculates Opportunity Score (30-100) and Level (HIGH/MEDIUM/LOW).
10. **Delivery:** Discovered leads return to client and render into the interactive discovery table without modifying the database.

---

# 7. SAVE LEAD WORKFLOW

1. **User Action:** User clicks "Save Lead" on a single row or "Save All Qualified Leads" in bulk.
2. **Payload:** Client dispatches `POST /api/leads/save` with array of lead objects.
3. **Duplicate Interception:** Backend checks each lead against `dbIndex` (`store.leads`) and `batchIndex`:
   - Checks matching Google Place ID.
   - Fallback checks: matching Phone + Business Name, or matching Domain + Business Name.
   - Any duplicate is silently skipped and added to `duplicatesSkippedList`.
4. **Lead Normalization:** Clean record is generated with initialized defaults (`outreach_status = 'Pending'`, `favorite = false`, `notes = []`, `activities = []`, `message_history = []`).
5. **Persistence (Local):** Clean records are unshifted to `store.leads` (`store.leads.unshift(...toInsert)`), and `saveStoredData(store, true)` writes immediately to `leads_store.json`.
6. **Persistence (Supabase):** If Supabase is connected, executes `supabase.from('leads').upsert(rows, { onConflict: 'place_id' })`.
7. **Separation Safeguard:** Saving a lead **never alters Outreach or Follow-Up**. Its `outreach_status` remains strictly `'Pending'`.

---

# 8. SAVED LEADS WORKFLOW

1. **Loading:** Fetched via `GET /api/leads/saved`. Client stores results in `AppState.allSavedLeads` and `AppState.savedLeads`.
2. **Date-Based Organization (Accordion):**
   - Leads are grouped by `created_at` timestamp using `getSavedDateKey(lead.created_at)` (`YYYY-MM-DD`).
   - Section headers display formatted date (`DD Month YYYY`, e.g., "18 September 2026") with total lead count badge.
   - Date banners feature expand/collapse toggle (`AppState.collapsedDateGroups`) and "Select Date" bulk checkbox.
3. **Filtering & Sorting:** Client-side multi-filtering handles text search, website status, outreach status, city, category, favorites, and WhatsApp status, with pagination (25, 50, 100 rows).
4. **Move to Outreach:** User selects leads and clicks "Move to Outreach". Backend updates `outreach_status = 'Not Contacted'` and creates entries in `store.outreach`.
5. **Deletion Mechanics (`DELETE /api/leads/:id` and `POST /api/leads/delete-batch`):**
   - **Operation:** Deletes the master record from `store.leads` and calls `supabase.from('leads').delete().in('place_id', placeIds)`.
   - **Cascade Scope:** Because `store.leads` is the master record, deleting a Saved Lead **removes it everywhere**: Saved Leads, Favorites, Outreach, Follow-Up, Notes, and Activities.
   - **Undo Protection:** Server stores deleted objects in an in-memory buffer (`storeTemporaryDeletion('saved_lead', toDelete)`) with a 25-second TTL. The frontend presents a 5-second toast with an **Undo** button. Clicking Undo triggers `POST /api/leads/undo-delete`, which restores the leads to `store.leads` and Supabase.

---

# 9. OUTREACH WORKFLOW

1. **Entry:** Leads enter Outreach exclusively when user clicks "Move to Outreach". Their `outreach_status` changes from `'Pending'` to `'Ready'` / `'Not Contacted'`.
2. **Relationship Tracking:** Stored in `store.outreach` as `{ id: 'outreach_' + id, saved_lead_id, place_id, status }`.
3. **AI Outreach Composer:**
   - User selects lead in Outreach Terminal.
   - Frontend requests `POST /api/outreach/generate-message`.
   - Gemini AI synthesizes pitch using lead data, selected Tone (8 options), Approach, CTA, and enabled services from `store.settings.services`.
   - If Gemini is offline, deterministic industry templates serve as instant fallbacks.
4. **WhatsApp Dispatcher:**
   - WhatsApp Click-to-Chat launches via `whatsapp://` desktop protocol or `https://wa.me/` web URL.
   - External launch is delegated safely to Windows default browser / desktop app via `shell.openExternal(url)`.
5. **Safe Confirmation Step:**
   - The composer switches to the Confirmation View (`composer-confirm-block`).
   - `[ ✓ Yes, Message Sent ]` (or keyboard `1`): Calls `/api/outreach/mark-sent`, establishing Day 0 and moving lead to Follow-Up.
   - `[ ✕ No, Not Sent ]` (or keyboard `2`): Retains lead in Outreach queue without state change.
   - `[ Not on WhatsApp ]` (or keyboard `3`): Marks lead as Stopped.
6. **Outreach Deletion Safeguard (CRITICAL ARCHITECTURAL FINDING):**
   - Deleting an outreach record calls `POST /api/outreach/remove-batch` or `DELETE /api/outreach/:id`.
   - **IT DOES NOT DELETE THE SAVED LEAD.**
   - Exact code path (`server.js: lines 4379-4384`):
     ```javascript
     lead.outreach_status = 'Pending';
     lead.next_follow_up_at = null;
     lead.next_follow_up_number = null;
     lead.next_follow_up_name = null;
     lead.updated_at = nowIso;
     ```
   - Tracking entry is removed from `store.outreach`, leaving the master lead **100% intact in Saved Leads and Favorites**.

---

# 10. FOLLOW-UP WORKFLOW

1. **Entry:** Occurs automatically the moment `POST /api/outreach/mark-sent` is confirmed.
2. **Scheduling Engine:** Anchored strictly to `main_message_sent_at` (Day 0).
   - **Follow-Up #1 (Day 2):** "Gentle Nudge"
   - **Follow-Up #2 (Day 4):** "Quick Check-in"
   - **Follow-Up #3 (Day 7):** "Service Value"
   - **Follow-Up #4 (Day 10):** "Low-Pressure Closing"
   - **Follow-Up #5 (Day 14):** "Final Note"
3. **Queue Classification (Calendar-Day Math):**
   - `diff < 0`: **Overdue** (red badge)
   - `diff === 0`: **Due Today** (orange badge)
   - `1 <= diff <= 3`: **Due Soon** (yellow badge)
   - `diff > 3`: **Upcoming** (gray badge)
4. **Completion:** Disagreeable or completed leads (`safeStep >= 5`) transition to `outreach_status = 'Completed'`, `follow_up_completed = true`. No Follow-Up #6 exists.
5. **Reply Handling:**
   - User clicks "Reply" on a lead card.
   - Modal allows selecting `Interested`, `Not Interested`, or `Other`.
   - Dispatches `POST /api/outreach/mark-replied`, setting `outreach_status = 'Replied'`. Automatic follow-up sequence is immediately cancelled.
6. **Backward Compatibility & Inactive Disappearance Risk:**
   - `enrichLeadOutreachFields` inspects every lead during `/api/outreach/data`.
   - If an old lead has `first_message_sent: true` but lacks `main_message_sent_at`, it auto-repairs the date to `first_message_sent_at || updated_at`.
   - If `next_follow_up_at` is missing, it reconstructs the calendar date from `main_message_sent_at + sched.dayOffset`.
   - **Audit Result:** Old leads **cannot disappear** from the follow-up queue due to schema gaps; the auto-enrichment engine guarantees backward compatibility.

---

# 11. HISTORY / ACTIVITY SYSTEM

The application maintains two independent history implementations:

```text
HISTORY SUBSYSTEMS
├── 1. SEARCH HISTORY (Global Search Audit)
│   ├── Storage: leads_store.json -> searchSessions: []
│   ├── Schema: { sessionId, timestamp, state, city, category, radiusKm, keyword, 
│   │             candidatesChecked, qualifiedLeadsCount, withoutWebsite, withWebsite }
│   ├── Endpoint: GET /api/history, DELETE /api/history/:id, DELETE /api/history
│   └── Independent: Deleting search history records does NOT affect leads.
│
└── 2. LEAD ACTIVITY TIMELINE (Per-Lead Event Audit)
    ├── Storage: Embedded inside each lead -> lead.activities: []
    ├── Schema: { activity_id, lead_id, event_type, event_title, event_description, 
    │             created_at, metadata: {} }
    ├── Event Types: lead_saved, lead_added_outreach, whatsapp_opened, message_sent,
    │                followup_due, followup_sent, followup_not_sent, lead_replied, 
    │                outreach_completed, lead_notes_updated, lead_favorited
    └── Endpoint: GET /api/leads/:id/activities, POST /api/leads/:id/activities
```

---

# 12. SETTINGS SUBSYSTEM

### Settings Structure & Defaults

Settings are structured into authoritative categories under `store.settings`:
- **`profile`**: User identity (`fullName: 'Akshay'`, `companyName: 'Nexora Labs'`, `phone`, `email`, `portfolioUrl`, `websiteUrl`, `city`, `state`, `bio`).
- **`services`**: Array of offering objects (`id`, `name`, `enabled`).
- **`templates`**: 12+ pre-configured outreach and follow-up templates.
- **`outreachTarget`**: `{ dailyTarget: 50, showProgressBar: true, enableMilestones: true }`.
- **`defaultLocation`**: `{ state: 'Telangana', city: 'Hyderabad', radiusKm: 100 }`.
- **`aiPreferences`**: Tone, length, approach, CTA, personalization, focus priority, auto vector analysis.
- **`whatsappPreferences`**: Country code, launch mode (`desktop` vs `web`), `autoTimer` (Outreach auto-timer), `followUpAutoTimer` (Follow-up auto-timer).
- **`appearance`**: `{ interactive3DGrid: true, layoutDensity: 'comfortable' }`.

### Persistence & Rebuild Protection

1. **Storage Layers:**
   - Written immediately to `leads_store.json` on local disk (`saveStoredData(store, true)`).
   - Upserted to Supabase table `public.settings` (`id = 'default'`).
   - Cached in browser `localStorage` (`clienthunter_settings`).
2. **Non-Destructive Defaults:**
   - Server uses `populateDefaultSettings(saved)`. If a key already exists in user settings, **it is never overwritten**. Defaults only populate undefined keys.
3. **Isolated Category Updates:**
   - `POST /api/settings` performs a shallow merge on the explicit submitted category key (`store.settings[key] = { ...store.settings[key], ...incoming[key] }`).
4. **Surviving EXE Rebuilds:**
   - Because user settings reside in `%APPDATA%\clienthunter\data\leads_store.json` and in Supabase, rebuilding or installing a new `.exe` does not touch or overwrite settings.

---

# 13. MY SERVICES

1. **Storage:** Stored in `store.settings.services` as an array of objects:
   ```json
   { "id": "srv-1", "name": "AI Voice Calling Agents", "enabled": true }
   ```
2. **Management:**
   - Add: User inputs service name and clicks Add (`id: 'srv-' + Date.now()`).
   - Toggle: Checkbox toggles `srv.enabled = true/false`.
   - Delete: User clicks trash icon; triggers modal confirmation, removes object from array, and saves to backend.
3. **Template & AI Message Injection:**
   - Variable tag `{my_services}` or `{{my_services}}` in message templates is automatically replaced with a formatted string of currently enabled services.
   - When calling Gemini AI (`/api/outreach/generate-message`), `server.js` extracts enabled services and passes them in the `systemInstruction` as the user's service capabilities.
4. **Historical Immutability:** Deleting or altering a service **does not alter historical messages**. Dispatched messages logged in `lead.message_history` retain the text as originally sent.

---

# 14. AI / GEMINI WORKFLOW

1. **Provider:** Google Gemini API (`generativelanguage.googleapis.com`).
2. **Model Cascading:** Attempts models in order: `models/gemini-3.5-flash-lite`, `models/gemini-3.5-flash`, `models/gemini-3.6-flash`.
3. **Credentials:** Loaded via `.env` (`GEMINI_API_KEY`).
4. **Capabilities:**
   - **Outreach Pitch Generation (`/api/outreach/generate-message`):** Injects lead business name, category, city, rating, website status, and user profile/services. Tailored across 8 tone styles.
   - **Follow-Up Message Generation (`/api/outreach/generate-followup`):** Generates stage-specific copy (Stages 1 through 5) factoring in the previous message date and text.
   - **Objection Handling (`/api/outreach/ai-reply`):** Handles objections (e.g., "too expensive", "already have someone") with 2-3 sentence conversational rebuttals.
   - **Terminal AI Assistant (`/api/ai/assistant`):** Answers user questions using factual ground-truth metrics calculated dynamically from the active store.
5. **Sanitization & Error Handling:** Outputs pass through `cleanAiMessage()` to strip markdown headers, quotation marks, and conversational preambles. If the API fails, timeouts trigger graceful fallbacks to built-in deterministic templates.

---

# 15. WHATSAPP WORKFLOW

```text
                 WHATSAPP WORKFLOW ARCHITECTURE
                               │
               ┌───────────────┴───────────────┐
               ▼                               ▼
       OUTREACH WHATSAPP               FOLLOW-UP WHATSAPP
   • autoTimer (0-10 sec)          • followUpAutoTimer (0-10 sec)
   • waAutoTimerId                 • waFuAutoTimerId
   • Modal: modal-outreach-composer• Modal: modal-followup-composer
   • Key 1: Confirm Sent           • Key 1: Confirm Sent
   • Key 2: Not Sent               • Key 2: Not Sent
   • Key 3: Not on WA              • Key 3: Not on WA
               │                               │
               └───────────────┬───────────────┘
                               ▼
                    PHONE NORMALIZATION
               cleanPhoneNumber(phone)
               • Strips non-digits
               • Prepends '91' for 10-digit Indian numbers
                               ▼
                     DISPATCH URL GENERATION
               • Desktop Mode: whatsapp://send?phone=...&text=...
               • Web Mode:     https://wa.me/.../?text=...
                               ▼
               ELECTRON NATIVE BROWSER DELEGATION
               shell.openExternal(url) in user's default browser
                               ▼
               MANDATORY USER CONFIRMATION MODAL
```

- **Outreach vs Follow-Up Separation:** Outreach and Follow-Up maintain separate timers, separate UI elements, separate interval IDs, and separate preferences in settings.
- **Automated Open Safety:** When the auto-timer expires, WhatsApp opens, but **the lead is never marked as sent automatically**. The user must explicitly confirm dispatch.

---

# 16. DUPLICATE PROTECTION ENGINE

ClientHunter implements a **Dual-Stage, Multi-Signal Deduplication Engine**:

```text
                       NEW LEAD CANDIDATE
                               │
            ┌──────────────────┴──────────────────┐
            ▼                                     ▼
   Stage 1: Session Scope                Stage 2: Database Scope
   sessionCandidateIndex                 duplicateIndex (Store + Supabase)
            │                                     │
            └──────────────────┬──────────────────┘
                               │
               ┌───────────────┴───────────────┐
               ▼                               ▼
      PRIMARY CHECK: PLACE ID         FALLBACK MULTI-SIGNAL CHECK
      • Normalize place_id            (Used if Place ID is synthetic/absent)
      • If pId1 === pId2 -> DUP       • Phone Normalization (last 10 digits)
      • If pId1 !== pId2 -> DISTINCT  • Business Name Normalization
                                      • Website Domain Normalization
                                      • Signal 2A: Same Phone + Same Name
                                      • Signal 2B: Same Domain + Same Name
                                      • Signal 2C: Same Name + Same Address
```

- **Action on Duplicate:** In Find Leads, duplicate candidates are dropped and increment `duplicatesRemoved`. In Save Leads, duplicates are omitted from insert and returned in `duplicatesSkipped`.

---

# 17. DELETE OPERATIONS — CRITICAL MASTER TABLE

| Delete Action | Trigger / Route | Exact Operation | Data Source Affected | Cascade / Side Effects | Undo Window |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Saved Lead Single Delete** | `DELETE /api/leads/:id` | Removes lead object from `store.leads` and Supabase | `leads_store.json` (`leads`), `public.leads` | **CASCADES:** Removes lead from Saved Leads, Favorites, Outreach, and Follow-Up. Deletes notes & activities. | 5-second Toast (25s server buffer) |
| **Saved Lead Batch Delete** | `POST /api/leads/delete-batch` | Removes matching lead objects from `store.leads` and Supabase | `leads_store.json` (`leads`), `public.leads` | **CASCADES:** Removes all selected leads from all views, favorites, outreach, and follow-up. | 5-second Toast (25s server buffer) |
| **Outreach Single Removal** | `DELETE /api/outreach/:id` | Reverts `outreach_status = 'Pending'`, clears follow-up schedules | `store.outreach`, lead status fields | **NO CASCADE:** Removes from Outreach & Follow-Up. **Saved Lead & Favorites remain 100% intact.** | 5-second Toast (25s server buffer) |
| **Outreach Batch Removal** | `POST /api/outreach/remove-batch` | Reverts `outreach_status = 'Pending'` on selected leads | `store.outreach`, lead status fields | **NO CASCADE:** Removes from Outreach & Follow-Up. **Saved Leads & Favorites remain 100% intact.** | 5-second Toast (25s server buffer) |
| **Reset All Lead Data** | `DELETE /api/leads/reset` | Empties `store.leads = []` and deletes all Supabase rows | `leads_store.json` (`leads`), `public.leads` | **TOTAL WIPE:** Clears all leads everywhere. **Settings and search sessions remain 100% intact.** | None (Requires typing 'RESET') |
| **Search History Single** | `DELETE /api/history/:id` | Removes session from `store.searchSessions` | `leads_store.json` (`searchSessions`) | **NONE:** Leads and outreach are completely unaffected. | None |
| **Search History Batch** | `POST /api/history/delete-batch` | Removes sessions from `store.searchSessions` | `leads_store.json` (`searchSessions`) | **NONE:** Leads and outreach are completely unaffected. | None |
| **Search History Clear** | `DELETE /api/history` | Empties `store.searchSessions = []` | `leads_store.json` (`searchSessions`) | **NONE:** Leads and outreach are completely unaffected. | None |
| **Lead Note Delete** | `DELETE /api/leads/:id/notes/:noteId` | Slices note object out of `lead.notes` array | `lead.notes` in store and Supabase | **LOCAL:** Only affects notes list of that specific lead. | None |
| **Service Delete** | `POST /api/settings` | Filters service out of `store.settings.services` | `store.settings.services` in store & Supabase | **NONE:** Does not alter historical dispatched messages. | None |
| **Settings Reset** | None (Not implemented) | No endpoint resets settings | N/A | Settings cannot be wiped via any automated API call. | N/A |

---

# 18. DATA-SAFETY & DATA-LOSS RISK AUDIT

| Risk # | File & Location | Code Pattern | Mechanism & Severity | Likelihood & Existing Safeguards |
| :--- | :--- | :--- | :--- | :--- |
| **1** | `server.js` (lines 139-142) | `return cachedStore \|\| { leads: [], ... }` | **HIGH HAZARD:** If `leads_store.json` is locked or corrupted during read, it returns an empty dataset. A subsequent save could overwrite disk with empty arrays. | **Mitigated:** `cachedStore` remains in memory; `statSync.mtimeMs` avoids redundant disk reads. |
| **2** | `server.js` (lines 1998-2053) | `app.delete('/api/leads/reset')` | **CRITICAL HAZARD:** Executes `supabase.from('leads').delete()` and `store.leads = []`. | **Safeguarded:** Modal requires user to explicitly type the exact uppercase string `RESET`. |
| **3** | `server.js` (lines 4840-4893) | `syncPersistentLeads()` | **DATA REAPPEARANCE:** Leads deleted locally while offline will be re-inserted from Supabase on next startup sync. | **Operational Notice:** Deletions should occur while online to allow atomic Supabase deletion. |
| **4** | `server.js` (lines 162-174) | `setTimeout(..., 400)` debounce | **DATA LOSS ON CRASH:** Non-immediate writes have a 400ms buffer. Process termination could lose up to 400ms of changes. | **Safeguarded:** All user-facing writes (save, delete, settings) explicitly set `immediate = true`. |
| **5** | `electron/main.js` (line 131) | `app.getPath('userData')` | **STORE DETACHMENT:** If Electron app ID or packaging changes, `userData` folder path could shift, pointing to an empty directory. | **Safeguarded:** `server.js` checks fallback `%APPDATA%\clienthunter\data` before initializing empty data. |

---

# 19. FRONTEND ↔ BACKEND END-TO-END TRACES

### 1. Find Leads Flow
`User Clicks "Find Leads"` ──► `handleSearch()` ──► `fetch('/api/leads/search', POST)` ──► `server.js: places:searchText` ──► Deduplication & Qualification ──► JSON Response ──► `renderDiscoveredTable()` ──► Discovered leads displayed on screen.

### 2. Save Lead Flow
`User Clicks "Save Lead"` ──► `saveLead(id)` ──► `fetch('/api/leads/save', POST)` ──► `server.js: unshift to store.leads` ──► Supabase upsert ──► Disk written (`immediate=true`) ──► `AppState.savedLeadsDirty = true` ──► Row updates to "Saved" state.

### 3. Delete Lead Flow
`User Clicks "Delete"` ──► Modal opens ──► User confirms ──► `fetch('/api/leads/:id', DELETE)` ──► `server.js: filter store.leads` ──► Supabase delete ──► Undo token generated ──► UI removes row & shows 5s Undo Toast.

### 4. Move to Outreach Flow
`User Selects Leads & Clicks "Move to Outreach"` ──► `fetch('/api/leads/move-to-outreach', POST)` ──► `server.js: outreach_status = 'Not Contacted'` ──► `store.outreach.push(...)` ──► Supabase updated ──► Outreach tab counter increments.

### 5. Send Outreach Message Flow
`User Clicks "Send Message"` ──► Composer opens ──► `fetch('/api/outreach/generate-message', POST)` ──► Gemini AI synthesizes pitch ──► User clicks "Open WhatsApp" ──► `shell.openExternal(whatsapp://...)` ──► Confirmation modal appears ──► User clicks "[ ✓ Yes, Message Sent ]" ──► `fetch('/api/outreach/mark-sent', POST)` ──► Day 0 anchored, scheduled for Follow-Up #1.

### 6. Process Follow-Up Flow
`User Clicks "Open WhatsApp" on Follow-Up Card` ──► Auto-timer runs / WhatsApp opens ──► User clicks "[ ✓ Yes, Follow-up Sent ]" ──► `fetch('/api/outreach/mark-followup-sent', POST)` ──► Sequence advances to next step or marks Completed.

### 7. Snooze Follow-Up Flow
`User Clicks "Snooze"` ──► Snooze modal opens ──► User selects preset (+1d, +3d, +1w) ──► `fetch('/api/outreach/snooze-followup', POST)` ──► `next_follow_up_at` updated ──► Card re-sorts into upcoming.

### 8. Record Lead Reply Flow
`User Clicks "Reply"` ──► Reply modal opens ──► User selects "Interested" ──► `fetch('/api/outreach/mark-replied', POST)` ──► `outreach_status = 'Replied'`, follow-ups stopped ──► Card moves to Replies tab.

### 9. Save Settings Category Flow
`User Clicks "Save Services"` ──► `saveCategory('services', ...)` ──► `fetch('/api/settings', POST)` ──► `server.js: merge category` ──► Persist to local disk & Supabase ──► Update `localStorage` ──► UI reflects saved settings.

### 10. Backup Export Flow
`User Clicks "Export Complete Backup"` ──► `fetch('/api/backup/export', GET)` ──► `server.js: compiles leads + settings + activities` ──► `preload.js: saveExportFile` ──► Windows Save Dialog prompts path ──► Native UTF-8 JSON file written to disk.

---

# 20. COMPLETE API ENDPOINTS CATALOG

| Method | Endpoint | Purpose | Key Inputs | Key Outputs | Storage Target |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/locations` | Returns Indian states & cities | None | `{ locations }` | Read-only dataset |
| `GET` | `/api/categories` | Returns niches & synonyms | None | `{ categories, details }` | Read-only dataset |
| `POST` | `/api/leads/search` | Discovers leads via Places API | `{ state, city, category, radiusKm }` | `{ leads: [], candidatesChecked }` | Memory only |
| `POST` | `/api/leads/save` | Persists discovered leads | `{ leads: [...] }` | `{ savedCount, totalCount }` | `store.leads` & Supabase |
| `GET` | `/api/leads/saved` | Retrieves all saved leads | None | `{ leads: [], totalCount }` | `store.leads` |
| `DELETE`| `/api/leads/:id` | Deletes single lead everywhere | URL param `:id` | `{ undoToken, lead }` | `store.leads` & Supabase |
| `POST` | `/api/leads/delete-batch`| Deletes multiple leads | `{ ids: [...] }` | `{ undoToken, deletedCount }` | `store.leads` & Supabase |
| `POST` | `/api/leads/undo-delete` | Restores deleted leads | `{ undoToken, fallbackLeads }` | `{ restoredCount }` | `store.leads` & Supabase |
| `DELETE`| `/api/leads/reset` | Resets all lead data | None (destructive) | `{ deletedCount }` | `store.leads` & Supabase |
| `POST` | `/api/leads/move-to-outreach`| Enrolls leads into Outreach | `{ leadIds: [...] }` | `{ movedCount }` | Lead status & `store.outreach` |
| `GET` | `/api/outreach/data` | Retrieves outreach & follow-up | None | `{ metrics, followUpLeads, allLeads }` | `store.leads` |
| `POST` | `/api/outreach/remove-batch`| Removes leads from Outreach | `{ leadIds: [...] }` | `{ undoToken, removedCount }` | Lead status (leaves lead in DB) |
| `POST` | `/api/outreach/undo-remove` | Restores outreach status | `{ undoToken, fallbackStates }` | `{ restoredCount }` | Lead status |
| `POST` | `/api/outreach/mark-sent` | Confirms main message sent | `{ leadId, messageText }` | `{ lead }` | Lead status (Day 0 anchor) |
| `POST` | `/api/outreach/mark-followup-sent`| Confirms follow-up step | `{ leadId, step, messageText }`| `{ lead, completed }` | Lead status (advances step) |
| `POST` | `/api/outreach/snooze-followup`| Snoozes follow-up date | `{ leadId, snoozeDays }` | `{ lead, next_follow_up_at }` | `lead.next_follow_up_at` |
| `POST` | `/api/outreach/mark-replied` | Records prospect reply | `{ leadId, replyStatus }` | `{ lead }` | `lead.reply_status` |
| `POST` | `/api/outreach/mark-stopped` | Stops follow-up sequence | `{ leadId }` | `{ lead }` | `lead.outreach_status = 'Stopped'` |
| `POST` | `/api/outreach/generate-message`| Synthesizes AI pitch | `{ leadId, tone, userServices }` | `{ message, aiPowered }` | External Gemini API |
| `POST` | `/api/outreach/generate-followup`| Synthesizes AI follow-up | `{ leadId, followUpDay, tone }` | `{ message, aiPowered }` | External Gemini API |
| `POST` | `/api/outreach/ai-reply` | Handles prospect objection | `{ leadId, objectionType }` | `{ reply }` | External Gemini API |
| `POST` | `/api/ai/assistant` | Terminal AI chat assistant | `{ query, history }` | `{ reply, action }` | External Gemini API |
| `GET` | `/api/leads/:id/notes` | Retrieves notes for lead | URL param `:id` | `{ notes: [...] }` | `lead.notes` |
| `POST` | `/api/leads/:id/notes` | Adds note to lead | `{ text }` | `{ note, notes }` | `lead.notes` & Supabase |
| `PUT` | `/api/leads/:id/notes/:noteId`| Edits existing note | `{ text }` | `{ note, notes }` | `lead.notes` & Supabase |
| `DELETE`| `/api/leads/:id/notes/:noteId`| Deletes note | URL params | `{ deletedNoteId }` | `lead.notes` & Supabase |
| `GET` | `/api/leads/:id/activities` | Retrieves lead activities | URL param `:id` | `{ activities: [...] }` | `lead.activities` |
| `POST` | `/api/leads/:id/activities`| Adds lead activity | `{ event_type, event_title }` | `{ activity, activities }` | `lead.activities` & Supabase |
| `GET` | `/api/history` | Retrieves search sessions | None | `{ history: [...] }` | `store.searchSessions` |
| `DELETE`| `/api/history/:id` | Deletes search session | URL param `:id` | `{ success }` | `store.searchSessions` |
| `POST` | `/api/history/delete-batch`| Batch deletes sessions | `{ ids: [...] }` | `{ deletedCount }` | `store.searchSessions` |
| `DELETE`| `/api/history` | Clears all search history | None | `{ success }` | `store.searchSessions` |
| `GET` | `/api/settings` | Retrieves system settings | None | `{ settings }` | `store.settings` & Supabase |
| `POST` | `/api/settings` | Saves settings category | Category payload + `_category` | `{ settings }` | `store.settings` & Supabase |
| `GET` | `/api/system/status` | Backend health & port check | None | `{ status: 'ok', port }` | Read-only |
| `GET` | `/api/system/check-updates` | Checks for app updates | None | `{ updatesAvailable }` | Read-only |
| `GET` | `/api/backup/export` | Generates full JSON backup | None | JSON file download | Read-only compiled export |

---

# 21. SUPABASE / DATABASE ARCHITECTURE AUDIT

1. **Connection Architecture:** Initialized in `server.js` using `@supabase/supabase-js` `createClient(SUPABASE_URL, SUPABASE_KEY)`. Credentials supplied via `.env` (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_ANON_KEY`).
2. **Tables:**
   - **`public.leads`**: Stores lead records.
     - `place_id`: Primary unique constraint (`CREATE UNIQUE INDEX leads_place_id_idx ON public.leads (place_id)`).
     - Indexes on: `place_id`, `phone`, `category`, `city`, `created_at DESC`.
     - JSONB columns: `notes`, `activities`, `message_history`.
   - **`public.settings`**: Stores settings. Single row with primary key `id = 'default'`; stores entire configuration object in `settings JSONB`.
3. **Row Level Security (RLS):** Enabled on `public.leads`. Permissive policies allow service role and anon full CRUD (`Allow all operations for service role`, `Allow anon read`, `Allow anon insert`, `Allow anon update`, `Allow anon delete`).
4. **Synchronization Logic:**
   - On startup or first data query, `syncPersistentLeads()` retrieves remote leads from Supabase and merges them into `store.leads`.
   - For existing leads, missing fields are updated.
   - For new remote leads, they are inserted locally with backward-compatible defaults.
   - On every local save, update, or delete, matching operations are dispatched to Supabase.

---

# 22. APPLICATION STARTUP SEQUENCE

```text
1. Desktop Executable Launched (Client Hunter.exe)
   │
2. Single-Instance Check (electron/main.js)
   ├── app.requestSingleInstanceLock()
   └── If secondary instance -> Focus existing window and terminate duplicate
   │
3. Port Availability & Conflict Resolution
   ├── Evaluates preferred port (default 3000)
   └── If occupied -> Locates available ephemeral port via net.createServer
   │
4. Backend Server Forking
   ├── Resolves userData directory: %APPDATA%\clienthunter
   ├── Spawns child process: fork('server.js') with ELECTRON_RUN_AS_NODE=1
   └── Passes CLIENTHUNTER_USER_DATA and PORT in environment
   │
5. Server Initialization (server.js)
   ├── Loads .env configuration (explicit paths, resourcesPath, local)
   ├── Validates Google Places API Key presence
   ├── Resolves DATA_DIR (%APPDATA%\clienthunter\data)
   ├── Seeds leads_store.json if file does not exist
   ├── Reads leads_store.json into memory (cachedStore)
   ├── Connects to Supabase client if configured
   └── Launches Express HTTP server on designated port
   │
6. Readiness Verification (electron/main.js)
   ├── Polls http://127.0.0.1:{port}/api/system/status every 150ms
   └── Confirms backend responsiveness (30-second timeout window)
   │
7. Main Window Creation & Presentation
   ├── Initializes BrowserWindow (1366x860, custom icon, dark theme #0a0d14)
   ├── Loads http://127.0.0.1:{port}
   ├── Registers external URL interceptors (wa.me, google.com/maps)
   └── Presents UI window once 'ready-to-show' fires
   │
8. Frontend Initialization (main.js)
   ├── Optimistically loads settings from localStorage cache
   ├── Dispatches GET /api/settings (syncs Supabase and store)
   ├── Applies settings (identity, daily target, 3D grid visibility)
   ├── Fetches locations (/api/locations) and categories (/api/categories)
   ├── Binds event listeners, keyboard shortcuts (1, 2, 3, Esc), and modals
   └── Sets default view to 'find-leads'
```

---

# 23. APPLICATION BUILD & EXE ARCHITECTURE

- **Packaging Technology:** `electron-builder` (v26.15.3) targeting Windows `x64`.
- **Build Commands:**
  - `npm run desktop:build`: Generates unpacked directory `dist/win-unpacked/` for testing.
  - `npm run desktop:dist`: Compiles installer `dist/Client Hunter-Setup.exe` (NSIS) and `dist/Client Hunter-Portable.exe` (Portable).
- **Configuration (`package.json`):**
  - App ID: `com.clienthunter.app`
  - Product Name: `Client Hunter`
  - Icon: `assets/icon.ico`
  - Extra Resources: Bundles `.env`, `data/`, and `assets/` into `process.resourcesPath`.
- **Data Bundling & Separation:**
  - `data/leads_store.json` bundled inside the installer acts **strictly as a seed template**.
  - At runtime, the application writes user data to `%APPDATA%\clienthunter\data\leads_store.json`.
  - **Audit Confirmation:** Rebuilding or updating the `.exe` binary **cannot wipe or overwrite existing user leads**, because user leads are stored outside the installation directory in `%APPDATA%` and in Supabase.

---

# 24. UPDATE SAFETY & USER DATA ISOLATION

```text
Code Update ──► npm run desktop:dist ──► New Setup.exe / Portable.exe
                                                │
                                                ▼ User runs update installer
                                  Existing binaries replaced in Program Files
                                                │
                                                ▼ App launches
                     Looks in: %APPDATA%\clienthunter\data\leads_store.json
                                                │
                 ┌──────────────────────────────┴──────────────────────────────┐
                 ▼                                                             ▼
        File Already Exists                                          File Does Not Exist
   (Existing user data preserved)                              (Initial installation seed copied)
                 │                                                             │
                 └──────────────────────────────┬──────────────────────────────┘
                                                ▼
                                   Connects to Supabase
                                 Syncs and validates leads
                                                ▼
                               100% OF EXISTING DATA PRESERVED
```

---

# 25. CURRENT FEATURE INVENTORY

### Implemented & Fully Functional
- Multi-signal Google Places API (New) lead search with coordinates and radial boundaries.
- Continuous lead qualification (No Website + Valid Phone Number filter).
- Hard 300 daily candidate search cap with persistent daily usage tracking.
- Multi-Signal Deduplication Engine (Place ID, Phone, Domain, Name+Address).
- Saved Leads table with collapsible date-based accordion groups (`DD Month YYYY`).
- Multi-criteria lead filtering (search, website status, city, category, favorites, WA status).
- Favorites management (star toggle, dedicated Favorites view).
- Outreach Terminal with 6 sub-tabs (Ready, All, Follow-Up, Completed, Replied, Stopped).
- Safe Outreach Removal (removes from outreach while keeping saved leads 100% intact).
- 5-Step Scheduled Follow-Up Queue anchored to Day 0 (Day 2, Day 4, Day 7, Day 10, Day 14).
- Calendar-day priority sorting (Overdue, Due Today, Due Soon, Upcoming, Replies, Completed).
- Follow-Up reply recording (Interested, Not Interested, Other).
- Follow-Up snooze scheduling (+1 day, +3 days, next week).
- Separate auto-open WhatsApp timers for Outreach and Follow-Up (0-10 seconds).
- Confirmation Modal before marking any message as sent.
- Keyboard shortcuts (`1` for Sent, `2` for Not Sent, `3` for Not on WA, `Esc` for Close).
- Gemini AI message generation with tone selection and deterministic fallback pitches.
- Built-in ClientHunter AI Assistant with ground-truth dynamic metrics.
- My Services management with dynamic `{my_services}` tag injection.
- Template editor with variable chips and priority re-ordering.
- Per-lead rich Notes system (add, edit, delete, 5000 character validation).
- Per-lead Activity Timeline with derived event reconstruction.
- Search history logging with individual and bulk deletion.
- Advanced CSV and JSON export with native Windows Save Dialog and UTF-8 BOM encoding.
- Complete system backup export (`/api/backup/export`).
- Two-way Supabase database synchronization for leads and settings.
- Electron desktop single-instance lock and port conflict resolution.

### Partially Implemented / Present in UI Only
- **Voice Agent Pitch Integration:** Template exists (`tpl-voice-agent`), but automated outbound voice dialing is not integrated (manual outreach only).
- **Google Maps In-App Embedding:** Google Maps links delegate out to the external browser via `shell.openExternal` rather than embedding an interactive map inside the window.

---

# 26. COMPLETE SYSTEM DEPENDENCY MAP

```text
Lead Master Record (store.leads[] / public.leads)
 ├── Identification: place_id (Primary) | id (UUID fallback)
 ├── Discovery Source: Google Places API (New) Text Search
 ├── Saved Leads View (view-saved-leads)
 │    ├── Date Accordions (getSavedDateKey -> DD Month YYYY)
 │    ├── Pagination & Multi-Selection (selectedLeadIds)
 │    └── Filter State (savedFilters)
 ├── Favorites View (view-favorites)
 │    └── Computed View: store.leads.filter(l => l.favorite)
 ├── Notes Subsystem (lead.notes[])
 │    └── Endpoints: /api/leads/:id/notes (GET, POST, PUT, DELETE)
 ├── Activity Subsystem (lead.activities[])
 │    └── Endpoints: /api/leads/:id/activities (GET, POST)
 ├── Outreach Terminal (view-outreach)
 │    ├── Link Array: store.outreach[]
 │    ├── Computed View: store.leads.filter(l => l.outreach_status !== 'Pending')
 │    ├── Outreach Sub-Tabs (Ready, All, Follow-Up, Completed, Replied, Stopped)
 │    ├── Message History (lead.message_history[])
 │    ├── AI Outreach Composer (/api/outreach/generate-message)
 │    │    ├── Settings Profile (store.settings.profile)
 │    │    ├── Enabled Services (store.settings.services)
 │    │    └── External Provider: Google Gemini API
 │    ├── WhatsApp Launcher (wa.me / whatsapp://)
 │    └── Outreach Safe Removal (/api/outreach/remove-batch)
 ├── Smart Follow-Up Queue (view-followup)
 │    ├── Computed View: store.leads.filter(l => l.first_message_sent)
 │    ├── Schedule Engine: FOLLOW_UP_SCHEDULE (Days 2, 4, 7, 10, 14)
 │    ├── AI Follow-Up Composer (/api/outreach/generate-followup)
 │    ├── Reply Handler (/api/outreach/mark-replied)
 │    └── Snooze Handler (/api/outreach/snooze-followup)
 ├── Dashboard View (view-dashboard)
 │    └── Metrics: /api/dashboard/daily-performance
 ├── AI Assistant Panel (ai-assistant-panel)
 │    └── Ground-Truth Aggregator: calculateAiGroundTruth(store)
 └── System Settings (view-settings)
      ├── Local File: leads_store.json (settings)
      ├── Remote Cloud: Supabase public.settings (id = 'default')
      └── Browser Cache: localStorage.clienthunter_settings
```

---

# 27. RULES FOR FUTURE CLIENTHUNTER CHANGES

1. **NEVER REPLACE THE EXISTING DATA SOURCE:** Do not switch database engines or replace `leads_store.json` without automated, verified migration of existing leads.
2. **NEVER SEED AN EMPTY REPLACEMENT DATABASE:** Never overwrite `leads_store.json` with an empty `{ leads: [] }` structure if file reading fails.
3. **NEW FIELDS MUST BE 100% BACKWARD COMPATIBLE:** Any new schema attribute must have a default fallback in `enrichLeadOutreachFields`. Never assume new fields exist on legacy records.
4. **OLD LEADS MUST REMAIN VISIBLE:** Do not introduce strict filter requirements (e.g. mandatory non-null dates) that would hide existing leads from Saved Leads, Outreach, or Follow-Up.
5. **FOLLOW-UP MUST REFERENCE EXISTING LEADS:** Follow-Up records must remain embedded inside the master lead record. Never create an orphaned secondary follow-up table.
6. **OUTREACH DELETION MUST REMAIN SEPARATED FROM SAVED LEADS:** Removing a lead from Outreach must only revert `outreach_status = 'Pending'`. Never delete the master lead during an outreach removal operation.
7. **SETTINGS MUST PERSIST ACROSS BUILDS:** Keep user settings in `%APPDATA%` and Supabase. Never bundle user settings inside the immutable read-only `.exe` binary.
8. **NEVER TEST USING REAL LEADS:** Always run automated tests using isolated mock leads prefixed with `test_` or `demo_` that clean up after themselves.
9. **NEVER RUN DESTRUCTIVE MIGRATIONS WITHOUT EXPLICIT APPROVAL:** Never invoke `DELETE /api/leads/reset`, `database.truncate()`, or `drop table` during routine updates.
10. **NEVER SILENTLY FALL BACK TO AN EMPTY DATASET:** If reading `leads_store.json` fails, halt with an error box; do not initialize an empty file.
11. **ALWAYS PRESERVE THE DAY 0 ANCHOR:** Never overwrite `main_message_sent_at` once set. All subsequent follow-up dates (Days 2, 4, 7, 10, 14) depend on this permanent timestamp.
12. **MAINTAIN CONFIRMATION BEFORE SEND:** Never automate the marking of messages as "Sent" upon clicking "Open WhatsApp". The user confirmation step is mandatory to prevent false status updates.

---

# 28. FINAL SYNTHESIS REPORT

### A. Current Architecture
Dual hybrid architecture uniting a local desktop Express backend with an Electron sandboxed frontend, backed by local JSON persistence and Supabase PostgreSQL synchronization.

### B. Current Data Sources
1. `%APPDATA%\clienthunter\data\leads_store.json` (Primary local storage)
2. `public.leads` & `public.settings` in Supabase PostgreSQL (Cloud persistence)
3. `localStorage.clienthunter_settings` (Client UI cache)

### C. Lead Data Model
Single unified record containing 35+ fields including Google Place ID, opportunity metrics, outreach progression flags, Day 0 anchor, and embedded JSON arrays for notes, activities, and message history.

### D. Lead Lifecycle
Find Leads (transient) ──► Saved Leads (permanent) ──► Outreach Queue ──► WhatsApp Dispatch ──► User Confirmation ──► 5-Step Scheduled Follow-Up ──► Reply or Completion Archive.

### E. Saved Leads Workflow
Full CRUD workflow organized into collapsible accordion sections by saved date (`DD Month YYYY`), with multi-filtering, batch selection, and safe cascading deletion protected by a 5-second undo toast.

### F. Outreach Workflow
Outreach queue manages initial pitches. Removing an outreach lead strictly resets `outreach_status` to `'Pending'` and leaves the saved lead 100% intact.

### G. Follow-Up Workflow
Automated 5-step schedule anchored to Day 0 (`main_message_sent_at`). Automatically groups into Overdue, Due Today, Due Soon, and Upcoming based on calendar day. Handles replies and snoozing.

### H. History Workflow
Two separate history engines: Global Search Session history (stored in `store.searchSessions`) and per-lead activity audit logs (stored in `lead.activities`).

### I. Settings Workflow
Category-isolated updates persisted to disk, Supabase, and `localStorage`. Default values serve strictly as non-destructive fallbacks for missing keys.

### J. AI / Gemini Workflow
Integrates Gemini 3.5/3.6 Flash for outreach copywriting, follow-ups, objection rebuttals, and terminal assistant queries, backed by deterministic fallback templates.

### K. WhatsApp Workflow
Generates `whatsapp://` or `wa.me/` URLs with normalized Indian phone numbers, features separate auto-timers for outreach and follow-up, and mandates manual send confirmation.

### L. Database / API Architecture
Express REST API with 35+ endpoints providing CORS-enabled JSON services. Supabase table `public.leads` enforces uniqueness on `place_id` and provides real-time synchronization.

### M. EXE Build Architecture
Packaged via `electron-builder` into NSIS Setup and Portable binaries. Separates application code from user data by designating `%APPDATA%\clienthunter` as the runtime data directory.

### N. Data-Deletion Risks
Single lead deletes cascade across all views. Resetting lead data clears the entire database. Both operations are protected by undo buffers or explicit keyword confirmation (`RESET`).

### O. Data-Loss Risks
Corrupted JSON reads could theoretically default to empty arrays if not guarded by in-memory caches. Local offline deletions can be re-populated by Supabase on reconnect.

### P. Current Feature Status
All core features (search, qualification, deduplication, saved leads date grouping, outreach, 5-step follow-up, notes, AI pitches, export) are fully implemented and verified by 27 automated test suites.

### Q. Dependencies
All application subsystems depend on the master Lead Record (`store.leads` / `public.leads`), keyed uniquely by `place_id`.

### R. Rules for Future Changes
12 mandatory safety principles preventing data overwrite, ensuring backward compatibility, maintaining the Day 0 anchor, and preserving outreach separation.

### S. Files That Are Safe to Modify
- `styles.css` (UI styling, colors, layout density, typography)
- `assets/` (Branding icons, logo images)
- `data/categories.json` (Adding new business categories and synonyms)
- `data/india_locations.json` (Adding new cities or districts)
- `fonts/` (Typography files)

### T. Files That Require Extra Caution
- `server.js` (Core API, deduplication engine, Supabase sync, store file I/O)
- `main.js` (Frontend state management, date grouping, delete dispatchers)
- `electron/main.js` (Port management, child process spawning, `%APPDATA%` path resolution)
- `data/leads_store.json` (Master user database — NEVER EDIT MANUALLY)
- `package.json` (`extraResources` and `build` configuration)
- `supabase_schema.sql` (Remote database schema and table constraints)

---

# 29. AUDIT VERIFICATION & COMPLIANCE CONFIRMATION

In strict compliance with your absolute rule:
- **Zero source code lines were modified.**
- **Zero database rows were altered, inserted, or deleted.**
- **Zero test or demo records were created.**
- **Zero build commands or migrations were executed.**
- **All credentials and secrets remain unexposed (`SECRET PRESENT — DO NOT DISPLAY`).**

This technical audit provides the exact, verified technical map of ClientHunter required to plan future development safely and without risk of data loss.
