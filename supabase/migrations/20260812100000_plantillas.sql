-- ============================================================================
-- Plantillas de WhatsApp — escribir cuando la ventana de 24 h está cerrada
--
-- POR QUÉ HACE FALTA
--
-- Es el único hueco de la plataforma que impide **trabajar**, no que impide
-- lucirse. Meta solo deja escribir texto libre durante las 24 h siguientes al
-- último mensaje del cliente. Pasado ese plazo, el negocio no puede mandar un
-- recordatorio de cita, ni un seguimiento, ni contestar a quien escribió ayer
-- por la noche. Ni el agente ni una persona.
--
-- La única salida que da Meta son las plantillas: mensajes redactados de
-- antemano y aprobados por ellos. Sin esto, una clínica no puede recordar una
-- cita — y recordar citas es media razón por la que contrata esto.
--
-- QUÉ NO ES
--
-- No es un mensaje más. Una plantilla se escribe aquí, se manda a Meta, y Meta
-- decide. Puede tardar minutos o días, y puede rechazarla. Por eso la tabla
-- guarda **estado y motivo del rechazo**: sin eso, la pantalla tendría que
-- mentir o quedarse muda mientras alguien espera.
-- ============================================================================

create table if not exists templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,

  -- El nombre tal y como lo exige Meta: minúsculas, números y guiones bajos.
  -- Se valida también en la aplicación, pero se repite aquí porque un nombre
  -- inválido no lo rechaza Meta al crearlo: lo rechaza al enviarlo, mucho
  -- después, cuando ya nadie relaciona una cosa con la otra.
  name text not null check (name ~ '^[a-z0-9_]{1,512}$'),
  language text not null default 'es',

  category text not null default 'utility'
    check (category in ('utility', 'marketing', 'authentication')),

  /*
   * El estado lo manda Meta, no nosotros. `local` es el único nuestro: una
   * plantilla escrita que todavía no se ha enviado a revisar.
   *
   * Los nombres son los de YCloud en minúsculas, a propósito: traducirlos
   * obligaría a mantener un diccionario y a adivinar qué significa un estado
   * nuevo el día que Meta lo añada.
   */
  status text not null default 'local'
    check (status in (
      'local',      -- escrita aquí, sin enviar todavía
      'pending',    -- enviada, Meta la está revisando
      'approved',   -- se puede usar
      'rejected',   -- Meta dijo que no; el motivo está en `rejection_reason`
      'paused',     -- Meta la paró por calidad
      'disabled',
      'archived',
      'in_appeal',
      'deleted'
    )),

  -- Las piezas del mensaje. `body` es lo único obligatorio para Meta.
  header_text text,
  body text not null,
  footer_text text check (footer_text is null or length(footer_text) <= 60),

  /*
   * Los botones, tal y como los espera YCloud. Se guardan en JSON en vez de en
   * una tabla aparte porque nunca se consultan por separado: se mandan enteros
   * al crear la plantilla y se leen enteros al usarla.
   */
  buttons jsonb not null default '[]'::jsonb,

  /*
   * Cuántas variables lleva el cuerpo ({{1}}, {{2}}…). Se guarda calculado en
   * vez de contarlo cada vez, porque de este número depende que el envío sea
   * válido: mandar una plantilla con menos valores de los que pide hace que
   * Meta rechace el mensaje entero.
   */
  variable_count integer not null default 0 check (variable_count >= 0),

  -- Identificador en el proveedor. Llega al crearla y sirve para trazar.
  provider_template_id text,
  rejection_reason text,

  submitted_at timestamptz,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  /*
   * ESTA RESTRICCIÓN NO ES COSMÉTICA.
   *
   * El evento `whatsapp.template.reviewed` identifica la plantilla por
   * `wabaId` + `name` + `language` — **no** manda nuestro identificador ni el
   * del proveedor (verificado en la documentación, SPIKE §2.c). Así que la
   * única forma de saber a qué fila se refiere es buscarla por esa terna.
   *
   * Si se permitieran dos plantillas con el mismo nombre e idioma en un
   * workspace, una aprobación de Meta actualizaría una de las dos al azar.
   */
  unique (workspace_id, name, language)
);

comment on table templates is
  'Plantillas de WhatsApp aprobadas por Meta: la única forma de escribir fuera de la ventana de 24 h.';
comment on column templates.status is
  'Estado en Meta. `local` es el nuestro: escrita pero sin enviar a revisar.';
comment on column templates.variable_count is
  'Cuántas {{n}} lleva el cuerpo. Enviar menos valores hace que Meta rechace el mensaje.';

create index if not exists templates_workspace_idx
  on templates (workspace_id, status);

-- ── Aislamiento ─────────────────────────────────────────────────────────────
-- Mismo patrón que el resto: denegar por defecto y dejar pasar solo a quien
-- pertenece al workspace. Una plantilla lleva el texto comercial del cliente;
-- que la vea otro no es una fuga grave, pero sí es una fuga.
--
-- Ver y editar son permisos distintos: un `viewer` tiene que poder leer las
-- plantillas para entender por qué se le contestó eso a una clienta, y no
-- tiene por qué poder mandar nada a revisar en nombre del negocio.

alter table templates enable row level security;

create policy "miembros ven las plantillas"
  on templates for select
  to authenticated
  using (public.is_member(workspace_id));

create policy "admin y manager editan las plantillas"
  on templates for all
  to authenticated
  using (public.has_role(workspace_id, array['admin', 'manager']::role_enum[]))
  with check (public.has_role(workspace_id, array['admin', 'manager']::role_enum[]));

grant select, insert, update, delete on templates to authenticated;
