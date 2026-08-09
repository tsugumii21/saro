# SARO — Full Codebase Architecture & System Overview

**Project:** SARO (*"One"* in Bikol) — Unified Civic Hazard, Incident, and Emergency Reporting System for Legazpi City  
**Repository Structure:** npm Workspaces Monorepo  
**Target Applications:** Resident Mobile Web App (`@saro/resident-app`) & Admin/Official Desktop Web App (`@saro/admin-app`)  
**Backend & Services:** Supabase (PostgreSQL, PostGIS, RLS, Storage, Realtime, Edge Functions) + Google Gemini API + MapLibre GL JS & PMTiles  

---

## 1. High-Level Architecture & Technology Stack

SARO operates as a multi-tier, dual-application system backed by a unified Supabase cloud infrastructure and localized GIS mapping services.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                             CLIENT APPLICATIONS                             │
├──────────────────────────────────────────┬──────────────────────────────────┤
│         Resident Mobile Web App          │    Admin/Official Desktop Web    │
│          (@saro/resident-app)            │        (@saro/admin-app)         │
│     Mobile Viewport (< 768px) · PWA     │   Ops Dashboard (>= 768px) · Table   │
└────────────────────┬─────────────────────┴────────────────┬─────────────────┘
                     │                                      │
                     ▼                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            SHARED APPLICATION LAYER                         │
│       @saro/shared (Auth Context, Supabase Client, Offline IDB, Types)       │
│       @saro/ui (HazardMap MapLibre GL JS, PMTiles, Status Badges, Icons)    │
└────────────────────┬──────────────────────────────────────┬─────────────────┘
                     │                                      │
                     ▼                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           SUPABASE BACKEND PLATFORM                         │
│  ┌───────────────────────┐  ┌───────────────────────┐  ┌─────────────────┐  │
│  │ PostgreSQL + PostGIS  │  │  Row Level Security   │  │ Supabase Auth   │  │
│  │ 22 Migrations · Tables│  │ Office & Role Scoped  │  │ Responders vs   │  │
│  │ Spatial RPC Functions │  │ Data Access Policies  │  │ Residents       │  │
│  └───────────┬───────────┘  └───────────────────────┘  └─────────────────┘  │
│              │                                                              │
│  ┌───────────┴───────────┐  ┌───────────────────────┐  ┌─────────────────┐  │
│  │ Supabase Storage     │  │  Realtime Engine      │  │ Edge Functions  │  │
│  │ report-media bucket   │  │  Live Queue & Panic   │  │ gemini-proxy    │  │
│  │ closure-proofs bucket │  │  Broadcasting         │  │ push-dispatch   │  │
│  └───────────────────────┘  └───────────────────────┘  └────────┬────────┘  │
└─────────────────────────────────────────────────────────────────┼───────────┘
                                                                  │
                                                                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           EXTERNAL INTEGRATIONS                             │
│  • Google Gemini API (Voice/text structuring, Grounded KB AI, Gap Polish)   │
│  • Open-Meteo API (Scheduled hourly precipitation telemetry polling)         │
│  • OSRM Routing Engine (Real-time evacuation center route calculations)     │
│  • Web Push API (Service worker notifications for status updates)           │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Core Architecture Components
1. **Frontend Layer:** Built with React 18 + Vite (JavaScript) and Tailwind CSS across two isolated single-page application entry points. Components prioritize high legibility, strict role separation, and rapid accessibility during emergency situations.
2. **Database & Security Layer:** Powered by Supabase PostgreSQL with PostGIS extensions. Data confidentiality and role-based access are enforced via 22 database migrations establishing strict Row Level Security (RLS) policies and `SECURITY DEFINER` Remote Procedure Calls (RPCs).
3. **AI Layer:** Google Gemini API accessed securely through a Supabase Edge Function (`gemini-proxy`). Client components never handle API secrets directly. Uses structured JSON prompts for hazard categorization, grounded context retrieval for citizen assistance, and draft polishing for municipal gap logs.
4. **GIS & Offline Layer:** MapLibre GL JS coupled with vector PMTiles (`pmtiles:///hazard/legazpi-hazards.pmtiles`). Custom tools convert official PHIVOLCS (Mayon PDZ/EDZ), MGB (flood/landslide risk), and DPWH/PNP (accident blackspots) data into compact offline vector tiles. Local-first report queuing is supported via IndexedDB and Service Worker background sync.

---

## 2. Directory & File Structure

```
SARO/
├── apps/
│   ├── admin-app/                 # Official/Responder Desktop Web Application (@saro/admin-app)
│   │   ├── src/
│   │   │   ├── components/
│   │   │   │   ├── landing/       # Staff landing page & portal entry
│   │   │   │   └── staff/         # Operations shell & dashboard tabs (Dispatch, Live Map, Analytics, etc.)
│   │   │   ├── App.jsx            # Entry router & STAFF_ROLES authentication gate
│   │   │   └── main.jsx           # App mount point
│   │   └── package.json
│   │
│   └── resident-app/              # Resident/Anonymous Mobile Web Application (@saro/resident-app)
│       ├── src/
│       │   ├── components/
│       │   │   ├── citizen/       # Mobile screens (Home, Describe, Track, Map, Assistant, Panic, Priming)
│       │   │   └── common/        # Shared offline connection indicators
│       │   ├── ResidentGate.jsx   # Role guard enforcing resident/guest access
│       │   ├── AppEntryFlow.jsx   # Launch flow (Splash -> Auth/Guest -> Priming -> Consent -> Shell)
│       │   └── main.jsx           # Mobile app mount point
│       └── package.json
│
├── packages/
│   ├── shared/                    # Shared Domain & Application Services (@saro/shared)
│   │   ├── src/
│   │   │   ├── api/               # Supabase API client methods & adapter wrappers (`index.js`, `proxy.js`)
│   │   │   ├── auth/              # AuthContext.jsx & useAuth() hook
│   │   │   ├── offline/           # IndexedDB offline store (`db.js`) & background sync (`sync.js`)
│   │   │   ├── constants.js       # Hazard categories, status codes, barangay directory
│   │   │   ├── emergency.js       # 911 hotline & panic event dispatchers
│   │   │   ├── errors.js          # Humanized RLS error transformer
│   │   │   ├── push.js            # Web Push subscription helpers
│   │   │   └── types.js           # Shared data definitions and validator functions
│   │   └── package.json
│   │
│   └── ui/                        # Shared UI Component Library (@saro/ui)
│       ├── src/
│       │   ├── HazardMap.jsx      # MapLibre GL JS + PMTiles map engine with layer toggles & OSRM routing
│       │   ├── AlertLevelBadge.jsx# Mayon alert status badge
│       │   ├── StatusTag.jsx      # Standardized status tags (Received, In Progress, Resolved, etc.)
│       │   ├── IncidentPinCard.jsx# Map popup card for clustered/single incidents
│       │   ├── TrackingCode.jsx   # Standardized 8-character tracking code formatter
│       │   └── Logo.jsx / Wordmark.jsx # Brand components
│       └── package.json
│
├── supabase/                      # Supabase Infrastructure & Database Code
│   ├── functions/                 # Deno Edge Functions
│   │   ├── gemini-proxy/          # Secure Gemini API proxy (Describe, Assistant, Gap Polish)
│   │   ├── push-dispatch/         # Web Push notifications dispatcher
│   │   └── rainfall-poll/         # Scheduled Open-Meteo precipitation collector
│   ├── migrations/                # 22 SQL schema migrations (Enums, Tables, RLS, RPCs, Triggers)
│   ├── config.toml                # Supabase local environment configuration
│   └── seed.sql                   # Comprehensive test database seed with realistic reports
│
├── tools/                         # Maintenance & GIS Build Scripts
│   ├── contrast-audit.mjs         # WCAG AA color contrast accessibility compliance auditor
│   └── hazard/                    # Shapefile processing & PMTiles vector tile build tools
│
├── context/                       # Project Documentation & Architecture Records
│   └── architecture-overview.md   # [THIS FILE] Consolidated codebase & architecture documentation
│
├── SARO_summary.md                # Official project summary & feature specification
├── PRODUCT.md                     # Product definition & platform positioning rules
└── package.json                   # Root monorepo workspace definition
```

---

## 3. End-to-End Data Flow Architecture

### A. Report Submission & AI Structuring Pipeline

```
[ Citizen Input ] (Voice audio or text input in Bikol / Tagalog / English)
       │
       ▼
[ ReportFormScreen.jsx ] ──(If audio)──► [ MediaRecorder API ]
       │                                         │
       ▼                                         ▼
[ gemini-proxy (Edge Function) ] ◄───────────────┘
       │ Parses input & extracts structured JSON:
       │ { category, hazard_tier, summary, preliminary_location }
       ▼
[ Confirmation Screen ] (Resident reviews Gemini extraction & attaches photos/location)
       │
       ▼
[ file_anonymous_report (Supabase SECURITY DEFINER RPC) ]
       │
       ├───────────────────────────────────────────┐
       ▼                                           ▼
[ Spatial & Temporal Clustering ]          [ Danger Zone Geofence Check ]
(Postgres Trigger checks 150m radius &      (Compares coordinates to Mayon summit;
 60-min window against active reports)      auto-flags PDZ 6km / EDZ 7.5km)
       │                                           │
       └─────────────────────┬─────────────────────┘
                             ▼
               [ Insert into `reports` Table ]
                             │
                             ▼
         [ Automatic Rules-Based Office Routing ]
         (Queries `routing_table` by category_id;
          assigns `assigned_office_id` or CDRRMO fallback)
                             │
                             ▼
         [ Realtime Broadcast to Admin Queue ]
         (Supabase Realtime triggers `UPDATE` on receiving office UI)
```

### B. Status & Accountability Lifecycle Pipeline

```
    ┌────────────┐
    │  Received  │  (Initial report creation; routed to designated municipal office)
    └─────┬──────┘
          │
          ▼
    ┌────────────┐
    │  Assigned  │  (Office dispatcher assigns incident to field response personnel)
    └─────┬──────┘
          │
          ▼
   ┌──────────────┐
   │ In Progress  │  (Responders deployed to location; notes attached)
   └─────┬────────┘
         │
         ▼
    ┌────────────┐   ★ MANDATORY REQUIREMENT:
    │  Resolved  │ ◄─ Physical hazards REQUIRE resolution photo evidence upload
    └─────┬──────┘    (or explicit reason code). Staff update note is required.
          │
          ├─────────────────────────────────────────┐
          ▼ (Resident confirms or 7-day timeout)   ▼ (Resident disputes resolution)
    ┌────────────┐                            ┌──────────────┐
    │   Closed   │                            │ In Progress  │
    │(Confirmed) │                            │(Reopened)    │
    └────────────┘                            └──────┬───────┘
                                                     │ (Full historical audit log
                                                     └─► preserved in `report_history`)
```

---

## 4. Application Boundaries & Access Control

SARO strictly isolates resident and official capabilities across runtime entry points, component gates, and database-level RLS policies.

| Boundary Axis | Resident App (`@saro/resident-app`) | Admin App (`@saro/admin-app`) |
| :--- | :--- | :--- |
| **Target Viewport** | Mobile web (`< 768px`) | Desktop web (`>= 768px`) |
| **Dev Command** | `npm run dev:resident` (Port 5173 default) | `npm run dev:admin` (Port 5174 default) |
| **User Roles** | Anonymous Guest, `resident` | `responder` (`admin`, `office`, `barangay_official`) |
| **Role Guard** | `ResidentGate.jsx` (Blocks staff profiles) | `App.jsx` + `STAFF_ROLES.includes(role)` |
| **Primary UI Focus** | High clarity, panic action, low friction | Dense data tables, queue triage, map operations |
| **Database Access** | Restricted to `SECURITY DEFINER` RPCs & own rows | Scoped to assigned `office_id` or city-wide (`admin`) |
| **Routing Tables** | Cannot read or edit routing rules | Read/write access via `RoutingEditor.jsx` (`admin` only) |
| **Media Operations**| Upload submission photos only | Upload resolution proof photos & inspection media |

---

## 5. Feature Set Audit: Intended vs. Codebase Implementation

| Feature Area | Intended Specification (`SARO_summary.md`) | Codebase Status | Architectural Mapping |
| :--- | :--- | :--- | :--- |
| **Dual Reporting** | Panic button (3s press-hold + 911 call) & Describe flow | **100% Matched** | `PanicControl.jsx`, `ReportFormScreen.jsx`, `panic_events` table |
| **Hazard Tiers** | Critical, Urgent, Routine with Routine login requirement | **100% Matched** | `ReportFormScreen.jsx`, `hazard_tier` enum |
| **Public Tracking** | No-login tracking code, local list, downloadable ticket QR | **100% Matched** | `TrackScreen.jsx`, `ReportTicket.jsx`, `file_anonymous_report` RPC |
| **Status Pipeline** | Received → Assigned → In Progress → Resolved → Closed / Dispute | **100% Matched** | `report_status` enum, `report_history`, `ReportDetailPanel.jsx` |
| **Rules Routing** | Category-to-office mapping table with CDRRMO fallback | **100% Matched** | `routing_table` SQL table, `RoutingEditor.jsx` |
| **Photo Closure** | Resolution photo mandatory for physical hazards | **100% Matched** | DB RPC `resolve_report`, `ReportDetailPanel.jsx` validation |
| **Clustering** | Automatic 150m / 60-min spatial-temporal report merging | **100% Matched** | Postgres trigger `trigger_cluster_reports`, `report_clusters` |
| **Grounded AI** | Cites published city KB; Bikol/Tagalog/English support | **100% Matched** | `AssistantScreen.jsx`, `gemini-proxy`, `knowledge-base.json` |
| **Gap Logging** | Unanswered questions logged; admin must answer before dismiss | **100% Matched** | `gap_logs` table, `GapLog.jsx`, Gemini draft polish tool |
| **Offline First** | IndexedDB queue ("Waiting to Send") + SW background sync | **100% Matched** | `packages/shared/src/offline/db.js` & `sync.js` |
| **DRRM Layers** | Mayon PDZ/EDZ, rainfall telemetry, flood risk, blackspots, routing | **100% Matched** | `HazardMap.jsx`, PMTiles, Open-Meteo Edge Function, OSRM routing |
| **Account Safety** | Soft deletion (`Former staff member`) for account removals | **100% Matched** | Migration `20260808000800`, `OfficesAndAccounts.jsx` |

---

## 6. Flagged Ambiguities & Open Technical Questions

1. **Legacy Prototype Documentation (`packages/shared/src/api/README.md`):**
   * *Findings:* `packages/shared/src/api/README.md` documents an earlier prototype `localStorage` mock layer. Codebase analysis confirms that `packages/shared/src/api/index.js` is fully connected to Supabase PostgreSQL and Row Level Security.
   * *Recommendation:* Keep `api/README.md` marked as legacy documentation while maintaining `api/index.js` as the single authoritative Supabase API interface.

2. **Mayon Telemetry Verification Mode:**
   * *Findings:* Live volcanic alert levels are manually verified by admins in `AlertLevelEditor.jsx`. A mock "live telemetry feed" simulation is toggleable for pitch/demo presentations.
   * *Recommendation:* Ensure demo simulation mode is toggled off in production builds to rely exclusively on official admin verification.

3. **Open-Meteo Rainfall Polling vs local PANaHON Network:**
   * *Findings:* `rainfall-poll` Edge Function actively queries Open-Meteo precipitation API on an automated `pg_cron` schedule.
   * *Recommendation:* If PAGASA's PANaHON ground station network opens a public API, `rainfall-poll` can be updated to poll local Legazpi station telemetry directly.

---

## 7. Change & Audit Log

| Action | Path / Target | Summary & Notes |
| :--- | :--- | :--- |
| **Created** | `context/architecture-overview.md` | Consolidated system architecture, file map, data flow pipelines, and feature audit |
| **Updated** | `R:\Code\Obsidian\SARO\context\project-overview.md` | Synchronized Obsidian vault snapshot with complete codebase analysis |
| **Verified**| `apps/resident-app` & `apps/admin-app` | Verified application entry points, role boundaries, and routing isolation |
| **Verified**| `supabase/migrations/` (22 files) | Confirmed PostGIS schema, RLS policies, RPCs, and automated triggers |
