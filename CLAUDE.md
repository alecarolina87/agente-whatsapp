# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

- `npm run dev` — start the dev server at http://localhost:3000
- `npm run build` — production build
- `npm run start` — serve the production build
- `npm run lint` — run ESLint (flat config, `eslint.config.mjs`)

No test suite is configured in this repo.

## Architecture

- App Router project (`src/` layout): routes and components live under `src/app/`, imported via the `@/*` path alias (see `tsconfig.json`).
- Styling is Tailwind CSS v4 via `@tailwindcss/postcss`. There is no `tailwind.config.*` — v4 is CSS-first, configured with `@import "tailwindcss"` and an `@theme inline` block in `src/app/globals.css`.
- Fonts: Geist Sans/Mono are loaded through `next/font/google` in `src/app/layout.tsx` and exposed as CSS variables (`--font-geist-sans`, `--font-geist-mono`) consumed by `globals.css`.
- `next.config.ts` is currently empty (default config). TypeScript `strict` mode is on.
- Beyond the default template route, the app currently has no custom pages/components — this is a SaaS dashboard for WhatsApp still being scaffolded. A technical brief with the full feature set is expected before planning begins.

### Supabase

- `src/lib/supabase/client.ts` — browser client (`createBrowserClient`), for use in Client Components.
- `src/lib/supabase/server.ts` — server client (`createServerClient`), for use in Server Components, Server Actions, and Route Handlers. Its `setAll` is a no-op when called from a Server Component (cookies can't be written there); session refresh instead happens in `src/proxy.ts`.
- `src/lib/supabase/middleware.ts` — `updateSession()` helper that refreshes the auth cookie on every request; called from `src/proxy.ts`.
- Required env vars (see `.env.example`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server-only, bypasses RLS — never expose to the client).
- No Supabase project is wired up yet — `.env.local` with real credentials must be created locally (gitignored); it does not exist in this repo.

### MCP / Supabase access

`.mcp.json` configures the `supabase` MCP server (`@supabase/mcp-server-supabase`, `--read-only`) so Claude Code can query the project's schema/data directly. It reads `SUPABASE_PROJECT_REF` and `SUPABASE_ACCESS_TOKEN` from the shell environment (not from `.env.local`, which Next.js consumes separately) — both must be exported before Claude Code can connect. Remove `--read-only` only if write access via MCP is intentionally needed.

## Working in this Next.js version

Next.js is pinned to `16.2.10`, a version newer than this model's training data, with breaking changes in APIs, conventions, and file structure. Before adding routes, config, or using any Next.js API, check the matching guide under `node_modules/next/dist/docs/01-app/` instead of relying on prior knowledge of Next.js — file conventions, config options, data fetching, and caching APIs may all differ from what you expect. Heed any deprecation notices found there.

- **Middleware is now called Proxy.** The file is `src/proxy.ts`, exporting a `proxy` function (not `middleware.ts`/`middleware`). Session-refresh logic for Supabase auth lives here — see `node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md`.
