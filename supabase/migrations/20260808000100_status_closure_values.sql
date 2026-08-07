-- SARO 10 — the closure end of the report lifecycle.
--
-- This file contains ALTER TYPE ... ADD VALUE and nothing else, on purpose.
-- Postgres will not let a newly added enum value be *used* in the same
-- transaction that added it, and the CLI wraps each migration file in one. Any
-- function or default referencing these values must therefore live in a later
-- file. Migration 11 is that file.
--
-- The lifecycle was always meant to end somewhere. Migration 01 shipped four
-- values with a comment saying "Confirm / Dispute / Reopen will extend this
-- later"; this is later.
--
--   received  →  assigned  →  in_progress  →  resolved  ─┬→ closed_confirmed
--                    ↑                                   ├→ closed_unconfirmed
--                    └──────────── reopened ←────────────┘
--
-- Why closure splits in two: "closed" alone cannot distinguish a resident who
-- looked at the work and said yes from a resident who never answered. Those are
-- different facts about how well the city did, and collapsing them into one
-- value would let an office's record look identical whether residents were
-- satisfied or simply absent. The split is the honest record.
--
-- reopened is a real state rather than a rewind to 'received'. A disputed
-- report keeps its whole history — every transition it already made stays in
-- report_status_history — because "this was resolved once and the resident said
-- otherwise" is exactly the thing an SLA report must not be able to hide.

alter type public.report_status add value if not exists 'closed_confirmed';
alter type public.report_status add value if not exists 'closed_unconfirmed';
alter type public.report_status add value if not exists 'reopened';
