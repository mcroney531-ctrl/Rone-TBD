-- Agent relay: cross-account agent-to-agent message/state relay.
-- Delivery correctness comes from message_receipts rows + explicit
-- acknowledgment, never from seq/BIGSERIAL ordering (sequence allocation
-- is not commit-ordered in Postgres, so it cannot be a completeness
-- boundary). seq exists only for history/pagination.

create extension if not exists pgcrypto;

create table agents (
  agent_id      text primary key,
  display_name  text not null,
  kind          text not null check (kind in ('claude', 'gpt', 'other')),
  created_at    timestamptz not null default now()
);

create table agent_credentials (
  credential_id text primary key default encode(gen_random_bytes(16), 'hex'),
  agent_id      text not null references agents(agent_id),
  token_hash    text not null unique,
  label         text,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz
);
create index idx_agent_credentials_agent on agent_credentials(agent_id);

create table sessions (
  session_id    text primary key default encode(gen_random_bytes(16), 'hex'),
  agent_id      text not null references agents(agent_id),
  label         text,
  started_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);

create table projects (
  project_id  text primary key,
  name        text,
  created_at  timestamptz not null default now()
);

create table messages (
  message_id       text primary key default encode(gen_random_bytes(16), 'hex'),
  idempotency_key   text not null,
  request_hash      text not null,
  project_id        text not null references projects(project_id),
  thread_id         text not null,
  reply_to          text references messages(message_id),
  from_agent_id     text not null references agents(agent_id),
  from_session_id   text references sessions(session_id),
  to_agent_id       text references agents(agent_id),
  broadcast         boolean not null default false,
  body              jsonb not null,
  seq               bigserial,
  created_at        timestamptz not null default now(),
  constraint msg_target check (
    (broadcast = true and to_agent_id is null) or
    (broadcast = false and to_agent_id is not null)
  ),
  unique (from_agent_id, idempotency_key)
);
create index idx_messages_thread on messages(thread_id);
create index idx_messages_project on messages(project_id);

create table message_receipts (
  message_id   text not null references messages(message_id),
  agent_id     text not null references agents(agent_id),
  state        text not null default 'pending' check (state in ('pending', 'pulled', 'acknowledged')),
  updated_at   timestamptz not null default now(),
  primary key (message_id, agent_id)
);
create index idx_receipts_inbox on message_receipts(agent_id, state);

create table thread_resolutions (
  thread_id           text primary key,
  resolved_by_agent_id text not null references agents(agent_id),
  resolved_at         timestamptz not null default now()
);

create table handoffs (
  handoff_id            text primary key default encode(gen_random_bytes(16), 'hex'),
  idempotency_key       text not null,
  request_hash          text not null,
  project_id            text not null references projects(project_id),
  from_agent_id         text not null references agents(agent_id),
  to_agent_id           text references agents(agent_id),
  source_session_id     text references sessions(session_id),
  objective             text,
  current_state         jsonb,
  decisions_made        jsonb,
  important_context     jsonb,
  unresolved_questions  jsonb,
  files_refs            jsonb,
  raw_transcript_ref     text,
  created_at            timestamptz not null default now(),
  unique (from_agent_id, idempotency_key)
);
create index idx_handoffs_project on handoffs(project_id, created_at desc);

create table project_state (
  project_id          text primary key references projects(project_id),
  version             bigint not null default 1,
  objective           text,
  phase               text,
  decisions_made      jsonb not null default '[]',
  decisions_rejected  jsonb not null default '[]',
  open_questions      jsonb not null default '[]',
  known_bugs          jsonb not null default '[]',
  repos               jsonb not null default '[]',
  next_actions        jsonb not null default '[]',
  updated_at          timestamptz not null default now(),
  updated_by_agent_id text references agents(agent_id)
);

create table events (
  event_id        text primary key default encode(gen_random_bytes(16), 'hex'),
  seq             bigserial,
  project_id      text not null references projects(project_id),
  actor_agent_id  text not null references agents(agent_id),
  kind            text not null,
  payload         jsonb not null default '{}',
  created_at      timestamptz not null default now()
);
create index idx_events_project on events(project_id, seq);
