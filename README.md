# Client Hunter

Client Hunter is a Windows desktop application for personal B2B lead discovery, lead management, outreach, and follow-up workflows. It provides a local-first workspace for finding local business prospects, scoring outreach opportunities, drafting customized pitches, and managing multi-touch outreach cadences via WhatsApp.

---

## Overview

Client Hunter is built specifically for individual consultants, agencies, and service providers who need an organized, repeatable system for identifying and contacting local businesses. 

The application operates as an offline-first Windows desktop program. All lead data, outreach logs, activity timelines, and custom templates are stored locally on your machine, with optional cloud synchronization through Supabase.

---

## Features

### Lead Discovery
* **Google Places API (New)**: Discovers local businesses using Text Search (`places:searchText`) with supplemental coverage via Nearby Search (`places:searchNearby`).
* **Geographic Coverage across India**: Coordinate resolution across all 36 States and Union Territories and 750+ districts.
* **50+ Curated Business Categories**: Real estate, clinics, gyms, salons, restaurants, retail, professional services, and more.
* **Lead Qualification Criteria**: Identifies businesses that have a valid contact phone number but lack an active official website.
* **Daily Candidate Safety Limit**: Implements a hard cap of 300 candidate evaluations per calendar day to control API usage and avoid unexpected quota consumption.
* **Duplicate Lead Protection**: Utilizes unique Google Place IDs and normalized phone numbers to prevent previously saved or evaluated leads from appearing as new search results.

### Lead Management & Organization
* **Saved Leads Terminal**: Local table view featuring real-time search, sorting (by opportunity score, rating, review count, date added, or business name), and pagination.
* **Favorites**: Dedicated bookmarking system for high-priority prospects with a separate Favorites view.
* **Lead Notes**: Persistent multi-line notes attached to individual leads with timestamps.
* **Custom Tags**: Color-coded tag chips for categorizing prospects with instant tag-based filtering.
* **Multi-Criteria Filtering**: Filter leads by opportunity score tier, rating range, review count, geographic location, website status, WhatsApp availability, priority, and outreach status.
* **Global Search**: Search across business names, phone numbers, categories, cities, and interaction records.
* **Saved Views**: Save complex filter configurations for quick retrieval across sessions.
* **Contact Outcomes**: Record outreach outcomes (*Contacted*, *Replied*, *Interested*, *Not Interested*, *Not on WhatsApp*).
* **Lead Conversion Tracking**: Track qualification stages (*Won*, *Lost*, *In Progress*) with conversion values and notes.
* **Undo Delete**: Temporary safety window with undo capability to recover accidentally removed leads.

### Opportunity Scoring
* **Scoring Engine (0–100)**: Evaluates prospects based on digital presence and contact readiness:
  * **Missing Website (+40 points)**: Primary signal for web development, digital presence, and modernization services.
  * **Verified Phone (+15 points)**: Direct outreach readiness indicator.
  * **Reputation & Review Signals (+10 to +15 points)**: Evaluates review count and rating to identify businesses needing reputation management or those with established clientele.
* **Tiered Classification**: Leads are grouped into High (80+), Medium (60–79), and Low (<60) opportunity tiers with detailed reasoning breakdowns.

### Outreach Workflow
* **Outreach Sequence Queue**: Walk through selected leads sequentially without repetitive navigation.
* **Custom Message Templates**: Includes 11 pre-configured templates with dynamic variable interpolation (`{businessName}`, `{category}`, `{city}`, `{my_name}`, `{my_company}`, `{portfolio_url}`, `{my_services}`).
* **Activity Timeline**: Complete chronological history of interactions per lead, logging when outreach was initiated, when WhatsApp was opened, when messages were confirmed sent, and status changes.
* **Outreach Keyboard Shortcuts**: Quick keyboard actions for queue confirmation:
  * `1`: Confirm Sent (Yes)
  * `2`: Not Sent (No)
  * `3`: Not on WhatsApp
  * `Escape`: Close modal or pause active queue

### Follow-Up System
* **Day-Anchored Follow-Up Cadence**: All follow-ups are strictly anchored to the permanent timestamp of the initial message (Day 0):
  * **Day 0**: Initial Outreach Pitch
  * **Day 2**: Follow-Up #1 — Gentle Nudge
  * **Day 4**: Follow-Up #2 — Quick Check-in
  * **Day 7**: Follow-Up #3 — Service Value
  * **Day 10**: Follow-Up #4 — Low-Pressure Closing
  * **Day 14**: Follow-Up #5 — Final Note
* **Smart Follow-Up Queue**: Automatically identifies follow-ups that are Due Today or Overdue.
* **Pause & Resume**: Pause individual or bulk cadences for leads currently engaged in discussion.
* **Stop on Reply**: Automatically halts sequence progression when a lead is marked as replied.
* **Follow-Up Snooze**: Postpone upcoming follow-up dates by 1, 2, 3, 5, 7 days, or a specific calendar date.
* **Configurable Auto-Timer**: Optional automatic dispatch countdown (*Off*, *Immediate / 0s*, *3s*, *5s*, *10s*, *15s*, *20s*, *30s*).

### WhatsApp Integration
* **Click-to-Chat Dispatch**: Launches WhatsApp using standard URI schemes:
  * **WhatsApp Desktop**: `whatsapp://send?phone=<phone>&text=<message>`
  * **WhatsApp Web**: `https://wa.me/<phone>?text=<message>`
* **Semi-Automated Review**: Client Hunter does not automate WhatsApp via unauthorized bots or emulators. The application prepares the message and launches WhatsApp; the user reviews and sends the message, then confirms the outcome in Client Hunter.

### AI Messaging & Assistant
* **Contextual Pitch Generation**: Integrates with Google Generative Language API (Gemini) to draft personalized pitches based on lead details, rating, location, and web presence.
* **Multi-Model Fallback**: Uses configured Gemini models (trying `gemini-3.5-flash-lite`, `gemini-3.5-flash`, and `gemini-3.6-flash`) with timeout handling.
* **Follow-Up Stage Messaging**: Generates follow-up messages tailored to each cadence step (Steps 1 through 5).
* **AI Assistant Chat**: In-app conversational assistant with direct access to current system metrics (total leads, daily outreach target, follow-ups due, overdue tasks).
* **Customization**: Configure tone (*Friendly*, *Professional*, *Direct*, *Consultative*), approach, length, and call-to-action styles.
* **API Key Requirement**: Requires a valid `GEMINI_API_KEY`. If unconfigured, template-based outreach remains fully functional.

### Analytics & Daily Performance
* **Daily Performance Summary**: Tracks daily outreach targets (e.g., 50 messages/day), sent counts, and milestone progress.
* **Dashboard KPIs**: Real-time counters for total saved leads, active outreach, follow-ups due, conversion rates, and response metrics.

### Backup & Restore
* **1-Click JSON Backups**: Exports full application snapshots (leads, settings, outreach settings, activity timeline, search history) without sensitive credentials.
* **Automatic Pre-Restore Snapshots**: Automatically creates a timestamped safety backup (`safety_backup_pre_restore_<timestamp>.json`) before applying any restore.
* **Pre-Write Safety Backups**: Automatically maintains `leads_store_last_valid.json` before disk write operations.
* **Backup Validation & Preview**: Inspects backup files before restoration, verifying schema validity and previewing lead counts, favorites, notes, and activity records.
* **Recent Backups Registry**: Tracks up to 25 recent backup files with timestamps and validation status.

### Settings & Customization
* **Profile Management**: Set your name, agency/company name, contact information, website, and portfolio URL for automatic interpolation.
* **Services Configuration**: Define offered services that dynamically populate outreach templates.
* **Template Editor**: Create, edit, and manage custom outreach and follow-up templates.
* **WhatsApp Preferences**: Select between WhatsApp Desktop client or WhatsApp Web launch modes, and configure auto-timer delays.
* **Target Management**: Set custom daily outreach targets and progress indicators.

### Data Health & Diagnostics
* **System Health Endpoint**: Accessible via `/api/diagnostics/health` and the Settings interface.
* **Store Verification**: Checks local JSON store readability, file size, lead counts, and last modification timestamps.
* **Connection Testing**: Reports active connection status for Google Places API, Gemini AI, and Supabase.

### Navigation & Desktop Experience
* **Maximized Startup**: Electron container launches directly into a maximized desktop window.
* **Single-Instance Enforcement**: Prevents multiple overlapping application processes from running simultaneously.
* **Backend Crash Recovery**: Automatically monitors the local Express process and presents an instant recovery dialog to restart services without data loss.
* **Go To Top Navigation**: Smooth floating **↑ Top** control active on primary workflow views (**Dashboard**, **Saved Leads**, **Favorites**, **Outreach**, **Follow-Up**, and **History**).

---

## Application Workflow

```text
Discovery Search
   │ (Google Places API New + India Geo-Targeting)
   ▼
Lead Qualification
   │ (Filters for Valid Phone + No Website)
   ▼
Saved Leads
   │ (Score, Filter, Tag, Add Notes)
   ▼
Move to Outreach
   │ (Queue Leads for Outreach Session)
   ▼
Compose Pitch
   │ (Choose Template or Generate with Gemini AI)
   ▼
Launch WhatsApp
   │ (Opens Desktop or Web via whatsapp:// or wa.me)
   ▼
Confirm Status
   │ (Key 1: Sent | Key 2: Not Sent | Key 3: Not on WhatsApp)
   ▼
Scheduled Follow-Up
   │ (Day 2 → Day 4 → Day 7 → Day 10 → Day 14 Cadence)
   ▼
Conversion / Outcome
     (Mark Won / Lost / Replied / Completed)
```

---

## Technology Stack

| Component | Technology | Version | Purpose |
| :--- | :--- | :--- | :--- |
| **Desktop Container** | Electron | 44.4.1 | Native Windows window management, single-instance locking, native dialogs |
| **Local Backend** | Node.js / Express | Express 5.2.1 | Local REST API, file system operations, API request coordination |
| **Frontend UI** | Vanilla HTML5 / CSS3 / JavaScript | — | Interface rendering, state handling, zero external frontend framework overhead |
| **Local Storage** | JSON File Store | — | Offline-first persistence with atomic writes and rollback copies |
| **Cloud Sync (Optional)** | Supabase (`@supabase/supabase-js`) | 2.116.0 | Optional remote database sync and cloud backup |
| **Discovery API** | Google Places API (New) | v1 | Geolocation search (`searchText`, `searchNearby`) |
| **AI Personalization** | Google Generative Language API | v1beta | AI pitch generation (`gemini-3.5-flash-lite`, `gemini-3.5-flash`, `gemini-3.6-flash`) |
| **Desktop Packaging** | electron-builder | 26.15.3 | NSIS installer and portable executable generation for Windows |
| **Platform** | Windows | 10 / 11 (x64) | Primary target operating system |

---

## Architecture

### Process Model & Lifecycle

Client Hunter runs as an integrated desktop application:

1. **Main Process (Electron)**: Checks for an active single-instance lock. If no other instance is running, it locates an available local port (defaulting to 3000, or finding an ephemeral free port if occupied).
2. **Backend Server (Node.js/Express)**: Electron forks `server.js` as a background child process with IPC communication. The server handles all data operations, local file persistence, and external API requests.
3. **Readiness Probe**: Electron polls `http://127.0.0.1:<PORT>/api/system/status` until the backend confirms readiness.
4. **Renderer Window**: Once verified, Electron creates the main `BrowserWindow` in a maximized state and loads the local interface. External links (such as WhatsApp URIs and Google Maps links) are delegated to the system default browser via Electron's `shell.openExternal`.
5. **Clean Teardown**: Upon application exit, Electron terminates the server child process using graceful IPC signals and Windows `taskkill` process-tree cleanup to prevent orphan background processes.

### Crash Recovery

If the local backend process terminates unexpectedly:
* Electron catches the exit event and displays an in-app recovery dialog.
* Clicking **Restart Services** terminates any residual process, re-allocates a port if necessary, restarts `server.js`, and re-establishes connection without requiring an application restart.
* Existing lead data remains intact on disk.

---

## Data Storage & Safety

### Storage Model

Client Hunter stores data locally on the user's file system:

* **Runtime User Data**:
  ```text
  %APPDATA%\clienthunter\data\leads_store.json
  ```
  *(In development: `data/leads_store.json`)*
* **Local Safety Backups**:
  ```text
  %APPDATA%\clienthunter\data\backups\
  ```
* **Bundled Seed Database**:
  `data/leads_store.json` (packaged with the application to initialize a clean store on new installations).

### Atomic Writes & Rollback Protection

* **Atomic File Writes**: File writes are executed by writing data to a temporary file (`.tmp`) first and renaming it to `leads_store.json`. This ensures that power cuts or process interruptions do not corrupt existing data.
* **Pre-Write Snapshot**: Before each write operation, a copy of the active store is preserved as `leads_store_last_valid.json` in the backups folder.
* **Update Isolation**: Packaged desktop updates do not touch or overwrite the runtime `%APPDATA%\clienthunter\data\` directory.

### Optional Cloud Synchronization (Supabase)

If `SUPABASE_URL` and `SUPABASE_ANON_KEY` (or `SUPABASE_SERVICE_ROLE_KEY`) are configured:
* The application synchronizes saved leads, status updates, and outreach states with your remote Supabase PostgreSQL database.
* If Supabase is unconfigured or the network is unavailable, Client Hunter operates in offline-first mode using the local JSON store.

---

## Getting Started

### Prerequisites

* **Node.js**: v18.0.0 or higher
* **npm**: v9.0.0 or higher
* **Operating System**: Windows 10 / 11 (for desktop binaries)

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/akshay118R/Client-Hunter.git
   cd Client-Hunter
   ```

2. Install project dependencies:
   ```bash
   npm install
   ```

### Environment Configuration

Create a `.env` file in the project root based on `.env.example`:

```bash
copy .env.example .env
```

Configure your environment variables:

```env
PORT=3000
GOOGLE_MAPS_API_KEY=your_google_maps_api_key_here
GOOGLE_PLACES_API_KEY=your_google_places_api_key_here
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_ANON_KEY=your_supabase_anon_key_here
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key_here
GEMINI_API_KEY=your_gemini_api_key_here
```

> [!NOTE]
> * `GOOGLE_MAPS_API_KEY` or `GOOGLE_PLACES_API_KEY` is required for lead discovery.
> * `GEMINI_API_KEY` is required for AI pitch generation and AI Assistant features.
> * Supabase variables are optional. If omitted, the app runs entirely on local storage.

---

## Development

Run the local Express backend server only:
```bash
npm start
```
The server will start at `http://localhost:3000`.

Run the full desktop application in development mode:
```bash
npm run desktop:dev
```
This launches the Electron container, starts the local server child process, and opens the maximized desktop interface.

---

## Building the Windows Application

Packaging is handled via `electron-builder`.

### 1. Build Unpacked Directory
Compiles the application and generates the unpacked native executable directory for fast local testing:
```bash
npm run desktop:build
```
* **Output Path**: `dist/win-unpacked/Client Hunter.exe`

### 2. Build Production Distributions
Packages the production binaries for deployment:
```bash
npm run desktop:dist
```
* **NSIS Setup Installer**: `dist/Client Hunter-Setup.exe`
* **Standalone Portable Executable**: `dist/Client Hunter-Portable.exe`

---

## Update System

* **Current Version**: `2.2.0`
* **Build Identifier**: `Build 20260920.1` (`CH-20260920-R1`)
* **Update Verification**: Navigate to **Settings → Check for Updates**. The application checks `/api/system/check-updates` and references published releases at:
  ```text
  https://github.com/akshay118R/Client-Hunter/releases
  ```
* When an update is detected, Client Hunter notifies the user and provides a link to download the latest installer from GitHub Releases. Updates are not installed silently or automatically.

---

## Project Structure

```text
Client-Hunter/
├── assets/                  # Application icons, logos, and window graphics
│   ├── icon.ico
│   ├── icon.png
│   └── logo.png
├── data/                    # Datasets and local persistence templates
│   ├── categories.json      # Curated business categories and search synonyms
│   ├── india_locations.json # India states, union territories, districts, and coordinates
│   └── leads_store.json     # Bundled initial store template
├── electron/                # Desktop shell scripts
│   ├── main.js              # Electron lifecycle, window creation, crash recovery, IPC
│   └── preload.js           # Secure context bridge exposing desktop dialogs
├── index.html               # Main desktop user interface layout and modals
├── main.js                  # Frontend state machine, DOM rendering, outreach queue
├── styles.css               # Application stylesheet, dark theme tokens, layout rules
├── server.js                # Express backend, Google Places integration, Gemini AI, storage
├── supabase_schema.sql      # Optional cloud database table schema and indexes
├── package.json             # Application metadata, scripts, and dependencies
├── .env.example             # Example environment variable template
└── README.md                # Project documentation
```

---

## License

Private / Personal Project. All rights reserved.

This repository is maintained for personal use and portfolio reference. Unauthorized redistribution or commercial reuse is prohibited without prior permission from the author.
