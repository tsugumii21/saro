# SARO — Project Summary

**"One" in Bikol.** A single reporting front door for hazards, incidents, and crimes in Legazpi City, replacing 20+ scattered emergency numbers with one channel: one code, one place to check, one door in.

- **Fellowship:** The Fellowship of the One Door: Asthan Eilexer J. Patanao, Adrian Kim P. De Guzman, John Carl Q. Bolo, Allen P. Del Valle, Jeric S. Base
- **Bicol University Polangui Campus**, competing in the Heroes of Innovation Challenge, Ibalong Festival 2026
- **Community Hero:** Isaiah Jotham Reonal, the Curious Builder
- **Hero Path chosen:** Bantong · The Strategist, not more force, but the one clever stroke nobody had tried

---

## The Hero's Journey

### I · Walk Their Path
Jotham is a Legazpi kid who lives with Mayon in view every morning and never thinks twice about it. His days are shaped by small, recurring gaps in information: whether there's class on a rainy day depends on rumor and a neighbor's phone, not a clear source. He passes a corner that floods every rainy season and a retaining wall that's been cracked for years, both known to everyone, fixed by no one. He's curious by nature (every answer just opens the next question) and frustrated by adults who shrug at problems not because they don't care, but because they genuinely don't know who to ask. The surprise that reframed the whole project: the fear he wants gone isn't fear of the volcano, it's the fear of *not knowing*. He doesn't want protection from danger. He wants the waiting to end.

### II · Name the Monster
The first instinct, "Legazpi is slow to respond," was a shadow, and an unfair one: the city already has a CDRRMO, a 911 center, a Public Safety Office, fire, police, and a Quick Response Team. Laddering "but why" down: help arrives late because reports arrive late; people don't report because they don't know which of 20+ scattered numbers to call; guessing wrong costs minutes and past calls left no trail. **At the bottom: not slow response, but a missing front door.** Everyone who's ever hesitated to report something dangerous lives in this monster's shadow, residents, barangay officials who find out from Facebook, dispatchers with no way to verify a call, an engineering office with no evidence to justify a budget line, and every child growing up learning that not being heard is just how things are.

### III · The Council of Heroes
The Fellowship chose **Bantong · The Strategist**: Legazpi doesn't need more strength, it has capable responders already. It needs the one clever stroke that closes the distance between *knowing* and *telling*. The oath: this gift costs the city nothing to swing.

### IV · Seek the Hidden Treasure
If the monster vanishes: the waiting ends. Jotham grows up somewhere a person who sees something wrong has one place to send it, a receipt for it, and a way to watch it move until it's fixed, and now, some of what he needs to know reaches him *before* anything's gone wrong, because the map that used to only fill in from neighbors' reports now also carries the Mayon danger zone, live rainfall readings, accident-prone road segments, and evacuation centers with routed directions to reach them. The corner outside his school gets fixed because the system counted rainy seasons of reports at that exact coordinate, not because someone finally complained loud enough. The treasure reaches further than Jotham: the resident who reports for the first time because she finally has a tracking code, the dispatcher who commits an ambulance with confidence instead of hope (and no longer has to hold the danger-zone boundary in memory, the system flags it automatically), the barangay official who stops finding out last, the engineering office with evidence instead of anecdote. The monster is regional, every Bicol city has the same scattered directory and the same silence after the call, so the treasure is too.

### V · Forge the Hero's Gift
Ideas considered and rejected before choosing SARO: a disaster-prep game (prepares people to act on info they still won't receive), a class-suspension verification tool (too narrow, though it's where the monster was first spotted), a rainfall-based flood prediction system (prediction without a reporting channel produces warnings nobody can act on or confirm), a city-wide siren broadcast app (moves information outward, when the real gap is information that can't move *inward*). **Chosen: a single reporting front door that routes automatically and stays visible until resolved.**

### VI · Return
The first real step was never a coding task, it's the conversation with CDRRMO as coordinator, the offices that actually own each category (PNP for crime, BFP for fire, City Engineering for infrastructure hazards, City Health for medical emergencies), and a barangay captain for the ground-level view, to confirm, category by category, which office owns what. From there: pilot in one barangay with a track record of hazards, accidents, and incidents before expanding citywide.

---

## The System: SARO — Full Feature Set

### Reporting
1. **Dual reporting paths**: Panic button (press-and-hold with a deliberate anti-accidental-trigger interaction, no category picker, opens a live 911 call while silently sending location/timestamp/photo, no account needed, call connects on cellular voice even with weak data) and Describe (voice or text in Bikol/Tagalog/English, structured into a report by Gemini and shown back for confirmation). The Panic flow lives only on its own dedicated Home button and is not a selectable option, or a routable category, anywhere in the Describe form or the admin routing table.
2. **Three-tier hazard classification** for the Describe flow, replacing a flat Emergency/Non-Urgent split:
   - **Critical**: fire, gas leak, medical emergency, vehicular collision, active coastal storm surge, active landslide, crime in progress. Triggers an immediate alert to the routed office's queue on submission. No account needed.
   - **Urgent**: real hazards that need fast-tracked handling but not a live alert, for example structural bridge/seawall damage and soil erosion. Auto-sorted to the top of the receiving office's queue. No account needed.
   - **Routine**: potholes, drains, typhoon debris, road obstruction, water contamination. Normal queue priority. Requires a signed-in resident account, guests see these types clearly listed with a lock icon and are prompted to sign in at the moment of selection, with their in-progress description and photo preserved.
   - The hazard type list is grouped under visible Critical / Urgent / Routine section headers instead of one flat scrolling list.

### Tracking, without an account
3. No-login public tracking for Critical and Urgent reports: every report gets a checkable tracking code, device-local "My Reports" list (clearing the browser never deletes the server-side record), save-code-as-image ticket card with QR, installable PWA (offline shell, no app store), opt-in push notifications requiring no phone number.
4. The report detail/tracking view shows the resident's own submitted photo(s) and their original description text, not just the hazard category label, alongside the location map and status timeline.

### Accountability
5. **Formal status pipeline:** Received → Assigned → In Progress → Resolved → Closed (Confirmed) / Closed (Unconfirmed) / Reopened. A dispute at Resolved sends it back to In Progress with full history intact, never restarts the record, giving the city an honest metric of reporter-verified vs. timed-out closures.
6. **Rules-based routing** (deliberately not AI): a plain, city-editable table maps category to responsible office, with the disaster/public safety office as fallback. Auditable, offline-capable, never improvised.
7. **Accountable closure**, enforced in the admin report detail view: physical hazards require a closing photo before a report can be marked Resolved; non-photographable cases require a reference number or reason code, pulled directly from the routing table's per-category requirement, not hardcoded separately.
8. Officials can attach a note when updating a report's status, visible to the resident on their tracking timeline, replacing generic system-only text with a real update from the handling office.

### Intelligence, applied narrowly
9. **Report clustering**: duplicate reports of the same incident within the existing distance/time threshold merge automatically into one card with a confidence score, no manual admin review step required. Tapping a single-report pin shows its photo(s) and the resident's description; tapping a clustered pin shows a few representative photos and an AI-summarized context of what's being reported, plus report count and recency. Reporter identity is never surfaced through this view.
10. **Grounded AI assistant**: answers only from documents the city has published, cites the source, refuses to guess otherwise. An in-browser emergency-keyword check runs first to fast-track urgent Describe-path reports before the model is ever consulted. Chip-suggested questions and typed input always stay in the language the resident used, no silent auto-translation.
11. **Gap-detection logging with an answer-before-resolve workflow**: unanswered assistant questions are logged and clustered by topic in the admin Gap Log tab. An admin cannot dismiss a gap without writing an actual answer first, either in their own words or drafted then optionally refined with an AI "polish" pass the admin reviews and approves, never auto-applied. That answer becomes a new published source the grounded assistant can cite, so the same question doesn't keep reopening the same gap. Similar questions in one topic cluster can be resolved together with a single answer.

### Reliability & access
12. **Offline handling**: local-first submission (IndexedDB) with service-worker background sync, for any low-signal scenario (storms, dead zones, indoor crime scenes). Reports only queue as "Waiting to Send" when the device genuinely has no connection, a working connection always sends and routes a report to the office queue instantly with zero approval step. Panic-button abuse guard rate-limits the *data*, never the call, soft-flags repeat false alarms for admin review only, visible in the Panic Review dashboard tab.
13. **Consent & privacy**: a one-time RA 10173 (Data Privacy Act) notice, shown right after Panic fires if needed, never gating it.
14. **Permission priming**: a one-time screen after sign-in/guest selection, before Home, requesting Location, Microphone, and Phone/Call permissions individually with plain-language reasons, fully skippable. Each permission can be turned on later from Settings.
15. **Auto-archiving**: resolved/closed reports stop rendering as live pins on the map after a set period, without deleting the underlying record, still checkable by tracking code and still counted in evidence exports and cluster history. Reopened reports immediately return to the live map. Admins can toggle "Show archived" on the map view.
16. **Admin & Responder Dashboard**, role-based, one flat top-level navigation with no hidden sub-tabs: Dispatch (city-wide queue with a full report detail/closure view), Live Map (live auto-clustering map, no manual duplicate-review step), Evidence (lookup by location, cluster, barangay, or tracking code, with a radius-based fallback for arbitrary points), Routing & Data (routing-table editor with change log, Mayon Alert Level verification), Offices & Accounts (city-wide oversight of every connected office, staff account, barangay official, and resident account), Panic Review, and Gap Log. Mobile for residents, desktop for officials/admins, with each served only by its own dedicated app entry point (`dev:resident` vs `dev:admin`), no shared routing between them. Access is enforced through one shared, centralized role-check used consistently across every tab, rather than separate per-screen checks that could drift out of sync.
17. A single generalized Login portal serves city-wide admins, single-office staff, and barangay officials, routing each to their correct scoped view after authentication.

### Account management
18. **Staff & Official Accounts Directory**: city-wide admins can edit or deactivate any staff/official account, including their own. Deleting an account with historical activity (status changes, closure notes, Panic Review entries) never hard-deletes and orphans that history, it anonymizes the account's login and access while preserving the historical record as attributable to "Former staff member." The last remaining active City Admin account can never be deleted or deactivated.
19. **Resident account self-management**: signed-in residents can edit their own profile from Settings, and can delete their own account. Deleting an account never deletes the resident's report history, records stay in Supabase and remain checkable by tracking code, only the account login and synced "My Reports" access are removed.
20. **Admin-managed resident account deletion**: city-wide admins can view and delete resident accounts from Offices & Accounts, restricted to that role only. Every deletion requires a short reason field and is logged with which admin performed it and when, visible in an audit trail. The same report-persistence safeguard applies, deleted resident accounts never take their filed reports with them.

### Hyper-Local DRRM Overlays (Mayon, Flood, Accident & Evacuation Layers)
21. Layers official government disaster data directly onto SARO's map, merging real-time environmental telemetry, official hazard boundaries, and citizen reports into one operational picture, shown through a shared, collapsible layers panel and a map legend so every color and shape has a clear meaning:
    - **Live Mayon hazard mapping**: PHIVOLCS's 6 km Permanent Danger Zone and 7 to 8 km Extended Danger Zone boundaries, plus the current volcanic alert level. Production design is admin-verified rather than auto-scraped, given the safety stakes of an unreliable scrape and the lack of an official PHIVOLCS real-time API; for pitch/presentation purposes only, a clearly-labeled mock "live telemetry feed" simulation is available as a demo mode (toggleable back to the real manual-verification mode), showing sample current bulletin data with an auto-refreshing "verified just now" timestamp, kept separate in the codebase from the real verification logic.
    - **Real-time rainfall telemetry**: live hourly precipitation from Open-Meteo, no signup needed, with PAGASA's PANaHON ground-station network as a possible more locally accurate upgrade if it proves queryable rather than dashboard-only.
    - **Landslide/flood risk layers**: MGB susceptibility overlays, sized and styled to stay legible against the base map rather than dominating it.
    - **Accident-Prone Areas**: known vehicular blackspots shown as a red circular buffer around each point, sized or intensified by reported incident severity/frequency, sourced from clustered vehicular-accident reports with a slot to plug in official PNP/DPWH blackspot data later.
    - **Evacuation Centers**: distinct house-icon point markers, visually separate from hazard zones since this is a resource, not a danger, showing name, address, and capacity/status on tap, with a "Get Directions" action that draws a real road-following route (via a free OSRM routing service) from the resident's current location to the center, along with estimated walking distance and time, and a clear-route control.
    - **Automated incident geofencing**: a server-side coordinate check (not AI) that auto-flags a citizen report as high priority the moment it lands inside an active danger zone.
    - **Server-side caching**: PHIVOLCS's and MGB's boundaries are downloaded once and bundled rather than polled; rainfall is the piece that's genuinely live, so a scheduled Supabase Edge Function polls it and caches the result, keeping mobile requests fast without hammering the upstream source.
    - **Offline PMTiles storage**: hazard boundaries stored compactly on-device, so map layers keep working through a signal outage.

This layer is also the narrative payoff of Jotham's own stated dream: information arriving *before* danger does, not just efficient reporting after the fact, the city's own hazard knowledge and its residents' eyes now sharing one screen.

---

## Resident App Structure
- Launch flow: splash screen (logo on a solid brand-navy background) → single consolidated welcome/sign-in screen (same screen reused everywhere sign-in is triggered, at launch or later from Settings) → optional permission priming → Home.
- Home shows the panic button, a live Mayon Alert snippet, a nearby active-reports count, a rotating safety tip/advisory card, and the two core Civic Services entries (Describe a Hazard, Track a Report).
- The account panel (opened from the signed-in user's name) is scoped to identity, a quick link to My Reports, a single Settings entry, and Sign Out; notification preferences, the privacy notice, profile editing, and account deletion now live inside Settings rather than the quick panel.
- The bottom nav's Report tab is a raised circular action button, visually distinct from the other four tabs, with a calm, non-bouncing press interaction.
- The "File on Behalf" assisted-reporting feature has been removed from the product; all reports are filed directly by the resident (or as a guest), with no barangay/admin proxy-filing flow.

---

## Architecture (current build plan)

| Layer | Choice |
|---|---|
| Backend | **Supabase**: Postgres + Row Level Security for role-scoped access, Storage for photos, Realtime for live queues, Edge Functions to keep API keys server-side |
| AI | **Gemini API**: already implemented for Describe and the grounded assistant, behind a Supabase Edge Function |
| Mapping | **MapLibre GL JS + PMTiles**: free, open-source stack for the DRRM overlay layer, no paid mapping SDK; routing to evacuation centers uses the free OSRM routing service |
| Hazard/weather data | **PHIVOLCS & MGB** boundaries downloaded once, bundled as static PMTiles · **Open-Meteo** (+ PANaHON if it checks out) for live rainfall, no signup needed |
| Media (optional) | **Cloudinary**: not required, only worth adding later if evidence export feels slow at real photo volume |
| App split | Two independently deployable apps sharing one Supabase backend: **resident/anonymous** (mobile web, `dev:resident`) and **admin/official** (desktop web, `dev:admin`), fully isolated entry points and routing |

---

## Status & Roadmap

A working prototype exists across both apps: live mapping with a legend and consistent status colors, three-tier hazard classification with account gating scoped only to Routine reports, photo/description-backed clustering, the accident-prone and evacuation-center layers with real routing directions, a completed admin report detail and closure workflow, an answer-before-resolve Gap Log, full account management for staff, officials, and residents, a generalized Login portal, and Supabase seeded with mock reports across every connected office, hazard type, status, and barangay for end-to-end testing. A recent QA pass fixed several undefined-reference crashes, a Supabase 401/404 authentication issue, a recurring role-permission bug that was incorrectly blocking valid accounts, and consolidated the admin dashboard's navigation into a single flat structure after duplicate and nested sub-tabs had crept in.

**Next steps, in order:**
1. Agree the routing table category by category: CDRRMO as coordinator, PNP (crime), BFP (fire), City Engineering (infrastructure hazards), City Health (medical), and a barangay captain for the ground-level view
2. Pilot in a single barangay with a track record of hazards, accidents, and incidents
3. Refine against real reports and real response times before expanding citywide
