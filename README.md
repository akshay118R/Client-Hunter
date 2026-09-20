# Client Hunter — AI-Powered B2B Client Acquisition System

<p align="center">
  <img src="https://img.shields.io/badge/Version-2.2.0-10b981?style=for-the-badge" alt="Version 2.2.0" />
  <img src="https://img.shields.io/badge/Electron-44.4.1-47848F?style=for-the-badge&logo=electron&logoColor=white" alt="Electron 44" />
  <img src="https://img.shields.io/badge/Node.js-18+-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js 18+" />
  <img src="https://img.shields.io/badge/Express-5.2-000000?style=for-the-badge&logo=express&logoColor=white" alt="Express 5.2" />
  <img src="https://img.shields.io/badge/Supabase-Database-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white" alt="Supabase Cloud" />
  <img src="https://img.shields.io/badge/Google%20Places-API%20(New)-4285F4?style=for-the-badge&logo=google-maps&logoColor=white" alt="Google Places API" />
  <img src="https://img.shields.io/badge/Google%20Gemini-3.8%20Flash-8E75C2?style=for-the-badge&logo=google-gemini&logoColor=white" alt="Google Gemini AI" />
  <img src="https://img.shields.io/badge/License-MIT-blue?style=for-the-badge" alt="License MIT" />
</p>

---

## ⚡ Overview

**Client Hunter** is an enterprise-grade, high-velocity B2B revenue and client acquisition desktop workstation. Built specifically for digital agencies, web developers, marketing consultants, and B2B service providers, it discovers high-intent local business prospects across India, scores digital opportunity potential, conducts automated deep AI audits, and executes high-converting WhatsApp pitches and scheduled follow-up cadences.

Operating as an offline-first Windows desktop application with self-healing backend processes, Client Hunter guarantees **zero data loss** through dual-tier persistence (local disk snapshotting + optional Supabase cloud synchronization) while adhering to a **100% ban-proof WhatsApp outreach protocol**.

---

## 🚀 End-to-End Client Acquisition Pipeline

```mermaid
flowchart LR
    A["📍 Hyper-Local Discovery<br/>(Google Places API New)"] --> B["🔥 Opportunity Scoring<br/>(0–100 Digital Gap Score)"]
    B --> C["🧠 Gemini AI Copilot<br/>(Deep Audit & Pitch Lab)"]
    C --> D["💬 1-Click WhatsApp Outreach<br/>(Anti-Ban Protocol via wa.me)"]
    D --> E["📅 14-Day Cadence Engine<br/>(Smart Timers & Follow-ups)"]
    E --> F{"Client Response"}
    F -- "Objection" --> G["💡 AI Objection Handler<br/>(Instant Rebuttal Engine)"]
    G --> D
    F -- "Interested / Book Call" --> H["🏆 Deal Won<br/>(Revenue Added to Pipeline)"]
```

---

## 🌟 Innovative Features & System Modules

### 1. 📍 Hyper-Local Discovery Engine
* **Google Places API (New)**: Next-generation multi-page text search pagination querying live business listings across all **36 Indian States & Union Territories** and **750+ districts**.
* **50+ Pre-Configured High-Value Niches**: Real Estate, Dental Clinics, Spas & Salons, Gyms, Cafes, Hospitals, Boutiques, Coaching Centers, and more.
* **Coordinate-Aware Geo-Biasing**: City-centric coordinate resolution with dynamic radius biasing (1–100 km) to surface hyper-targeted geographical clusters.
* **Duplicate Lead Shield**: Automatic duplicate suppression during active discovery matching unique Google Place IDs and normalized E.164 phone numbers.

### 2. 🔥 Intelligent Opportunity Scoring Algorithm (0–100)
* **Website Gap Detection**: Automatically isolates businesses with missing, broken, or outdated web presences, or those operating exclusively via unverified social pages (**+40 Opportunity Score**).
* **Reputation & Review Diagnostics**: Analyzes rating tiers and user review density to uncover high-volume businesses ripe for digital conversion upgrades or reputation engineering.
* **Smart Tiering & Action Triggers**: Categorizes prospects into **High**, **Medium**, and **Low** opportunity tiers with explicit reasoning breakdowns for each lead.

### 3. 🧠 Gemini AI Growth Copilot & Pitch Lab
* **Deep Business Digital Audits (`/api/leads/:id/ai-audit`)**: Generates an instant, comprehensive 4-point agency audit for any selected lead:
  1. *Executive Summary*: 2-sentence situational assessment.
  2. *Top 3 Revenue Leaks*: Pinpoints missing digital assets, poor mobile accessibility, or booking bottlenecks.
  3. *Recommended High-Ticket Solutions*: Tailored agency deliverables (custom web apps, WhatsApp automated booking flows, local SEO).
  4. *Cold Pitch Angle & Deal Value*: Recommended positioning with projected project valuation in **INR (₹)**.
* **Real-Time WhatsApp Objection Handling & Rebuttals (`/api/outreach/ai-reply`)**: Instant consultative responses to overcome prospect resistance:
  * *"Too expensive / what are your rates?"*
  * *"We already have a web developer / agency."*
  * *"Send details / portfolio on WhatsApp."*
  * *"Not interested right now."*
  * *"Call or contact me next month."*
* **Contextual Pitch Synthesis**: Powered by Google's **Gemini 3.8 Flash** engine, personalizing pitches based on rating, location, category, and dynamically enabled agency services.

### 4. 💬 100% Anti-Ban WhatsApp Outreach Terminal
* **Compliant `wa.me` Deep-Linking Protocol**: Launches messages directly via WhatsApp Web or native WhatsApp Desktop with zero headless browser automation or unauthorized API scraping — eliminating SIM ban risks.
* **Outreach Sequence Queue**: Batch-pitch queued leads sequentially with single-click advancement, keeping focus uninterrupted.
* **11 Field-Tested Pitch Templates**: Curated library with dynamic variable interpolation (`{businessName}`, `{category}`, `{city}`, `{my_name}`, `{my_company}`, `{portfolio_url}`, `{my_services}`).
* **Outcome & Conversion Tracking**: Log call and message statuses (*Contacted*, *Replied*, *Interested*, *Not Interested*, *Not on WhatsApp*).
* **Activity Timeline & Instant Undo**: Complete chronological audit trail with instant undo recovery for accidentally deleted leads or outreach records.

### 5. 📅 Day-Anchored 14-Day Cadence Engine
* **Automated Multi-Touch Follow-Up Schedule**: Systematically anchored to Day 0 (Initial Pitch):
  * **Day 0**: Initial Outreach Pitch
  * **Day 2**: Follow-Up #1 — *Gentle Nudge*
  * **Day 4**: Follow-Up #2 — *Quick Check-in*
  * **Day 7**: Follow-Up #3 — *Value Addition & Portfolio*
  * **Day 10**: Follow-Up #4 — *Low-Pressure Closing*
  * **Day 14**: Follow-Up #5 — *Final Breakaway Note*
* **Smart Urgency Ranking**: Automatically flags due and overdue cadences, surfacing the hottest prospects first.
* **"Stop on Reply" Protection**: Progresses automatically halt as soon as a lead responds, preventing awkward duplicate pitches.
* **Configurable Smart Dispatch Timers**: Power-user automation controls with customizable countdown delays (*Immediate 0s*, *3s*, *5s*, *10s*, *15s*, *20s*, *30s*).

### 6. 🗃️ Terminal Lead Management & Advanced Filtering
* **High-Performance Offline Table**: Virtualized list handling thousands of leads with instant search and multi-column sorting.
* **Multi-Dimensional Query Filter**: Filter simultaneously by opportunity tier, rating range, review count, geographical region, website presence, and outreach state.
* **Dynamic Color Tags & Notes**: Multi-line timestamped notes and custom color badges for granular lead classification.
* **Saved Views**: Persist and recall complex filter criteria in a single click across desktop sessions.
* **1-Click Favorites**: Dedicated high-priority prospect vault with bulk actions.

### 7. 📊 Performance Analytics & Revenue Dashboard
* **Velocity Metrics**: Real-time tracking of leads discovered, messages sent, response rates, and pipeline progression.
* **Daily Target Milestone Bars**: Visual pacing indicators against daily prospecting goals.
* **Pipeline Valuation Tracker**: Live INR (₹) revenue estimates based on active negotiations and won deals.
* **System Health Diagnostics**: Live reporting of database integrity, connection status, and API availability.

### 8. 🛡️ Dual-Tier Hybrid Persistence & Disaster Recovery
* **Isolated Data Runtime**: All user data, notes, activity history, and settings live securely in `%APPDATA%\clienthunter\data\leads_store.json`, safe from application updates and binary reinstalls.
* **Supabase Cloud Sync (Optional)**: Bidirectional cloud synchronization for remote PostgreSQL backups and multi-device access.
* **1-Click Safety Snapshots**: Export version-controlled JSON snapshots stripped of secret API keys.
* **Pre-Restore Rollback Shield**: Automatically creates an emergency snapshot prior to any restore action.
* **Disaster Recovery Failover**: In the event of an unexpected power cut or storage corruption, Client Hunter automatically restores from `leads_store_last_valid.json`.

### 9. 📤 RFC 4180 Advanced Export Engine
* **28-Column Full CRM CSV**: Comprehensive export formatted strictly to RFC 4180 specifications.
* **Indian Unicode & ₹ Rupee Support**: Includes UTF-8 BOM (`\uFEFF`) to ensure Excel and Google Sheets render Hindi, Telugu, and ₹ currency symbols flawlessly.
* **Data Sanitization & Format Guard**: Preserves leading zeroes on STD codes and phone numbers (`+91` / `040`) and safely escapes commas and multiline notes.
* **7 Granular Export Scopes**: Export All Saved Leads, Filtered Results, Selected Rows, Favorites, Outreach Queue, Follow-Up Pipeline, or Full JSON System Backups.

---

## 💡 Why Client Hunter? (Competitive Matrix)

| Feature / Capability | Traditional Web Scrapers | Manual Google / WhatsApp | Client Hunter 2.2 |
| :--- | :---: | :---: | :---: |
| **Discovery Source** | Stale static directories | Slow manual web search | **Live Google Places API (New)** |
| **Coverage** | Generic / incomplete | Fragmented | **750+ Indian Districts & 36 States** |
| **Opportunity Qualification** | None (raw data dump) | Manual inspection | **Automated 0–100 Opportunity Score** |
| **Deep AI Pitch Audits** | ❌ No | ❌ No | **✅ Gemini 3.8 Flash B2B Audits** |
| **WhatsApp Ban Risk** | 🚨 High (Unregulated Bots) | Low (Tiring & slow) | **🛡️ Zero (100% Compliant wa.me)** |
| **AI Objection Handler** | ❌ No | ❌ No | **✅ 1-Click WhatsApp Rebuttal Engine** |
| **Cadence Automation** | ❌ Manual spreadsheets | ❌ Easy to forget | **✅ 14-Day Day-Anchored Cadence** |
| **Data Safety & Offline Mode** | ❌ Cloud-dependent / Fragile | ❌ Lost in chat tabs | **✅ Dual-Tier Hybrid Persistence** |
| **Indian Localization (₹ & Unicode)** | ❌ Often garbled | Manual | **✅ Native UTF-8 BOM + INR Pipeline** |

---

## 🛠️ Technology Stack

| Layer | Technology | Role & Architecture |
| :--- | :--- | :--- |
| **Desktop Shell** | Electron 44.4.1 | Native Windows container, maximized startup, single-instance lock, backend lifecycle supervision |
| **Backend API** | Node.js & Express 5.2 | Local REST API, input validation, automated snapshotting, failover recovery |
| **Frontend UI** | HTML5 & Vanilla CSS3 | Modern glassmorphism dark theme, custom design tokens, micro-interactions, zero framework overhead |
| **Client Logic** | Vanilla JavaScript | State machine architecture with instant DOM reactivity |
| **Cloud Database** | Supabase (PostgreSQL) | Optional cloud backup, sync layer, and multi-machine persistence |
| **AI Engine** | Google Gemini 3.8 Flash | B2B lead audits, pitch personalization, objection rebuttals, follow-up copy |
| **Places Engine** | Google Places API (New) | Hyper-local business discovery and geolocation queries |
| **Packaging** | Electron Builder 26.15.3 | Automated generation of NSIS installer (`.exe`) and portable standalone binaries |

---

## 🖥️ Desktop Application Architecture

Client Hunter runs as a coordinated single-instance desktop workstation:
1. **Single-Instance Enforcement**: Electron secures a single-instance lock, focusing the existing active window if launched again.
2. **Local API Server**: Launches internal Express backend on port 3000 (with automatic conflict resolution if occupied).
3. **Maximized Native Window**: Boots directly in a maximized state with custom styling and system integration.
4. **Self-Healing Backend Watchdog**: Real-time heartbeat supervision automatically restarts backend processes in the rare event of a crash without data loss.

```
+-------------------------------------------------------------+
|                     Client Hunter Desktop                   |
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

---

## 🗄️ Data Storage Paths

* **Runtime Data Store**:
  `%APPDATA%\clienthunter\data\leads_store.json`
* **Local Safety Backups**:
  `%APPDATA%\clienthunter\data\backups\`
* **Crash Recovery Fallback**:
  `%APPDATA%\clienthunter\data\leads_store_last_valid.json`
* **Clean Seed Database**:
  `data/leads_store.json` (bundled with installer to initialize clean stores on fresh installations)

> [!IMPORTANT]
> **Zero-Loss Data Isolation**: Runtime data in `%APPDATA%\clienthunter` is fully decoupled from executable binaries. Updating or reinstalling Client Hunter will never overwrite your saved leads, notes, or outreach history.

---

## 🚀 Getting Started

### Prerequisites
* **Node.js** v18.0.0 or higher
* **npm** v9.0.0 or higher
* **Windows 10 / 11** (for desktop binary packaging)

### Installation & Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/akshay118R/Client-Hunter.git
   cd Client-Hunter
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure Environment Variables:**
   Copy the example `.env.example` file to `.env`:
   ```bash
   cp .env.example .env
   ```
   Open `.env` and provide your API keys:
   ```env
   PORT=3000
   GOOGLE_PLACES_API_KEY=your_google_places_api_key
   GEMINI_API_KEY=your_gemini_api_key
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_ANON_KEY=your_supabase_anon_key
   SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
   ```

4. **Launch Application in Development Mode:**
   ```bash
   npm run desktop:dev
   ```
   *To launch only the local server for browser testing:*
   ```bash
   npm start
   ```

5. **Initialize Supabase Cloud Tables (Optional):**
   Run the contents of `supabase_schema.sql` inside your Supabase SQL Editor.

---

## 📦 Packaging & Build Instructions

Client Hunter uses Electron Builder to produce standalone production distributions:

### 1. Build Unpacked Testing Directory
Compiles the application without packaging into an installer:
```bash
npm run desktop:build
```
* **Output Binary**: `dist/win-unpacked/Client Hunter.exe`

### 2. Build Production Distributions (Installer & Portable)
Generates high-compression release executables:
```bash
npm run desktop:dist
```
* **NSIS Setup Installer**: `dist/Client Hunter-Setup.exe`
* **Standalone Portable Executable**: `dist/Client Hunter-Portable.exe`

---

## 🔄 Version Information

* **Application Version**: `2.2.0`
* **Release Build**: `CH-20260920-R1`
* **Update Verification**: Navigate to **Settings > About** and click **Check for Updates** to compare your active build with the latest release.

---

## 🛡️ License

This project is licensed under the **MIT License** — see the `LICENSE` file for details.
