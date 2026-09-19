-- decision_ref was free text; that decays into "see state" garbage fast.
-- Structured but still not semantically validated: {type, ref, note?}.
-- Column has only ever held NULLs so far (feature just shipped, unused),
-- so a direct type change is safe.
alter table thread_resolutions
  alter column decision_ref type jsonb using decision_ref::jsonb;
