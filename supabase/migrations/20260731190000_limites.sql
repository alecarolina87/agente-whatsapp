-- ============================================================================
-- F2 · Freno de mano y tope de gasto por workspace
--
-- POR QUÉ HACE FALTA
--
-- Cada respuesta del agente cuesta dinero, y ese dinero lo pone la agencia
-- (BLUEPRINT §7.4): el cliente paga sus mensajes de WhatsApp en su cuenta de
-- YCloud, la plataforma pone el modelo. Sin un tope, un cliente con mucho
-- tráfico —o una conversación en bucle— se lleva el margen de un mes en una
-- tarde, y no hay forma de enterarse hasta que llega la factura.
--
-- Son dos cosas distintas y las dos hacen falta:
--
--   · El TOPE es automático y silencioso: se alcanza y el agente se calla.
--   · El FRENO DE MANO es manual e inmediato: un interruptor para cuando algo
--     va mal y hay que parar **ya**, sin desplegar nada ni tocar código.
--
-- El día que un agente empiece a contestar disparates a los clientes de otro,
-- lo que se necesita no es un despliegue: es un botón.
-- ============================================================================

alter table workspaces
  -- Freno de mano. Se apaga desde la aplicación y corta la IA de todo el
  -- workspace al instante. Los mensajes se siguen recibiendo y guardando: lo
  -- que se para es que el agente conteste, no que la bandeja funcione.
  add column if not exists ia_activa boolean not null default true,

  -- Tope de gasto del mes en curso, en dólares. `null` significa sin tope.
  -- Se guarda con cuatro decimales porque una respuesta cuesta céntimos: con
  -- dos, todo se redondearía a cero y el contador nunca subiría.
  add column if not exists tope_mensual_usd numeric(10, 4),

  -- Cuántas respuestas puede recibir un mismo contacto por hora. Frena a quien
  -- escriba sin parar, por gracia o por error, sin cortarle a nadie más.
  add column if not exists tope_respuestas_hora integer not null default 20;

comment on column workspaces.ia_activa is
  'Freno de mano: en false, el agente no responde en todo el workspace. Los mensajes se siguen recibiendo.';
comment on column workspaces.tope_mensual_usd is
  'Tope de gasto del mes en dólares. null = sin tope.';
comment on column workspaces.tope_respuestas_hora is
  'Máximo de respuestas de IA por contacto y hora.';

-- ── Consultar el gasto del mes ──────────────────────────────────────────────
-- El coste real de cada respuesta se guarda en `messages.cost->>'coste_usd'`,
-- tal y como lo devuelve OpenRouter. Sumarlo desde la aplicación obligaría a
-- traerse todos los mensajes del mes; aquí lo suma Postgres y devuelve un
-- número.
--
-- `stable` y no `volatile` para que el planificador pueda reutilizar el
-- resultado dentro de una misma consulta.
create or replace function public.gasto_del_mes(p_workspace_id uuid)
returns numeric
language sql
security definer
set search_path = ''
stable
as $$
  select coalesce(sum((cost->>'coste_usd')::numeric), 0)
  from public.messages
  where workspace_id = p_workspace_id
    and direction = 'out'
    and cost ? 'coste_usd'
    and created_at >= date_trunc('month', now());
$$;

comment on function public.gasto_del_mes(uuid) is
  'Suma en dólares lo gastado en respuestas de IA este mes.';

-- Igual que con las funciones de Vault: una función recién creada la puede
-- ejecutar PUBLIC por defecto. Aquí el dato no es un secreto, pero el gasto de
-- un cliente no tiene por qué verlo otro.
revoke all on function public.gasto_del_mes(uuid) from public, anon;
grant execute on function public.gasto_del_mes(uuid) to authenticated, service_role;

-- Sumar por mes recorre los mensajes salientes del workspace. Con este índice
-- no hace falta mirar los entrantes, que son la mayoría.
create index if not exists messages_coste_idx
  on messages (workspace_id, created_at desc)
  where direction = 'out';
