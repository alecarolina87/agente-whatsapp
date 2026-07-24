---
proyecto: 01 — Agente de WhatsApp
doc: user stories (épicas + historias + criterios de aceptación)
version: v1.0
actualizado: 2026-07-06
relacionado: BRIEF.md · ARQUITECTURA-OBJETIVO.md · BLUEPRINT-agente-whatsapp.md
---

# USER-STORIES — Plataforma de inbox conversacional WhatsApp con IA

> Historias de usuario organizadas por **épica** (mapeadas a los 17 módulos del BRIEF y a las fases F0–F8 del
> BLUEPRINT). Formato: `Como <rol> quiero <capacidad> para <beneficio>` + **criterios de aceptación** (Given/When/Then)
> + **Fase** + **Prioridad** (Must / Should / Could).

## Roles
- **Admin** — configura todo el workspace, integraciones, roles, ve costos/logs, fuerza envíos.
- **Manager** — supervisa conversaciones y equipo, edita prompts/templates, hace handoff, ve métricas.
- **Agent** — opera el inbox: responde, enciende/apaga IA, deriva, etiqueta, edita contacto.
- **Viewer** — solo lectura de conversaciones y métricas.
- **Sistema/IA** — actor automático (agent runtime); sus reglas se expresan como historias de "el sistema".
- **Contacto** — usuario final de WhatsApp (externo; su experiencia motiva varias historias).

## Índice de épicas
E0 Onboarding · E1 Inbox · E2 Buffer · E3 IA/Humano & Handoff · E4 CRM · E5 Business Info · E6 Prompting ·
E7 Tools · E8 Setter · E9 Agendamiento · E10 Templates & Compliance · E11 OpenRouter/Modelos · E12 Knowledge Base ·
E13 HighLevel · E14 Motor de decisión · E15 Settings · E16 Roles & permisos · E17 Observabilidad

---

## E0 — Onboarding & setup del workspace · (F0/F8)

**US-0.1** — *Como Admin quiero registrarme y crear un workspace para tener un entorno aislado.* · **Must** · F0
- Given un email válido, When me registro, Then se crea mi `user` y un `workspace` con mi membresía **Admin**.
- El workspace aísla config, datos y credenciales de cualquier otro (verificado por tests de aislamiento).

**US-0.2** — *Como Admin quiero un wizard de onboarding (modo → datos de empresa → YCloud → opc HighLevel/OpenRouter)
para activar el agente sin tocar código.* · **Must** · F8 (versión mínima en F1)
- Given el wizard, When elijo caso de uso (setter/ventas/soporte/agendamiento), Then se **siembran** prompt + tools base.
- When conecto credenciales de YCloud + número, Then el canal queda **verificado** (envío/recepción de prueba OK).
- When completo el wizard, Then el agente queda **activo** para ese número.

**US-0.3** — *Como Admin quiero conectar mi API key de OpenRouter (o usar la de la plataforma) para habilitar la IA.*
· **Must** · F1
- Given la key, When la guardo, Then se almacena en **Vault** (nunca en claro) y se valida con una llamada de prueba.

**US-0.4** — *Como Admin quiero invitar miembros con un rol para operar en equipo.* · **Should** · F8
- Given un email + rol, When invito, Then el invitado se une con **ese rol** y sus permisos aplican server-side.

---

## E1 — Inbox conversacional · (F1)

**US-1.1** — *Como Agent quiero una lista de conversaciones (búsqueda, filtros, etiquetas, asignado, último mensaje,
hora, estado, canal) para priorizar a quién atender.* · **Must** · F1
- Given conversaciones del workspace, When abro el inbox, Then veo la lista ordenada por actividad, paginada.
- When filtro por estado/etiqueta/asignado, Then la lista se filtra sin recargar.

**US-1.2** — *Como Agent quiero ver el hilo completo (historial, eventos del sistema, timeline de acciones) para tener
contexto.* · **Must** · F1
- Given una conversación, When la abro, Then veo mensajes in/out, eventos (IA↔humano, tools, ventana) en orden temporal.

**US-1.3** — *Como Agent quiero que las conversaciones y mensajes se actualicen en tiempo real para no refrescar.*
· **Must** · F1
- Given el inbox abierto, When entra/sale un mensaje, Then aparece **en vivo** (Supabase Realtime) sin recargar.
- El realtime **nunca** muestra datos de otro workspace (test cross-tenant).

**US-1.4** — *Como Agent quiero un composer con texto, audio, imágenes, documentos y video (y templates aprobados)
para responder por cualquier medio.* · **Must** · F1 (media completa F4)
- Given una ventana **abierta**, When envío texto/media, Then se entrega vía YCloud y se persiste el outbound.
- Given una ventana **cerrada**, When intento free-text, Then se **bloquea** y se sugiere template (F4) / se informa (MVP).

**US-1.5** — *Como Agent quiero ver el estado de la ventana de 24h por conversación para saber qué puedo enviar.*
· **Must** · F1
- Given una conversación, Then el header muestra **dentro/fuera de ventana** y el tiempo restante.

**US-1.6** — *Como Agent quiero notas internas (no visibles al contacto) para coordinar con el equipo.* · **Should** · F1
- Given una conversación, When agrego una nota, Then queda visible para el equipo y **nunca** se envía al contacto.

**US-1.7** — *Como Agent quiero acciones rápidas (cerrar, reabrir, archivar, prioridad, copiar teléfono, abrir CRM) para
operar rápido.* · **Should** · F1
- Given una conversación, When ejecuto una acción rápida, Then el estado se actualiza y queda en `events`.

**US-1.8** — *Como Agent quiero etiquetas manuales y automáticas en conversaciones para segmentar.* · **Should** · F1/F14

---

## E2 — Buffer y agrupación inteligente ⭐ · (F2)

**US-2.1** — *Como Contacto quiero que si escribo varios mensajes seguidos ("hola" / "me das informes") reciba **una**
respuesta coherente, no una por mensaje.* · **Must** · F2
- Given varios inbound en la ventana de silencio, When dejo de escribir, Then el sistema procesa **todo el batch** como
  un bloque y responde **una vez**.
- El buffer se dispara por **silencio del usuario**, no por el primer mensaje.

**US-2.2** — *Como Admin quiero configurar el delay del buffer por workspace/número/conversación para ajustar la
sensibilidad.* · **Should** · F2
- Given un delay (p.ej. 10–60s), When llegan mensajes, Then `flush_after` se **reinicia** con cada uno.

**US-2.3** — *Como Sistema quiero agrupar texto + audio transcrito + captions y aplicar reglas por tipo (esperar más si
hay audio) para no cortar la intención.* · **Should** · F2
- Given un audio en el batch, When aún se transcribe, Then el flush espera según la regla de tipo.

**US-2.4** — *Como Admin quiero logs de qué mensajes fueron al mismo batch y un bypass para urgentes/botones.*
· **Could** · F2
- Given un mensaje con botón interactivo/urgente, When llega, Then hace **bypass** del buffer.

**US-2.5** — *Como Sistema quiero que ningún mensaje del cliente se pierda aunque falle el disparo del flush.*
· **Must** · F2
- Given un batch vencido no procesado (crash de pg_net), When corre la **reconciliación**, Then se reprocesa; sin
  duplicar respuesta (lock `FOR UPDATE SKIP LOCKED` + estado `processing`).

---

## E3 — Modos IA/humano & handoff · (F1/F3)

**US-3.1** — *Como Agent quiero encender/apagar la IA por conversación desde un botón para tomar el control cuando
quiera.* · **Must** · F1
- Given una conversación, When apago la IA, Then el sistema deja de responder automáticamente y el estado pasa a
  `human_active`.

**US-3.2** — *Como Agent quiero derivar a humano manualmente y que se notifique al equipo.* · **Must** · F3
- Given una conversación en IA, When pulso "derivar a humano", Then estado `handoff_pending` + notificación al equipo.

**US-3.3** — *Como Sistema quiero hacer handoff automático cuando detecte baja confianza / objeción compleja / enojo /
pedido de humano / límite de capacidad.* · **Must** · F3
- Given una señal de handoff, When se detecta, Then cambio a modo humano, notifico y lo registro en `events`.

**US-3.4** — *Como Agent quiero reactivar la IA tras el handoff cuando resuelva lo manual.* · **Should** · F3
- Given `human_active`, When reactivo la IA, Then vuelve a `ai_active` y responde según reglas.

**US-3.5** — *Como Agent quiero coexistencia con el celular: si respondo desde el móvil, la IA no debe pisar.*
· **Must** · F3
- Given actividad **saliente humana** (móvil/Cloud API), When se detecta, Then la IA se **auto-pausa** en esa conversación.

**US-3.6** — *Como Sistema quiero mostrar el indicador de estado (asignada · atendida por IA · por humano · en handoff).*
· **Should** · F3

---

## E4 — CRM básico · (F1/F6)

**US-4.1** — *Como Sistema quiero crear/actualizar el contacto al entrar un mensaje, con dedupe por teléfono, para no
duplicar.* · **Must** · F1
- Given un inbound, When no existe el contacto, Then lo creo; When existe (mismo `wa_phone` E.164), Then lo actualizo.
- **UNIQUE(workspace_id, wa_phone)**; normalización E.164 antes de comparar.

**US-4.2** — *Como Agent quiero un panel lateral del contacto (nombre, teléfono, email, fuente, owner, tags, custom
fields, stage, consentimiento) y editarlo sin salir de la conversación.* · **Must** · F1
- Given una conversación, When edito un campo del contacto, Then se guarda y queda en el historial de cambios.

**US-4.3** — *Como Agent quiero historial de tags/notas/cambios del contacto para trazabilidad.* · **Should** · F1

**US-4.4** — *Como Manager quiero sync bidireccional de contacto y tags con HighLevel para mantener un solo origen de
verdad.* · **Must** · F6
- Given un cambio local, When se sincroniza, Then se refleja en HighLevel **sin loop** (flags de origen + idempotencia).

**US-4.5** — *Como Admin quiero registrar el consentimiento/opt-in (fuente + fecha) del contacto para cumplir Meta.*
· **Must** · F1
- Given un contacto sin opt-in, When se intenta un envío business-initiated, Then se **bloquea**.

---

## E5 — Información del negocio · (F1/F8)

**US-5.1** — *Como Admin quiero cargar la info del negocio (qué vende, servicios, FAQs, horarios, zonas, precios,
políticas, objeciones, claims permitidos/prohibidos, tono, CTA) en texto libre + formularios estructurados para que la
IA la use bien.* · **Must** · F1 (UI completa F8)
- Given la info, When la guardo, Then el runtime la inyecta como contexto y respeta los **claims prohibidos** como filtro duro.

**US-5.2** — *Como Manager quiero separar la info del negocio de las instrucciones narrativas del prompt para editar cada
una sin romper la otra.* · **Should** · F8

---

## E6 — Custom prompting · (F1/F8)

**US-6.1** — *Como Admin quiero un system prompt global por workspace para definir el comportamiento base.* · **Must** · F1

**US-6.2** — *Como Manager quiero prompts por número / campaña / etiqueta / modo con resolución jerárquica para
especializar sin duplicar.* · **Should** · F8
- Given prompts en varios scopes, When se resuelve, Then gana el más específico (`workspace>número>campaña>segmento>modo`).

**US-6.3** — *Como Manager quiero variables dinámicas (nombre, fuente, stage, horario, dueño) inyectadas en el prompt.*
· **Should** · F8

**US-6.4** — *Como Manager quiero versionado (draft/published), historial y un playground de prueba para iterar seguro.*
· **Should** · F8
- Given un draft, When lo pruebo en el playground, Then no afecta producción hasta **publicar**.

**US-6.5** — *Como Admin quiero un fallback prompt y guardrails (qué no prometer/decir, cuándo escalar) para acotar
riesgos.* · **Must** · F1

---

## E7 — Tools / conectores · (F5)

**US-7.1** — *Como Admin quiero un catálogo de tools activables/desactivables por workspace (con credenciales por tool)
para habilitar solo lo que uso.* · **Must** · F5
- Given el catálogo, When activo/desactivo una tool, Then el runtime la ofrece/oculta al modelo según el workspace.

**US-7.2** — *Como Sistema quiero exponer las tools al LLM vía tool-calling (OpenRouter) con args validados por zod.*
· **Must** · F5
- Given una tool call, When los args no cumplen el schema, Then se rechaza sin ejecutar.

**US-7.3** — *Como Admin quiero logs de tool calls, timeout/retry/fallback y confirmación previa para acciones
sensibles.* · **Must** · F5
- Given una acción sensible (p.ej. crear cita), When se invoca, Then requiere **confirmación** antes de ejecutar.

**US-7.4** — *Como Admin quiero conectar sistemas externos propios con `custom_webhook` (URL por workspace) sin
reescribir el motor.* · **Should** · F5
- Given una URL de workspace, When la tool corre, Then respeta **anti-SSRF** (allowlist + bloqueo de IPs privadas).

---

## E8 — Setter y calificación · (F7)

**US-8.1** — *Como Admin quiero activar el modo setter por workspace/conversación con una secuencia de preguntas
(obligatorias/opcionales) para calificar leads.* · **Must** · F7

**US-8.2** — *Como Sistema quiero aplicar knockout questions (presupuesto, ubicación, giro, headcount, edad, idioma) y
un score (calificado / no calificado / revisar) para decidir si avanza.* · **Must** · F7
- Given respuestas, When violan una knockout rule, Then el lead se marca **no calificado** y se ejecuta la post-action.

**US-8.3** — *Como Manager quiero un resumen automático del lead y una acción posterior configurable (mandar agenda,
crear oportunidad, mandar a humano, actualizar HighLevel).* · **Should** · F7

---

## E9 — Agendamiento · (F7)

**US-9.1** — *Como Admin quiero configurar agendamiento por link (Cal.com/Calendly/otro) por workspace/campaña/agente
para casos simples.* · **Must** · F7

**US-9.2** — *Como Sistema quiero crear una cita directa en HighLevel (mapeo de payload, validaciones de timezone/
disponibilidad/nombre/teléfono) y registrar el resultado en la conversación + CRM.* · **Must** · F7
- Given datos válidos, When agendo, Then la cita se crea en HighLevel y se registra confirmación/reprogramación.

---

## E10 — Templates & compliance Meta ⚠️ · (F1 mínimo / F4 completo)

**US-10.1** — *Como Sistema quiero permitir free-text solo dentro de la ventana (<24h) y bloquearlo fuera para no violar
política de Meta.* · **Must** · F1 (abstención) / F4 (bloqueo+template)
- Given ventana **abierta**, Then se permiten mensajes de sesión.
- Given ventana **cerrada**, When se intenta free-text, Then se **bloquea**; el humano no puede forzarlo salvo **override
  admin con warning**.

**US-10.2** — *Como Agent quiero que el sistema sugiera templates válidos cuando la ventana esté cerrada para reactivar
la conversación correctamente.* · **Must** · F4

**US-10.3** — *Como Admin quiero gestionar templates (crear, editar/clonar, enviar a validación Meta, ver estados,
sincronizar desde Meta) con validación de estructura.* · **Must** · F4
- Given un template, When lo envío a validación, Then su estado refleja draft/submitted/approved/rejected/paused.
- La estructura del request y del template coinciden **exacto** (variables, componentes, idioma **`es`**, nombre).

**US-10.4** — *Como Sistema quiero manejar el cap de marketing por usuario (error `131049`) y los estados `failed` para
no reintentar a ciegas.* · **Must** · F4
- Given un `131049`, When ocurre, Then no reintento como si nada; lo registro y notifico.

**US-10.5** — *Como Admin quiero respetar los messaging limits/tier y el quality rating para escalar sin ban.*
· **Should** · F4

---

## E11 — OpenRouter & modelos · (F1/F8)

**US-11.1** — *Como Admin quiero elegir modelo por workspace y por tarea (clasificación vs respuesta) con fallback para
optimizar costo/calidad.* · **Should** · F8 (default en F1)

**US-11.2** — *Como Admin quiero límites de costo/uso y métricas de tokens/costo por conversación para controlar el
gasto.* · **Must** · F1
- Given un límite alcanzado, When se supera, Then el **kill-switch** corta la IA del workspace y se notifica.

**US-11.3** — *Como Admin quiero forzar ZDR / proveedores permitidos y jamás activar prompt-logging para proteger la PII
de mis contactos.* · **Must** · F1
- Given una request, When se enruta, Then solo va a proveedores con **ZDR** (si el workspace lo exige).

---

## E12 — Knowledge base · (F8)

**US-12.1** — *Como Admin quiero subir documentos/FAQs/URLs/snippets con versionado y activación por workspace/agente
para gobernar las fuentes.* · **Should** · F8

**US-12.2** — *Como Sistema quiero priorizar entre KB / prompt / tools y **citar** la fuente usada, con fallback cuando
no hay respuesta.* · **Should** · F8
- Given una consulta, When respondo con KB, Then registro la **fuente** (trazabilidad).

**US-12.3** — *Como Admin quiero consultas seguras a bases/endpoints (sin SQL libre) con auditoría de accesos.*
· **Must** · F8

---

## E13 — Sincronización con HighLevel · (F6)

**US-13.1** — *Como Admin quiero conectar mi subcuenta de HighLevel vía OAuth para integrar el CRM oficial.* · **Must** · F6
- Given el flujo OAuth, When autorizo, Then se guardan access/refresh tokens (Vault) con refresh robusto.

**US-13.2** — *Como Sistema quiero crear/actualizar contacto, sync tags, (opc) notas, crear/actualizar oportunidad y
crear cita directa por endpoint.* · **Must** · F6

**US-13.3** — *Como Sistema quiero webhooks inbound/outbound con mapeo configurable, retries y logs de error,
respetando 100 req/10s y 200K/día.* · **Must** · F6
- Given un webhook HL, When llega, Then verifico firma + idempotencia y evito **loops de sync**.

---

## E14 — Motor de decisión (reglas + triggers) · (F1/F3)

**US-14.1** — *Como Sistema quiero decidir cuándo responder / esperar / usar tools / pedir agenda / aplicar setter /
etiquetar / derivar / **abstenerme** (sin ventana o sin confianza).* · **Must** · F1→F7
- Given ventana cerrada o baja confianza, Then me **abstengo** y lo registro.

**US-14.2** — *Como Sistema quiero disparadores claros (primer mensaje, batch, audio transcrito, intención, etiqueta,
horario, fuera de policy, pedido de humano) para actuar de forma predecible.* · **Should** · F2→F7

---

## E15 — Panel de configuración (Settings) · (F4→F8)

**US-15.1** — *Como Admin quiero un panel con 14 secciones (WhatsApp/YCloud, Templates, OpenRouter, Business info,
Prompting, Tools, KB, Setter, Scheduling, HighLevel, Automation rules, Handoff, Team/roles, Logs) para configurar todo
por web.* · **Should** · se completa por fase
- Cada sección aparece cuando su fase la habilita; sin secciones muertas.

---

## E16 — Roles & permisos · (F0/F8)

**US-16.1** — *Como Admin quiero roles (Admin/Manager/Agent/Viewer) con permisos diferenciados para controlar quién hace
qué.* · **Must** · F0 (enforcement) / F8 (UI)
- Permisos: encender/apagar IA · responder · editar prompts · editar templates · conectar tools · ver costos/logs ·
  forzar envíos · handoff.
- Given un **Viewer**, When intenta una acción de escritura, Then se **rechaza server-side** (no solo oculta en UI).

**US-16.2** — *Como Viewer quiero acceso de solo lectura a conversaciones y métricas para supervisar sin riesgo.*
· **Should** · F0

---

## E17 — Observabilidad · (F1→)

**US-17.1** — *Como Admin quiero logs mínimos (mensajes entrantes, agrupados en buffer, decisión del agente, prompt
usado, tools llamadas, respuesta del modelo, estado de ventana, errores de template/envío, cambios IA↔humano, sync HL,
resultado de agenda) para auditar y depurar.* · **Must** · F1 (crece por fase)
- Given cualquier acción del runtime, Then queda un registro en `events` (append-only).

**US-17.2** — *Como Admin quiero alertas de fallos de envío, caída de quality, spike de costo y errores de webhook para
reaccionar a tiempo.* · **Should** · F2+

**US-17.3** — *Como Manager quiero un dashboard de métricas (volumen, costo por conversación, tasa de handoff, agendas)
para medir el desempeño.* · **Could** · F8

---

## Trazabilidad rápida (épica → fase → prioridad dominante)
| Épica | Fase principal | Prioridad |
|-------|----------------|-----------|
| E0 Onboarding | F0/F8 | Must |
| E1 Inbox | F1 | Must |
| E2 Buffer ⭐ | F2 | Must |
| E3 IA/Humano & Handoff | F1/F3 | Must |
| E4 CRM | F1/F6 | Must |
| E5 Business Info | F1/F8 | Must |
| E6 Prompting | F1/F8 | Must/Should |
| E7 Tools | F5 | Must |
| E8 Setter | F7 | Must |
| E9 Agendamiento | F7 | Must |
| E10 Templates & Compliance | F1/F4 | **Must (crítico)** |
| E11 OpenRouter/Modelos | F1/F8 | Must |
| E12 Knowledge Base | F8 | Should |
| E13 HighLevel | F6 | Must |
| E14 Motor de decisión | F1→F7 | Must |
| E15 Settings | F4→F8 | Should |
| E16 Roles & permisos | F0/F8 | Must |
| E17 Observabilidad | F1→ | Must |

---

*Las historias marcadas **Must** en F1 forman el corte vertical del MVP (camino feliz + compliance mínimo). El resto se
prioriza por fase según el roadmap del BLUEPRINT.*
