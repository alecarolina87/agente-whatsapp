-- ═══════════════════════════════════════════════════════════════════════════
-- Información del negocio
--
-- Hasta ahora, todo lo que el agente sabía de un cliente estaba metido a mano
-- dentro de `channels.system_prompt`, en un solo campo de texto. Eso funciona
-- para «habla de tú y sé amable» y se rompe para «¿cuánto cuesta la limpieza
-- dental?»: los datos acaban mezclados con las instrucciones, nadie sabe qué
-- puede tocar sin estropear el tono, y actualizar un precio obliga a releer un
-- muro de texto.
--
-- Separarlos es la US-5.2 de las historias de usuario: **la información del
-- negocio va aparte de las instrucciones narrativas**, para poder editar una
-- sin romper la otra.
--
-- ## Por qué jsonb y no tablas para servicios y preguntas
--
-- Un negocio tiene entre tres y quince servicios, y se leen todos juntos o
-- ninguno: no hay una sola consulta que pida «los servicios de más de 50 €».
-- Una tabla aparte añadiría dos joins y una migración por cada campo nuevo, a
-- cambio de nada. Cuando haga falta buscar dentro, se cambia.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists business_info (
  workspace_id uuid primary key references workspaces (id) on delete cascade,

  -- Qué es el negocio, en dos frases. Es lo primero que lee el modelo.
  descripcion text,

  -- [{ nombre, descripcion, precio, duracion }]
  servicios jsonb not null default '[]'::jsonb,

  -- Texto libre a propósito: los horarios reales son irregulares —«L-V de 9 a
  -- 14 y de 16 a 20, sábados alternos»— y cualquier estructura que se invente
  -- acaba estorbando.
  horarios text,
  direccion text,
  zona text,

  -- [{ pregunta, respuesta }]
  faqs jsonb not null default '[]'::jsonb,

  -- [{ objecion, respuesta }] — lo que frena a alguien a comprar y cómo se
  -- responde. Es lo que más levanta la tasa de conversión y lo que nunca se
  -- escribe, porque no se le ocurre a nadie que el agente lo necesite.
  objeciones jsonb not null default '[]'::jsonb,

  /*
   * Lo que el agente NO puede prometer.
   *
   * Es el campo más importante de esta tabla y va en su propia columna para
   * que nadie lo borre por accidente al reordenar el prompt. En una clínica o
   * un centro de estética, una promesa de más no es un problema de marketing:
   * es una afirmación sanitaria sin supervisar.
   */
  no_prometer text,

  web text,
  actualizado_en timestamptz not null default now()
);

alter table business_info enable row level security;

create policy "miembros ven la info del negocio"
  on business_info for select
  to authenticated
  using (public.is_member(workspace_id));

create policy "admin y manager editan la info del negocio"
  on business_info for all
  to authenticated
  using (public.has_role(workspace_id, array['admin', 'manager']::role_enum[]))
  with check (public.has_role(workspace_id, array['admin', 'manager']::role_enum[]));

grant select, insert, update, delete on business_info to authenticated;
grant all on business_info to service_role;

comment on table business_info is
  'Datos del negocio que el agente inyecta como contexto. Separados del system_prompt para poder editar uno sin romper el otro (US-5.2).';

comment on column business_info.no_prometer is
  'Lo que el agente no puede prometer nunca. Se inyecta al final del prompt, después de todo lo demás.';
