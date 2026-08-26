# TakeKeeper

**Know what changed before you roll again.**

TakeKeeper is an agentic visual continuity supervisor for film crews. It is being built for the Replit track of the Agentic Cinema Hackathon. The current build includes the Phase 3 Script Breakdown Agent: projects can save pasted or `.txt` screenplays, analyze them with Google Gemini, review the extracted scenes and continuity, and approve validated production records.

The visual comparison workflow is intentionally not implemented yet. There are no fake AI results.

## What the current build includes

- Responsive React web application with desktop and compact navigation
- TypeScript throughout the web, API, database, and shared domain contracts
- PostgreSQL schema for the full planned continuity domain
- Ownership-aware API access with an explicit development identity adapter
- Replit App Storage provisioned for future direct media uploads
- Validated schemas for every planned Gemini structured output
- Google Gemini / Agent Engine configuration isolated behind server modules
- Application-tool contracts that keep model output away from direct database writes
- Internal analytics events stored in PostgreSQL
- Idempotent demo seed for **The Last Cup**
- Project archive and deletion
- Scene workspaces with screenplay text, continuity editing, and shot planning
- Reference setup and new-take capture backed by Replit App Storage
- Take status controls including Circle Take
- Honest results and daily-report shells with AI generation explicitly deferred
- Saved screenplay sources with retry-safe analysis state
- Real Google Gemini scene and continuity extraction with structured-output validation
- Scene-batched analysis for feature-length screenplays without asking Gemini to echo the full source
- Editable screenplay review, confidence/evidence labels, approval, and reload persistence

The main production path is:

`Projects → Scene → Shot → Shoot → Reference / New Take → Results shell`

## Stack

- React, Vite, TanStack Query, Wouter, Tailwind CSS
- Express 5 with structured Pino logging
- PostgreSQL, Drizzle ORM, Drizzle Kit
- OpenAPI-first API contracts with Orval-generated hooks and Zod validators
- Zod domain validation
- Replit App Storage
- Google Gemini runtime for Script Breakdown; Google Cloud Agent Engine remains the later deployment boundary

No OpenAI, Anthropic, Claude, OpenRouter, LangChain, or non-Google model integration is present.

## Repository architecture

```text
artifacts/
  takekeeper/                 React web application
    src/components/           reusable UI and production shell
    src/pages/                projects, scenes, shots, shoot, activity, reports, settings
  api-server/                 Express API
    src/config/               validated server environment
    src/middlewares/          identity boundary
    src/routes/               health, production CRUD, media upload, activity, reports
    src/services/             repositories, analytics, storage, Google AI
    src/tools/                validated application-tool contracts
lib/
  api-spec/                   source-of-truth OpenAPI contract
  api-client-react/           generated React Query client
  api-zod/                    generated request/response validators
  db/                         Drizzle client and relational schema
  takekeeper-domain/          shared AI/application validation schemas
scripts/
  src/seed.ts                 idempotent development seed
```

## Database tables

| Area | Tables |
| --- | --- |
| Identity and access | `users`, `projects`, `project_members`, `entitlements` |
| Production | `screenplay_sources`, `scenes`, `shots`, `takes`, `media` |
| Continuity | `continuity_items`, `observations`, `continuity_issues`, `continuity_state_changes` |
| Operations | `agent_events` |

Foreign keys, ownership indexes, unique constraints, timestamps, and cascade behavior are defined in `lib/db/src/schema/`. Images and video are never stored in PostgreSQL; `media.storage_key` stores only an App Storage object path.

Development schema changes use Drizzle Kit against Replit PostgreSQL. Replit Publish applies the development schema diff to production through the supported publish flow.

## Google AI and agent architecture

```text
TakeKeeper web
  → TakeKeeper API
  → Gemini
  → validated TakeKeeper review and approval tools
  → PostgreSQL / App Storage
```

Server-side agent definitions:

- Script Breakdown Agent — live for pasted and `.txt` screenplay sources
- Visual State Agent
- Continuity Supervisor Agent
- Report Agent

Every agent output has a shared Zod schema. Gemini cannot mutate the database. Screenplay source saving, review edits, scene/continuity approval, ownership checks, and agent-event recording execute in validated application code. The remaining agent definitions are not runtime features yet.

## Authentication foundation

Development uses one fixed, clearly identified demo crew user so local work remains deterministic. It does not accept arbitrary identity headers or pretend to be production authentication. In production, protected routes fail closed until the production identity adapter is configured. Projects are filtered by `owner_id` on every route.

The intended production integration is Replit-managed Clerk. It remains deliberately disabled until production authentication is configured; production requests fail closed.

## App Storage

Replit App Storage is provisioned. The server now supports:

- protected upload target creation
- direct browser-to-storage image upload
- protected media delivery through short-lived signed URLs
- retrieval URLs
- deletion
- metadata
- future thumbnail generation
- project-authorized access

Media uploads use server-issued reservations and protected reads. Screenplay `.txt` files are read in the browser and sent as validated text; screenplay files are not stored in App Storage.

## Environment variables

| Variable | Required now | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes, managed by Replit | PostgreSQL connection |
| `DEFAULT_OBJECT_STORAGE_BUCKET_ID` | yes, managed by Replit | App Storage bucket |
| `PRIVATE_OBJECT_DIR` | yes, managed by Replit | private object namespace |
| `GEMINI_MODEL` | optional | central Gemini model selection; defaults to `gemini-2.5-flash` |
| `GEMINI_API_KEY` | yes for Script Breakdown | Google Gemini credential stored only in Replit Secrets |
| `GOOGLE_CLOUD_PROJECT` | later | Google Cloud project for ADK / Agent Engine |
| `GOOGLE_CLOUD_LOCATION` | optional | Google Cloud region; defaults to `us-central1` |
| `AGENT_ENGINE_ID` | later | deployed Agent Engine identifier |

Do not hardcode credentials. Google application credentials, if required by the final Agent Engine deployment method, belong in Replit Secrets.

## Development

```bash
pnpm install
pnpm --filter @workspace/db run push
pnpm --filter @workspace/scripts run seed
pnpm --filter @workspace/api-spec run codegen
pnpm run typecheck
pnpm run build
```

Replit workflows run the API server and web app with their required ports and base paths.

## Current status and planned phases

**Phase 1:** foundation, schema, validation, responsive shell, storage and agent boundaries.

**Phase 2:** persisted project, scene, shot, take, continuity, activity, and App Storage production workflow.

**Phase 3:** saved screenplay import, real Gemini Script Breakdown Agent, editable review, approval, and activity tracking.

**Next:** production authentication, visual state extraction, continuity comparison, human issue resolution, approved state changes, and reporting.

RevenueCat, OneSignal, scheduling, casting, budgeting, screenplay writing, storyboards, and editing are intentionally outside this phase.