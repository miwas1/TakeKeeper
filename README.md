# TakeKeeper

**Know what changed before you roll again.**

TakeKeeper is an agentic visual continuity supervisor for film crews, built for the Replit track of the Agentic Cinema Hackathon. Crews can save screenplay-derived continuity, capture durable reference and take media, run structured Gemini analysis, review persisted comparison results, record human decisions, and generate date-scoped daily reports.

TakeKeeper does not simply compare two images. It maintains approved semantic continuity state and updates that state when filmmakers intentionally approve changes.

## What the current build includes

- Responsive React web application with desktop and compact navigation
- TypeScript throughout the web, API, database, and shared domain contracts
- PostgreSQL schema for the full planned continuity domain
- Ownership-aware API access with an explicit development identity adapter
- Replit App Storage direct uploads with protected retrieval and cleanup
- Validated schemas for every planned Gemini structured output
- Google Gemini runtime through the official `@google/genai` SDK, with Agent Engine configuration isolated behind server modules
- Application-tool contracts that keep model output away from direct database writes
- Internal analytics events stored in PostgreSQL
- Idempotent demo seed for **The Last Cup**
- Project archive and deletion
- Scene workspaces with screenplay text, continuity editing, and shot planning
- Reference setup and new-take capture backed by Replit App Storage
- Take status controls including Circle Take
- Persisted daily production reports with database-owned facts and a Google Gemini Report Agent narrative
- Saved screenplay sources with retry-safe analysis state
- Real Google Gemini scene and continuity extraction with structured-output validation
- Scene-batched analysis for feature-length screenplays without asking Gemini to echo the full source
- Editable screenplay review, confidence/evidence labels, approval, and reload persistence
- Web-first reference and take capture with file picker, drag-and-drop, local previews, progress, retry, and optional mobile camera hint
- Client-side image inspection, orientation-aware preparation, resize/compression, and server-side signature/dimension verification
- Idempotent media registration and take submission, shot-locked take numbering, reference replacement history, take notes, shot notes, status controls, and safe media cleanup
- Deterministic approved-state resolution across the Continuity Bible, reference observations, human edits, and applicable approved changes
- Google Gemini Visual State and Continuity Supervisor runs with persisted status, schema version, latency, error metadata, and retry-safe issue persistence
- Normalized, confidence-calibrated continuity issues with visibility-aware comparison and a developer inspector
- Paged production activity with category filters and a developer-only Agent Activity trace
- Demo Mode health visibility for the Google agent, database, storage, auth boundary, model, project/Agent Engine configuration, and latest latency

The main production path is:

`Projects → Scene → Shot → Shoot → Reference / New Take → Continuity Results`

## Stack

- React, Vite, TanStack Query, Wouter, Tailwind CSS
- Express 5 with structured Pino logging
- PostgreSQL, Drizzle ORM, Drizzle Kit
- OpenAPI-first API contracts with Orval-generated hooks and Zod validators
- Zod domain validation
- Replit App Storage
- Google Gemini runtime for Script Breakdown, Visual State, and Continuity Supervisor; Google Cloud Agent Engine is the deployment boundary

No OpenAI, Anthropic, Claude, OpenRouter, LangChain, or non-Google model integration is present.

## Repository architecture

```text
artifacts/
  takekeeper/                 React web application
    src/components/           reusable UI and production shell
    src/pages/                projects, scenes, shots, shoot, activity, agent activity, reports, settings
  api-server/                 Express API
    src/config/               validated server environment
    src/middlewares/          identity boundary
    src/routes/               health, production CRUD, media upload, continuity analysis, activity, reports
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
| Continuity | `continuity_analysis_runs`, `continuity_items`, `observations`, `continuity_issues`, `continuity_state_changes`, `continuity_issue_events` |
| Operations | `agent_events`, `daily_reports` |

Foreign keys, ownership indexes, unique constraints, timestamps, and cascade behavior are defined in `lib/db/src/schema/`. Images and video are never stored in PostgreSQL; `media.storage_key` stores only an App Storage object path.

Development schema changes use Drizzle Kit against Replit PostgreSQL. Replit Publish applies the development schema diff to production through the supported publish flow.

## Google AI and agent architecture

```text
TakeKeeper web
  → TakeKeeper API
  → Google Gemini through @google/genai and the ContinuityCheckWorkflow
  → validated TakeKeeper observation and issue tools
  → PostgreSQL / App Storage
```

Server-side agent definitions:

- Script Breakdown Agent — live for pasted and `.txt` screenplay sources
- Visual State Agent — extracts only visible, structured state from an approved image or take
- Continuity Supervisor Agent — compares structured observations with the resolved approved state
- Report Agent — compiles database-owned facts and generates a schema-validated narrative

Every agent output has a shared Zod schema. Gemini cannot mutate the database. `ContinuityCheckWorkflow` deterministically loads only the relevant scene, shot, take, Continuity Bible, reference observations, current observations, script requirements, and approved changes; it then validates and persists issues through application tools. Tool calls and agent actions are recorded in `agent_events`.

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

## Local development mode

When `DATABASE_URL` starts with `pglite`, the database package uses PGlite and the API uses local filesystem object storage. For example, use an absolute path so every workspace command resolves the same database:

```bash
export DATABASE_URL="pglite:///home/devnexx/Nexxyu/TakeKeeper/.takekeeper/pglite"
pnpm --filter @workspace/db run push
pnpm --filter @workspace/scripts run seed
```

Local media is stored in `.takekeeper/object-storage` by default. Set `TAKEKEEPER_LOCAL_STORAGE_DIR` to use another local directory. `.takekeeper/` is ignored by Git. Any other `DATABASE_URL` keeps the PostgreSQL and Replit App Storage path; local mode does not change Replit development or production behavior.

## Environment variables

| Variable | Required now | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | PostgreSQL connection, or `pglite:///absolute/local/path` for local development |
| `DEFAULT_OBJECT_STORAGE_BUCKET_ID` | yes for PostgreSQL | Replit App Storage bucket |
| `PRIVATE_OBJECT_DIR` | yes for PostgreSQL | Replit private object namespace |
| `GEMINI_MODEL` | optional | central Gemini model selection; defaults to `gemini-2.5-flash` |
| `GEMINI_API_KEY` | yes for Script Breakdown, Visual State, and Continuity Supervisor | Google Gemini credential stored only in Replit Secrets |
| `GOOGLE_CLOUD_PROJECT` | required for hosted agent deployment | Google Cloud project for Agent Builder / Agent Engine |
| `GOOGLE_CLOUD_LOCATION` | optional | Google Cloud region; defaults to `us-central1` |
| `AGENT_ENGINE_ID` | required for hosted agent deployment | deployed Agent Engine identifier |

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

Replit workflows run the API server and web app with their required ports and base paths. Publish the finished app directly from Replit and verify the resulting public `replit.app` or `replit.dev` URL. A local preview or a non-Replit host does not satisfy the selected track.

## Judge demo

1. Open the public Replit deployment and choose **Try Demo Project**.
2. Open **The Last Cup**, Scene 1, and its approved reference.
3. Add Take B and wait for the live Visual State and Continuity Supervisor runs.
4. Mark the jacket change **Intentional → From now on**.
5. Add Take C and confirm the jacket is no longer flagged while another incorrect change is.
6. Circle the take, inspect Activity and Agent Activity, generate the Daily Report, then reload and confirm persistence.

AI results are never seeded or hardcoded. The demo requires original/licensed sample media and a configured Gemini credential. See [SUBMISSION.md](SUBMISSION.md) for the final checklist and three-minute script.

## Privacy and deletion

Reference and take images are uploaded for AI continuity processing. Media stays in private object storage and is delivered through ownership-checked, short-lived access. Deleting a project removes its database records and attempts to remove associated storage objects; failed object cleanup is logged for operational follow-up. Do not use confidential production media in a public judging environment.

## Known limitations and release gates

- Production authentication must be configured before publishing; the server intentionally fails closed outside development until a trusted identity adapter is installed.
- The hosted Agent Builder / Agent Engine runtime still requires production project credentials and a deployed agent identifier.
- The real Last Cup reference/take media and a credentialed end-to-end public-deployment test are required before submission.
- Still images are supported; video and frame-level continuity analysis are not.

These are release gates, not completed capabilities. Current implementation notes are tracked in [NOT-IMPLEMENTED.txt](NOT-IMPLEMENTED.txt).

## Development history

**Phase 1:** foundation, schema, validation, responsive shell, storage and agent boundaries.

**Phase 2:** persisted project, scene, shot, take, continuity, activity, and App Storage production workflow.

**Phase 3:** saved screenplay import, real Gemini Script Breakdown Agent, editable review, approval, and activity tracking.

**Phase 4:** reliable web-first reference and take media capture, protected App Storage persistence, retry-safe uploads, take history, notes, statuses, reference replacement history, and cleanup.

**Phase 6:** Google Gemini Visual State extraction, deterministic approved-state resolution, ADK-compatible ContinuityCheckWorkflow orchestration, validated issue persistence, confidence/severity calibration, visibility-aware normalization, retries, idempotency, activity logging, and real Results integration.

RevenueCat, OneSignal, scheduling, casting, budgeting, screenplay writing, storyboards, and editing are intentionally outside this phase.

## License

[MIT](LICENSE)
