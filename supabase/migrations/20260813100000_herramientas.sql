-- ============================================================================
-- Capacidades del agente — que pueda HACER cosas, no solo contestar
--
-- POR QUÉ HACE FALTA
--
-- Hoy el agente solo sabe escribir. Cuando una clienta dice «quiero pedir
-- cita», lo mejor que puede hacer es contarle cómo hacerlo — y ahí se pierde
-- la mitad. La conversión está en darle el enlace en ese mismo mensaje,
-- mientras está decidida.
--
-- Es además lo que Ale vende: «reservas online». Sin esto, el agente y las
-- reservas son dos cosas que conviven sin hablarse.
--
-- POR QUÉ EL CATÁLOGO NO ESTÁ AQUÍ
--
-- Misma decisión que con los modelos de IA: el catálogo vive en el código
-- (`src/lib/agent/herramientas/catalogo.ts`), donde se revisa en cada
-- despliegue, y aquí solo queda **qué tiene activado cada negocio y con qué
-- configuración**. Una tabla de catálogo habría que mantenerla a mano y
-- acabaría desincronizada del código que la ejecuta.
--
-- Si una herramienta desaparece del catálogo, la fila que la tuviera activada
-- simplemente se ignora: nadie se queda con un agente roto por un despliegue.
-- ============================================================================

create table if not exists workspace_tools (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,

  -- La clave de la herramienta en el catálogo del código.
  clave text not null,

  -- Desactivada por defecto. Una capacidad que aparece sola sin que nadie la
  -- haya configurado es una forma de que el agente empiece a dar enlaces
  -- vacíos a las clientas.
  activa boolean not null default false,

  /*
   * Lo que necesita para funcionar: el enlace de reservas, la URL de un
   * webhook… Va en JSON porque cada herramienta pide cosas distintas y nunca
   * se consulta por separado: se lee entera al ejecutarla.
   */
  config jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (workspace_id, clave)
);

comment on table workspace_tools is
  'Qué capacidades tiene activadas cada negocio y con qué configuración. El catálogo vive en el código.';
comment on column workspace_tools.activa is
  'Desactivada por defecto: una herramienta sin configurar haría que el agente diera datos vacíos.';

create index if not exists workspace_tools_negocio_idx
  on workspace_tools (workspace_id) where activa;

-- ── Aislamiento ─────────────────────────────────────────────────────────────
-- La configuración puede llevar enlaces privados de agenda y URLs internas.

alter table workspace_tools enable row level security;

create policy "miembros ven las capacidades"
  on workspace_tools for select
  to authenticated
  using (public.is_member(workspace_id));

create policy "admin y manager cambian las capacidades"
  on workspace_tools for all
  to authenticated
  using (public.has_role(workspace_id, array['admin', 'manager']::role_enum[]))
  with check (public.has_role(workspace_id, array['admin', 'manager']::role_enum[]));

grant select, insert, update, delete on workspace_tools to authenticated;
