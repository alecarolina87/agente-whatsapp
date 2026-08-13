-- ============================================================================
-- Automatizaciones — que pasen cosas sin que nadie esté delante
--
-- POR QUÉ HACE FALTA
--
-- El agente contesta muy bien a quien escribe. Lo que no sabe hacer es lo
-- contrario: acordarse de alguien que se quedó a medias. Una clienta pregunta
-- el precio de las cejas, el agente contesta, y ahí muere. Nadie vuelve a
-- escribirle, y no porque no se quiera, sino porque no hay quien lo recuerde.
--
-- Ese seguimiento es donde está el dinero de verdad de una clínica o un
-- estudio. Y pasadas 24 h ya no se puede escribir texto libre: la única puerta
-- es una plantilla aprobada, que es justo lo que se construyó antes de esto.
--
-- POR QUÉ ESTO NO ES LO QUE HACE EL FORK
--
-- El fork tiene esta misma tabla desde junio, con seis disparadores y cinco
-- acciones. **Nadie las lee.** Se comprobó: las ocho referencias a
-- `automation_rules` en su código están en la pantalla que las guarda y en la
-- API que las guarda. No hay motor. Es un formulario que promete algo que no
-- ocurre nunca, y el cliente no se entera hasta que echa de menos el
-- recordatorio.
--
-- Por eso aquí hay menos opciones: **solo entran las que se ejecutan de
-- principio a fin**. Un desplegable con cosas que no funcionan es peor que un
-- desplegable corto.
--
-- POR QUÉ EL CATÁLOGO NO ESTÁ AQUÍ
--
-- Igual que con los modelos y las capacidades: qué disparadores y qué acciones
-- existen vive en el código (`src/lib/automatizaciones/catalogo.ts`), y aquí
-- solo queda qué ha configurado cada negocio. Un `check` con la lista cerrada
-- obligaría a una migración cada vez que se añade una, y la lista acabaría
-- diciendo una cosa distinta que el código que la ejecuta.
-- ============================================================================

create table if not exists automations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,

  -- Lo escribe quien la crea, para reconocerla en la lista.
  nombre text not null check (length(trim(nombre)) between 1 and 80),

  -- Apagada por defecto. Una automatización que se enciende sola escribiría a
  -- clientas reales sin que nadie lo haya decidido.
  activa boolean not null default false,

  -- Claves del catálogo del código.
  disparador text not null,
  accion text not null,

  -- Cada disparador y cada acción piden datos distintos (horas de silencio,
  -- qué plantilla, qué etiqueta). Se leen siempre enteros, nunca por separado.
  config_disparador jsonb not null default '{}'::jsonb,
  config_accion jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table automations is
  'Reglas disparador → acción de cada negocio. El catálogo de disparadores y acciones vive en el código.';

-- El barrido pregunta cada pocos minutos por las activas de cada negocio.
create index if not exists automations_activas_idx
  on automations (workspace_id) where activa;

-- ============================================================================
-- Lo que ya se hizo — y por qué esta tabla es la pieza importante
--
-- Un disparador de tiempo («lleva 24 h sin contestar») es verdad de forma
-- continua: si el barrido pasa cada diez minutos, la misma conversación lo
-- cumple ciento cuarenta veces al día. Sin registro, la clienta recibiría
-- ciento cuarenta recordatorios. No es un detalle a pulir después: es la
-- diferencia entre una función útil y quemar el número de WhatsApp del
-- cliente, que es un daño que no se deshace.
--
-- LA CLAVE ESTÁ EN `referencia`, Y NO ES OBVIA
--
-- Marcar «esta regla ya se ejecutó en esta conversación» y no volver a
-- hacerlo nunca sería demasiado: si la clienta vuelve a escribir en marzo y se
-- queda callada otra vez, ese silencio es nuevo y merece su recordatorio.
--
-- Se guarda entonces **el momento en que se quedó callada** — el último
-- mensaje suyo — como parte de la clave. El mismo silencio se persigue una
-- vez; un silencio nuevo vuelve a contar. La regla, la conversación y el
-- silencio: tres cosas, una fila.
-- ============================================================================

create table if not exists automation_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  automation_id uuid not null references automations(id) on delete cascade,
  conversation_id uuid not null references conversations(id) on delete cascade,

  /*
   * Qué ocasión concreta se atendió. Para los disparadores de tiempo es el
   * instante del último mensaje de la clienta; para los de evento, el
   * identificador de lo que pasó. Texto y no timestamp a propósito: así vale
   * para los dos sin partir la tabla en dos.
   */
  referencia text not null,

  created_at timestamptz not null default now(),

  unique (automation_id, conversation_id, referencia)
);

comment on table automation_runs is
  'Qué automatización ya se ejecutó y para qué ocasión. Es lo que impide repetir el mismo aviso cada barrido.';
comment on column automation_runs.referencia is
  'La ocasión concreta: normalmente el último mensaje entrante. Un silencio nuevo genera una referencia nueva.';

create index if not exists automation_runs_regla_idx
  on automation_runs (automation_id, created_at desc);

-- ── Aislamiento ─────────────────────────────────────────────────────────────
-- Las reglas llevan textos que se envían a clientas reales; el historial dice
-- a quién se le escribió y cuándo.

alter table automations enable row level security;
alter table automation_runs enable row level security;

create policy "miembros ven las automatizaciones"
  on automations for select
  to authenticated
  using (public.is_member(workspace_id));

create policy "admin y manager cambian las automatizaciones"
  on automations for all
  to authenticated
  using (public.has_role(workspace_id, array['admin', 'manager']::role_enum[]))
  with check (public.has_role(workspace_id, array['admin', 'manager']::role_enum[]));

/*
 * El historial se mira, no se toca. Quien pudiera borrar una fila de aquí
 * podría hacer que un recordatorio ya enviado se volviera a enviar — y esa es
 * exactamente la avería que esta tabla existe para evitar. Solo lee, y solo
 * escribe el service-role desde el motor.
 */
create policy "miembros ven el historial"
  on automation_runs for select
  to authenticated
  using (public.is_member(workspace_id));

grant select, insert, update, delete on automations to authenticated;
grant select on automation_runs to authenticated;

-- ============================================================================
-- El barrido
--
-- Mismo montaje que el del buffer (`20260802220000_barrido.sql`) y por el mismo
-- motivo: responder implica llamar a WhatsApp, y eso no lo hace Postgres. El
-- cron dispara, la aplicación ejecuta.
--
-- POR QUÉ CADA DIEZ MINUTOS Y NO CADA MINUTO
--
-- El buffer corre cada minuto porque una clienta está esperando la respuesta.
-- Aquí no espera nadie: son horas de silencio. Diez minutos de retraso sobre un
-- recordatorio de veinticuatro horas no lo nota nadie, y cada barrido son
-- consultas que se ahorran a la base de datos de todos los clientes.
-- ============================================================================

create or replace function public.barrer_automatizaciones()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url     text;
  v_secreto text;
begin
  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'plataforma:automatizaciones:url';

  select decrypted_secret into v_secreto
    from vault.decrypted_secrets where name = 'plataforma:flush:secreto';

  -- Sin configurar no se hace nada y no se protesta: la migración se aplica
  -- antes de que exista la URL de producción.
  if v_url is null or v_secreto is null then
    return;
  end if;

  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Content-Type',      'application/json',
      'x-internal-secret', v_secreto
    ),
    body    := '{}'::jsonb
  );
end;
$$;

revoke all on function public.barrer_automatizaciones() from public, anon, authenticated;

select cron.unschedule('barrer-automatizaciones')
  where exists (select 1 from cron.job where jobname = 'barrer-automatizaciones');

select cron.schedule(
  'barrer-automatizaciones',
  '*/10 * * * *',
  'select public.barrer_automatizaciones()'
);
