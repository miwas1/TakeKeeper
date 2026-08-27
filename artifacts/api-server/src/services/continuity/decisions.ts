import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  continuityIssueEventsTable,
  continuityIssuesTable,
  continuityItemsTable,
  continuityStateChangesTable,
  db,
  projectsTable,
  scenesTable,
  shotsTable,
  takesTable,
  usersTable,
} from "@workspace/db";
import { recordAgentEvent, trackEvent } from "../analytics";
import {
  entitySimilarity,
  makeIssueKey,
  makeIssueDimensionKey,
  makeIntentionalDecisionKey,
  normalizeCategory,
  normalizeState,
} from "./normalization";
import {
  getTakeContext,
  isTakeAtOrAfter,
  normalizedScope,
  resolveApprovedContinuityState,
} from "./approved-state";

export class ContinuityDecisionError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "ContinuityDecisionError";
  }
}

export function serializeContinuityIssue(row: typeof continuityIssuesTable.$inferSelect) {
  const severity = row.severity === "critical" ? "high" : row.severity === "warning" ? "medium" : row.severity;
  const status = ["open", "fixed", "intentional", "ignored"].includes(row.status) ? row.status : "open";
  return {
    id: row.id,
    sceneId: row.sceneId,
    takeId: row.takeId,
    analysisRunId: row.analysisRunId,
    issueKey: row.issueKey ?? makeIssueKey({ category: row.category, entity: row.entity, expectedState: row.expectedState, observedState: row.observedState }),
    category: normalizeCategory(row.category),
    entity: row.entity,
    expectedState: normalizeState(row.category, row.entity, row.expectedState),
    observedState: normalizeState(row.category, row.entity, row.observedState),
    continuityItemId: row.continuityItemId,
    stateDimension: row.stateDimension?.includes("|") ? row.stateDimension : makeIssueDimensionKey(row),
    severity: ["low", "medium", "high"].includes(severity) ? severity : "medium",
    confidence: Number(row.confidence ?? 0),
    explanation: row.explanation ?? "The observed state differs from the approved continuity state.",
    suggestedFix: row.suggestedFix,
    status,
    resolution: row.resolution,
    notes: row.notes,
    resolutionTakeId: row.resolutionTakeId,
    resolvedByUserId: row.resolvedByUserId,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
  } as const;
}

export function serializeDecisionChange(change: typeof continuityStateChangesTable.$inferSelect) {
  return {
    id: change.id,
    sceneId: change.sceneId,
    continuityItemId: change.continuityItemId,
    previousState: change.previousState,
    newState: change.newState,
    effectiveScope: normalizedScope(change.effectiveScope),
    effectiveFromTakeId: change.effectiveFromTakeId,
    effectiveUntilTakeId: change.effectiveUntilTakeId,
    supersedesChangeId: change.supersedesChangeId,
    sourceTakeId: change.sourceTakeId,
    userId: change.userId,
    reason: change.reason,
    createdAt: change.createdAt.toISOString(),
  };
}

type OwnedIssue = {
  issue: typeof continuityIssuesTable.$inferSelect;
  take: typeof takesTable.$inferSelect;
  shot: typeof shotsTable.$inferSelect;
  scene: typeof scenesTable.$inferSelect;
  project: typeof projectsTable.$inferSelect;
};

function cleanNote(note: string | undefined | null): string | null {
  const value = note?.trim();
  return value ? value : null;
}

function issueDimension(issue: Pick<typeof continuityIssuesTable.$inferSelect, "category" | "entity" | "expectedState" | "observedState" | "stateDimension">): string {
  return issue.stateDimension?.includes("|") ? issue.stateDimension : makeIssueDimensionKey(issue);
}

async function getOwnedIssue(userId: string, issueId: string): Promise<OwnedIssue | null> {
  const [row] = await db
    .select({ issue: continuityIssuesTable, take: takesTable, shot: shotsTable, scene: scenesTable, project: projectsTable })
    .from(continuityIssuesTable)
    .innerJoin(takesTable, eq(continuityIssuesTable.takeId, takesTable.id))
    .innerJoin(shotsTable, eq(takesTable.shotId, shotsTable.id))
    .innerJoin(scenesTable, eq(shotsTable.sceneId, scenesTable.id))
    .innerJoin(projectsTable, eq(scenesTable.projectId, projectsTable.id))
    .where(and(eq(continuityIssuesTable.id, issueId), eq(projectsTable.ownerId, userId)))
    .limit(1);
  return row ?? null;
}

async function getIssue(issueId: string): Promise<OwnedIssue | null> {
  const [row] = await db
    .select({ issue: continuityIssuesTable, take: takesTable, shot: shotsTable, scene: scenesTable, project: projectsTable })
    .from(continuityIssuesTable)
    .innerJoin(takesTable, eq(continuityIssuesTable.takeId, takesTable.id))
    .innerJoin(shotsTable, eq(takesTable.shotId, shotsTable.id))
    .innerJoin(scenesTable, eq(shotsTable.sceneId, scenesTable.id))
    .innerJoin(projectsTable, eq(scenesTable.projectId, projectsTable.id))
    .where(eq(continuityIssuesTable.id, issueId))
    .limit(1);
  return row ?? null;
}

async function getOwnedItem(userId: string, itemId: string) {
  const [row] = await db.select({ item: continuityItemsTable, scene: scenesTable, project: projectsTable })
    .from(continuityItemsTable)
    .innerJoin(scenesTable, eq(continuityItemsTable.sceneId, scenesTable.id))
    .innerJoin(projectsTable, eq(scenesTable.projectId, projectsTable.id))
    .where(and(eq(continuityItemsTable.id, itemId), eq(projectsTable.ownerId, userId)))
    .limit(1);
  return row ?? null;
}

function issueUpdateValues(input: {
  status: "open" | "fixed" | "intentional" | "ignored";
  userId: string;
  resolution?: string | null;
  resolutionTakeId?: string | null;
  notes?: string | null;
}) {
  return {
    status: input.status,
    resolution: input.resolution ?? null,
    resolutionTakeId: input.resolutionTakeId ?? null,
    resolvedByUserId: input.userId,
    resolvedAt: new Date(),
    ...(input.notes === undefined ? {} : { notes: input.notes }),
    updatedAt: new Date(),
  };
}

async function writeIssueEvent(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], input: {
  issueId: string;
  eventType: string;
  status?: string | null;
  note?: string | null;
  resolution?: string | null;
  resolutionTakeId?: string | null;
  userId?: string | null;
  metadata?: Record<string, unknown> | null;
}) {
  await tx.insert(continuityIssueEventsTable).values({
    issueId: input.issueId,
    eventType: input.eventType,
    status: input.status ?? null,
    note: input.note ?? null,
    resolution: input.resolution ?? null,
    resolutionTakeId: input.resolutionTakeId ?? null,
    userId: input.userId ?? null,
    metadataJson: input.metadata ?? null,
  });
}

async function trackDecisionEvents(input: {
  projectId: string;
  issueId: string;
  action: string;
  eventName?: "issue_fixed" | "issue_marked_intentional" | "issue_ignored" | "issue_note_added";
  metadata?: Record<string, unknown>;
}) {
  await recordAgentEvent({
    projectId: input.projectId,
    agent: "continuity-supervisor",
    action: input.action,
    toolName: "ContinuityDecisionWorkflow",
    status: "completed",
    metadata: { issueId: input.issueId, ...input.metadata },
  });
  if (input.eventName) await trackEvent({ projectId: input.projectId, name: input.eventName, metadata: { issueId: input.issueId, ...input.metadata } });
}

export async function ignoreIssue(userId: string, issueId: string, note?: string) {
  const row = await getOwnedIssue(userId, issueId);
  if (!row) throw new ContinuityDecisionError("ISSUE_NOT_FOUND", "Continuity issue not found");
  const cleanedNote = cleanNote(note);
  const result = await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(continuityIssuesTable).where(eq(continuityIssuesTable.id, issueId)).for("update");
    if (!locked) throw new ContinuityDecisionError("ISSUE_NOT_FOUND", "Continuity issue not found");
    if (locked.status === "ignored" && !cleanedNote) return { issue: locked, changed: false };
    if (locked.status !== "open" && locked.status !== "ignored") {
      throw new ContinuityDecisionError("ISSUE_ALREADY_RESOLVED", "This continuity issue already has a decision");
    }
    const nextNotes = cleanedNote ?? locked.notes;
    await tx.update(continuityIssuesTable).set(issueUpdateValues({
      status: "ignored",
      userId,
      resolution: "Ignored by filmmaker",
      notes: nextNotes,
    })).where(eq(continuityIssuesTable.id, issueId));
    await writeIssueEvent(tx, {
      issueId,
      eventType: "status_changed",
      status: "ignored",
      note: cleanedNote,
      resolution: "Ignored by filmmaker",
      userId,
    });
    const [updated] = await tx.select().from(continuityIssuesTable).where(eq(continuityIssuesTable.id, issueId));
    return { issue: updated ?? locked, changed: true };
  });
  if (result.changed) await trackDecisionEvents({ projectId: row.project.id, issueId, action: "ContinuitySupervisor → resolve_issue", eventName: "issue_ignored", metadata: { status: "ignored" } });
  return result.issue;
}

export async function addIssueNote(userId: string, issueId: string, note: string) {
  const row = await getOwnedIssue(userId, issueId);
  if (!row) throw new ContinuityDecisionError("ISSUE_NOT_FOUND", "Continuity issue not found");
  const cleanedNote = cleanNote(note);
  if (!cleanedNote) throw new ContinuityDecisionError("NOTE_REQUIRED", "Add a short note before saving");
  const result = await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(continuityIssuesTable).where(eq(continuityIssuesTable.id, issueId)).for("update");
    if (!locked) throw new ContinuityDecisionError("ISSUE_NOT_FOUND", "Continuity issue not found");
    await tx.update(continuityIssuesTable).set({ notes: cleanedNote, updatedAt: new Date() }).where(eq(continuityIssuesTable.id, issueId));
    await writeIssueEvent(tx, { issueId, eventType: "note_added", note: cleanedNote, status: locked.status, userId });
    const [updated] = await tx.select().from(continuityIssuesTable).where(eq(continuityIssuesTable.id, issueId));
    return updated ?? locked;
  });
  await trackDecisionEvents({ projectId: row.project.id, issueId, action: "ContinuitySupervisor → add_issue_note", eventName: "issue_note_added", metadata: { status: result.status } });
  return result;
}

async function findOrCreateContinuityItem(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], row: OwnedIssue) {
  if (row.issue.continuityItemId) {
    const [item] = await tx.select().from(continuityItemsTable).where(eq(continuityItemsTable.id, row.issue.continuityItemId)).for("update");
    if (item) return item;
  }
  const items = await tx.select().from(continuityItemsTable).where(eq(continuityItemsTable.sceneId, row.scene.id)).for("update");
  const matching = items.find((item) => normalizeCategory(item.category) === normalizeCategory(row.issue.category) && entitySimilarity(item.entity, row.issue.entity) >= 0.66);
  if (matching) return matching;
  const [created] = await tx.insert(continuityItemsTable).values({
    sceneId: row.scene.id,
    category: normalizeCategory(row.issue.category),
    entity: row.issue.entity,
    expectedState: normalizeState(row.issue.category, row.issue.entity, row.issue.expectedState),
    sourceType: "manual",
    confidence: Number(row.issue.confidence ?? 0).toFixed(4),
    sourceEvidence: "Approved from a filmmaker continuity decision",
  }).returning();
  if (!created) throw new ContinuityDecisionError("ITEM_NOT_CREATED", "The continuity item could not be created");
  return created;
}

export type IntentionalChangeInput = {
  newState?: string;
  effectiveScope: "this_shot" | "rest_of_scene" | "from_now_on" | "shot" | "scene" | "future";
  sourceTakeId?: string;
  effectiveFromTakeId?: string;
  effectiveUntilTakeId?: string | null;
  note?: string;
  idempotencyKey?: string;
};

export async function approveIntentionalChange(userId: string, issueId: string, input: IntentionalChangeInput) {
  const row = await getOwnedIssue(userId, issueId);
  if (!row) throw new ContinuityDecisionError("ISSUE_NOT_FOUND", "Continuity issue not found");
  const sourceTakeId = input.sourceTakeId ?? row.issue.takeId;
  const sourceTake = await getTakeContext(sourceTakeId);
  if (!sourceTake || sourceTake.scene.id !== row.scene.id) throw new ContinuityDecisionError("TAKE_NOT_IN_SCENE", "The source take must belong to this scene");
  const effectiveFromTakeId = input.effectiveFromTakeId ?? sourceTake.take.id;
  const effectiveFrom = await getTakeContext(effectiveFromTakeId);
  if (!effectiveFrom || effectiveFrom.scene.id !== row.scene.id) throw new ContinuityDecisionError("EFFECTIVE_TAKE_NOT_IN_SCENE", "The effective starting take must belong to this scene");
  const effectiveScope = normalizedScope(input.effectiveScope);
  if (effectiveScope === "this_shot" && effectiveFrom.shot.id !== row.shot.id) throw new ContinuityDecisionError("SHOT_SCOPE_MISMATCH", "A shot-only change must start in the issue's shot");
  let effectiveUntilTakeId = input.effectiveUntilTakeId ?? null;
  if (effectiveUntilTakeId) {
    const effectiveUntil = await getTakeContext(effectiveUntilTakeId);
    if (!effectiveUntil || effectiveUntil.scene.id !== row.scene.id) throw new ContinuityDecisionError("EFFECTIVE_END_NOT_IN_SCENE", "The ending take must belong to this scene");
    if (effectiveScope === "this_shot" && effectiveUntil.shot.id !== effectiveFrom.shot.id) throw new ContinuityDecisionError("SHOT_SCOPE_MISMATCH", "A shot-only change must end in the same shot");
    if (!await isTakeAtOrAfter(row.scene.id, effectiveFromTakeId, effectiveUntilTakeId)) throw new ContinuityDecisionError("INVALID_EFFECTIVE_RANGE", "The ending take must not come before the starting take");
  }
  const newState = normalizeState(row.issue.category, row.issue.entity, input.newState ?? row.issue.observedState);
  const resolved = await resolveApprovedContinuityState(row.scene.id, sourceTake.shot.id, sourceTake.take.id);
  const resolvedItem = resolved.items.find((item) => item.id === row.issue.continuityItemId || (
    normalizeCategory(item.category) === normalizeCategory(row.issue.category) && entitySimilarity(item.entity, row.issue.entity) >= 0.66
  ));
  const previousState = normalizeState(row.issue.category, row.issue.entity, resolvedItem?.expectedState ?? row.issue.expectedState);
  const decisionKey = input.idempotencyKey?.trim() || makeIntentionalDecisionKey({
    sceneId: row.scene.id,
    category: row.issue.category,
    entity: row.issue.entity,
    sourceTakeId,
    effectiveFromTakeId,
    effectiveUntilTakeId,
    effectiveScope,
    newState,
  });
  const reason = cleanNote(input.note) ?? "Intentional change approved by filmmaker";
  const result = await db.transaction(async (tx) => {
    const [lockedIssue] = await tx.select().from(continuityIssuesTable).where(eq(continuityIssuesTable.id, issueId)).for("update");
    if (!lockedIssue) throw new ContinuityDecisionError("ISSUE_NOT_FOUND", "Continuity issue not found");
    const [idempotentChange] = await tx.select().from(continuityStateChangesTable).where(eq(continuityStateChangesTable.decisionKey, decisionKey)).limit(1);
    if (idempotentChange) {
      return { change: idempotentChange, issue: lockedIssue, created: false };
    }
    if (lockedIssue.status !== "open") throw new ContinuityDecisionError("ISSUE_ALREADY_RESOLVED", "This continuity issue already has a decision");
    const item = await findOrCreateContinuityItem(tx, row);
    if (lockedIssue.continuityItemId !== item.id) {
      await tx.update(continuityIssuesTable).set({ continuityItemId: item.id, updatedAt: new Date() }).where(eq(continuityIssuesTable.id, issueId));
    }
    const [latestChange] = await tx.select().from(continuityStateChangesTable)
      .where(and(eq(continuityStateChangesTable.sceneId, row.scene.id), eq(continuityStateChangesTable.continuityItemId, item.id)))
      .orderBy(desc(continuityStateChangesTable.createdAt), desc(continuityStateChangesTable.id))
      .limit(1);
    const nextPreviousState = latestChange
      ? normalizeState(row.issue.category, row.issue.entity, latestChange.newState)
      : previousState;
    const inserted = await tx.insert(continuityStateChangesTable).values({
      sceneId: row.scene.id,
      continuityItemId: item.id,
      previousState: nextPreviousState,
      newState,
      effectiveScope,
      effectiveFromTakeId,
      effectiveUntilTakeId,
      supersedesChangeId: latestChange?.id ?? resolvedItem?.appliedChangeId ?? null,
      sourceTakeId,
      userId,
      reason,
      decisionKey,
    }).onConflictDoNothing({ target: continuityStateChangesTable.decisionKey }).returning();
    const change = inserted[0] ?? (await tx.select().from(continuityStateChangesTable).where(eq(continuityStateChangesTable.decisionKey, decisionKey)).limit(1))[0];
    if (!change) throw new ContinuityDecisionError("STATE_CHANGE_NOT_SAVED", "The continuity update could not be saved");
    const resolution = `Intentional change approved (${effectiveScope.replaceAll("_", " ")})`;
    const nextNotes = cleanNote(input.note) ?? lockedIssue.notes;
    await tx.update(continuityIssuesTable).set({
      ...issueUpdateValues({ status: "intentional", userId, resolution, resolutionTakeId: sourceTakeId, notes: nextNotes }),
      continuityItemId: item.id,
    }).where(eq(continuityIssuesTable.id, issueId));
    await writeIssueEvent(tx, {
      issueId,
      eventType: "status_changed",
      status: "intentional",
      note: cleanNote(input.note),
      resolution,
      resolutionTakeId: sourceTakeId,
      userId,
      metadata: { stateChangeId: change.id, effectiveScope, newState },
    });
    const [updatedIssue] = await tx.select().from(continuityIssuesTable).where(eq(continuityIssuesTable.id, issueId));
    return { change, issue: updatedIssue ?? lockedIssue, created: true };
  });
  if (result.created) {
    await trackDecisionEvents({
      projectId: row.project.id,
      issueId,
      action: "ContinuitySupervisor → approve_state_change",
      eventName: "issue_marked_intentional",
      metadata: { stateChangeId: result.change.id, effectiveScope, newState },
    });
    await recordAgentEvent({
      projectId: row.project.id,
      agent: "continuity-state",
      action: "ContinuityState → approved_change",
      toolName: "resolveApprovedContinuityState",
      status: "completed",
      metadata: { stateChangeId: result.change.id, continuityItemId: result.change.continuityItemId, effectiveScope },
    });
  }
  return result;
}

export async function approveContinuityItemChange(userId: string, itemId: string, input: IntentionalChangeInput) {
  const row = await getOwnedItem(userId, itemId);
  if (!row) throw new ContinuityDecisionError("ITEM_NOT_FOUND", "Continuity item not found");
  const sourceTakeId = input.sourceTakeId;
  if (!sourceTakeId) throw new ContinuityDecisionError("SOURCE_TAKE_REQUIRED", "Choose the take that introduced this state");
  const sourceTake = await getTakeContext(sourceTakeId);
  if (!sourceTake || sourceTake.scene.id !== row.scene.id) throw new ContinuityDecisionError("TAKE_NOT_IN_SCENE", "The source take must belong to this scene");
  const effectiveFromTakeId = input.effectiveFromTakeId ?? sourceTake.take.id;
  const effectiveFrom = await getTakeContext(effectiveFromTakeId);
  if (!effectiveFrom || effectiveFrom.scene.id !== row.scene.id) throw new ContinuityDecisionError("EFFECTIVE_TAKE_NOT_IN_SCENE", "The effective starting take must belong to this scene");
  const effectiveScope = normalizedScope(input.effectiveScope);
  if (effectiveScope === "this_shot" && effectiveFrom.shot.id !== sourceTake.shot.id) throw new ContinuityDecisionError("SHOT_SCOPE_MISMATCH", "A shot-only change must start in the source shot");
  const effectiveUntilTakeId = input.effectiveUntilTakeId ?? null;
  if (effectiveUntilTakeId) {
    const effectiveUntil = await getTakeContext(effectiveUntilTakeId);
    if (!effectiveUntil || effectiveUntil.scene.id !== row.scene.id) throw new ContinuityDecisionError("EFFECTIVE_END_NOT_IN_SCENE", "The ending take must belong to this scene");
    if (effectiveScope === "this_shot" && effectiveUntil.shot.id !== effectiveFrom.shot.id) throw new ContinuityDecisionError("SHOT_SCOPE_MISMATCH", "A shot-only change must end in the same shot");
    if (!await isTakeAtOrAfter(row.scene.id, effectiveFromTakeId, effectiveUntilTakeId)) throw new ContinuityDecisionError("INVALID_EFFECTIVE_RANGE", "The ending take must not come before the starting take");
  }
  const newState = normalizeState(row.item.category, row.item.entity, input.newState ?? row.item.expectedState);
  const resolved = await resolveApprovedContinuityState(row.scene.id, sourceTake.shot.id, sourceTake.take.id);
  const resolvedItem = resolved.items.find((item) => item.id === row.item.id);
  const previousState = normalizeState(row.item.category, row.item.entity, resolvedItem?.expectedState ?? row.item.expectedState);
  const decisionKey = input.idempotencyKey?.trim() || [
    "item-change",
    row.item.id,
    makeIntentionalDecisionKey({
      sceneId: row.scene.id,
      category: row.item.category,
      entity: row.item.entity,
      sourceTakeId,
      effectiveFromTakeId,
      effectiveUntilTakeId,
      effectiveScope,
      newState,
    }),
  ].join(":");
  const reason = cleanNote(input.note) ?? "Continuity state approved by filmmaker";
  const result = await db.transaction(async (tx) => {
    await tx.select().from(continuityItemsTable).where(eq(continuityItemsTable.id, row.item.id)).for("update");
    const [existingChange] = await tx.select().from(continuityStateChangesTable).where(eq(continuityStateChangesTable.decisionKey, decisionKey)).limit(1);
    if (existingChange) return { change: existingChange, created: false };
    const [latestChange] = await tx.select().from(continuityStateChangesTable)
      .where(and(eq(continuityStateChangesTable.sceneId, row.scene.id), eq(continuityStateChangesTable.continuityItemId, row.item.id)))
      .orderBy(desc(continuityStateChangesTable.createdAt), desc(continuityStateChangesTable.id))
      .limit(1);
    const nextPreviousState = latestChange
      ? normalizeState(row.item.category, row.item.entity, latestChange.newState)
      : previousState;
    const inserted = await tx.insert(continuityStateChangesTable).values({
      sceneId: row.scene.id,
      continuityItemId: row.item.id,
      previousState: nextPreviousState,
      newState,
      effectiveScope,
      effectiveFromTakeId,
      effectiveUntilTakeId,
      supersedesChangeId: latestChange?.id ?? resolvedItem?.appliedChangeId ?? null,
      sourceTakeId,
      userId,
      reason,
      decisionKey,
    }).onConflictDoNothing({ target: continuityStateChangesTable.decisionKey }).returning();
    const change = inserted[0] ?? (await tx.select().from(continuityStateChangesTable).where(eq(continuityStateChangesTable.decisionKey, decisionKey)).limit(1))[0];
    if (!change) throw new ContinuityDecisionError("STATE_CHANGE_NOT_SAVED", "The continuity update could not be saved");
    return { change, created: true };
  });
  if (result.created) {
    await recordAgentEvent({ projectId: row.project.id, agent: "continuity-supervisor", action: "ContinuitySupervisor → approve_state_change", toolName: "ContinuityDecisionWorkflow", status: "completed", metadata: { stateChangeId: result.change.id, continuityItemId: row.item.id, effectiveScope } });
    await trackEvent({ projectId: row.project.id, name: "continuity_state_change_approved", metadata: { stateChangeId: result.change.id, continuityItemId: row.item.id, effectiveScope } });
  }
  return { ...result, item: row.item };
}

function matchesRecheckIssue(previous: typeof continuityIssuesTable.$inferSelect, current: typeof continuityIssuesTable.$inferSelect) {
  return normalizeCategory(previous.category) === normalizeCategory(current.category)
    && entitySimilarity(previous.entity, current.entity) >= 0.66
    && issueDimension(previous) === issueDimension(current);
}

export async function markIssueFixedAfterRecheck(input: { issueId: string; takeId: string; analysisRunId: string; userId: string }) {
  const previous = await getIssue(input.issueId);
  if (!previous) return null;
  const resolvingTake = await getTakeContext(input.takeId);
  if (!resolvingTake || resolvingTake.scene.id !== previous.scene.id || resolvingTake.shot.id !== previous.shot.id || resolvingTake.take.id === previous.take.id) {
    throw new ContinuityDecisionError("RECHECK_SHOT_MISMATCH", "A recheck must use a different take from the same shot");
  }
  const currentIssues = await db.select().from(continuityIssuesTable).where(eq(continuityIssuesTable.analysisRunId, input.analysisRunId));
  const stillPresent = currentIssues.some((current) => current.status === "open" && matchesRecheckIssue(previous.issue, current));
  if (stillPresent) return { fixed: false, issue: previous.issue };
  const result = await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(continuityIssuesTable).where(eq(continuityIssuesTable.id, input.issueId)).for("update");
    if (!locked || locked.status !== "open") return { fixed: false, issue: locked ?? previous.issue };
    const resolution = "Resolved by a successful recheck";
    await tx.update(continuityIssuesTable).set(issueUpdateValues({ status: "fixed", userId: input.userId, resolution, resolutionTakeId: input.takeId })).where(eq(continuityIssuesTable.id, input.issueId));
    await writeIssueEvent(tx, {
      issueId: input.issueId,
      eventType: "status_changed",
      status: "fixed",
      resolution,
      resolutionTakeId: input.takeId,
      userId: input.userId,
      metadata: { analysisRunId: input.analysisRunId },
    });
    const [updated] = await tx.select().from(continuityIssuesTable).where(eq(continuityIssuesTable.id, input.issueId));
    return { fixed: true, issue: updated ?? locked };
  });
  if (result.fixed) {
    await trackDecisionEvents({ projectId: previous.project.id, issueId: input.issueId, action: "ContinuitySupervisor → resolve_issue", eventName: "issue_fixed", metadata: { resolutionTakeId: input.takeId, analysisRunId: input.analysisRunId } });
  }
  return result;
}

export async function getIssueHistory(userId: string, issueId: string) {
  const row = await getOwnedIssue(userId, issueId);
  if (!row) throw new ContinuityDecisionError("ISSUE_NOT_FOUND", "Continuity issue not found");
  const events = await db.select().from(continuityIssueEventsTable).where(eq(continuityIssueEventsTable.issueId, issueId)).orderBy(asc(continuityIssueEventsTable.createdAt), asc(continuityIssueEventsTable.id));
  const userIds = [...new Set(events.map((event) => event.userId).filter((id): id is string => Boolean(id)))];
  const users = userIds.length ? await db.select({ id: usersTable.id, displayName: usersTable.displayName }).from(usersTable).where(inArray(usersTable.id, userIds)) : [];
  const userById = new Map(users.map((user) => [user.id, user.displayName]));
  return {
    issue: serializeContinuityIssue(row.issue),
    events: events.map((event) => ({
      id: event.id,
      issueId: event.issueId,
      eventType: event.eventType,
      status: event.status,
      note: event.note,
      resolution: event.resolution,
      resolutionTakeId: event.resolutionTakeId,
      userId: event.userId,
      userDisplayName: event.userId ? userById.get(event.userId) ?? null : null,
      metadata: event.metadataJson,
      createdAt: event.createdAt,
    })),
  };
}

export async function getContinuityHistory(userId: string, sceneId: string, itemId?: string) {
  const [scene] = await db.select({ scene: scenesTable, project: projectsTable }).from(scenesTable).innerJoin(projectsTable, eq(scenesTable.projectId, projectsTable.id)).where(and(eq(scenesTable.id, sceneId), eq(projectsTable.ownerId, userId))).limit(1);
  if (!scene) throw new ContinuityDecisionError("SCENE_NOT_FOUND", "Scene not found");
  const where = itemId
    ? and(eq(continuityStateChangesTable.sceneId, sceneId), eq(continuityStateChangesTable.continuityItemId, itemId))
    : eq(continuityStateChangesTable.sceneId, sceneId);
  const changes = await db.select({ change: continuityStateChangesTable, item: continuityItemsTable, sourceTake: takesTable, sourceShot: shotsTable })
    .from(continuityStateChangesTable)
    .innerJoin(continuityItemsTable, eq(continuityStateChangesTable.continuityItemId, continuityItemsTable.id))
    .innerJoin(takesTable, eq(continuityStateChangesTable.sourceTakeId, takesTable.id))
    .innerJoin(shotsTable, eq(takesTable.shotId, shotsTable.id))
    .where(where)
    .orderBy(desc(continuityStateChangesTable.createdAt), desc(continuityStateChangesTable.id));
  const userIds = [...new Set(changes.map(({ change }) => change.userId))];
  const users = userIds.length ? await db.select({ id: usersTable.id, displayName: usersTable.displayName }).from(usersTable).where(inArray(usersTable.id, userIds)) : [];
  const userById = new Map(users.map((user) => [user.id, user.displayName]));
  return changes.map(({ change, item, sourceTake, sourceShot }) => ({
    id: change.id,
    sceneId: change.sceneId,
    continuityItemId: change.continuityItemId,
    entity: item.entity,
    category: normalizeCategory(item.category),
    previousState: normalizeState(item.category, item.entity, change.previousState),
    newState: normalizeState(item.category, item.entity, change.newState),
    effectiveScope: normalizedScope(change.effectiveScope),
    effectiveFromTakeId: change.effectiveFromTakeId,
    effectiveUntilTakeId: change.effectiveUntilTakeId,
    supersedesChangeId: change.supersedesChangeId,
    sourceTakeId: change.sourceTakeId,
    sourceTakeNumber: sourceTake.takeNumber,
    shotId: sourceShot.id,
    shotLabel: sourceShot.label,
    userId: change.userId,
    userDisplayName: userById.get(change.userId) ?? null,
    reason: change.reason,
    createdAt: change.createdAt,
  }));
}
