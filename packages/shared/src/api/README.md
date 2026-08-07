# SARO Mock Data Layer & Supabase API Mapping

This module (`packages/shared/src/api/`) provides a fully working, offline-capable in-memory state layer persisted to `localStorage`. It is designed to strictly mirror Supabase PostgreSQL tables and Row Level Security (RLS) policies for effortless future backend replacement.

---

## Deliverables Summary

- `data.js` — Initial seed datasets (8 offices, 14 categories, 12 barangays, 18 hazard reports, 4 profiles, 20 assistant query logs).
- `index.js` — Async data-access helper functions returning standardized `{ data, error }` results.
- `events.js` — Cross-tab event emitter synced with native `window.storage` events.
- `README.md` — API function to Supabase query mapping guide.

---

## Mock Helper Function to Supabase API Mapping

| Mock Data Access Helper Function | Standardized Return | Future Supabase Equivalent Query / Policy |
|----------------------------------|-------------------|------------------------------------------|
| `getOffices()` | `{ data, error }` | `supabase.from('offices').select('*')` |
| `getCategories()` | `{ data, error }` | `supabase.from('categories').select('*')` |
| `updateCategory(id, updates)` | `{ data, error }` | `supabase.from('categories').update(updates).eq('id', id)` |
| `getBarangays()` | `{ data, error }` | `supabase.from('barangays').select('*')` |
| `getReports()` | `{ data, error }` | `supabase.from('reports').select('*').order('created_at', { ascending: false })` |
| `getReportById(id)` | `{ data, error }` | `supabase.from('reports').select('*').eq('id', id).single()` |
| `getReportByTrackingCode(code)` | `{ data, error }` | `supabase.from('reports').select('*').eq('tracking_code', code).single()` |
| `createReport(reportData)` | `{ data, error }` | `supabase.from('reports').insert(reportData).select().single()` + Postgres spatial trigger for clustering |
| `updateReportStatus(reportId, status, notes, actorProfileId)` | `{ data, error }` | `supabase.from('reports').update({ status }).eq('id', reportId)` enforced by RLS policy `check_office_ownership_or_admin` |
| `markFalseReport(reportId, notes, actorProfileId)` | `{ data, error }` | `supabase.from('reports').update({ is_false_report: true, status: 'resolved' })` enforced by RLS policy |
| `addReportMedia(reportId, mediaObj)` | `{ data, error }` | `supabase.from('report_media').insert({ report_id: reportId, ...mediaObj })` |
| `getReportMedia(reportId)` | `{ data, error }` | `supabase.from('report_media').select('*').eq('report_id', reportId)` |
| `getStatusHistory(reportId)` | `{ data, error }` | `supabase.from('status_history').select('*').eq('report_id', reportId).order('created_at', { ascending: true })` |
| `getProfiles()` | `{ data, error }` | `supabase.from('profiles').select('*')` |
| `getProfile(id)` | `{ data, error }` | `supabase.from('profiles').select('*').eq('id', id).single()` |
| `getAssistantLogs()` | `{ data, error }` | `supabase.from('assistant_logs').select('*').order('created_at', { ascending: false })` |
| `logAssistantQuestion(q, wasAnswered, docId)` | `{ data, error }` | `supabase.from('assistant_logs').insert({ question: q, was_answered: wasAnswered, matched_doc_id: docId })` |
| `resetMockData()` | `{ data, error }` | Reset local storage cache to initial seeds. |

---

## Authorization (RLS) Rules Implemented

1. **Status Update Restriction**:
   - Status updates are rejected if actor's `office_id` does not match the report's `office_id`, UNLESS `profile.is_coordinator` is `true`.
2. **Resolution Media Requirement**:
   - Status change to `'resolved'` is rejected with `"Cannot resolve report without resolution photo evidence"` if no `report_media` record with `kind === 'resolution'` exists for that report.
3. **False Report Auditing**:
   - Marking a report as false (`markFalseReport`) requires responder office match or coordinator access, updates `is_false_report = true` and `status = 'resolved'`, and appends a `status_history` entry.

---

## Turf.js Spatial Clustering

- Reports within **150 meters** (`0.15 km`), sharing the same `category_id` and submitted within **60 minutes** of each other automatically assign to a shared `cluster_id`.
- `confidence_score` reflects cluster population count across all grouped reports.
- Creating matching reports automatically updates all grouped reports and emits `report:updated` events across browser tabs via window storage listeners.
