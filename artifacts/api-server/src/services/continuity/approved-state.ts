import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  continuityAnalysisRunsTable,
  continuityItemsTable,
  continuityStateChangesTable,
  db,
  observationsTable,
  projectsTable,
  scenesTable,
  shotsTable,
  takesTable,
  usersTable,
} from "@workspace/db";
import {
  analysisRunKinds,
  analysisRunStatuses,
  type VisualObservation,
  visualObservationSchema,
} from "@workspace/takekeeper-domain";
import {
  areStatesEquivalent,
  effectiveScopeApplies,
  normalizeCategory,
  normalizeEntity,
  normalizeState,
  inferObservationVisibility,
  type ApprovedContinuityItem,
} from "./normalization";
import { projectAccessCondition, type ProjectCapability } from "../authorization";

export type ApprovedContinuityState = {
  sceneId: string;
  shotId: string;
  takeId: string;
  referenceTakeId: string | null;
  items: ApprovedContinuityItem[];
  scriptRequirements: ApprovedContinuityItem[];
  referenceObservations: VisualObservation[];
  previousApprovedChanges: Array<{
    id: string;
    continuityItemId: string;
    previousState: string;
    newState: string;
    effectiveScope: "this_shot" | "rest_of_scene" | "from_now_on";
    effectiveFromTakeId: string;
    effectiveUntilTakeId: string | null;
    supersedesChangeId: string | null;
    sourceTakeId: string;
    userId: string;
    reason: string | null;
    createdAt: Date;
  }>;
};

export type TakeContext = {
  take: typeof takesTable.$inferSelect;
  shot: typeof shotsTable.$inferSelect;
  scene: typeof scenesTable.$inferSelect;
  project: typeof projectsTable.$inferSelect;
};

export type ApprovedChange = {
  id: string;
  sceneId: string;
  continuityItemId: string;
  previousState: string;
  newState: string;
  effectiveScope: "this_shot" | "rest_of_scene" | "from_now_on";
  effectiveFromTakeId: string;
  effectiveUntilTakeId: string | null;
  supersedesChangeId: string | null;
  sourceTakeId: string;
  userId: string;
  reason: string | null;
  createdAt: Date;
};

type SceneTake = {
  take: typeof takesTable.$inferSelect;
  shot: typeof shotsTable.$inferSelect;
};

function numeric(value: string | number | null): number | null {
  return value === null ? null : Number(value);
}

function parseStoredObservation(row: typeof observationsTable.$inferSelect): VisualObservation | null {
  const parsed = visualObservationSchema.safeParse({
    category: normalizeCategory(row.category),
    entity: row.entity,
    observedState: row.observedState,
    confidence: numeric(row.confidence) ?? 0,
    visibility: row.visibility,
    region: row.regionJson,
  });
  return parsed.success ? parsed.data : null;
}

export async function getTakeContext(takeId: string): Promise<TakeContext | null> {
  const [row] = await db
    .select({ take: takesTable, shot: shotsTable, scene: scenesTable, project: projectsTable })
    .from(takesTable)
    .innerJoin(shotsTable, eq(takesTable.shotId, shotsTable.id))
    .innerJoin(scenesTable, eq(shotsTable.sceneId, scenesTable.id))
    .innerJoin(projectsTable, eq(scenesTable.projectId, projectsTable.id))
    .where(eq(takesTable.id, takeId))
    .limit(1);
  return row ?? null;
}

export async function getOwnedTakeContext(userId: string, takeId: string, capability: ProjectCapability = "read") {
  const [row] = await db
    .select({ take: takesTable, shot: shotsTable, scene: scenesTable, project: projectsTable })
    .from(takesTable)
    .innerJoin(shotsTable, eq(takesTable.shotId, shotsTable.id))
    .innerJoin(scenesTable, eq(shotsTable.sceneId, scenesTable.id))
    .innerJoin(projectsTable, eq(scenesTable.projectId, projectsTable.id))
    .where(and(eq(takesTable.id, takeId), projectAccessCondition(userId, capability)))
    .limit(1);
  return row ?? null;
}

export async function getLatestAnalysisRun(takeId: string, kind: (typeof analysisRunKinds)[number]) {
  const [run] = await db
    .select()
    .from(continuityAnalysisRunsTable)
    .where(and(
      eq(continuityAnalysisRunsTable.takeId, takeId),
      eq(continuityAnalysisRunsTable.kind, kind),
    ))
    .orderBy(desc(continuityAnalysisRunsTable.createdAt))
    .limit(1);
  return run ?? null;
}

export async function getLatestCompletedAnalysisRun(takeId: string, kind: (typeof analysisRunKinds)[number]) {
  const [run] = await db
    .select()
    .from(continuityAnalysisRunsTable)
    .where(and(
      eq(continuityAnalysisRunsTable.takeId, takeId),
      eq(continuityAnalysisRunsTable.kind, kind),
      eq(continuityAnalysisRunsTable.status, "completed" satisfies (typeof analysisRunStatuses)[number]),
    ))
    .orderBy(desc(continuityAnalysisRunsTable.createdAt))
    .limit(1);
  return run ?? null;
}

export async function getTakeObservations(takeId: string, analysisRunId?: string | null): Promise<VisualObservation[]> {
  const rows = await db
    .select()
    .from(observationsTable)
    .where(analysisRunId
      ? and(eq(observationsTable.takeId, takeId), eq(observationsTable.analysisRunId, analysisRunId))
      : eq(observationsTable.takeId, takeId))
    .orderBy(desc(observationsTable.createdAt));
  const observations = rows.map(parseStoredObservation).filter((observation): observation is VisualObservation => Boolean(observation));
  const seen = new Set<string>();
  return observations.filter((observation) => {
    const key = `${normalizeCategory(observation.category)}|${normalizeEntity(observation.entity)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function getReferenceTake(shotId: string) {
  const [take] = await db
    .select()
    .from(takesTable)
    .where(and(eq(takesTable.shotId, shotId), eq(takesTable.isReference, true)))
    .orderBy(desc(takesTable.updatedAt))
    .limit(1);
  return take ?? null;
}

function sourcePriority(sourceType: string): number {
  switch (sourceType) {
    case "manual": return 5;
    case "approved_change": return 4;
    case "reference": return 3;
    case "script": return 2;
    case "agent": return 1;
    default: return 0;
  }
}

function itemKey(category: string, entity: string): string {
  return `${normalizeCategory(category)}|${normalizeEntity(entity)}`;
}

export function normalizedScope(scope: string): "this_shot" | "rest_of_scene" | "from_now_on" {
  if (scope === "shot" || scope === "this_shot") return "this_shot";
  if (scope === "scene" || scope === "rest_of_scene") return "rest_of_scene";
  return "from_now_on";
}

function itemFromRow(row: typeof continuityItemsTable.$inferSelect): ApprovedContinuityItem & { updatedAt: Date } {
  const category = normalizeCategory(row.category);
  const originalState = normalizeState(category, row.entity, row.expectedState);
  return {
    id: row.id,
    category,
    entity: row.entity,
    expectedState: originalState,
    originalState,
    sourceType: row.sourceType,
    confidence: numeric(row.confidence),
    active: row.active,
    sourceEvidence: row.sourceEvidence,
    updatedAt: row.updatedAt,
  };
}

function chooseItem(current: (ApprovedContinuityItem & { updatedAt: Date }) | undefined, next: ApprovedContinuityItem & { updatedAt: Date }) {
  if (!current) return next;
  const priorityDifference = sourcePriority(next.sourceType) - sourcePriority(current.sourceType);
  if (priorityDifference > 0 || (priorityDifference === 0 && next.updatedAt >= current.updatedAt)) return next;
  return current;
}

async function getSceneTakes(sceneId: string): Promise<SceneTake[]> {
  return db
    .select({ take: takesTable, shot: shotsTable })
    .from(takesTable)
    .innerJoin(shotsTable, eq(takesTable.shotId, shotsTable.id))
    .where(eq(shotsTable.sceneId, sceneId))
    .orderBy(
      asc(shotsTable.createdAt),
      asc(shotsTable.id),
      asc(takesTable.takeNumber),
      asc(takesTable.createdAt),
      asc(takesTable.id),
  );
}

export async function isTakeAtOrAfter(sceneId: string, effectiveFromTakeId: string, effectiveUntilTakeId: string): Promise<boolean> {
  const sceneTakes = await getSceneTakes(sceneId);
  const order = new Map(sceneTakes.map((entry, index) => [entry.take.id, index]));
  const fromOrder = order.get(effectiveFromTakeId);
  const untilOrder = order.get(effectiveUntilTakeId);
  return fromOrder !== undefined && untilOrder !== undefined && untilOrder >= fromOrder;
}

function compareTakeOrder(left: SceneTake, right: SceneTake, shotOrder: Map<string, number>): number {
  const shotDifference = (shotOrder.get(left.shot.id) ?? Number.MAX_SAFE_INTEGER) - (shotOrder.get(right.shot.id) ?? Number.MAX_SAFE_INTEGER);
  if (shotDifference !== 0) return shotDifference;
  if (left.take.takeNumber !== right.take.takeNumber) return left.take.takeNumber - right.take.takeNumber;
  const capturedDifference = left.take.capturedAt.getTime() - right.take.capturedAt.getTime();
  if (capturedDifference !== 0) return capturedDifference;
  return left.take.id.localeCompare(right.take.id);
}

function changeApplies(
  change: typeof continuityStateChangesTable.$inferSelect,
  current: SceneTake,
  takeById: Map<string, SceneTake>,
  takeOrder: Map<string, number>,
): boolean {
  const effectiveFrom = takeById.get(change.effectiveFromTakeId) ?? takeById.get(change.sourceTakeId);
  if (!effectiveFrom || effectiveFrom.shot.sceneId !== current.shot.sceneId) return false;
  return effectiveScopeApplies({
    scope: change.effectiveScope,
    changeSceneId: effectiveFrom.shot.sceneId,
    currentSceneId: current.shot.sceneId,
    effectiveFromShotId: effectiveFrom.shot.id,
    currentShotId: current.shot.id,
    currentOrder: takeOrder.get(current.take.id) ?? Number.MAX_SAFE_INTEGER,
    effectiveFromOrder: takeOrder.get(effectiveFrom.take.id) ?? Number.MAX_SAFE_INTEGER,
    effectiveUntilOrder: change.effectiveUntilTakeId ? takeOrder.get(change.effectiveUntilTakeId) ?? null : null,
  });
}

async function getApplicableChangeRows(sceneId: string, takeId: string) {
  const [current, changes, sceneTakes] = await Promise.all([
    getTakeContext(takeId),
    db.select().from(continuityStateChangesTable).where(eq(continuityStateChangesTable.sceneId, sceneId)).orderBy(asc(continuityStateChangesTable.createdAt), asc(continuityStateChangesTable.id)),
    getSceneTakes(sceneId),
  ]);
  if (!current || current.scene.id !== sceneId) return { current: null, changes: [], allChanges: changes, sceneTakes };
  const takeById = new Map(sceneTakes.map((entry) => [entry.take.id, entry]));
  const shotOrder = new Map<string, number>();
  const takeOrder = new Map<string, number>();
  sceneTakes.forEach((entry) => {
    if (!shotOrder.has(entry.shot.id)) shotOrder.set(entry.shot.id, shotOrder.size);
  });
  sceneTakes.forEach((entry, index) => takeOrder.set(entry.take.id, index));
  const currentEntry = takeById.get(takeId);
  if (!currentEntry) return { current, changes: [], allChanges: changes, sceneTakes };
  const applicable = changes
    .filter((change) => changeApplies(change, currentEntry, takeById, takeOrder))
    .sort((left, right) => {
      const leftFrom = takeById.get(left.effectiveFromTakeId) ?? takeById.get(left.sourceTakeId);
      const rightFrom = takeById.get(right.effectiveFromTakeId) ?? takeById.get(right.sourceTakeId);
      if (leftFrom && rightFrom) {
        const orderDifference = compareTakeOrder(leftFrom, rightFrom, shotOrder);
        if (orderDifference !== 0) return orderDifference;
      }
      const createdDifference = left.createdAt.getTime() - right.createdAt.getTime();
      return createdDifference || left.id.localeCompare(right.id);
    });
  return { current, changes: applicable, allChanges: changes, sceneTakes };
}

function toApprovedChange(change: typeof continuityStateChangesTable.$inferSelect): ApprovedChange {
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
    createdAt: change.createdAt,
  };
}

export async function getApprovedChanges(sceneId: string, shotId: string, takeId: string): Promise<ApprovedChange[]> {
  const result = await getApplicableChangeRows(sceneId, takeId);
  if (!result.current || result.current.shot.id !== shotId) return [];
  return result.changes.map(toApprovedChange);
}

function recoverLegacyOriginalState(item: ApprovedContinuityItem & { updatedAt: Date }, changes: ApprovedChange[]) {
  if (changes.length === 0 || !item.id) return item;
  const itemChanges = changes.filter((change) => change.continuityItemId === item.id);
  const lastChange = itemChanges.at(-1);
  if (lastChange && areStatesEquivalent(item.category, item.entity, item.expectedState, lastChange.newState)) {
    item.originalState = lastChange.previousState;
    item.expectedState = lastChange.previousState;
  }
  return item;
}

export async function resolveApprovedContinuityState(sceneId: string, shotId: string, takeId: string): Promise<ApprovedContinuityState> {
  const current = await getTakeContext(takeId);
  if (!current || current.scene.id !== sceneId || current.shot.id !== shotId) {
    throw new Error("Continuity context does not match the requested take");
  }

  const [rows, referenceTake, applicableResult] = await Promise.all([
    db.select().from(continuityItemsTable).where(and(eq(continuityItemsTable.sceneId, sceneId), eq(continuityItemsTable.active, true))).orderBy(asc(continuityItemsTable.updatedAt), asc(continuityItemsTable.id)),
    getReferenceTake(shotId),
    getApplicableChangeRows(sceneId, takeId),
  ]);
  const referenceRun = referenceTake ? await getLatestCompletedAnalysisRun(referenceTake.id, "visual_state") : null;
  const referenceObservations = referenceTake ? await getTakeObservations(referenceTake.id, referenceRun?.id) : [];
  const applicableChanges = applicableResult.changes.map(toApprovedChange);

  const allChangesForItem = new Map<string, ApprovedChange[]>();
  for (const change of applicableResult.allChanges.map(toApprovedChange)) {
    const existing = allChangesForItem.get(change.continuityItemId) ?? [];
    existing.push(change);
    allChangesForItem.set(change.continuityItemId, existing);
  }

  const chosenByKey = new Map<string, ApprovedContinuityItem & { updatedAt: Date }>();
  for (const row of rows) {
    const item = recoverLegacyOriginalState(itemFromRow(row), allChangesForItem.get(row.id) ?? []);
    const key = itemKey(item.category, item.entity);
    chosenByKey.set(key, chooseItem(chosenByKey.get(key), item));
  }

  for (const observation of referenceObservations) {
    if (inferObservationVisibility(observation) !== "visible") continue;
    const category = normalizeCategory(observation.category);
    const key = itemKey(category, observation.entity);
    const existing = chosenByKey.get(key);
    if (existing && sourcePriority(existing.sourceType) >= sourcePriority("manual")) continue;
    const referenceState = normalizeState(category, observation.entity, observation.observedState);
    chosenByKey.set(key, {
      id: existing?.id ?? null,
      category,
      entity: existing?.entity ?? observation.entity,
      expectedState: referenceState,
      originalState: existing?.originalState ?? referenceState,
      sourceType: "reference",
      confidence: observation.confidence,
      active: true,
      sourceEvidence: existing?.sourceEvidence ?? null,
      updatedAt: existing?.updatedAt ?? new Date(0),
    });
  }

  const changesByItem = new Map<string, ApprovedChange>();
  for (const change of applicableChanges) {
    const existing = changesByItem.get(change.continuityItemId);
    if (!existing || change.createdAt >= existing.createdAt) changesByItem.set(change.continuityItemId, change);
  }
  for (const item of chosenByKey.values()) {
    if (!item.id) continue;
    const change = changesByItem.get(item.id);
    if (change) {
      item.expectedState = normalizeState(item.category, item.entity, change.newState);
      item.sourceType = "approved_change";
      item.appliedChangeId = change.id;
    }
  }

  const items = [...chosenByKey.values()].map(({ updatedAt: _updatedAt, ...item }) => item);
  return {
    sceneId,
    shotId,
    takeId,
    referenceTakeId: referenceTake?.id ?? null,
    items,
    scriptRequirements: items.filter((item) => item.sourceType === "script"),
    referenceObservations,
    previousApprovedChanges: applicableChanges.map((change) => ({
      id: change.id,
      continuityItemId: change.continuityItemId,
      previousState: change.previousState,
      newState: change.newState,
      effectiveScope: change.effectiveScope,
      effectiveFromTakeId: change.effectiveFromTakeId,
      effectiveUntilTakeId: change.effectiveUntilTakeId,
      supersedesChangeId: change.supersedesChangeId,
      sourceTakeId: change.sourceTakeId,
      userId: change.userId,
      reason: change.reason,
      createdAt: change.createdAt,
    })),
  };
}

export async function getContinuityOverview(sceneId: string) {
  const [rows, changes, sceneTakes] = await Promise.all([
    db.select().from(continuityItemsTable).where(and(eq(continuityItemsTable.sceneId, sceneId), eq(continuityItemsTable.active, true))).orderBy(asc(continuityItemsTable.category), asc(continuityItemsTable.entity)),
    db.select().from(continuityStateChangesTable).where(eq(continuityStateChangesTable.sceneId, sceneId)).orderBy(asc(continuityStateChangesTable.createdAt), asc(continuityStateChangesTable.id)),
    getSceneTakes(sceneId),
  ]);
  const sourceTakeIds = [...new Set(changes.map((change) => change.sourceTakeId))];
  const sourceTakes = sourceTakeIds.length
    ? await db.select({ take: takesTable, shot: shotsTable }).from(takesTable).innerJoin(shotsTable, eq(takesTable.shotId, shotsTable.id)).where(inArray(takesTable.id, sourceTakeIds))
    : [];
  const userIds = [...new Set(changes.map((change) => change.userId))];
  const userRows = userIds.length ? await db.select({ id: usersTable.id, displayName: usersTable.displayName }).from(usersTable).where(inArray(usersTable.id, userIds)) : [];
  const takeById = new Map(sourceTakes.map((entry) => [entry.take.id, entry.take]));
  const sceneTakeById = new Map(sceneTakes.map((entry) => [entry.take.id, entry]));
  const shotOrder = new Map<string, number>();
  sceneTakes.forEach((entry) => {
    if (!shotOrder.has(entry.shot.id)) shotOrder.set(entry.shot.id, shotOrder.size);
  });
  const userById = new Map(userRows.map((user) => [user.id, user.displayName]));

  return rows.map((row) => {
    const itemChanges = changes.filter((change) => change.continuityItemId === row.id);
    const firstChange = itemChanges[0];
    const effectiveChanges = [...itemChanges].sort((left, right) => {
      const leftFrom = sceneTakeById.get(left.effectiveFromTakeId) ?? sceneTakeById.get(left.sourceTakeId);
      const rightFrom = sceneTakeById.get(right.effectiveFromTakeId) ?? sceneTakeById.get(right.sourceTakeId);
      if (leftFrom && rightFrom) {
        const orderDifference = compareTakeOrder(leftFrom, rightFrom, shotOrder);
        if (orderDifference !== 0) return orderDifference;
      }
      const createdDifference = left.createdAt.getTime() - right.createdAt.getTime();
      return createdDifference || left.id.localeCompare(right.id);
    });
    const lastChange = effectiveChanges.at(-1);
    const baseState = normalizeState(row.category, row.entity, firstChange ? firstChange.previousState : row.expectedState);
    const currentApprovedState = normalizeState(row.category, row.entity, lastChange?.newState ?? row.expectedState);
    return {
      id: row.id,
      sceneId: row.sceneId,
      category: normalizeCategory(row.category),
      entity: row.entity,
      expectedState: baseState,
      originalState: baseState,
      currentApprovedState,
      sourceType: row.sourceType,
      confidence: numeric(row.confidence),
      active: row.active,
      updatedAt: row.updatedAt,
      lastChange: lastChange ? {
        id: lastChange.id,
        newState: normalizeState(row.category, row.entity, lastChange.newState),
        effectiveScope: normalizedScope(lastChange.effectiveScope),
        sourceTakeId: lastChange.sourceTakeId,
        sourceTakeNumber: takeById.get(lastChange.sourceTakeId)?.takeNumber ?? null,
        userId: lastChange.userId,
        userDisplayName: userById.get(lastChange.userId) ?? null,
        reason: lastChange.reason,
        createdAt: lastChange.createdAt,
      } : null,
    };
  });
}
