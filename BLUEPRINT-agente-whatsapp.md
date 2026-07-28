---
proyecto: 01 — Agente de WhatsApp
doc: blueprint técnico maestro
version: v1.0
actualizado: 2026-07-06
relacionado: BRIEF.md · ARQUITECTURA-OBJETIVO.md · SECURITY-AUDIT-agente-whatsapp.md · USER-STORIES-agente-whatsapp.md
fuentes_verificadas: docs YCloud, OpenRouter, HighLevel, Supabase (pg_cron/pg_net/pooler), Meta WhatsApp
---

# BLUEPRINT — Plataforma de inbox conversacional WhatsApp con IA

> Documento técnico maestro. El `BRIEF.md` dice **qué** (producto + módulos); la `ARQUITECTURA-OBJETIVO.md` dice
> **cómo se ve terminado**; este blueprint fija **cómo se construye**: arquitectura, modelo de datos, contratos de
> integración, motor del agente, compliance, fases y requisitos no-funcionales. Incorpora las correcciones del
> **premortem** (ver §14 y `SECURITY-AUDIT`).

## Tabla de contenido
1. Resumen ejecutivo y definición
2. Alcance v1 (in / out)
3. Decisiones fijas (stack)
4. Arquitectura de alto nivel
5. Runtime del mensaje (pipeline)
6. Modelo de datos (Supabase)
7. Multi-tenancy y RLS
8. Contrato `Tool` y catálogo
9. Contratos de integración (YCloud · OpenRouter · HighLevel)
10. Motor de decisión y agent runtime
11. Compliance Meta (ventana 24h, tiers, quality, opt-in)
12. Buffer inteligente (diseño)
13. Roadmap por fases (F0–F8)
14. Secuencia de ejecución endurecida (F0–F1)
15. Requisitos no-funcionales (NFR)
16. Configuración y variables de entorno
17. Estructura de carpetas objetivo
18. Criterios de aceptación técnica

---

## 1. Resumen ejecutivo y definición

**No es "solo un bot".** Es una **plataforma multi-tenant de inbox conversacional para WhatsApp con IA, operable por
humano**: combina inbox tipo WhatsApp Web + CRM básico + motor de agente (agent runtime) + buffer inteligente +
handoff humano + integraciones + **cumplimiento estricto de las reglas Meta/WhatsApp**.

- Webapp **tipo WhatsApp Web** para gestionar conversaciones (lista + hilo + composer + estado IA/humano).
- IA conectada a WhatsApp con **modo automático** y **modo humano**, conmutables por conversación.
- **CRM básico** (contactos + contexto comercial) con dedupe por teléfono.
- Tools, knowledge base y conectores **activables por workspace**.
- **Modo setter** (calificación, knockout questions, agendamiento).
- Integración nativa **HighLevel** + enlaces externos de agenda.
- Gestión de **templates**, **ventana 24h** y **cumplimiento Meta** como guardrail duro.
- **Multi-tenant por workspace**: cada workspace aísla config, prompts, tools, KB, credenciales y datos.

## 2. Alcance v1

**Dentro (Core v1):** inbox realtime; CRM básico; texto + media (audio/imagen/doc/video) en recepción y composer;
buffer inteligente; toggle IA/humano; handoff manual y automático; business info; custom prompting; catálogo de
tools; etiquetas; sync de contactos con HighLevel; OpenRouter; ventana 24h + bloqueo fuera de ventana + templates;
gestión/validación/sync de templates con Meta; modo setter; agendamiento por link y directo en HighLevel;
coexistencia con móvil.

**Fuera (v2+):** multiagente por workspace; multi-número; pipelines/oportunidades avanzados; flujos visuales
complejos; QA de conversaciones; A/B testing de prompts; auto-optimización; marketplace de tools.

**No-objetivos explícitos:** no es un CRM completo (es una capa de contexto conversacional); no reemplaza a HighLevel;
no expone SQL libre a los tenants.

## 3. Decisiones fijas (stack)

| Tema | Decisión |
|------|----------|
| Proveedor WhatsApp (BSP) | **YCloud** (único) — sin Meta directo ni Kapso |
| LLM gateway | **OpenRouter** (modelo seleccionable por workspace/tarea) |
| Integración oficial v1 | **HighLevel** (only) |
| Framework | **Next.js 16.2.10** (App Router, `src/`, **Proxy** no Middleware), React 19.2 |
| Estilos | **Tailwind v4** (CSS-first) + **shadcn/ui** |
| Datos / auth / realtime | **Supabase** (Postgres + Auth + Realtime + Storage + Vault + pg_cron/pg_net) |
| Hosting app | **Vercel** (serverless) |
| Multi-tenancy | Por **workspace** (multi-tenant desde el diseño) |

## 4. Arquitectura de alto nivel

**Topología:**
- **Next.js en Vercel (serverless):** dashboard (Server/Client Components), Server Actions, y **route handlers** para
  webhooks (`/api/webhooks/ycloud/[workspaceId]`) e internos (`/api/internal/*`). Sin proceso always-on.
- **Supabase:** Postgres (datos + RLS), Auth (sesiones), Realtime (inbox en vivo), Storage (media), **Vault**
  (credenciales por tenant), **pg_cron + pg_net** (motor del buffer en F2).
- **Servicios externos:** YCloud (WhatsApp), OpenRouter (LLM), HighLevel (CRM oficial).

**Superficies del dashboard:**
- **Inbox** estilo WhatsApp Web: lista + hilo + composer + toggle IA/humano + estado ventana 24h + handoff + notas
  internas + panel CRM lateral.
- **Settings** (14 secciones): WhatsApp/YCloud · Templates Meta · OpenRouter · Business info · Prompting · Tools · KB ·
  Setter · Scheduling · HighLevel · Automation rules · Handoff · Team/roles · Logs.
- **Onboarding wizard:** modo/caso de uso → datos de empresa → conectar YCloud → (opc) HighLevel/OpenRouter → activo.

## 5. Runtime del mensaje (pipeline)

```
WhatsApp (YCloud)
        │  webhook inbound (POST /api/webhooks/ycloud/[workspaceId])
        ▼
[1] Ingress + verificación de firma (HMAC YCloud-Signature) + idempotencia (event.id/wamid)
        │        → responde 2xx en <2s (ACK). El procesamiento sigue en after()/flush.
        ▼
[2] Normalizador   → evento unificado {workspace, from(E.164), type, text|media, ts_cliente, wamid, event_id}
        ▼
[3] Buffer / debounce ⭐ (F2)  → agrupa por SILENCIO del usuario; junta texto + audio transcrito + captions;
        │                        reglas por tipo; flush_after reseteable; logs de batch
        ▼
[4] Motor de DECISIÓN  → ¿responder? ¿esperar más? ¿tool? ¿setter? ¿etiquetar? ¿handoff? ¿abstenerse?
        │                (abstención dura si ventana cerrada o baja confianza)
        ▼
[5] Agent runtime (OpenRouter)  → prompt resuelto (workspace>número>campaña>segmento>modo) + variables
        │        ▲                 dinámicas + tool-calling + guardrails + control de ventana 24h
        │        │ tools
        ▼        │
[6] Capa de Tools (adapter) ◄───┘  KB · HighLevel · agenda · etiquetar · validar ventana · elegir template ·
        │                          transferir a humano · webhook custom
        ▼
[7] Salida YCloud  → texto (sesión <24h) | template aprobado (fuera de ventana, F4+)
        ▼
[8] Persistencia + Observabilidad (Supabase) → messages, events, costo/tokens, estado

   [transversal] State machine de la conversación:
   IA activa · Humano activo · Handoff pendiente · Esperando respuesta · Pausada/snoozed · Cerrada
```

**Regla de oro serverless:** el webhook **nunca** hace la llamada al LLM de forma bloqueante antes del ACK
(YCloud espera 2xx en <6s y **reintenta 7 veces**). El trabajo del agente corre en `after()` (Next.js) en el MVP y se
mueve al **flush del buffer** en F2.

## 6. Modelo de datos (Supabase)

Todas las tablas de negocio llevan `workspace_id uuid not null` y RLS por membresía. Tipos abreviados; `id uuid pk
default gen_random_uuid()`, `created_at timestamptz default now()` implícitos salvo nota.

### 6.1 Núcleo (Fase 0)

**`workspaces`** — `name text`, `slug text unique`, `plan text`, `settings jsonb`.

**`workspace_members`** — `workspace_id fk`, `user_id fk→auth.users`, `role role_enum`. UNIQUE(workspace_id, user_id).
`role_enum = admin | manager | agent | viewer`.

**`channels`** (número WhatsApp por workspace) — `phone_number text` (E.164), `display_name text`,
`ycloud_credential_ref text` (→ Vault, **no** el secreto en claro), `webhook_secret_ref text` (→ Vault),
`system_prompt text`, `ai_default_enabled bool`, `status text`. UNIQUE(phone_number).

**`integrations`** — `type integration_enum (openrouter|highlevel)`, `credentials_ref text` (→ Vault),
`config jsonb`, `enabled bool`. UNIQUE(workspace_id, type).

**`contacts`** — `wa_phone text` (E.164 normalizado), `name text`, `email text`, `source text`, `owner_id fk→members`,
`tags text[]`, `custom_fields jsonb`, `stage text`, `hl_contact_id text`, `opt_in bool`, `opt_in_source text`,
`opt_in_at timestamptz`, `last_interaction_at timestamptz`. **UNIQUE(workspace_id, wa_phone)** (dedupe).

**`conversations`** — `contact_id fk`, `channel_id fk`, `state conversation_state_enum`, `assignee_id fk→members`,
`ai_enabled bool`, `window_expires_at timestamptz` (= último inbound del cliente + 24h), `last_inbound_at`,
`last_outbound_at`, `last_message_at`, `unread_count int`, `status text (open|closed|archived)`, `priority text`.
`conversation_state_enum = ai_active | human_active | handoff_pending | awaiting_user | snoozed | closed`.

**`messages`** — `conversation_id fk`, `direction msg_dir_enum (in|out)`, `type msg_type_enum
(text|audio|image|document|video|template|interactive|system)`, `text text`, `media jsonb`, `wamid text`,
`batch_id fk→message_batches`, `sender sender_enum (contact|ai|human|system)`, `status msg_status_enum
(queued|sent|delivered|read|failed)`, `error jsonb`, `cost jsonb` (tokens/costo si aplica). INDEX(conversation_id,
created_at). UNIQUE(workspace_id, wamid) donde wamid no es null (idempotencia de salida/entrada).

**`processed_events`** (idempotencia de webhooks) — `event_id text`, `source text (ycloud|highlevel)`,
`received_at timestamptz`. UNIQUE(workspace_id, source, event_id). Retención p.ej. 7 días.

**`events`** (observabilidad, append-only) — `conversation_id fk null`, `type text`, `payload jsonb`, `actor text`.
INDEX(workspace_id, created_at). Solo escribe el service-role.

### 6.2 Crecimiento (F2–F8, se crean como stub temprano)

**`message_batches`** (F2 buffer) — `conversation_id fk`, `status batch_status_enum (pending|processing|done|failed)`,
`flush_after timestamptz`, `message_count int`, `reason text`. INDEX(status, flush_after).

**`business_info`** — `structured jsonb` (servicios, FAQs, horarios, zonas, precios, políticas, claims_permitidos[],
claims_prohibidos[], CTA), `free_text text`, `updated_by fk`.

**`prompts`** + **`prompt_versions`** — `prompts(scope prompt_scope_enum
(workspace|channel|campaign|segment|mode), target text, mode text)`; `prompt_versions(prompt_id fk, body text,
status draft|published, version int, variables jsonb, created_by fk)`.

**`tools`** (catálogo global) + **`tool_configs`** (`tool_id fk`, `enabled bool`, `credentials_ref text` (→ Vault),
`config jsonb`, `requires_confirmation bool`).

**`templates`** — `name text`, `language text` (**`es`**, no `es_PA`), `category template_category_enum
(marketing|utility|authentication)`, `components jsonb`, `meta_status text (draft|submitted|approved|rejected|paused)`,
`ycloud_template_id text`, `hl_synced bool`. UNIQUE(workspace_id, name, language).

**`setter_configs`** — `questions jsonb` (obligatorias/opcionales), `knockout_rules jsonb`, `scoring jsonb`,
`post_action jsonb`.

**`schedules`** / **`appointments`** — link config + citas creadas (HighLevel/externo), `result text`.

**`kb_documents`** + **`kb_chunks`** (F8, requiere `vector`) — `kb_chunks(embedding vector, content text,
document_id fk, metadata jsonb)`.

**`usage_counters`** (cost cap / rate-limit) — `workspace_id`, `period text`, `tokens_in bigint`, `tokens_out bigint`,
`cost_usd numeric`, `message_count int`. Para kill-switch y límites.

### 6.3 Índices y constraints clave
- `UNIQUE(workspace_id, wa_phone)` en `contacts` (dedupe).
- `UNIQUE(workspace_id, source, event_id)` en `processed_events` (idempotencia inbound).
- `UNIQUE(workspace_id, wamid)` en `messages` (idempotencia).
- `INDEX(status, flush_after)` en `message_batches` (poller del buffer).
- `INDEX(conversation_id, created_at)` en `messages` (hilo paginado).
- FKs con `on delete cascade` desde `workspace_id` según convenga; borrado de PII controlado (ver compliance/GDPR).

## 7. Multi-tenancy y RLS

- **RLS deny-by-default** en todas las tablas de negocio. Política de lectura/escritura: la fila es visible/editable
  si `workspace_id` pertenece a un `workspace_members` del `auth.uid()` actual (y, donde aplique, con el `role`
  requerido). Helper SQL `is_member(workspace_id)` / `has_role(workspace_id, roles[])`.
- **Service-role (bypass RLS)** solo en código server-side de webhook/agent/tools/flush. Para reducir el blast radius,
  **toda** query server-side pasa por una capa de datos (`src/lib/data/*`) que **exige y filtra `workspace_id`**;
  prohibido construir queries ad-hoc sin scope. Tests de aislamiento obligatorios.
- **Supabase Realtime:** publicar solo las tablas necesarias (`messages`, `conversations`) con RLS activa y verificar
  la **autorización de canales** para que un cliente jamás reciba filas de otro workspace.
- **Storage (media):** buckets/paths por workspace con policies; nunca URLs públicas sin firmar para PII.
- **Secrets:** credenciales de tenant (YCloud/OpenRouter/HighLevel) en **Supabase Vault** (`*_ref` en las tablas),
  descifradas solo server-side al momento de usar. `SUPABASE_SERVICE_ROLE_KEY` solo en el entorno server de Vercel.

### 7.1 Nivel agencia — acceso al estado, nunca al contenido

Hay un nivel por encima del workspace: **quien explota la plataforma** y da de alta a varios negocios como
clientes. Necesita una vista transversal para operar (¿está YCloud conectado en cada cliente? ¿alguien se acerca al
límite de coste? ¿hay envíos fallidos?), pero **no necesita leer las conversaciones de nadie**.

**Decisión: la agencia ve el estado operativo, no el contenido.**

| La agencia SÍ ve | La agencia NO ve |
| --- | --- |
| Nº de conversaciones, mensajes y miembros por workspace | El texto de los mensajes |
| Estado de conexión del canal (YCloud) y calidad del número | Teléfonos y nombres de los contactos |
| Consumo y coste acumulado; alertas de límite | `custom_fields`, notas y etiquetas de contactos |
| Errores de envío y eventos del sistema | El detalle de cualquier conversación |
| Plan, fecha de alta y estado del workspace | — |

**Por qué, y no es solo prudencia:** los mensajes de una clínica son datos de salud. Si quien opera la plataforma
puede leerlos, asume un riesgo que no le aporta nada y complica su posición ante el RGPD. Con este límite la
agencia es encargada del tratamiento con acceso mínimo. **Y es argumento comercial**: se le puede decir al cliente
"no puedo leer lo que te escriben tus pacientes" y que sea verdad.

**Modelo de datos.** Tabla `platform_admins` (`user_id fk→auth.users`, `created_at`) y helper
`is_platform_admin()`, análogo a `is_member()` y también `security definer`.

**Implementación del acceso.** La agencia **no recibe políticas RLS sobre `messages`, `contacts` ni
`conversations`**. Su panel se alimenta de:

- una **vista agregada** `agency_workspace_stats` (contadores por workspace, sin filas de negocio), y
- `channels`, `integrations`, `usage_counters` y `events`, donde sí hay política para `is_platform_admin()`.

Así el límite no depende de que la interfaz "no muestre" el contenido: **la base de datos no se lo entrega**. Un
fallo de programación en el panel no puede convertirse en una fuga.

**Tests obligatorios**, en la línea de los de aislamiento de F0: un `platform_admin` que consulte `messages` o
`contacts` de cualquier workspace debe recibir **cero filas**.

### 7.2 Que el cliente pueda usarla sin ayuda

El límite anterior tiene una consecuencia: **si la agencia no ve el contenido, no puede resolver los problemas del
cliente entrando a mirar**. Así que la interfaz del workspace tiene que bastarse sola.

Requisitos que se derivan de esa decisión, y que condicionan el diseño de la app del cliente:

- **Alta autónoma:** conectar el número, escribir el prompt del negocio y probar el agente sin depender de nadie.
- **Errores explicados en su idioma:** "el número no está conectado" en vez de un código de YCloud. Cada error
  visible dice **qué ha pasado y qué hacer**.
- **Estado siempre a la vista:** si la IA está activa o pausada, si la ventana de 24 h sigue abierta, si un mensaje
  falló. Sin tener que buscarlo.
- **Nada que requiera saber de tecnología:** ni ids, ni JSON, ni webhooks en la interfaz del cliente.
- **Soporte sin acceso a datos:** cuando el cliente pida ayuda, la agencia se apoya en `events` y en los
  contadores, que sí ve. Por eso `events` es un log de decisión y no un volcado de mensajes: está pensado para
  poder diagnosticar sin leer conversaciones.

### 7.3 Qué mide cada panel

Son dos audiencias con preguntas distintas, así que son dos paneles distintos. No es una cuestión de permisos
solamente: es que las métricas útiles para una son ruido para la otra.

**Panel del cliente — responde "¿está funcionando?" y "¿tengo que hacer algo?"**

- **Resultado primero:** citas agendadas, conversaciones resueltas sin intervención humana. Es lo que justifica la
  suscripción, y lo que hace que renueve.
- **Lo que requiere su atención:** conversaciones esperando respuesta, ventanas de 24 h por caducar, envíos
  fallidos. Aquí es donde se usan el ámbar y el rojo.
- **Actividad reciente**, leída de `events`.

**Nunca en el panel del cliente: el coste de LLM.** Es el coste de la agencia, no del cliente. Enseñárselo revela
el margen y no le sirve para nada: no puede actuar sobre esa cifra. Un cliente que ve "coste de IA: 3 $" junto a
una factura de 200 € tiene una conversación pendiente que nadie quiere.

**Panel de agencia — responde "¿cómo va el negocio y qué cliente necesita algo?"**

- **Coste y consumo por workspace** (`usage_counters`), para saber cuánto gasta cada cliente y con qué margen.
- Estado de conexión del canal y calidad del número.
- Errores de envío y alertas de límite de coste.
- Altas, plan y estado de cada workspace.

Contar mensajes o conversaciones sirve poco en ambos casos: con volumen, ese número deja de significar nada.
Las métricas son **de resultado** (cliente) o **de explotación** (agencia).

### 7.4 Reparto de costes y titularidad de la WABA

**El número y la cuenta de empresa de Meta (WABA) son del cliente, no de la agencia.** Meta exige verificar al
negocio con sus datos fiscales y factura al titular de la cuenta. De ahí se deriva el reparto:

| Coste | Lo paga | Por qué |
| --- | --- | --- |
| Mensajes de WhatsApp (Meta / BSP) | **El cliente** | La WABA es suya y Meta le factura a él |
| Modelo de lenguaje (OpenRouter) | **La agencia** | Es el motor de la plataforma; el cliente no tiene relación con el proveedor |
| Plataforma | El cliente, a la agencia | Cuota del servicio |

Que la WABA sea del cliente no es solo una cuestión de facturación: **si deja de trabajar con la agencia, se lleva
su número y su historial**. No queda atrapado, y eso hace el servicio más fácil de vender.

**Consecuencias para la arquitectura**, ya cubiertas por el modelo de datos:

- `channels.ycloud_credential_ref` e `integrations.credentials_ref` son **por workspace**: cada cliente puede
  tener sus propias credenciales, que es lo que exige este reparto.
- `usage_counters` separa `message_count` (coste del cliente) de `tokens_in`/`tokens_out`/`cost_usd` (coste de la
  agencia). El panel de agencia muestra las dos cifras por separado, por cliente.
- El **cost cap y el kill-switch** protegen el único coste que asume la agencia: el del modelo.

**Confirmado (2026-07-28):** no hay sub-cuentas. **Cada cliente abre su propia cuenta de YCloud**, con su API Key
y su webhook signing secret, y YCloud le factura directamente. La agencia solo los guarda en el workspace (en
Vault, por referencia). OpenRouter, en cambio, es **una sola cuenta de la agencia** para toda la plataforma.

Consecuencia para el alta de un cliente: antes de conectarlo hace falta que **él** tenga su cuenta de YCloud y su
número verificado. Es el paso que la agencia no puede hacer por él —Meta exige verificar al negocio con sus datos
fiscales—, así que solo puede **acompañarlo**.

**Cómo se resuelve ese paso:**

1. **Un vídeo grabado una vez** con el proceso completo. Es lo que hace que el alta escale: la mayoría lo resuelve
   sola y solo pide ayuda quien se atasca.
2. **Videollamada de apoyo** para quien la necesite, compartiendo pantalla mientras el cliente hace los clics.
3. **La app guía igualmente** (§7.2): lista de pasos, y errores explicados en su idioma cuando algo falta.

Ese acompañamiento es **trabajo facturable** —una puesta en marcha, aparte de la cuota— y es donde se pierde a la
mayoría de clientes si se les deja solos. Conviene tratarlo como parte del producto, no como un favor.

## 8. Contrato `Tool` y catálogo

Interfaz única, extensible por workspace (de `ARQUITECTURA-OBJETIVO §La pieza clave`):

```ts
interface Tool {
  name: string;
  description: string;               // para el tool-calling del LLM (vía OpenRouter)
  schema: ZodSchema;                 // args validados con zod
  enabledFor(ctx: ToolContext): boolean;   // activable por workspace
  requiresConfirmation?: boolean;    // acciones sensibles → confirmación previa
  run(args, ctx: ToolContext): Promise<ToolResult>;  // ctx: workspace, conversation, contact, credenciales
}
// HighLevel: run() => fetch(API HighLevel)              // integración oficial v1
// Custom:    run() => fetch(webhook externo del workspace)  // adapter configurable por tenant (SSRF-guarded)
// Interno:   run() => supabase / cal.com / etc.
```

**Catálogo v1:** `kb_search` · `db_query` (restringido) · `hl_upsert_contact` · `hl_sync_tags` · `schedule_appointment`
· `check_availability` · `send_scheduling_link` · `tag_conversation` · `update_stage_or_field` · `validate_window`
· `pick_template` · `transfer_to_human` · `create_internal_note` · `custom_webhook`.

**Requisitos por tool:** enable/disable por workspace; credenciales por tool (Vault); qué tools puede usar cada
agente; **logs de tool calls** (a `events`); timeout/retry/fallback; **confirmación previa** para acciones sensibles;
**guardas anti-SSRF** en cualquier tool que reciba URL.

## 9. Contratos de integración

> Los shapes se validan con un **spike real** antes de construir encima (ver §14, paso 0). Aquí, lo verificado.

### 9.1 YCloud (WhatsApp BSP)
- **Base URL:** `https://api.ycloud.com/v2` · **Auth:** header `X-API-Key`.
- **Enviar mensaje:** `POST /whatsapp/messages` (envío directo). *Confirmar en el spike vs. variantes
  `/whatsapp_message/send-directly` (texto/OTP) y `/whatsapp_message/send` (encolado/template) que aparecen en el
  índice de docs.* Body de template: idioma **`es`** (NO `es_PA`), `components`/`body` con parámetros planos.
- **Webhook inbound:** `body.whatsappInboundMessage = { from:"+507…", to:"+50763440979", type:"text|audio|image|…",
  text:{ body }, customerProfile:{ name }, wamid, id, … }`. Cada evento trae un **`id` único** (idempotencia).
- **Webhook status:** eventos de `sent|delivered|read|failed` → actualizar `messages.status`; manejar `failed`
  (motivos: fuera de ventana, número inválido, cap de marketing, etc.).
- **Firma:** header **`YCloud-Signature`** con formato **`t={unix_ts},s={firma}`**; algoritmo **HMAC-SHA256** sobre
  **`"{timestamp}.{request_body}"`** con el `webhook_secret`. **Verificar siempre**; rechazar si el timestamp está
  fuera de tolerancia (anti-replay).
- **Reintentos:** ante no-2xx o timeout, YCloud reintenta **10s → 30s → 5m → 30m → 1h → 2h → 2h** (máx 7). Responder
  2xx en **<6s** (idealmente <2s). Entrega **puede duplicar** → dedupe por `event.id`.
- **Media:** `POST /whatsapp_media/upload` para subir; URLs de media entrante **expiran** → descargar y guardar en
  Storage al recibir.
- **Templates:** `POST /whatsapp_template/create`, `GET /whatsapp_template/list` (crear/listar/sincronizar estados Meta).
- **Gotchas confirmados:** normalizar teléfono (a veces sin `+`); `es` no `es_PA`; ventana 24h; request y template
  deben coincidir **exacto** en variables, componentes, idioma y nombre.

### 9.2 OpenRouter (LLM gateway)
- **Endpoint:** `POST https://openrouter.ai/api/v1/chat/completions` · **Auth:** `Authorization: Bearer`.
  Headers opcionales de atribución (`HTTP-Referer`, `X-Title`). **OpenAI-compatible** → tool-calling estándar
  (`tools`, `tool_calls`, rol `tool` con `tool_call_id`).
- **Selección de modelo:** por **workspace** y por **tarea** (clasificación vs respuesta); `GET /api/v1/models` para
  catálogo. `fallback_model` si el primario falla / no soporta tools.
- **Parámetros:** temperature, max_tokens, reasoning effort; **límites de costo/uso** y **métricas de tokens/costo por
  conversación** (persistir en `messages.cost` / `usage_counters`).
- **Privacidad (crítico):** OpenRouter enruta a proveedores con distintas políticas → **forzar ZDR / allowlist de
  provider** por request cuando el tenant maneje PII. **Nunca activar prompt-logging** (cede derecho comercial
  irrevocable sobre inputs/outputs). Disclosure a tenants sobre el ruteo.

### 9.3 HighLevel (integración oficial v1)
- **OAuth 2.0** Authorization Code; token endpoint `POST https://services.leadconnectorhq.com/oauth/token`.
  **Private app** para desarrollo; **Public app requiere aprobación** de HighLevel antes de distribuir → iniciar el
  trámite temprano. Manejo robusto de **refresh token**.
- **Recursos:** contacto (crear/actualizar) · tags · (opc) notas · oportunidad · **cita directa** (endpoint/payload) ·
  traer datos de contacto para contexto IA · **webhooks in/out**; mapeo de campos configurable.
- **Rate limits:** **burst 100 req/10s** y **200.000 req/día** por app **por resource (location/company)** → respetar
  con rate-limiter + backoff en 429.
- **Loops de sync (riesgo):** nuestro update → webhook HL → nuestro update → … → **loop-breaking** con flags de origen
  + idempotencia por evento.

## 10. Motor de decisión y agent runtime

**La IA decide:** cuándo responder · cuándo esperar más · cuándo usar tools · cuándo pedir agenda · cuándo aplicar
preguntas de setter · cuándo etiquetar · cuándo derivar a humano · cuándo **abstenerse** (sin ventana o sin confianza).

**Triggers:** primer mensaje · batch de mensajes · audio transcrito · intención detectada · etiqueta/segmento · horario
laboral · conversación fuera de policy · solicitud expresa de humano.

**Resolución de prompt (jerarquía):** `workspace > número/channel > campaña/funnel > etiqueta/segmento > modo`
(setter/ventas/soporte). Inyecta **variables dinámicas** (nombre, fuente, stage, horario, dueño del lead) y el
`business_info`. Versionado draft/published + fallback prompt.

**Guardrails (duros):** claims permitidos/prohibidos del `business_info` como filtro de salida; separación
system/usuario; tools sensibles con confirmación; sin URLs controladas por el modelo (anti-SSRF); `max_turns` y
kill-switch por costo; validación de tool JSON; **abstención dura** si `window_expires_at < now()`.

**Estados (state machine):** `ai_active → human_active` (handoff manual o automático por baja confianza / objeción
compleja / enojo / pedido de humano / límite); `awaiting_user`; `snoozed`; `closed`. Reactivación manual de la IA
tras handoff. **Coexistencia móvil:** al detectar saliente humano (echo/status), **auto-pausar** la IA.

## 11. Compliance Meta (guardrail de negocio)

> "Rompe o funciona." Tratado como **requisito de diseño**, no feature tardía.

- **Ventana de servicio 24h:** se abre/renueva con cada inbound del cliente; `window_expires_at` = ts del **último
  inbound del cliente** + 24h (UTC; cuidar DST). Dentro → free-text permitido. Fuera → **bloquear free-text** y exigir
  **template aprobado** (F4). En el MVP (pre-F4): fuera de ventana la IA **se abstiene** y lo registra (no hay envío
  de template todavía).
- **Opt-in obligatorio** para iniciar conversación: registrar `opt_in`, `opt_in_source`, `opt_in_at`; bloquear sends
  business-initiated sin opt-in.
- **Messaging limits (portfolio):** 250 → 1K (tras verificación) → 10K → 100K → ilimitado; revisados cada ~6h.
  No escalar volumen de un tenant más rápido que su tier → los sends fallan.
- **Quality rating** Green/Yellow/Red: monitorear señales; en Yellow, throttle. (2026: Red da ventana de corrección,
  no downgrade inmediato, pero frena el avance de tier.)
- **Cap de marketing por usuario:** ~2 templates de marketing por usuario/día **across all businesses**; el API
  devuelve **error `131049`** → manejarlo, categorizar templates (marketing/utility/auth) y no spamear.
- **Aislamiento por tenant:** contenido prohibido de un tenant no debe arriesgar a otros → **WABA/sub-cuenta por
  tenant** en YCloud (validar en el spike, pregunta abierta #4).
- **Templates:** estructura del request y del template deben coincidir exacto (variables, componentes, idioma `es`,
  nombre). Sincronizar estados desde Meta.

## 12. Buffer inteligente (diseño, F2)

Objetivo: agrupar intención esperando el **silencio del usuario** (no responder cada mensaje suelto).

- **Mecanismo:** `message_batches` + **`pg_cron`** que cada ~10–15s (schedule sub-minuto, requiere **PG ≥
  15.1.1.61**) selecciona batches vencidos (`status='pending' AND flush_after < now()`) y dispara el flush.
- **Disparo del flush:** `pg_net` **`http_post`** a un endpoint interno `POST /api/internal/flush` (protegido por
  `INTERNAL_API_SECRET`). ⚠️ `pg_net` **timeout default 2s** y tablas **unlogged** → el endpoint debe **ackear rápido
  y procesar en `after()`**, y existir un **job de reconciliación** que reprocese batches vencidos no marcados (pg_net
  no es durable).
- **Concurrencia:** selección atómica con `FOR UPDATE SKIP LOCKED`; transición `pending→processing` antes de trabajar;
  re-chequeo de `flush_after`; cap de batch por tick (evitar thundering herd; Supabase recomienda ≤8 jobs, ≤10 min/job).
- **Reglas:** `flush_after` se **reinicia** con cada inbound; ventana configurable por workspace/número/conversación
  (p.ej. 10–60s); reglas por tipo (esperar más si llega audio); **bypass** para urgentes/plantillas/botones; agrupa
  texto + audio transcrito + captions; **logs** de qué mensajes fueron al mismo batch.
- **Fallback:** si el plan de Supabase no da granularidad sub-minuto o pg_net resulta inestable → **Upstash QStash**
  (cola diferida con delay y cancel/reschedule).

## 13. Roadmap por fases

| Fase | Entregable | Gate de salida |
|------|-----------|----------------|
| **F0 Foundations** | Deps (shadcn, zod, vitest), schema núcleo + RLS, Vault, auth + app shell, capa de datos con `workspace_id`, pooler transaction mode | Migraciones aplicadas; tests de aislamiento en verde; login funciona |
| **F1 MVP camino feliz** | Spike YCloud; clientes YCloud/OpenRouter; webhook endurecido (firma+dedupe+ACK+after()); guardrail 24h mínimo; inbox realtime + toggle IA/humano + **tiempo restante de ventana en cada fila de la lista**; controles de costo | Mensaje real WhatsApp → respuesta IA; duplicados imposibles; fuera de ventana la IA se abstiene; **desde la lista se ve en cuáles se puede escribir sin abrirlas** |
| **F2 Buffer ⭐** | `message_batches` + pg_cron/pg_net + reconciliación; agrupación por silencio | Múltiples mensajes → 1 respuesta agrupada; sin carreras |
| **F3 State machine + handoff** | Estados; auto-handoff; notificación; coexistencia móvil | Handoff manual y automático; IA se auto-pausa con humano |
| **F4 Ventana 24h + templates** | Guardrail duro; template picker; sync Meta; validación estructura; override admin | Fuera de ventana solo template aprobado; UI de ventana |
| **F5 Capa de Tools** | Interfaz `Tool` + registry + tool-calling + logs + confirm + anti-SSRF | Tools activables por workspace; tool calls logueadas |
| **F6 HighLevel** | OAuth; contacto/tags/oportunidad/cita; webhooks; loop-breaking | Sync bidireccional sin loops; cita directa creada |
| **F7 Setter + agenda** | Knockout, score, resumen, post-action; agenda link + HL | Lead calificado y agendado end-to-end |
| **F8 Resto** | Prompting avanzado, Business info UI, KB+pgvector, config modelos+costos, roles, dashboards, onboarding wizard, media | Onboarding self-serve; KB citada; métricas de costo |
| **F9 Panel de agencia** | `platform_admins` + `is_platform_admin()`; vista `agency_workspace_stats`; alta de cliente; estado de canal, consumo y errores por workspace (§7.1) | Un `platform_admin` ve el estado de todos los workspaces y **cero filas** al consultar `messages` o `contacts` |

**Estrategia:** MVP del camino feliz primero, luego capas. **Cada fase se valida con demo de número real** como gate.

## 14. Secuencia de ejecución endurecida (F0–F1)

0. **Des-riesgo previo:** confirmar versión de Postgres (cron sub-minuto), config Realtime+RLS, y **spike real de
   YCloud** (enviar/recibir 1 mensaje: endpoint de envío + firma + shape inbound) antes de construir encima.
1. **Foundations endurecida:** pooler transaction mode; RLS deny-by-default + capa de datos que inyecta
   `workspace_id`; Vault; tablas núcleo + `processed_events` + opt-in en `contacts`; vitest (aislamiento / ventana /
   idempotencia).
2. **Clientes:** YCloud (`sendText`, `verify` HMAC, `normalize` E.164), OpenRouter (`chatCompletion` con
   ZDR/allowlist, sin prompt-logging), agent `runtime` tool-ready.
3. **Webhook endurecido:** firma → dedupe → persist → **ACK<2s → `after()`**.
4. **Guardrail mínimo 24h:** nunca free-text con ventana cerrada (abstención + `events`).
5. **Costo/abuso:** cost cap + kill-switch por workspace; rate-limit por contacto; `max_turns`.
6. **Guardrails IA:** claims prohibidos (filtro duro); sin URLs del modelo (SSRF); parse robusto de tool JSON.
7. **Inbox realtime** + toggle IA/humano + auto-pausa con humano + estado de ventana 24h.
8. **Observabilidad mínima:** `events` desde día 1 + dead-letter para inbound fallido + manejo de status `failed`.

## 15. Requisitos no-funcionales (NFR)

- **Latencia:** ACK de webhook <2s (hard). Respuesta de IA objetivo <10s percibido (buffer añade el delay de silencio,
  configurable). Inbox realtime <1s de propagación.
- **Fiabilidad:** idempotencia extremo a extremo; dead-letter para inbound; reconciliación del buffer; reintentos con
  backoff hacia YCloud/HL; sin pérdida de mensajes del cliente.
- **Seguridad:** ver `SECURITY-AUDIT-agente-whatsapp.md` (RLS, Vault, firma, anti-SSRF, anti-injection, ZDR).
- **Escalabilidad:** pooler transaction mode (serverless), índices, paginación de inbox; ≤8 cron jobs; batch cap por
  tick; límites de conexiones Realtime por plan.
- **Observabilidad:** `events` como log de decisión (BRIEF §17); métricas de tokens/costo por conversación; alertas de
  fallos de envío / caída de quality / spike de costo.
- **Costo:** cost cap + kill-switch por workspace; modelo de unit economics por conversación (LLM+WA+infra) —
  pregunta abierta #6.
- **Compliance/privacidad:** ventana 24h + opt-in + tiers; PII con retención/borrado; DPA con tenants; ZDR en OpenRouter.
- **Mantenibilidad:** capa de datos con scope obligatorio; contract tests de integraciones; deps pineadas.

## 16. Configuración y variables de entorno

```
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=        # server-only, bypass RLS
# MCP / migraciones (shell)
SUPABASE_PROJECT_REF=
SUPABASE_ACCESS_TOKEN=
# App
APP_URL=                          # para construir URLs de webhook por workspace
INTERNAL_API_SECRET=              # protege /api/internal/* (flush, reconcile)
# OpenRouter
OPENROUTER_API_KEY=               # o por-workspace en Vault
OPENROUTER_DEFAULT_MODEL=
# YCloud / HighLevel: credenciales por workspace en Supabase Vault (no en .env)
```
Credenciales **por tenant** (YCloud/OpenRouter/HighLevel) viven en **Vault**, referenciadas por `*_ref`.

## 17. Estructura de carpetas objetivo

```
src/
  app/
    (auth)/login/page.tsx · (auth)/layout.tsx
    (app)/layout.tsx                      # shell + gate + workspace ctx
    (app)/inbox/{page.tsx,actions.ts}
    (app)/settings/**                      # 14 secciones (F4+)
    api/webhooks/ycloud/[workspaceId]/route.ts
    api/webhooks/highlevel/[workspaceId]/route.ts   # F6
    api/internal/{flush,reconcile}/route.ts         # F2
  components/{ui/*, inbox/*, settings/*}
  lib/
    supabase/{client,server,middleware,admin}.ts
    data/*                                 # capa de acceso con workspace_id obligatorio
    ycloud/{client,normalize,verify,types}.ts
    openrouter/{client,types}.ts
    highlevel/{client,oauth,types}.ts      # F6
    agent/{runtime,prompt,decision,guardrails,types}.ts
    tools/{registry,contract, *tools}.ts   # F5
  proxy.ts                                 # session refresh + gate
supabase/migrations/*.sql
```

## 18. Criterios de aceptación técnica (F0–F1)

- [ ] Migraciones aplicadas; `list_tables` muestra el núcleo; **tests de aislamiento multi-tenant en verde**.
- [ ] Webhook: firma inválida → 401; evento duplicado (`event.id` repetido) → no reprocesa; ACK <2s.
- [ ] Mensaje real de WhatsApp → 1 (y solo 1) respuesta de IA; registro completo en `events`.
- [ ] Ventana cerrada → la IA **no** envía free-text (se abstiene y registra).
- [ ] Inbox realtime: la conversación aparece en vivo; toggle IA/humano; estado de ventana 24h visible.
- [ ] Kill-switch por workspace corta la IA; rate-limit por contacto activo.
- [ ] `npm run lint` y `npm run build` en verde.

---

*Este blueprint es el contrato técnico de referencia. Cualquier desviación (endpoints YCloud, granularidad de cron,
aislamiento WABA, ZDR) se resuelve con las **preguntas abiertas** y el **spike** antes de construir encima.*
