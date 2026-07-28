-- ============================================================================
-- F0 · Esquema núcleo
-- Implementa el §6.1 del BLUEPRINT. Los constraints marcados como clave en el
-- §6.3 van comentados donde aparecen, porque son los que sostienen el dedupe y
-- la idempotencia de todo el sistema.
--
-- Convención del blueprint: toda tabla de negocio lleva workspace_id, id uuid
-- por defecto y created_at. Los secretos NO viven aquí: se guardan en Supabase
-- Vault y en estas tablas solo queda la referencia (*_ref).
-- ============================================================================

create extension if not exists pgcrypto;

-- ── Enums ───────────────────────────────────────────────────────────────────

create type role_enum as enum ('admin', 'manager', 'agent', 'viewer');

create type integration_enum as enum ('openrouter', 'highlevel');

create type conversation_state_enum as enum (
  'ai_active', 'human_active', 'handoff_pending', 'awaiting_user', 'snoozed', 'closed'
);

create type msg_dir_enum as enum ('in', 'out');

create type msg_type_enum as enum (
  'text', 'audio', 'image', 'document', 'video', 'template', 'interactive', 'system'
);

create type sender_enum as enum ('contact', 'ai', 'human', 'system');

create type msg_status_enum as enum ('queued', 'sent', 'delivered', 'read', 'failed');

-- ── workspaces ──────────────────────────────────────────────────────────────

create table workspaces (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text not null unique,
  plan       text not null default 'free',
  settings   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ── workspace_members ───────────────────────────────────────────────────────
-- Es la tabla que decide quién ve qué: de ella cuelgan todas las políticas RLS.

create table workspace_members (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  role         role_enum not null default 'agent',
  created_at   timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create index workspace_members_user_idx on workspace_members (user_id);

-- ── channels ────────────────────────────────────────────────────────────────
-- Un número de WhatsApp por fila. Un número solo puede pertenecer a un
-- workspace: de ahí el unique global sobre phone_number.

create table channels (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          uuid not null references workspaces (id) on delete cascade,
  phone_number          text not null unique,          -- E.164
  display_name          text,
  ycloud_credential_ref text,                          -- → Vault, nunca el secreto
  webhook_secret_ref    text,                          -- → Vault
  system_prompt         text,
  ai_default_enabled    boolean not null default true,
  status                text not null default 'active',
  created_at            timestamptz not null default now()
);

create index channels_workspace_idx on channels (workspace_id);

-- ── integrations ────────────────────────────────────────────────────────────

create table integrations (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces (id) on delete cascade,
  type            integration_enum not null,
  credentials_ref text,                                -- → Vault
  config          jsonb not null default '{}'::jsonb,
  enabled         boolean not null default false,
  created_at      timestamptz not null default now(),
  unique (workspace_id, type)
);

-- ── contacts ────────────────────────────────────────────────────────────────

create table contacts (
  id                   uuid primary key default gen_random_uuid(),
  workspace_id         uuid not null references workspaces (id) on delete cascade,
  wa_phone             text not null,                  -- E.164 normalizado
  name                 text,
  email                text,
  source               text,
  owner_id             uuid references workspace_members (id) on delete set null,
  tags                 text[] not null default '{}',
  custom_fields        jsonb not null default '{}'::jsonb,
  stage                text,
  hl_contact_id        text,
  opt_in               boolean not null default false,
  opt_in_source        text,
  opt_in_at            timestamptz,
  last_interaction_at  timestamptz,
  created_at           timestamptz not null default now(),
  -- §6.3 · dedupe: el mismo teléfono no puede entrar dos veces en un workspace
  unique (workspace_id, wa_phone)
);

-- ── conversations ───────────────────────────────────────────────────────────
-- window_expires_at = último inbound del cliente + 24 h. Es el dato que sostiene
-- el guardrail de la ventana de Meta.

create table conversations (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references workspaces (id) on delete cascade,
  contact_id        uuid not null references contacts (id) on delete cascade,
  channel_id        uuid not null references channels (id) on delete cascade,
  state             conversation_state_enum not null default 'ai_active',
  assignee_id       uuid references workspace_members (id) on delete set null,
  ai_enabled        boolean not null default true,
  window_expires_at timestamptz,
  last_inbound_at   timestamptz,
  last_outbound_at  timestamptz,
  last_message_at   timestamptz,
  unread_count      integer not null default 0,
  status            text not null default 'open',      -- open | closed | archived
  priority          text,
  created_at        timestamptz not null default now()
);

create index conversations_workspace_idx on conversations (workspace_id, last_message_at desc);
create index conversations_contact_idx   on conversations (contact_id);

-- ── messages ────────────────────────────────────────────────────────────────

create table messages (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces (id) on delete cascade,
  conversation_id uuid not null references conversations (id) on delete cascade,
  direction       msg_dir_enum not null,
  type            msg_type_enum not null default 'text',
  text            text,
  media           jsonb,
  wamid           text,
  batch_id        uuid,                                -- FK a message_batches en F2
  sender          sender_enum not null,
  status          msg_status_enum not null default 'queued',
  error           jsonb,
  cost            jsonb,
  created_at      timestamptz not null default now()
);

-- §6.3 · hilo paginado
create index messages_conversation_idx on messages (conversation_id, created_at);

-- §6.3 · idempotencia: el mismo wamid no puede guardarse dos veces.
-- Parcial, porque los mensajes aún sin enviar no tienen wamid todavía.
create unique index messages_wamid_key on messages (workspace_id, wamid)
  where wamid is not null;

-- ── processed_events ────────────────────────────────────────────────────────
-- Idempotencia de webhooks: si YCloud reintenta un evento, aquí choca y se
-- descarta antes de procesarlo dos veces.

create table processed_events (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  event_id     text not null,
  source       text not null,                          -- ycloud | highlevel
  received_at  timestamptz not null default now(),
  unique (workspace_id, source, event_id)
);

create index processed_events_received_idx on processed_events (received_at);

-- ── events ──────────────────────────────────────────────────────────────────
-- Log de decisión, append-only. Solo escribe el service-role (ver RLS).

create table events (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces (id) on delete cascade,
  conversation_id uuid references conversations (id) on delete cascade,
  type            text not null,
  payload         jsonb not null default '{}'::jsonb,
  actor           text,
  created_at      timestamptz not null default now()
);

create index events_workspace_idx on events (workspace_id, created_at desc);
