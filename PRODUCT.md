# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

React 18 + Vite (JavaScript), Tailwind CSS, Leaflet 1.9 + react-leaflet, Turf.js, lucide-react, local localStorage mock Supabase layer, client-side Gemini API (`VITE_GEMINI_API_KEY`).

## Users

1. **Legazpi City Residents / Guests:** Citizens reporting hazards or emergencies needing immediate or routed response.
2. **Office Responders:** Field and office staff scoped to specific city departments.
3. **Coordinators / Admins:** City-wide emergency management dispatchers and administrators.

## Product Purpose

SARO ("One" in Bikol) acts as the single civic hazard reporting front door for Legazpi City, Philippines. Replaces 20+ disconnected office hotlines with automated department routing and end-to-end report visibility for citizens.

## Positioning

Calm, quiet, single-entry civic reporting tool. Transparent status tracking for residents; dense, ops-first queue management for responders.

## Operating Context

- **Citizen Shell (`viewport < 768px`):** Calm, plain, high legibility for anxious situations. No hype, no exclamation marks, no celebratory animations.
- **Staff Shell (`viewport >= 768px`):** Dense, ops-focused dashboard with tables over cards, low whitespace, status-at-a-glance.

## Roles and Data Schema

`profiles.role` enum: `'resident' | 'responder'`
- **Guest:** Anonymous user (no profile row).
- **Resident:** `role = 'resident'`.
- **Responder:** `role = 'responder'`, `office_id` set, `is_coordinator = false`. Scoped to assigned office.
- **Admin / Coordinator:** `role = 'responder'` AND `is_coordinator = true`. Full city-wide view.

## Brand Commitments

- Name: SARO (Bikol word for "one").
- Tone: Calm, plain, unshowy, competent public service.
- Creator: Fellowship of the One Door (Hackstreet Boys, Bicol University Polangui Campus) for Heroes of Innovation Challenge, Ibalong Festival 2026. Dedicated to Isaiah Jotham Reonal.

## Product Principles

1. One front door: automatic routing to correct municipal office.
2. Calm public voice: plain language microcopy, zero noise.
3. Dense ops view: high data density for emergency response dispatch.
4. Privacy and accessibility first: full offline/localStorage mock layer matching Supabase authorization.
