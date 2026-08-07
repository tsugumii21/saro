-- SARO 09 — the Panic button needs somewhere to file.
--
-- Panic sends in one action, before anyone has said what is happening. That is
-- the whole point of the control: a frightened person holding a phone should
-- not be asked to classify their own emergency first.
--
-- So it files against a category that means exactly "unspecified emergency",
-- routed to Legazpi 911 — the command centre whose actual job is triage. They
-- read the location, call back on the number if there is one, and re-route to
-- BFP, CHO or PNP once they know. The alternative was making the resident pick
-- fire/medical/crime before sending, which is one decision too many at the
-- worst possible moment.
--
-- SLA is 1 hour, matching the other emergency categories. is_fallback stays
-- false: flooding keeps that role, because an uncategorised REPORT and an
-- unspecified EMERGENCY are different problems and should not share a
-- destination.

set search_path = public, extensions;

insert into public.routing_table
  (category, label, label_bikol, label_tagalog, responsible_office_id,
   is_emergency, is_fallback, sla_hours)
select
  'emergency_unspecified',
  'Emergency — Panic Alert',
  'Emergency — Panic Alert',
  'Emergency — Panic Alert',
  o.id,
  true,
  false,
  1
from public.offices o
where o.short_name = 'Legazpi 911'
on conflict (category) do nothing;
