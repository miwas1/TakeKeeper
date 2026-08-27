# TakeKeeper

TakeKeeper is a production-monitor workspace that helps film crews know what changed before they roll again.

## Run & operate

- `pnpm --filter @workspace/api-server run dev` — API server (managed workflow)
- `pnpm --filter @workspace/takekeeper run dev` — web app (managed workflow)
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and validators
- `pnpm --filter @workspace/db run push` — apply development schema
- `pnpm --filter @workspace/scripts run seed` — idempotently seed The Last Cup
- `pnpm run typecheck` — full workspace typecheck
- `pnpm run build` — typecheck and build

For local testing outside Replit, set `DATABASE_URL` to an absolute `pglite://` path. This selects PGlite and filesystem object storage; the default `.takekeeper/` directory is Git-ignored. Leave Replit's normal PostgreSQL `DATABASE_URL` unchanged for Replit development and production.

## Stack

- pnpm workspace, Node.js, strict TypeScript
- React + Vite + TanStack Query
- Express 5 + Pino
- PostgreSQL + Drizzle ORM
- OpenAPI + Orval + Zod
- Replit App Storage
- Google Gemini / ADK / Agent Engine architecture only
- Google Gemini Script Breakdown, Visual State, and Continuity Supervisor runtimes using the server-only `GEMINI_API_KEY` secret

## Source of truth

- API contract: `lib/api-spec/openapi.yaml`
- Database schema: `lib/db/src/schema/`
- Structured domain outputs: `lib/takekeeper-domain/src/index.ts`
- Design tokens: `artifacts/takekeeper/src/index.css`
- Google agent boundaries: `artifacts/api-server/src/services/google-ai/`
- Application tools: `artifacts/api-server/src/tools/`

## Architecture decisions

- AI output is always validated and cannot write the database directly.
- Media bytes live in App Storage; PostgreSQL stores object keys and metadata only.
- Runtime AI is Google-only; do not add non-Google models or agent frameworks.
- Protected routes fail closed in production until the production identity adapter is configured.
- API changes begin in OpenAPI and require codegen before client or route changes.

## Product boundaries

Phase 3 adds a real Script Breakdown Agent to the working product shell. Pasted and `.txt` screenplay text is saved before analysis, Gemini output is validated before review, and only explicit approval writes scenes and script-sourced continuity items. Phase 4 adds the web-first shooting-media workflow: protected reference/take uploads, local previews, retry-safe persistence, take history, notes, statuses, and reference replacement history. Phase 6 adds persisted Visual State and Continuity Supervisor runs, deterministic approved-state resolution, normalized validated issues, retries, activity logging, and real Results data.

Do not fabricate continuity observations, issues, confidence scores, comparisons, or "all clear" results. Script Breakdown, Visual State, and Continuity Supervisor confidence must come from validated Google output or filmmaker review. Reports remain an explicit shell until the Report Agent is implemented.

Preserve original screenplay text when analysis fails. The model never writes application state directly; ownership-checked application routes save sources, reviews, approvals, and safe agent events. Preserve manual Continuity Bible items when approving script-derived items.

The mobile-first production flow is Projects → Scene → Shot → Shoot. Desktop progressively enhances the same workflow and adds Reports navigation.

Do not add RevenueCat, OneSignal, production scheduling, casting, budgeting, screenplay writing, storyboards, or editing.

## Gotchas

- Run API and web packages through their Replit workflows so `PORT` and `BASE_PATH` are injected.
- Re-run codegen after every OpenAPI change.
- Seed data is domain data only; never seed fake AI observations or issues.
