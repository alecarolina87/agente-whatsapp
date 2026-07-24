# Agente de WhatsApp con IA

Plataforma multi-tenant de inbox conversacional para WhatsApp con IA: inbox tipo
WhatsApp Web, motor de agente, buffer inteligente, handoff a humano e integración
con CRM, con cumplimiento estricto de las reglas de Meta.

> **Estado: fase de diseño.** La arquitectura está definida y documentada al
> detalle; la implementación está en sus cimientos — proyecto Next.js con
> conexión y sesión de Supabase.

## Documentación

El diseño técnico es, hoy por hoy, el núcleo de este proyecto.

- **[Blueprint técnico](BLUEPRINT-agente-whatsapp.md)** — documento maestro en 18
  secciones: arquitectura, modelo de datos, runtime del mensaje, multi-tenancy y
  RLS, contrato de herramientas, compliance de la ventana de 24h, diseño del
  buffer inteligente y roadmap por fases (F0–F8).
- **[Historias de usuario](USER-STORIES-agente-whatsapp.md)** — alcance funcional
  desde la perspectiva de quien opera el inbox.
- **[Auditoría de seguridad](SECURITY-AUDIT-agente-whatsapp.md)** — premortem del
  proyecto; sus conclusiones están incorporadas al blueprint.

## Stack

**Implementado**

| Capa | Tecnología |
|------|-----------|
| Framework | Next.js 16 (App Router, `src/`, Proxy) · React 19 |
| Lenguaje | TypeScript |
| Estilos | Tailwind CSS 4 |
| Datos y auth | Supabase (`@supabase/ssr`) |

**Previsto** (decisiones cerradas en el [blueprint §3](BLUEPRINT-agente-whatsapp.md))

| Capa | Decisión |
|------|----------|
| Proveedor de WhatsApp (BSP) | YCloud — sin Meta directo |
| Pasarela de LLM | OpenRouter, con modelo seleccionable por workspace |
| CRM | HighLevel |
| Hosting | Vercel |

## Puesta en marcha

```bash
npm install
cp .env.example .env.local   # completa tus credenciales de Supabase
npm run dev
```

La aplicación queda en [http://localhost:3000](http://localhost:3000).

Las variables necesarias están documentadas en [`.env.example`](.env.example).
`SUPABASE_SERVICE_ROLE_KEY` se salta las políticas de seguridad a nivel de fila:
es de uso exclusivo en servidor y nunca debe llevar el prefijo `NEXT_PUBLIC_`.

---

Proyecto desarrollado durante mi formación en agentes de IA.
