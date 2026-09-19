-- Mechanical traceability, not a validation engine: resolve_thread can
-- optionally carry a pointer to where its outcome actually landed (a
-- project_state field name, a handoff_id, etc). Nothing is enforced --
-- this just makes "what did resolving this thread produce" queryable
-- later instead of relying on someone remembering to check by hand.
alter table thread_resolutions
  add column decision_ref text;
