import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import {
  continuityAnalysisRunsTable,
  continuityIssueEventsTable,
  continuityIssuesTable,
  db,
  mediaTable,
  observationsTable,
} from "@workspace/db";
import {
  continuityIssueDraftSchema,
  continuityIssueSchema,
  type ContinuityIssueDraft,
  type ContinuityCheckResult,
  type VisualObservation,
  visualObservationSchema,
} from "@workspace/takekeeper-domain";
import { env } from "../../config/env";
import { mediaStorage } from "../storage";
import {
  analyzeVisualState,
  runContinuitySupervisor,
  type ContinuitySupervisorInput,
} from "../google-ai";
import { queryAgentEngine } from "../google-ai/agent-engine";
import { recordAgentEvent, trackEvent } from "../analytics";
import {
  getLatestAnalysisRun,
  getLatestCompletedAnalysisRun,
  getOwnedTakeContext,
  getReferenceTake,
  getTakeContext,
  getTakeObservations,
  resolveApprovedContinuityState,
} from "./approved-state";
import {
  buildComparisonCandidates,
  calibrateSeverity,
  findMatchingCandidate,
  findMatchingObservation,
  inferObservationVisibility,
  makeIssueKey,
  makeIssueDimensionKey,
  normalizeCategory,
  normalizeState,
  type ComparisonCandidate,
} from "./normalization";
import { createContinuityToolRuntime } from "../../tools/continuity";
import { markIssueFixedAfterRecheck } from "./decisions";

export const continuitySchemaVersion = "continuity-v1";

type AnalysisRun = typeof continuityAnalysisRunsTable.$inferSelect;

const visualRunsInFlight = new Map<string, Promise<AnalysisRun>>();
const continuityRunsInFlight = new Map<string, Promise<AnalysisRun>>();

function errorMetadata(error: unknown) {
  return {
    errorType: error instanceof Error ? error.name : "UnknownError",
    message: (error instanceof Error ? error.message : String(error)).slice(0, 300),
  };
}

function runErrorMessage(run: AnalysisRun): string | null {
  if (!run.errorMetadataJson || typeof run.errorMetadataJson !== "object") return null;
  const message = (run.errorMetadataJson as Record<string, unknown>).message;
  return typeof message === "string" ? message : null;
}

function dateString(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function runStatus(value: string): "pending" | "analyzing" | "completed" | "failed" {
  if (value === "pending" || value === "completed" || value === "failed") return value;
  return "analyzing";
}

async function createAnalysisRun(input: {
  kind: "visual_state" | "continuity_check";
  sceneId: string;
  shotId: string;
  takeId: string;
  referenceTakeId?: string | null;
  recheckIssueId?: string | null;
  requestedByUserId?: string | null;
}): Promise<AnalysisRun> {
  const [run] = await db.insert(continuityAnalysisRunsTable).values({
    kind: input.kind,
    sceneId: input.sceneId,
    shotId: input.shotId,
    takeId: input.takeId,
    referenceTakeId: input.referenceTakeId ?? null,
    recheckIssueId: input.recheckIssueId ?? null,
    requestedByUserId: input.requestedByUserId ?? null,
    attemptId: randomUUID(),
    status: "analyzing",
    model: env.GEMINI_MODEL,
    schemaVersion: continuitySchemaVersion,
    startedAt: new Date(),
  }).returning();
  return run;
}

async function persistObservations(input: {
  takeId: string;
  analysisRunId: string;
  observations: VisualObservation[];
}) {
  const observations = input.observations.map((observation) => visualObservationSchema.parse({
    ...observation,
    category: normalizeCategory(observation.category),
    visibility: inferObservationVisibility(observation),
  }));
  if (observations.length === 0) return [];
  return db.transaction(async (tx) => {
    return tx.insert(observationsTable).values(observations.map((observation) => ({
      takeId: input.takeId,
      analysisRunId: input.analysisRunId,
      category: observation.category,
      entity: observation.entity,
      observedState: observation.observedState,
      confidence: observation.confidence.toFixed(4),
      visibility: observation.visibility,
      regionJson: observation.region,
    }))).returning();
  });
}

async function updateRun(runId: string, values: {
  status: "pending" | "analyzing" | "completed" | "failed";
  model?: string | null;
  completedAt?: Date | null;
  latencyMs?: number | null;
  errorMetadataJson?: Record<string, unknown> | null;
}) {
  const [updated] = await db.update(continuityAnalysisRunsTable).set({
    ...values,
    updatedAt: new Date(),
  }).where(eq(continuityAnalysisRunsTable.id, runId)).returning();
  return updated;
}

async function executeVisualStateRun(run: AnalysisRun): Promise<AnalysisRun> {
  const startedAt = Date.now();
  const context = await getTakeContext(run.takeId);
  if (!context) throw new Error("Take not found");
  await recordAgentEvent({
    projectId: context.scene.projectId,
    agent: "visual-state-agent",
    action: "visual_state_analysis",
    toolName: "gemini.generateContent",
    status: "started",
    metadata: { takeId: run.takeId, analysisRunId: run.id, model: env.GEMINI_MODEL },
  });
  try {
    const tools = createContinuityToolRuntime({
      projectId: context.scene.projectId,
      saveObservations: persistObservations,
    });
    await tools.get_scene.execute({ sceneId: context.scene.id });
    const knownEntities = await tools.get_continuity_bible.execute({ sceneId: context.scene.id }) as Array<{
      category: string;
      entity: string;
      expectedState: string;
      sourceType: string;
      confidence: number | null;
    }>;
    const [media] = await db.select().from(mediaTable).where(eq(mediaTable.takeId, run.takeId)).limit(1);
    if (!media) throw new Error("Take has no attached image");
    const stored = await mediaStorage.readBytes(media.storageKey);
    const result = await analyzeVisualState({
      takeId: run.takeId,
      mediaType: stored.contentType || media.mediaType,
      bytes: stored.bytes,
      project: { id: context.project.id, title: context.project.title, type: context.project.type },
      scene: {
        id: context.scene.id,
        sceneNumber: context.scene.sceneNumber,
        slugline: context.scene.slugline,
        location: context.scene.location,
        timeOfDay: context.scene.timeOfDay,
        storyDay: context.scene.storyDay,
      },
      shot: {
        id: context.shot.id,
        label: context.shot.label,
        description: context.shot.description,
        notes: context.shot.notes,
      },
      take: { id: context.take.id, takeNumber: context.take.takeNumber, isReference: context.take.isReference },
      knownEntities,
    });
    await tools.save_observations.execute({
      takeId: run.takeId,
      analysisRunId: run.id,
      observations: result.observations,
    });
    const updated = await updateRun(run.id, {
      status: "completed",
      model: result.model,
      completedAt: new Date(),
      latencyMs: Date.now() - startedAt,
      errorMetadataJson: { warningCount: result.warnings.length },
    });
    await recordAgentEvent({
      projectId: context.scene.projectId,
      agent: "visual-state-agent",
      action: "visual_state_analysis",
      toolName: "gemini.generateContent",
      status: "completed",
      latencyMs: Date.now() - startedAt,
      metadata: { takeId: run.takeId, analysisRunId: run.id, observationCount: result.observations.length, warningCount: result.warnings.length },
    });
    if (!updated) throw new Error("Visual state run disappeared");
    return updated;
  } catch (error) {
    await updateRun(run.id, {
      status: "failed",
      completedAt: new Date(),
      latencyMs: Date.now() - startedAt,
      errorMetadataJson: errorMetadata(error),
    });
    await recordAgentEvent({
      projectId: context.scene.projectId,
      agent: "visual-state-agent",
      action: "visual_state_analysis",
      toolName: "gemini.generateContent",
      status: "failed",
      latencyMs: Date.now() - startedAt,
      metadata: { takeId: run.takeId, analysisRunId: run.id, errorType: error instanceof Error ? error.name : "UnknownError" },
    });
    throw error;
  }
}

export async function startVisualStateAnalysis(takeId: string, force = false): Promise<AnalysisRun> {
  const context = await getTakeContext(takeId);
  if (!context) throw new Error("Take not found");
  const latest = await getLatestAnalysisRun(takeId, "visual_state");
  if (!force && latest && ["pending", "analyzing", "completed"].includes(latest.status)) return latest;
  const inFlight = visualRunsInFlight.get(takeId);
  if (inFlight) return inFlight;
  const run = await createAnalysisRun({ kind: "visual_state", sceneId: context.scene.id, shotId: context.shot.id, takeId });
  const promise = executeVisualStateRun(run).finally(() => visualRunsInFlight.delete(takeId));
  visualRunsInFlight.set(takeId, promise);
  void promise.catch(() => undefined);
  return run;
}

export async function runVisualStateWorkflow(takeId: string, force = false): Promise<AnalysisRun> {
  const inFlight = visualRunsInFlight.get(takeId);
  if (inFlight) return inFlight;
  const latest = await getLatestAnalysisRun(takeId, "visual_state");
  if (!force && latest?.status === "completed") return latest;
  if (!force && latest?.status === "analyzing") throw new Error("Visual state analysis is already running");
  const context = await getTakeContext(takeId);
  if (!context) throw new Error("Take not found");
  const run = await createAnalysisRun({ kind: "visual_state", sceneId: context.scene.id, shotId: context.shot.id, takeId });
  const promise = executeVisualStateRun(run).finally(() => visualRunsInFlight.delete(takeId));
  visualRunsInFlight.set(takeId, promise);
  return promise;
}

function issueResponse(row: typeof continuityIssuesTable.$inferSelect) {
  const severity = row.severity === "critical" ? "high" : row.severity === "warning" ? "medium" : row.severity;
  return continuityIssueSchema.parse({
    id: row.id,
    sceneId: row.sceneId,
    takeId: row.takeId,
    analysisRunId: row.analysisRunId,
    issueKey: row.issueKey ?? makeIssueKey(row),
    category: normalizeCategory(row.category),
    entity: row.entity,
    expectedState: normalizeState(row.category, row.entity, row.expectedState),
    observedState: normalizeState(row.category, row.entity, row.observedState),
    severity: ["low", "medium", "high"].includes(severity) ? severity : "medium",
    confidence: Number(row.confidence ?? 0),
    explanation: row.explanation ?? "The observed state differs from the approved continuity state.",
    suggestedFix: row.suggestedFix,
    status: row.status,
    stateDimension: row.stateDimension?.includes("|") ? row.stateDimension : makeIssueDimensionKey(row),
    continuityItemId: row.continuityItemId,
    resolution: row.resolution,
    notes: row.notes,
    resolutionTakeId: row.resolutionTakeId,
    resolvedByUserId: row.resolvedByUserId,
    resolvedAt: dateString(row.resolvedAt),
  });
}

async function persistIssue(run: AnalysisRun, draft: ContinuityIssueDraft, continuityItemId?: string | null) {
  const issue = continuityIssueDraftSchema.parse(draft);
  const issueKey = makeIssueKey(issue);
  const existingRows = await db.select().from(continuityIssuesTable).where(eq(continuityIssuesTable.takeId, run.takeId));
  const existing = existingRows.find((row) => (row.issueKey ?? makeIssueKey(row)) === issueKey);
  if (existing) {
    const [updated] = await db.update(continuityIssuesTable).set({
      analysisRunId: run.id,
      issueKey,
      stateDimension: makeIssueDimensionKey(issue),
      continuityItemId: continuityItemId ?? existing.continuityItemId,
      expectedState: normalizeState(issue.category, issue.entity, issue.expectedState),
      observedState: normalizeState(issue.category, issue.entity, issue.observedState),
      updatedAt: new Date(),
    }).where(eq(continuityIssuesTable.id, existing.id)).returning();
    await db.insert(continuityIssueEventsTable).values({
      issueId: existing.id,
      eventType: "detected_again",
      status: existing.status,
      metadataJson: { analysisRunId: run.id },
    });
    return updated ?? existing;
  }
  const created = await db.transaction(async (tx) => {
    const [inserted] = await tx.insert(continuityIssuesTable).values({
      analysisRunId: run.id,
      sceneId: run.sceneId,
      takeId: run.takeId,
      category: issue.category,
      entity: issue.entity,
      expectedState: normalizeState(issue.category, issue.entity, issue.expectedState),
      observedState: normalizeState(issue.category, issue.entity, issue.observedState),
      continuityItemId: continuityItemId ?? null,
      severity: issue.severity,
      confidence: issue.confidence.toFixed(4),
      issueKey,
      stateDimension: makeIssueDimensionKey(issue),
      explanation: issue.explanation,
      suggestedFix: issue.suggestedFix,
      status: "open",
    }).returning();
    if (inserted) {
      await tx.insert(continuityIssueEventsTable).values({
        issueId: inserted.id,
        eventType: "detected",
        status: "open",
        metadataJson: { analysisRunId: run.id },
      });
    }
    return inserted;
  });
  return created;
}

function sanitizeSupervisorIssues(rawIssues: ContinuityIssueDraft[], candidates: ComparisonCandidate[]): ContinuityIssueDraft[] {
  const seen = new Set<string>();
  const sanitized: ContinuityIssueDraft[] = [];
  for (const rawIssue of rawIssues) {
    const candidate = findMatchingCandidate(rawIssue, candidates);
    if (!candidate) continue;
    const confidence = Math.round(Math.min(
      rawIssue.confidence,
      candidate.observation.confidence,
      candidate.item.confidence ?? 1,
    ) * 1000) / 1000;
    if (confidence < 0.4) continue;
    const issue = continuityIssueDraftSchema.parse({
      category: normalizeCategory(candidate.item.category),
      entity: candidate.item.entity,
      expectedState: normalizeState(candidate.item.category, candidate.item.entity, candidate.item.expectedState),
      observedState: normalizeState(candidate.item.category, candidate.item.entity, candidate.observation.observedState),
      severity: calibrateSeverity(rawIssue.severity, confidence, candidate),
      confidence,
      explanation: rawIssue.explanation,
      suggestedFix: rawIssue.suggestedFix,
    });
    const key = makeIssueKey(issue);
    if (seen.has(key)) continue;
    seen.add(key);
    sanitized.push(issue);
  }
  return sanitized.sort((left, right) => right.confidence - left.confidence);
}

function comparisonDetails(
  items: Awaited<ReturnType<typeof resolveApprovedContinuityState>>["items"],
  observations: VisualObservation[],
  candidates: ComparisonCandidate[],
  issues: Array<ReturnType<typeof issueResponse>>,
) {
  const used = new Set<number>();
  return items.map((item) => {
    const match = findMatchingObservation(item, observations, used, true);
    if (match) used.add(match.index);
    const candidate = candidates.find((entry) => entry.item.id === item.id && entry.observation.entity === match?.observation.entity)
      ?? candidates.find((entry) => entry.item.id === item.id);
    const issue = candidate ? issues.find((entry) => entry.issueKey === makeIssueKey({
      category: candidate.item.category,
      entity: candidate.item.entity,
      expectedState: candidate.item.expectedState,
      observedState: candidate.observation.observedState,
    })) : undefined;
    return {
      category: normalizeCategory(item.category),
      entity: item.entity,
      approvedState: item.expectedState,
      currentState: match?.observation.observedState ?? null,
      visibility: match ? inferObservationVisibility(match.observation) : "not_visible",
      mismatch: Boolean(candidate),
      confidence: match?.observation.confidence ?? null,
      severity: issue?.severity ?? null,
    };
  });
}

export async function getVisualStateResult(takeId: string) {
  const context = await getTakeContext(takeId);
  if (!context) return null;
  const run = await getLatestAnalysisRun(takeId, "visual_state");
  if (!run) return null;
  const observations = run.status === "completed" ? await getTakeObservations(takeId, run.id) : [];
  return {
    analysisRunId: run.id,
    takeId,
    status: runStatus(run.status),
    model: run.model,
    schemaVersion: run.schemaVersion,
    startedAt: dateString(run.startedAt),
    completedAt: dateString(run.completedAt),
    latencyMs: run.latencyMs,
    errorMessage: runErrorMessage(run),
    observations,
  };
}

export async function getContinuityCheckResult(takeId: string): Promise<ContinuityCheckResult & {
  schemaVersion: string;
  startedAt: string | null;
  completedAt: string | null;
  latencyMs: number | null;
  errorMessage: string | null;
  comparison: ReturnType<typeof comparisonDetails>;
} | null> {
  const context = await getTakeContext(takeId);
  if (!context) return null;
  const run = await getLatestAnalysisRun(takeId, "continuity_check");
  if (!run) return null;
  const visualRun = await getLatestCompletedAnalysisRun(takeId, "visual_state");
  const observations = visualRun ? await getTakeObservations(takeId, visualRun.id) : await getTakeObservations(takeId);
  const state = await resolveApprovedContinuityState(context.scene.id, context.shot.id, takeId);
  const candidates = buildComparisonCandidates(state.items, observations);
  const rows = run.status === "completed"
    ? await db.select().from(continuityIssuesTable).where(eq(continuityIssuesTable.analysisRunId, run.id)).orderBy(desc(continuityIssuesTable.createdAt))
    : [];
  const recheckIssue = run.status === "completed" && run.recheckIssueId
    ? (await db.select().from(continuityIssuesTable).where(eq(continuityIssuesTable.id, run.recheckIssueId)).limit(1))[0]
    : undefined;
  const issues = [
    ...rows.map(issueResponse),
    ...(recheckIssue && recheckIssue.status !== "open" && !rows.some((row) => row.id === recheckIssue.id) ? [issueResponse(recheckIssue)] : []),
  ];
  const checkedAt = run.completedAt ?? run.updatedAt;
  return {
    checkId: run.id,
    sceneId: context.scene.id,
    shotId: context.shot.id,
    takeId,
    referenceTakeId: run.referenceTakeId,
    status: runStatus(run.status),
    issues,
    observations,
    model: run.model ?? env.GEMINI_MODEL,
    checkedAt: checkedAt.toISOString(),
    schemaVersion: run.schemaVersion,
    startedAt: dateString(run.startedAt),
    completedAt: dateString(run.completedAt),
    latencyMs: run.latencyMs,
    errorMessage: runErrorMessage(run),
    comparison: comparisonDetails(state.items, observations, candidates, issues),
  };
}

async function executeContinuityCheckRun(run: AnalysisRun): Promise<AnalysisRun> {
  const startedAt = Date.now();
  const context = await getTakeContext(run.takeId);
  if (!context) throw new Error("Take not found");
  const workflowAgent = "continuity-check-workflow";
  await recordAgentEvent({
    projectId: context.scene.projectId,
    agent: workflowAgent,
    action: run.recheckIssueId ? "ContinuitySupervisor → recheck" : "continuity_check",
    toolName: "ContinuityCheckWorkflow",
    status: "started",
    metadata: { analysisRunId: run.id, takeId: run.takeId, referenceTakeId: run.referenceTakeId },
  });
  try {
    const referenceTake = await getReferenceTake(context.shot.id);
    if (!referenceTake) throw new Error("An approved reference is required before checking a take");
    const tools = createContinuityToolRuntime({
      projectId: context.scene.projectId,
      createIssue: ({ takeId, issue, continuityItemId }) => persistIssue(run, issue, continuityItemId),
    });
    await tools.get_scene.execute({ sceneId: context.scene.id });
    await tools.get_continuity_bible.execute({ sceneId: context.scene.id });
    await tools.get_reference_take.execute({ shotId: context.shot.id });
    await tools.get_previous_approved_changes.execute({ sceneId: context.scene.id, takeId: run.takeId });

    if (env.AGENT_ENGINE_ID) {
      const engineStartedAt = Date.now();
      await recordAgentEvent({
        projectId: context.scene.projectId,
        agent: "google-agent-engine",
        action: "ContinuityWorkflow → coordinate",
        toolName: "reasoningEngines.query",
        status: "started",
        metadata: { analysisRunId: run.id, engineId: env.AGENT_ENGINE_ID },
      });
      const engineOutput = await queryAgentEngine({
        workflow: "takekeeper_continuity_check",
        analysisRunId: run.id,
        projectId: context.project.id,
        sceneId: context.scene.id,
        shotId: context.shot.id,
        takeId: context.take.id,
        referenceTakeId: referenceTake.id,
        requestedTools: [
          "get_scene",
          "get_continuity_bible",
          "get_reference_take",
          "get_previous_approved_changes",
          "analyze_media",
          "get_effective_continuity_state",
          "create_issue",
        ],
      });
      await recordAgentEvent({
        projectId: context.scene.projectId,
        agent: "google-agent-engine",
        action: "ContinuityWorkflow → coordinate",
        toolName: "reasoningEngines.query",
        status: "completed",
        latencyMs: Date.now() - engineStartedAt,
        metadata: {
          analysisRunId: run.id,
          outputReceived: engineOutput !== null && engineOutput !== undefined,
        },
      });
    }

    let referenceVisualRun = await getLatestCompletedAnalysisRun(referenceTake.id, "visual_state");
    if (!referenceVisualRun) {
      await runVisualStateWorkflow(referenceTake.id);
      referenceVisualRun = await getLatestCompletedAnalysisRun(referenceTake.id, "visual_state");
    }
    if (!referenceVisualRun) throw new Error("Reference visual observations are not available");

    let currentVisualRun = await getLatestCompletedAnalysisRun(run.takeId, "visual_state");
    if (!currentVisualRun) {
      await runVisualStateWorkflow(run.takeId);
      currentVisualRun = await getLatestCompletedAnalysisRun(run.takeId, "visual_state");
    }
    if (!currentVisualRun) throw new Error("Current take visual observations are not available");

    const referenceObservations = await tools.get_take_observations.execute({ takeId: referenceTake.id }) as VisualObservation[];
    const currentObservations = await tools.get_take_observations.execute({ takeId: run.takeId }) as VisualObservation[];
    const approvedState = await tools.get_effective_continuity_state.execute({
      sceneId: context.scene.id,
      shotId: context.shot.id,
      takeId: run.takeId,
    }) as Awaited<ReturnType<typeof resolveApprovedContinuityState>>;
    await recordAgentEvent({
      projectId: context.scene.projectId,
      agent: "continuity-state",
      action: "ContinuityState → resolve_effective_state",
      toolName: "resolveApprovedContinuityState",
      status: "completed",
      metadata: { analysisRunId: run.id, takeId: run.takeId, itemCount: approvedState.items.length, appliedChangeCount: approvedState.previousApprovedChanges.length },
    });
    // The resolver reuses the approved reference observations. Keep this explicit
    // in the workflow context so the supervisor never has to discover project history.
    approvedState.referenceObservations = referenceObservations;
    const candidates = buildComparisonCandidates(approvedState.items, currentObservations);
    const supervisorInput: ContinuitySupervisorInput = {
      project: {
        id: context.project.id,
        title: context.project.title,
        type: context.project.type,
      },
      scene: {
        id: context.scene.id,
        sceneNumber: context.scene.sceneNumber,
        slugline: context.scene.slugline,
        location: context.scene.location,
        timeOfDay: context.scene.timeOfDay,
        storyDay: context.scene.storyDay,
      },
      shot: {
        id: context.shot.id,
        label: context.shot.label,
        description: context.shot.description,
        notes: context.shot.notes,
      },
      take: { id: context.take.id, takeNumber: context.take.takeNumber },
      approvedState,
      currentObservations,
    };
    await recordAgentEvent({
      projectId: context.scene.projectId,
      agent: "continuity-supervisor-agent",
      action: "compare_state",
      toolName: "gemini.generateContent",
      status: "started",
      metadata: { analysisRunId: run.id, candidateCount: candidates.length, observationCount: currentObservations.length },
    });
    const supervisor = await runContinuitySupervisor(supervisorInput);
    await recordAgentEvent({
      projectId: context.scene.projectId,
      agent: "continuity-supervisor-agent",
      action: "compare_state",
      toolName: "gemini.generateContent",
      status: "completed",
      latencyMs: Date.now() - startedAt,
      metadata: { analysisRunId: run.id, returnedIssueCount: supervisor.issues.length },
    });
    const issues = sanitizeSupervisorIssues(supervisor.issues, candidates);
    const persisted = [] as Array<typeof continuityIssuesTable.$inferSelect>;
    for (const issue of issues) {
      const candidate = findMatchingCandidate(issue, candidates);
      const created = await tools.create_issue.execute({ takeId: run.takeId, issue, continuityItemId: candidate?.item.id ?? null });
      if (created && typeof created === "object" && "id" in created) {
        const persistedIssue = created as typeof continuityIssuesTable.$inferSelect;
        persisted.push(persistedIssue);
        await trackEvent({ projectId: context.scene.projectId, name: "issue_detected", metadata: { issueId: persistedIssue.id, analysisRunId: run.id, takeId: run.takeId } });
      }
    }
    const updated = await updateRun(run.id, {
      status: "completed",
      model: supervisor.model,
      completedAt: new Date(),
      latencyMs: Date.now() - startedAt,
      errorMetadataJson: { candidateCount: candidates.length, issueCount: persisted.length },
    });
    if (run.recheckIssueId) {
      await markIssueFixedAfterRecheck({
        issueId: run.recheckIssueId,
        takeId: run.takeId,
        analysisRunId: run.id,
        userId: run.requestedByUserId ?? "dev-user",
      });
    }
    await recordAgentEvent({
      projectId: context.scene.projectId,
      agent: workflowAgent,
      action: run.recheckIssueId ? "ContinuitySupervisor → recheck" : "continuity_check",
      toolName: "ContinuityCheckWorkflow",
      status: "completed",
      latencyMs: Date.now() - startedAt,
      metadata: { analysisRunId: run.id, issueCount: persisted.length },
    });
    await trackEvent({ projectId: context.scene.projectId, name: "continuity_check_completed", metadata: { analysisRunId: run.id, takeId: run.takeId, issueCount: persisted.length } });
    if (!updated) throw new Error("Continuity check run disappeared");
    return updated;
  } catch (error) {
    await updateRun(run.id, {
      status: "failed",
      completedAt: new Date(),
      latencyMs: Date.now() - startedAt,
      errorMetadataJson: errorMetadata(error),
    });
    await recordAgentEvent({
      projectId: context.scene.projectId,
      agent: workflowAgent,
      action: run.recheckIssueId ? "ContinuitySupervisor → recheck" : "continuity_check",
      toolName: "ContinuityCheckWorkflow",
      status: "failed",
      latencyMs: Date.now() - startedAt,
      metadata: { analysisRunId: run.id, errorType: error instanceof Error ? error.name : "UnknownError" },
    });
    await trackEvent({ projectId: context.scene.projectId, name: "continuity_check_completed", metadata: { analysisRunId: run.id, takeId: run.takeId, status: "failed" } });
    throw error;
  }
}

export async function startContinuityCheck(takeId: string, retry = false, options: { recheckIssueId?: string | null; requestedByUserId?: string | null } = {}): Promise<AnalysisRun> {
  const context = await getTakeContext(takeId);
  if (!context) throw new Error("Take not found");
  if (context.take.isReference) throw new Error("The approved reference does not need a continuity check");
  const referenceTake = await getReferenceTake(context.shot.id);
  if (!referenceTake) throw new Error("An approved reference is required before checking a take");
  const latest = await getLatestAnalysisRun(takeId, "continuity_check");
  if (!retry && latest && ["pending", "analyzing", "completed", "failed"].includes(latest.status)) return latest;
  const inFlight = continuityRunsInFlight.get(takeId);
  if (inFlight) return inFlight;
  const run = await createAnalysisRun({
    kind: "continuity_check",
    sceneId: context.scene.id,
    shotId: context.shot.id,
    takeId,
    referenceTakeId: referenceTake.id,
    recheckIssueId: options.recheckIssueId ?? null,
    requestedByUserId: options.requestedByUserId ?? null,
  });
  await trackEvent({ projectId: context.scene.projectId, name: "continuity_check_started", metadata: { analysisRunId: run.id, takeId } });
  const promise = executeContinuityCheckRun(run).finally(() => continuityRunsInFlight.delete(takeId));
  continuityRunsInFlight.set(takeId, promise);
  void promise.catch(() => undefined);
  return run;
}

export async function runContinuityCheckWorkflow(takeId: string, retry = false, options: { recheckIssueId?: string | null; requestedByUserId?: string | null } = {}): Promise<AnalysisRun> {
  const inFlight = continuityRunsInFlight.get(takeId);
  if (inFlight) return inFlight;
  const latest = await getLatestAnalysisRun(takeId, "continuity_check");
  if (!retry && latest?.status === "completed") return latest;
  if (!retry && latest?.status === "analyzing") throw new Error("Continuity check is already running");
  const context = await getTakeContext(takeId);
  if (!context) throw new Error("Take not found");
  const referenceTake = await getReferenceTake(context.shot.id);
  if (!referenceTake) throw new Error("An approved reference is required before checking a take");
  const run = await createAnalysisRun({ kind: "continuity_check", sceneId: context.scene.id, shotId: context.shot.id, takeId, referenceTakeId: referenceTake.id, recheckIssueId: options.recheckIssueId ?? null, requestedByUserId: options.requestedByUserId ?? null });
  const promise = executeContinuityCheckRun(run).finally(() => continuityRunsInFlight.delete(takeId));
  continuityRunsInFlight.set(takeId, promise);
  return promise;
}

export async function getOwnedVisualStateResult(userId: string, takeId: string) {
  const context = await getOwnedTakeContext(userId, takeId);
  return context ? getVisualStateResult(takeId) : null;
}

export async function getOwnedContinuityCheckResult(userId: string, takeId: string) {
  const context = await getOwnedTakeContext(userId, takeId);
  return context ? getContinuityCheckResult(takeId) : null;
}
