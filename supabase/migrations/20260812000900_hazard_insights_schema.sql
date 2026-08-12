-- SARO 09 — Hazard Insights AI Narrative column on reports.

set search_path = public, extensions;

-- Add ai_narrative column to reports table for cached per-report Gemini Executive Synthesis
alter table public.reports
  add column if not exists ai_narrative text;

comment on column public.reports.ai_narrative is 'Gemini-generated Executive Operational Synthesis per report, cached on-demand.';
