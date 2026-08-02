# Agente de WhatsApp con IA

Plataforma multi-tenant para atender WhatsApp con un agente de IA: bandeja de
entrada en tiempo real, motor de respuesta, buffer de silencio, paso a una
persona cuando hace falta y cumplimiento de las reglas de Meta.

**Está funcionando.** Un WhatsApp real entra por el webhook y sale una
respuesta del agente, con todo el recorrido registrado. Probado en vivo con un
número de WhatsApp Business conectado a YCloud.

Hecho por [Alejandra Ramos](https://alejandraramos.dev).

---

## Qué hace hoy

| | |
|---|---|
| **Recibe** | Webhook de YCloud con firma HMAC verificada, deduplicación por evento y acuse rápido |
| **Entiende** | Texto, fotos, notas de voz, vídeos y documentos, con el pie de foto conservado |
| **Responde** | OpenRouter, con la personalidad de cada cliente sacada de la base de datos |
| **Espera** | Buffer de silencio: quien escribe a trozos recibe **una** respuesta, no tres |
| **Se aparta** | Paso a una persona si lo piden, si el agente no sabe seguir, o si llega un archivo |
| **Se frena** | Ventana de 24 h de Meta, tope de gasto mensual, límite por contacto y freno de mano |
| **Se ve** | Bandeja en tiempo real, con lo que espera respuesta arriba del todo |

## Decisiones que sostienen el proyecto

**Nadie ve los datos de otro cliente, y no depende de que el código acierte.**
Las nueve tablas llevan RLS que deniega por defecto. La capa de datos
(`src/lib/data/scoped.ts`) exige el workspace en cada consulta y solo admite
tablas de una lista explícita. Nueve tests comprueban el aislamiento
intentando, desde un cliente, leer lo que es de otro.

**Las claves de cada cliente no están en el entorno.** Viven en Vault, y en las
tablas solo hay referencias. Poner las credenciales de YCloud en un `.env`
funciona con un cliente y se rompe con dos — y para entonces ya está escrito en
todas partes.

**La deduplicación es un candado, no una consulta.** El evento se **inserta**
en `processed_events` antes de procesarlo y se deja fallar el índice único. Con
"consulta y luego inserta", dos reintentos simultáneos de YCloud pasan los dos
la comprobación y el agente contesta dos veces.

**El agente no opina sobre lo que no ha visto.** Un mensaje con archivo no
llega al modelo: se manda el acuse del canal y la conversación pasa a una
persona. El modelo no ve la imagen, así que cualquier cosa que dijera sobre
ella se la estaría inventando.

**El traspaso se marca antes de intentar enviar nada.** Si el tope de gasto
está al límite el agente se calla, pero la conversación queda señalada igual.
Una foto sin contestar y sin marcar es una clienta esperando a alguien que no
sabe que la está esperando.

**Los archivos van a un bucket privado con URLs firmadas que caducan.** Son
fotos de la piel de personas reales. Y solo se descargan de `api.ycloud.com`
exacto: el enlace viene dentro del cuerpo del webhook, o sea que es dato de
fuera, y sin esa comprobación el servidor descargaría lo que le pusieran ahí.

**Los ecos se descartan.** La respuesta del agente vuelve como evento de
YCloud; procesarla dispararía otra respuesta, y otra, pagando una llamada al
modelo en cada vuelta.

## Cómo está montado

```
src/lib/ycloud/     firma, normalización E.164, tipos del evento, archivos
src/lib/agent/      motor, prompt, guardrails, límites de gasto, buffer, handoff
src/lib/data/       capa con workspace obligatorio y lista de tablas permitidas
src/lib/vault.ts    guardar y leer secretos
src/app/api/        webhook por workspace + barrido interno del buffer
src/app/app/inbox/  la bandeja
supabase/migrations/ esquema, RLS, grants, Vault, realtime, límites, buffer, media
```

**108 tests.** No cubren por cubrir: cazaron un límite de respuestas que contaba
por workspace en vez de por conversación —un contacto hablador habría callado
al agente para todos los demás clientes— y una forma de pedir un humano que la
lista no reconocía.

## Documentación

- **[Blueprint técnico](BLUEPRINT-agente-whatsapp.md)** — arquitectura, modelo
  de datos, runtime del mensaje, multi-tenancy, contrato de herramientas,
  compliance de la ventana de 24 h y hoja de ruta.
- **[Historias de usuario](USER-STORIES-agente-whatsapp.md)** — el alcance desde
  la perspectiva de quien opera la bandeja.
- **[Auditoría de seguridad](SECURITY-AUDIT-agente-whatsapp.md)** — premortem
  del proyecto; sus conclusiones están incorporadas al blueprint.
- **[Spike de YCloud](SPIKE-ycloud.md)** — el contrato del proveedor, verificado
  contra una integración en funcionamiento.

## Stack

| Capa | Tecnología |
|------|-----------|
| Framework | Next.js 16 (App Router, Turbopack) · React 19 · TypeScript |
| Estilos | Tailwind CSS 4 |
| Datos, auth y archivos | Supabase — Postgres con RLS, Vault, Realtime, Storage |
| WhatsApp | YCloud (BSP), sin integración directa con Meta |
| Modelos | OpenRouter, seleccionable por workspace |
| Hosting | Vercel · barrido del buffer con `pg_cron` dentro de Supabase |

## Puesta en marcha

```bash
npm install
cp .env.example .env.local   # completa tus credenciales
npm run dev
```

Las migraciones de `supabase/migrations/` se aplican en orden. Las variables
necesarias están en [`.env.example`](.env.example);
`SUPABASE_SERVICE_ROLE_KEY` se salta el RLS, así que es de servidor y nunca
lleva el prefijo `NEXT_PUBLIC_`.

Para probar la cadena entera sin depender de que llegue un WhatsApp:

```bash
node --env-file=.env.local scripts/simular-entrante.mjs <url> <workspaceId> <deQuien> "texto"
```

Firma el evento con el secreto real de Vault, así que el webhook lo acepta
igual que si viniera de YCloud. Con `--imagen` manda una foto.

## Lo que falta

Plantillas aprobadas para escribir fuera de la ventana de 24 h, integración con
CRM y la capa de herramientas del agente (consultar huecos, reservar cita).

---

Proyecto desarrollado durante mi formación en agentes de IA. La arquitectura y
las decisiones son propias: el curso sirvió de punto de partida, no de guion.
