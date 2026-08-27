# TakeKeeper submission kit

## Devpost description

### Inspiration and problem

Film crews must preserve visual continuity across takes and shots, but wardrobe,
props, blocking, hair, makeup, and set details are still commonly tracked by
hand. A missed change costs time on set and can create an expensive problem in
the edit.

### What it does

TakeKeeper is an agentic visual continuity supervisor for film crews. It uses
Gemini to turn an approved reference into structured visual state, checks each
new take against the effective approved state, and surfaces likely mismatches
for a human decision. When a filmmaker marks a change intentional, TakeKeeper
updates the state future takes should match.

TakeKeeper does not simply compare two images. It maintains approved semantic
continuity state and updates that state when filmmakers intentionally approve
changes.

### How it works

1. The Script Breakdown Agent extracts script-supported continuity requirements.
2. The Visual State Agent observes only visible, production-relevant facts.
3. The Continuity Supervisor resolves the approved state and checks a new take.
4. Ownership-checked application tools validate and persist issues and decisions.
5. The Report Agent compiles database-owned production facts into a daily report.

All model output is schema-validated. Gemini cannot write directly to the
database. Tool and agent events are persisted so judges can inspect the real
workflow in Agent Activity.

### Technology

- Replit Agent development, Replit deployment, PostgreSQL, and App Storage
- Google Gemini through the official `@google/genai` SDK
- Google Cloud Agent Builder / Agent Engine deployment target
- React, Vite, Express, TypeScript, Drizzle, OpenAPI, and Zod

### Agentic differentiator

**TakeKeeper doesn't just identify what changed. It remembers what is now
supposed to be true.**

### Findings and learnings

Image similarity alone is not continuity supervision. The useful abstraction is
an auditable, effective state assembled from the script, the approved reference,
and scoped human decisions. Separating model observation from application-owned
state mutation also makes retries safe and keeps filmmakers in control.

## Required submission links

- Hosted Replit project: `TODO: https://<deployment>.replit.app`
- Public repository: `TODO: https://github.com/<owner>/TakeKeeper`
- Public YouTube/Vimeo demo: `TODO: https://...`
- Partner track: **Replit**

Do not submit while any `TODO` remains.

## Three-minute demo script

| Time | Screen | Narration / action |
| --- | --- | --- |
| 0:00–0:15 | Projects | “Continuity errors cost film crews time and create edit-room problems. TakeKeeper tells crews what changed before they roll again.” Open **The Last Cup**. |
| 0:15–0:35 | Scene / reference | Show the approved Reference A and its live Gemini visual observations. |
| 0:35–1:05 | Shoot / results | Add Take B. Show the saved take, live analysis progress, then the three-column Reference / Current Take / Issues result. |
| 1:05–1:25 | Issue decision | Open Jacket, choose **Intentional**, then **From now on**. Explain that this is a human-approved state transition. |
| 1:25–1:50 | Next take | Add Take C. Show that the zipped jacket is remembered while the incorrect mug change is still flagged. |
| 1:50–2:10 | Take / activity | Circle Take C, then show the persisted Activity timeline. |
| 2:10–2:35 | Agent Activity | Show real Visual State, Continuity Supervisor, application tool calls, status, and latency. Do not show secrets or hidden reasoning. |
| 2:35–2:50 | Architecture | Explain Replit web/API/database/storage and the Gemini Agent Engine workflow. |
| 2:50–3:00 | Closing | “TakeKeeper doesn't just identify what changed. It remembers what is now supposed to be true. Know what changed before you roll again.” |

Keep the uploaded video at or below three minutes, public on YouTube or Vimeo,
and in English or with English subtitles.

## Final submission gate

- [ ] Project was created during the contest period and is original work.
- [ ] Runtime AI uses only permitted Google Cloud AI tooling.
- [ ] Production invokes the accepted Google SDK and deployed Agent Builder / Agent Engine workflow.
- [ ] App is deployed directly to a public `replit.app` or `replit.dev` URL.
- [ ] Public deployment passes the complete Last Cup workflow after a reload.
- [ ] Production authentication lets judges enter while preserving per-user ownership.
- [ ] Reference A, Take B, and Take C assets are original or properly licensed.
- [ ] Repository is public and its About section detects the MIT license.
- [ ] Repository contains no credentials, private media, or copyrighted screenplay.
- [ ] Public demo video shows the functioning deployed product and is no longer than three minutes.
- [ ] Devpost description and all three links are complete.
