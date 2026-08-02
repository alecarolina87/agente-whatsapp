-- ═══════════════════════════════════════════════════════════════════════════
-- Alta de un negocio
--
-- Es la primera historia del documento de usuario (US-0.1, Must, F0) y era la
-- que faltaba: hasta hoy, dar de alta a un cliente se hacía a mano con SQL y
-- un script. Sin esto no hay agencia, solo una bandeja.
--
-- ## Por qué una función y no cuatro inserts desde la app
--
-- Un negocio son cuatro cosas que nacen juntas o no nacen: el workspace, la
-- membresía de quien lo crea, su canal de WhatsApp y sus claves en Vault. Si
-- se insertan por separado y falla la tercera, queda un workspace huérfano al
-- que nadie pertenece —invisible incluso para quien lo acaba de crear, porque
-- RLS cuelga de la membresía—. Aquí o pasa entero o no pasa nada.
--
-- ## Por qué SECURITY DEFINER
--
-- El RLS de F0 deniega el `insert` sobre `workspaces` a propósito, y dejó
-- escrito por qué: «crear workspaces se hace desde servidor (alta con su
-- primer admin en una transacción)». Esta función es ese servidor.
-- ═══════════════════════════════════════════════════════════════════════════

/**
 * Convierte «Estética Ale» en «estetica-ale».
 *
 * El slug se ve en URLs y en la tabla de clientes, así que no puede llevar
 * tildes ni espacios. `unaccent` no está disponible en todas las instancias,
 * así que se traducen las vocales a mano: son las que aparecen de verdad en
 * nombres de negocios en español.
 */
create or replace function public.a_slug(p_texto text)
returns text
language sql
immutable
set search_path = ''
as $$
  select trim(both '-' from
    regexp_replace(
      lower(translate(p_texto, 'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ',
                               'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC')),
      '[^a-z0-9]+', '-', 'g'
    )
  );
$$;

/**
 * Da de alta un negocio completo y devuelve su identificador.
 *
 * Las claves de YCloud son opcionales: un negocio se puede crear hoy y
 * conectar el WhatsApp mañana. Mientras no las tenga, el canal queda en
 * `pending` y **el webhook lo rechaza**, que es justo lo que debe pasar: sin
 * secreto no se puede verificar ninguna firma.
 */
create or replace function public.crear_negocio(
  p_nombre               text,
  p_telefono             text,
  p_ycloud_api_key       text default null,
  p_ycloud_webhook_secret text default null,
  p_system_prompt        text default null,
  p_respuesta_a_archivos text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_usuario     uuid := auth.uid();
  v_workspace   uuid;
  v_slug        text;
  v_sufijo      int  := 0;
  v_ref_api     uuid;
  v_ref_webhook uuid;
  v_estado      text;
begin
  -- Sin sesión no se crea nada. La función se salta RLS, así que es la propia
  -- función la que tiene que comprobar quién llama.
  if v_usuario is null then
    raise exception 'hace falta iniciar sesión';
  end if;

  if coalesce(trim(p_nombre), '') = '' then
    raise exception 'el negocio necesita un nombre';
  end if;

  -- E.164: el mismo formato que normaliza el webhook. Si aquí se guardara
  -- «662 55 28 51», ningún mensaje entrante encontraría su canal.
  if p_telefono !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'el teléfono debe ir en formato internacional, por ejemplo +34600111222';
  end if;

  if exists (select 1 from public.channels where phone_number = p_telefono) then
    raise exception 'ese número ya está dado de alta en otro negocio';
  end if;

  -- Slug único. Dos clientes pueden llamarse igual, y el segundo no puede
  -- fallar por eso: se le añade un número y sigue.
  v_slug := public.a_slug(p_nombre);
  if v_slug = '' then v_slug := 'negocio'; end if;

  while exists (select 1 from public.workspaces where slug = v_slug) loop
    v_sufijo := v_sufijo + 1;
    v_slug := public.a_slug(p_nombre) || '-' || v_sufijo;
  end loop;

  insert into public.workspaces (name, slug)
  values (trim(p_nombre), v_slug)
  returning id into v_workspace;

  -- Quien lo crea es su admin. Va inmediatamente después del workspace porque
  -- hasta que existe esta fila, el workspace es invisible para todo el mundo.
  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_workspace, v_usuario, 'admin');

  /*
   * Las claves nunca se guardan en la tabla: van a Vault y en `channels` solo
   * queda la referencia. El canal solo se activa si están las dos — con una
   * sola, el webhook verificaría firmas pero no podría contestar, o al revés.
   */
  if p_ycloud_api_key is not null and p_ycloud_webhook_secret is not null then
    v_ref_api := public.guardar_secreto(
      'ws:' || v_workspace || ':ycloud:api_key', p_ycloud_api_key
    );
    v_ref_webhook := public.guardar_secreto(
      'ws:' || v_workspace || ':ycloud:webhook_secret', p_ycloud_webhook_secret
    );
    v_estado := 'active';
  else
    v_estado := 'pending';
  end if;

  insert into public.channels (
    workspace_id, phone_number, display_name,
    ycloud_credential_ref, webhook_secret_ref,
    system_prompt, status
  )
  values (
    v_workspace, p_telefono, trim(p_nombre),
    v_ref_api, v_ref_webhook,
    nullif(trim(coalesce(p_system_prompt, '')), ''),
    v_estado
  );

  -- El acuse de archivos solo se pisa si viene escrito: si no, se queda el
  -- valor por defecto de la columna, que ya es una frase válida.
  if nullif(trim(coalesce(p_respuesta_a_archivos, '')), '') is not null then
    update public.channels
       set respuesta_a_archivos = trim(p_respuesta_a_archivos)
     where workspace_id = v_workspace;
  end if;

  insert into public.events (workspace_id, type, actor, payload)
  values (v_workspace, 'workspace.created', 'user',
          jsonb_build_object('slug', v_slug, 'canal', p_telefono, 'estado_canal', v_estado));

  return v_workspace;
end;
$$;

comment on function public.crear_negocio is
  'Alta completa de un cliente: workspace + membresía admin + canal + claves en Vault, en una transacción. US-0.1.';

/*
 * Cualquiera con sesión puede dar de alta un negocio, y pasa a ser su admin.
 * Es el modelo de hoy: una agencia, una persona. Cuando haya que limitar quién
 * puede crear clientes, el sitio es esta línea y la tabla `platform_admins`
 * que el blueprint deja prevista para F9.
 */
revoke all on function public.crear_negocio(text, text, text, text, text, text) from public, anon;
grant execute on function public.crear_negocio(text, text, text, text, text, text) to authenticated, service_role;

grant execute on function public.a_slug(text) to authenticated, service_role;
