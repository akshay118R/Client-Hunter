# Client Hunter — AI-Powered B2B Client Acquisition System

![Version](https://img.shields.io/badge/version-2.0.0-emerald?style=for-the-badge)
![Electron](https://img.shields.io/badge/Electron-44.4.1-47848F?style=for-the-badge&logo=electron&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=for-the-badge&logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-5.2-000000?style=for-the-badge&logo=express&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-Database-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white)
![Google Places](https://img.shields.io/badge/Google%20Places-API%20(New)-4285F4?style=for-the-badge&logo=google-maps&logoColor=white)

Client Hunter is a high-velocity B2B revenue and client acquisition desktop application designed to discover local business leads across India, score high-value outreach opportunities, and execute high-converting WhatsApp pitches and scheduled follow-up cadences with AI personalization.

---

## 🌟 Key Features

### 1. 📍 Hyper-Local Discovery Engine
* **Google Places API (New)**: Multi-page text search pagination across all **36 States & Union Territories** and **750+ districts** in India.
* **50+ Curated Business Niches**: Real Estate, Dental Clinics, Spas & Salons, Gyms, Cafes, Hospitals, and more.
* **Intelligent Query Expansion & Geo-Targeting**: City-aware coordinate resolution with adaptive radius biasing (1–100 km).

### 2. 🔥 Opportunity Scoring Algorithm (0–100)
* Automatically analyzes digital footprint:
  * **Website Presence**: Detects businesses lacking websites or relying on unverified social profiles (+40 opportunity score).
  * **Review & Reputation Analysis**: Evaluates user review volume and rating signals to pinpoint businesses ready for reputation management or digital modernization.
  * **Opportunity Tiering**: High, Medium, and Low opportunity classification with actionable reason breakdowns.

### 3. 💬 WhatsApp Outreach Terminal
* **Zero-Friction 1-Click WhatsApp Send**: Generates direct WhatsApp Web/Desktop links with fully interpolated messages.
* **Safe Confirmation Workflow**: Prevents false-positive status marks with explicit delivery verification.
* **"Not on WhatsApp" Removal**: Instant 1-click removal of numbers not registered on WhatsApp, keeping outreach queues clean and efficient.
* **Sequential Outreach Queue**: Batch message selected leads in sequence without repetitive clicking or losing context.

### 4. 📝 Custom Pitch Templates & Live Variable Preview
* **11 Pre-Packaged High-Converting Templates**:
  1. *Website Outreach* (Default)
  2. *Voice Agent Outreach*
  3. *AI Automation Outreach*
  4. *AI Chatbot Outreach*
  5. *General Introduction*
  6. *Custom Pitch*
  7. *Follow-Up #1 — Gentle Nudge*
  8. *Follow-Up #2 — Quick Check-in*
  9. *Follow-Up #3 — Service Value*
  10. *Follow-Up #4 — Low-Pressure Closing*
  11. *Follow-Up #5 — Final Note*
* **Dynamic Variable Interpolation**: Real-time substitution for `{businessName}`, `{category}`, `{city}`, `{my_name}`, `{my_company}`, and `{portfolio_url}` with live previews.

### 5. 🤖 Gemini AI Custom Pitch Generation
* Powered by Google's **Gemini 3.8 Flash** engine.
* Generates bespoke, personalized pitches tailored to the lead's exact business name, rating, location, and website status.

### 6. 📅 Day-Anchored Follow-Up Schedule
* Automated cadence anchored to Day 0:
  * **Day 2**: Gentle Nudge
  * **Day 5**: Quick Check-In
  * **Day 9**: Service Value Showcase
  * **Day 14**: Final Courteous Closing
* Smart filters: *Due Today*, *Upcoming*, *Overdue*, and *Replies*.
* **Stop on Reply**: Automatically halts sequence when prospect replies.

### 7. ☁️ Hybrid Persistence & Offline Resilience
* **Dual-Tier Storage Architecture**:
  * Local JSON storage (`data/leads_store.json`) guarantees instant offline capability.
  * Real-time sync with **Supabase PostgreSQL** for multi-device cloud persistence.

---

## 🛠️ Technology Stack

* **Frontend**: Vanilla HTML5, Modern CSS (Glassmorphism, Neon Emerald Aesthetics, HSL Palette), Vanilla JavaScript (Zero bloated frameworks).
* **Backend**: Node.js & Express 5.2 REST API with built-in retry mechanisms and rate limiting.
* **Desktop**: Electron 44 with NSIS installer and portable executable bundling via Electron Builder.
* **Cloud Database**: Supabase PostgreSQL.
* **APIs**: Google Places API (New), Google Gemini Generative AI.

---

## 🚀 Quick Start Guide

### Prerequisites
* **Node.js** v18.0.0 or higher
* **npm** v9.0.0 or higher

### Installation

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
   Copy the example `.env` file:
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

4. **Initialize Supabase Schema (Optional but Recommended):**
   Execute `supabase_schema.sql` in your Supabase SQL Editor to create the required tables and indexes.

---

## 🖥️ Running the Application

### Web Development Mode
Starts the Express API and serves the frontend on `http://localhost:3000`:
```bash
npm start
```

### Desktop Application Mode
Launches the standalone Electron desktop window:
```bash
npm run desktop:dev
```

### Build Desktop Binaries (Windows)
Creates unpacked directory or standalone installer (`.exe`) inside `dist/`:
```bash
# Build portable & setup installer
npm run desktop:dist

# Build unpacked directory
npm run desktop:build
```

---

## 📁 Project Structure

```
Client-Hunter/
├── assets/                  # Application icons and branding assets
├── data/                    # Offline database files
│   ├── categories.json      # Curated business niches & search synonyms
│   ├── india_locations.json # States, districts, and coordinates
│   └── leads_store.json     # Local leads and settings cache
├── electron/                # Electron main and preload lifecycle scripts
├── fonts/                   # Embedded typography
├── index.html               # Main application interface
├── main.js                  # Frontend client architecture & state machine
├── server.js                # Express API backend & database synchronization
├── styles.css               # Design system & responsive styles
├── supabase_schema.sql      # Supabase PostgreSQL relational schema
├── package.json             # Build configuration & scripts
└── .env.example             # Template environment configuration
```

---

## 🛡️ License

This project is licensed under the MIT License — see the LICENSE file for details.
