# CLIENTHUNTER — DATA SAFETY, PERSISTENCE & ARCHITECTURE SPECIFICATION

> **CRITICAL ARCHITECTURAL INVARIANT FOR FUTURE CHANGES:**
>
> ClientHunter uses an existing persistent data architecture. Future feature changes must be additive and backward-compatible. No feature may create a new source of truth, replace existing persistent data with an empty/default dataset, change the runtime data path, or destructively migrate existing records without explicit approval and verified backup/recovery.

---

## 1. Executive Summary & Core Safety Principles

ClientHunter is a hybrid-persistence desktop application designed for local discovery and business lead outreach across India. Because real users rely on accumulated lead datasets, activity timelines, custom notes, outreach queues, and custom settings, **data preservation is the primary architectural priority**.

Under no circumstances may the application:
1. Fall back to an empty database (`{ leads: [] }`) when a read error, JSON parse error, permission lock, or schema mismatch occurs.
2. Overwrite an existing persistent file with an empty dataset during startup, synchronization, or error recovery.
3. Interpret a failed remote or local read as "there are zero leads."
4. Silently truncate lead records during schema additions. All new fields must receive non-destructive runtime defaults.

---

## 2. Source of Truth & Hybrid Persistence Architecture

ClientHunter utilizes a dual-tier hybrid persistence model:

```
+-------------------------------------------------------------+
|                     ClientHunter Desktop                   |
|                                                             |
|   +-----------------------------------------------------+   |
|   |             In-Memory Store State Machine           |   |
|   |   'uninitialized' | 'loaded' | 'empty' | 'failed'   |   |
|   +-----------------------------------------------------+   |
|                              |                              |
|           +------------------+------------------+           |
|           |                                     |           |
|           v                                     v           |
|   +-----------------------+           +------------------+  |
|   | Local JSON Persistence|           |  Supabase Cloud  |  |
|   |   leads_store.json    |           | PostgreSQL Table |  |
|   | (%APPDATA% or ./data) |           |  (public.leads)  |  |
|   +-----------------------+           +------------------+  |
+-------------------------------------------------------------+
```

### Dual-Tier Roles:
1. **Local Persistent JSON (`leads_store.json`)**:
   - Primary offline source of truth on the desktop client.
   - Fully operational without internet connectivity or Supabase API keys.
   - Holds:
     - `leads`: Array of master lead records (including notes, activities, outreach state, and follow-up data).
     - `searchSessions`: Discovered lead sessions.
     - `outreach`: Outreach workflow tracking relationships.
     - `settings`: Category-level user configurations.
     - `dailyCandidateTracker`: Daily discovery quota tracking.
2. **Supabase Cloud PostgreSQL (`public.leads` & `public.settings`)**:
   - Secondary persistence and synchronization layer.
   - Synchronizes bidirectionally at startup without overwriting unverified local data.
   - Immediately receives newly saved leads (`POST /api/leads/save`), updates, and deletions.

---

## 3. Runtime Data Locations & Electron Path Resolution

### Production Desktop Executable (`app.isPackaged === true`)
- **Root User Data Folder**: `%APPDATA%\clienthunter\` (defined by Electron `app.getPath('userData')` for `appId: "com.clienthunter.app"`).
- **Persistent Store File**: `%APPDATA%\clienthunter\data\leads_store.json`.
- **Pre-Write Backups Folder**: `%APPDATA%\clienthunter\data\backups\`.
- **Environment Variable**: `CLIENTHUNTER_USER_DATA` passed from `electron/main.js` to `server.js`.

### Local Development / Node Environment
- **Fallback Store File**: `d:\Antigravity\New project\data\leads_store.json`.
- **Pre-Write Backups Folder**: `d:\Antigravity\New project\data\backups\`.

### Path Resolution Invariant in `server.js`:
```javascript
const DATA_DIR = process.env.CLIENTHUNTER_USER_DATA
  ? path.join(process.env.CLIENTHUNTER_USER_DATA, 'data')
  : (process.env.APPDATA && fs.existsSync(path.join(process.env.APPDATA, 'clienthunter', 'data', 'leads_store.json')))
    ? path.join(process.env.APPDATA, 'clienthunter', 'data')
    : path.join(__dirname, 'data');
```

---

## 4. Persistent Store State Machine & Empty-Store Protection

To prevent silent data loss, the backend storage engine enforces an explicit state machine:

| State | Definition | Read Action | Write Action |
|---|---|---|---|
| `'uninitialized'` | Server starting up, file not yet read | Transition to `'loading'` | Blocked |
| `'loaded'` | File parsed, schema valid, `leads.length > 0` | Returns valid store | Allowed (atomic write) |
| `'empty'` | File parsed, schema valid, `leads.length === 0` | Returns empty store | Allowed (atomic write) |
| `'failed'` | Read error, JSON corruption, permission lock, 0-byte file, or schema failure | Returns 500 error & safe notice | **CRITICALLY BLOCKED** |

### Critical Protections Implemented:
1. **Zero-Fallback Rule**: If `getStoredData()` catches a read or parse error, it **NEVER** returns `{ leads: [] }`. It sets `storeStatus = 'failed'` and returns `cachedStore` (if previously valid) or `null`.
2. **Write Safety Blocker**: `saveStoredData()` immediately aborts if `storeStatus === 'failed'`.
3. **Anomalous Truncation Blocker**: If the currently active store has `leads.length > 0`, any incoming payload with `data.leads.length === 0` is rejected with a critical safety abort, unless explicitly authorized by the user reset endpoint via `data.__allowEmptyReset === true`.
4. **Pre-Write Backup Snapshot**: Before any disk write, the storage engine copies the current file to `data/backups/leads_store_last_valid.json`.
5. **Atomic Write Replacement**: Writes are executed to a temporary file (`leads_store.json.tmp_<timestamp>`) and atomically renamed over the target file to eliminate partial-write truncation.

---

## 5. Startup Synchronization Rules

Startup synchronization between local JSON and Supabase follows strict fail-safe rules:

1. **Pre-condition Validation**: If local store loading failed (`storeStatus === 'failed'`), `syncPersistentLeads()` and `syncPersistentSettings()` are immediately aborted.
2. **Read-Before-Merge**: Remote leads are fetched via `supabase.from('leads').select('*')`.
3. **Supabase Failure Safety**: If the network request fails or Supabase returns an error, the local store is preserved untouched. Local data is never cleared or degraded.
4. **Empty Remote Safety**: If Supabase returns `[]` (zero records) and local store has leads, local leads are **NEVER** deleted.
5. **Non-Destructive Merge**: Remote records not present locally are appended; existing local records retain their local notes, activity histories, and timestamps.

---

## 6. Saved Lead Lifecycle & 28-Field Dictionary

Every Saved Lead represents a master business record. All 28 fields must be preserved across loads, exports, backups, and synchronizations:

| Field Name | Data Type | Purpose & Invariant |
|---|---|---|
| `id` | String | Unique identifier (`lead_...` or `place_id`). |
| `place_id` | String | Unique Google Places / Provider identifier. |
| `business_name` | String | Legal or trade business name. |
| `category` | String | Primary business classification. |
| `sub_categories` | Array | Secondary classifications. |
| `rating` | Number | User rating (e.g. 4.2). |
| `reviews_count` | Number | Total review count. |
| `phone` | String | Contact phone number. |
| `formatted_phone` | String | E.164 formatted telephone number. |
| `website` | String | URL of website (or empty string/null). |
| `website_status` | String | `'NO'` (No website - high opportunity) or `'YES'`. |
| `email` | String | Contact email address. |
| `address` | String | Full physical street address. |
| `city` | String | City location. |
| `district` | String | District location. |
| `state` | String | State / Territory. |
| `status` | String | Pipeline status (`New`, `Contacted`, `Replied`, `Closed`). |
| `outreach_status` | String | Workflow status (`Pending`, `Not Contacted`, `Ready`, `Follow-Up`, `Completed`). |
| `favorite` | Boolean | Starred/bookmarked status (`true` or `false`). |
| `opportunity_score` | Number | Proprietary scoring (0 to 100). |
| `opportunity_level` | String | `'HIGH'`, `'MEDIUM'`, or `'LOW'`. |
| `first_message_sent` | Boolean | True once Day 0 main message is dispatched. |
| `main_message_sent_at` | String (ISO) | Timestamp when Day 0 message was sent. |
| `follow_up_day` | Number | Current anchor day (0, 2, 4, 7, 10, 14). |
| `current_follow_up_number`| Number | Number of follow-ups dispatched (0 to 5). |
| `next_follow_up_at` | String (ISO) | Scheduled execution timestamp. |
| `next_follow_up_number` | Number | Next step index (1 to 5). |
| `follow_up_completed` | Boolean | Set to true after FU#5 or client reply. |
| `follow_up_paused` | Boolean | User pause toggle. |
| `reply_status` | String | Client reply state (`null`, `'Replied'`, etc.). |
| `notes` | Array | Chronological array of user note objects. |
| `activities` | Array | Comprehensive audit trail of outreach events. |
| `message_history` | Array | History of sent message templates. |
| `created_at` | String (ISO) | Immutable creation timestamp. |
| `updated_at` | String (ISO) | Last modification timestamp. |

---

## 7. Outreach Separation & Follow-Up Invariants

### Outreach vs. Saved Lead Separation
- **Moving to Outreach**: Sets `lead.outreach_status = 'Not Contacted'` and creates a record in `store.outreach`.
- **Removing from Outreach**: Reverts `lead.outreach_status = 'Pending'`. **CRITICAL**: Removing a lead from Outreach MUST NEVER delete the master Saved Lead record from `store.leads`!
- **Deleting a Saved Lead**: Completely removes the lead record from `store.leads` and cleans up related outreach state.

### 5-Step Follow-Up Scheduling Engine
Follow-Up scheduling operates strictly on the master lead record and follows the established timeline:
- **Day 0**: Initial outreach / main message sent (`main_message_sent_at`).
- **Day 2**: Follow-Up #1 (+2 days from Day 0).
- **Day 4**: Follow-Up #2 (+4 days from Day 0).
- **Day 7**: Follow-Up #3 (+7 days from Day 0).
- **Day 10**: Follow-Up #4 (+10 days from Day 0).
- **Day 14**: Follow-Up #5 (+14 days from Day 0).
- **Completion**: Once FU#5 is sent or if the client replies, `follow_up_completed` is set to `true`, halting further messages.

### Independent WhatsApp Timers
Outreach auto-timer and Follow-Up auto-timer are strictly separate state variables:
- `settings.whatsappPreferences.autoTimer`
- `settings.whatsappPreferences.followUpAutoTimer`
Modifying or executing one timer must never alter the configuration or execution of the other.

---

## 8. Settings Persistence Architecture

System settings are stored at:
- `store.settings` in `leads_store.json`.
- `public.settings` table in Supabase (`id = 'default'`).

### Settings Invariants:
1. User-saved settings are authoritative. Application restarts, rebuilds, and updates must never reset or overwrite saved settings.
2. `populateDefaultSettings(saved)` only supplies default values for keys that do not yet exist; existing user values are preserved 100%.
3. Lead resets (`DELETE /api/leads/reset`) must **NEVER** clear or reset `store.settings`.

---

## 9. Destructive Operations & 5-Second Undo Protection

All destructive operations require explicit safeguards:
1. **Single Lead Deletion (`DELETE /api/leads/:id`)**:
   - Stores deleted record in server deletion buffer (`recentDeletions` map) with a 5-second expiration window.
   - Returns `undoToken` to client.
   - Client displays toast with an active **Undo** button.
2. **Undo Restoration (`POST /api/leads/undo-delete`)**:
   - Restores the lead to `store.leads` and Supabase if token is valid.
   - Token is consumed immediately upon use (idempotent).
3. **Permanent Database Reset (`DELETE /api/leads/reset`)**:
   - Requires user to open the danger modal and explicitly type `"RESET"`.
   - Blocked immediately if `storeStatus === 'failed'`.
   - Requires explicit authorization flag `store.__allowEmptyReset = true`.

---

## 10. EXE Packaging & Update Safety

When building or updating desktop releases:
- **Build Commands**: `npm run desktop:build` (`--dir`) and `npm run desktop:dist` (`electron-builder`).
- **Seed Database Isolation**: The bundled `data/leads_store.json` packaged inside `resources/data/` acts strictly as an initial seed for first-time installations.
- **AppData Preservation**: NSIS installer updates write binaries to `Program Files\Client Hunter\` without touching `%APPDATA%\clienthunter\`. Existing user databases, notes, outreach queues, and settings remain untouched across application updates, re-installs, and version upgrades.

---

## 11. Safe Data Migration & Backward Compatibility Rules

If future features require new data fields:
1. **Additive Schema Only**: New fields must be optional.
2. **Runtime Defaults**: Apply default values in accessor functions (e.g. `lead.newField = lead.newField ?? defaultValue`).
3. **No Batch File Rewrites**: Do not rewrite the entire database file merely to add new empty properties.
4. **No Destructive Migrations**: Any schema migration requiring file changes must be explicitly reviewed, backward-compatible, and accompanied by automated pre-migration backups.
