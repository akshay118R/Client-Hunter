# Client Hunter — AI-Powered B2B Client Acquisition System

![Version](https://img.shields.io/badge/version-2.2.0-emerald?style=for-the-badge)
![Electron](https://img.shields.io/badge/Electron-44.4.1-47848F?style=for-the-badge&logo=electron&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=for-the-badge&logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-5.2-000000?style=for-the-badge&logo=express&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-Database-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white)
![Google Places](https://img.shields.io/badge/Google%20Places-API%20(New)-4285F4?style=for-the-badge&logo=google-maps&logoColor=white)

Client Hunter is a high-velocity B2B revenue and client acquisition desktop application designed to discover local business leads across India, score high-value outreach opportunities, and execute high-converting WhatsApp pitches and scheduled follow-up cadences with AI personalization.

Packaged as a standalone Windows desktop application, Client Hunter operates offline-first with local persistence, native window behavior, and optional cloud synchronization with Supabase.

---

## 🌟 Main Features & Modules

### 1. 📍 Hyper-Local Discovery Engine
* **Google Places API (New)**: Multi-page text search pagination across all **36 States & Union Territories** and **750+ districts** in India.
* **50+ Curated Business Niches**: Real Estate, Dental Clinics, Spas & Salons, Gyms, Cafes, Hospitals, Boutiques, and more.
* **Geo-Targeting & Query Expansion**: City-aware coordinate resolution with adaptive radius biasing (1–100 km).
* **Duplicate Lead Protection**: Automatically identifies and suppresses duplicate leads during discovery searches using unique Google Place IDs and normalized phone numbers.

### 2. 🗃️ Lead Management & Organization
* **Saved Leads Terminal**: High-performance offline table featuring instant search, pagination, and multi-criteria sorting.
* **Favorites**: 1-click bookmarking system with a dedicated Favorites tab and bulk export capabilities.
* **Lead Notes**: Multi-line structured notes per lead with automatic timestamping and persistence.
* **Lead Tags**: Custom colored tag chips for categorization with instant filter matching.
* **Better Lead Filtering**: Granular multi-dimensional filtering by opportunity score tier, rating range, review count, location, and website availability.
* **Global & Activity Search**: Instant real-time filtering across lead business names, contact numbers, categories, and interaction logs.
* **Lead Conversion Tracking**: Record lead qualification status (*Won*, *Lost*, *In Progress*) with conversion metrics.
* **Saved Views**: Save complex filter configurations for single-click recall across sessions.

### 3. 🔥 Opportunity Scoring Algorithm (0–100)
* **Website Presence Analysis**: Automatically identifies businesses lacking modern websites or relying solely on unverified social profiles (+40 opportunity score).
* **Review & Reputation Analysis**: Evaluates user review volume and rating signals to pinpoint businesses ripe for digital transformation or reputation enhancement.
* **Opportunity Tiering**: High, Medium, and Low classification with clear reasoning breakdowns.

### 4. 💬 WhatsApp Outreach Terminal
* **Compliant 1-Click WhatsApp Send**: Generates direct WhatsApp Web or Desktop links via `wa.me` with interpolated pitch copy — 100% compliant with zero risk of account automation bans.
* **Outreach Sequence Queue**: Batch message selected leads in sequence without losing focus or repetitive navigation.
* **Custom Message Templates**: 11 pre-packaged, field-tested templates with dynamic variable interpolation (`{businessName}`, `{category}`, `{city}`, `{my_name}`, `{my_company}`, `{portfolio_url}`).
* **Contact Outcomes & Reason Tracking**: Categorize outreach results (*Contacted*, *Replied*, *Interested*, *Not Interested*, *Not on WhatsApp*).
* **Keyboard Shortcuts**: Rapid shortcuts for message preview, queue advancement, and sending.
* **Complete Outreach Activity Timeline**: Chronological log of every pitch sent, template used, and outcome recorded.
* **Undo Delete**: Instant undo action for accidentally deleted leads or outreach records.

### 5. 📅 Day-Anchored Follow-Up System
* **Automated Cadence Schedule**: Follow-up cadence automatically anchored to Day 0 (Initial Outreach):
  * **Day 0**: Initial Outreach Pitch
  * **Day 2**: Follow-Up #1 — *Gentle Nudge*
  * **Day 4**: Follow-Up #2 — *Quick Check-in*
  * **Day 7**: Follow-Up #3 — *Service Value*
  * **Day 10**: Follow-Up #4 — *Low-Pressure Closing*
  * **Day 14**: Follow-Up #5 — *Final Note*
* **Smart Follow-Up Queue**: Automatically calculates overdue vs. upcoming cadences and ranks prospects by urgency.
* **Due Today & Overdue Filters**: Dedicated views to highlight prospects requiring action today.
* **Pause / Resume Cadence**: Pause automated sequences for responsive leads or manual negotiations.
* **Stop on Reply**: Automatically halts sequence progression when a prospect responds.
* **Follow-Up WhatsApp Timer**: Configurable automatic dispatch delay (*Off*, *3s*, *5s*, *10s*, *15s*, *20s*, *30s*).
* **Immediate Option**: 0-second automatic WhatsApp launch option for power users wanting instant dispatch without a countdown popup.

### 6. 📊 Analytics & Daily Performance Summary
* **Daily Performance Summary**: Tracks daily outreach targets, milestones, and goal progress bars.
* **KPI Dashboard**: Real-time metrics for total leads discovered, outreach velocity, response rates, and conversion ratios.
* **Data Health & Diagnostics**: Dedicated system diagnostics reporting store integrity, database connectivity, and runtime metrics.

### 7. 🤖 AI Assistant (Gemini)
* Powered by Google's **Gemini 3.8 Flash** engine.
* Generates bespoke, personalized pitches tailored to the lead's business name, category, rating, location, and digital presence.
* Configurable tone, length, approach, and call-to-action styles.

### 8. 💾 Backup, Restore & Data Safety
* **1-Click Safety Backups**: Export versioned, structured JSON snapshots of leads and configurations without secrets.
* **Automatic Pre-Restore Snapshots**: Generates an automatic rollback snapshot before any restore operation.
* **Restore Preview**: Inspect lead count, timestamp, and backup metadata before committing a database restore.
* **Disaster Recovery**: Automated fallback to `leads_store_last_valid.json` on unexpected shutdown or file corruption.

### 9. ⬆️ Quick "↑ Top" Navigation
* **Floating Action Pill**: Sleek, compact **“↑ Top”** button with emerald glow and smooth lift animation matching Client Hunter's visual design.
* **Intelligent Visibility**: Remains hidden at the top and gracefully fades in when scrolling down; smoothly hides upon return or view change.
* **Dedicated Scoping**: Active exclusively on the 6 primary workflow views: **Dashboard**, **Saved Leads**, **Favorites**, **Outreach**, **Follow-Up**, and **History**.
* **Seamless Behavior**: Returns the view to the top with a smooth native scroll without reloading, navigating, or resetting filters, pagination, or active timers.

---

## 🛠️ Technology Stack

| Component | Technology | Purpose |
| :--- | :--- | :--- |
| **Desktop Shell** | Electron 44 | Standalone native Windows container with maximized startup behavior and backend lifecycle management |
| **Backend API** | Node.js & Express 5.2 | High-throughput local REST API, data validation, and crash recovery routines |
| **Frontend UI** | Vanilla HTML5 & CSS3 | Fast, framework-free client interface with custom design tokens, dark theme, and micro-interactions |
| **Client State** | Vanilla JavaScript | State machine and DOM rendering with zero runtime overhead |
| **Cloud Database** | Supabase (PostgreSQL) | Optional cloud persistence, backup storage, and multi-device synchronization |
| **Packaging** | Electron Builder 26 | Automated generation of NSIS installer (`.exe`) and portable executables |
| **APIs** | Google Places (New), Google Gemini | Geolocation discovery and contextual AI pitch generation |

---

## 🖥️ Desktop Application Architecture

Client Hunter runs as a single-instance Windows desktop application. When launched:
1. Electron initializes and checks for existing active instances.
2. The internal Express backend server starts on designated local port 3000 (with automatic conflict resolution).
3. The main application window launches automatically in a **maximized state**.
4. Built-in crash recovery automatically monitors the backend and provides instant restart without data loss.

---

## 🗄️ Data Storage Architecture

Client Hunter uses an offline-first storage model that isolates runtime data from application binaries:

* **Runtime Data Location**:
  `%APPDATA%\clienthunter\data\leads_store.json`
* **Local Safety Backups**:
  `%APPDATA%\clienthunter\data\backups\`
* **Seed Database Template**:
  `data/leads_store.json` (bundled with installer to initialize clean stores for new installations)
* **Cloud Database (Optional)**:
  Supabase PostgreSQL synchronization for remote backup and multi-seat sync.

> [!IMPORTANT]
> **Data Safety Guarantee**: Application updates and binary rebuilds do not overwrite runtime data in `%APPDATA%\clienthunter`. Always generate a manual backup via Settings prior to major system migrations.

---

## 🚀 Getting Started

### Prerequisites
* **Node.js** v18.0.0 or higher
* **npm** v9.0.0 or higher
* **Windows 10 / 11** (for packaged desktop binaries)

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
   Copy the example `.env.example` file:
   ```bash
   cp .env.example .env
   ```
   Open `.env` and fill in your API credentials:
   ```env
   PORT=3000
   GOOGLE_PLACES_API_KEY=your_google_places_api_key_here
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_ANON_KEY=your_supabase_anon_key_here
   SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key_here
   GEMINI_API_KEY=your_gemini_api_key_here
   ```

4. **Initialize Supabase Schema (Optional):**
   Execute `supabase_schema.sql` in your Supabase SQL Editor to initialize cloud tables and indexes.

---

## 📦 Build Instructions

Client Hunter provides two build modes via Electron Builder:

### 1. Build Unpacked Directory
Compiles the application and generates the unpacked native executable directory for fast local testing:
```bash
npm run desktop:build
```
* **Output Path**: `dist/win-unpacked/Client Hunter.exe`

### 2. Build Production Distributions (Installer & Portable)
Packages the production binaries for deployment:
```bash
npm run desktop:dist
```
* **NSIS Setup Installer**: `dist/Client Hunter-Setup.exe`
* **Standalone Portable Executable**: `dist/Client Hunter-Portable.exe`

---

## 🔄 Version & Updates

* **Current Version**: `2.2.0`
* **Build Number**: `Build 20260920.1` (`CH-20260920-R1`)
* **Check for Updates**: Built directly into **Settings > About**. Clicking **Check for Updates** queries the update service to compare the current build against the latest release.

---

## 🛡️ License

This project is licensed under the MIT License — see the LICENSE file for details.
