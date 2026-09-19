-- Handoffs are immutable by design, so a superseded proposal just sits
-- there forever with no forward link to what replaced it. Same shape as
-- decision_ref: a mechanical pointer, not a judgment about correctness.
alter table handoffs
  add column supersedes text references handoffs(handoff_id);
