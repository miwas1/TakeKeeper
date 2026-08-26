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

## Stack

- pnpm workspace, Node.js, strict TypeScript
- React + Vite + TanStack Query
- Express 5 + Pino
- PostgreSQL + Drizzle ORM
- OpenAPI + Orval + Zod
- Replit App Storage
- Google Gemini / ADK / Agent Engine architecture only

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

Phase 2 is a working product shell. Projects, scenes, shots, takes, continuity items, intentional state changes, activity, and media metadata are real persisted records. Media bytes belong in App Storage and must never be written as base64 or blobs into PostgreSQL.

Do not fabricate continuity observations, issues, confidence scores, comparisons, or "all clear" results. Results and reports remain explicit shells until Gemini/Agent Engine analysis is connected.

The mobile-first production flow is Projects → Scene → Shot → Shoot. Desktop progressively enhances the same workflow and adds Reports navigation.

Do not add RevenueCat, OneSignal, production scheduling, casting, budgeting, screenplay writing, storyboards, or editing.

## Gotchas

- Run API and web packages through their Replit workflows so `PORT` and `BASE_PATH` are injected.
- Re-run codegen after every OpenAPI change.
- Seed data is domain data only; never seed fake AI observations or issues.