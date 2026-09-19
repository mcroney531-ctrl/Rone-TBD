-- Repo/branch context needs to be canonical, not buried in decisions_made
-- free text -- that's exactly what went wrong when Codex found a
-- production branch neither Claude agent knew about.
alter table project_state
  add column repo_context jsonb not null default '{}';
