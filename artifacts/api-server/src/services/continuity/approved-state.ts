import { and, desc, eq, inArray } from "drizzle-orm";
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
} from "@workspace/db";
import {
  analysisRunKinds,
  analysisRunStatuses,
  type VisualObservation,
  visualObservationSchema,
} from "@workspace/takekeeper-domain";
import {
  normalizeCategory,
  normalizeEntity,
  inferObservationVisibility,
  type ApprovedContinuityItem,
} from "./normalization";

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
    effectiveScope: string;
    effectiveFromTakeId: string;
    sourceTakeId: string;
    createdAt: Date;
  }>;
};

export type TakeContext = {
  take: typeof takesTable.$inferSelect;
  shot: typeof shotsTable.$inferSelect;
  scene: typeof scenesTable.$inferSelect;
  project: typeof projectsTable.$inferSelect;
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

export async function getOwnedTakeContext(userId: string, takeId: string) {
  const [row] = await db
    .select({ take: takesTable, shot: shotsTable, scene: scenesTable, project: projectsTable })
    .from(takesTable)
    .innerJoin(shotsTable, eq(takesTable.shotId, shotsTable.id))
    .innerJoin(scenesTable, eq(shotsTable.sceneId, scenesTable.id))
    .innerJoin(projectsTable, eq(scenesTable.projectId, projectsTable.id))
    .where(and(eq(takesTable.id, takeId), eq(projectsTable.ownerId, userId)))
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

function itemFromRow(row: typeof continuityItemsTable.$inferSelect): ApprovedContinuityItem & { updatedAt: Date } {
  return {
    id: row.id,
    category: normalizeCategory(row.category),
    entity: row.entity,
    expectedState: row.expectedState,
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

function normalizedScope(scope: string): "this_shot" | "rest_of_scene" | "from_now_on" {
  if (scope === "shot" || scope === "this_shot") return "this_shot";
  if (scope === "scene" || scope === "rest_of_scene") return "rest_of_scene";
  return "from_now_on";
}

function changeApplies(
  change: typeof continuityStateChangesTable.$inferSelect,
  current: TakeContext,
  sourceTake: { take: typeof takesTable.$inferSelect; shot: typeof shotsTable.$inferSelect } | undefined,
): boolean {
  if (!sourceTake || sourceTake.shot.sceneId !== current.scene.id) return false;
  const scope = normalizedScope(change.effectiveScope);
  if (scope === "this_shot" && sourceTake.take.shotId !== current.shot.id) return false;
  if (sourceTake.take.shotId === current.shot.id && current.take.takeNumber < sourceTake.take.takeNumber) return false;
  if (sourceTake.take.shotId !== current.shot.id && current.take.capturedAt < sourceTake.take.capturedAt) return false;
  return true;
}

export async function getApprovedChanges(sceneId: string, shotId: string, takeId: string) {
  const current = await getTakeContext(takeId);
  if (!current || current.scene.id !== sceneId || current.shot.id !== shotId) return [];
  const changes = await db
    .select()
    .from(continuityStateChangesTable)
    .where(eq(continuityStateChangesTable.sceneId, sceneId))
    .orderBy(continuityStateChangesTable.createdAt);
  const sourceTakeIds = [...new Set(changes.map((change) => change.sourceTakeId))];
  const sourceTakes = sourceTakeIds.length
    ? await db
        .select({ take: takesTable, shot: shotsTable })
        .from(takesTable)
        .innerJoin(shotsTable, eq(takesTable.shotId, shotsTable.id))
        .where(inArray(takesTable.id, sourceTakeIds))
    : [];
  const sourceTakeById = new Map(sourceTakes.map((sourceTake) => [sourceTake.take.id, sourceTake]));
  return changes.filter((change) => changeApplies(change, current, sourceTakeById.get(change.sourceTakeId))).map((change) => ({
    id: change.id,
    continuityItemId: change.continuityItemId,
    previousState: change.previousState,
    newState: change.newState,
    effectiveScope: normalizedScope(change.effectiveScope),
    effectiveFromTakeId: change.effectiveFromTakeId,
    sourceTakeId: change.sourceTakeId,
    createdAt: change.createdAt,
  }));
}

export async function resolveApprovedContinuityState(sceneId: string, shotId: string, takeId: string): Promise<ApprovedContinuityState> {
  const current = await getTakeContext(takeId);
  if (!current || current.scene.id !== sceneId || current.shot.id !== shotId) {
    throw new Error("Continuity context does not match the requested take");
  }

  const [rows, referenceTake] = await Promise.all([
    db.select().from(continuityItemsTable).where(and(eq(continuityItemsTable.sceneId, sceneId), eq(continuityItemsTable.active, true))).orderBy(continuityItemsTable.updatedAt),
    getReferenceTake(shotId),
  ]);
  const referenceRun = referenceTake ? await getLatestCompletedAnalysisRun(referenceTake.id, "visual_state") : null;
  const referenceObservations = referenceTake ? await getTakeObservations(referenceTake.id, referenceRun?.id) : [];

  const chosenByKey = new Map<string, ApprovedContinuityItem & { updatedAt: Date }>();
  for (const row of rows) {
    const item = itemFromRow(row);
    chosenByKey.set(itemKey(item.category, item.entity), chooseItem(chosenByKey.get(itemKey(item.category, item.entity)), item));
  }

  for (const observation of referenceObservations) {
    if (inferObservationVisibility(observation) !== "visible") continue;
    const key = itemKey(observation.category, observation.entity);
    const existing = chosenByKey.get(key);
    if (existing && sourcePriority(existing.sourceType) >= sourcePriority("manual")) continue;
    chosenByKey.set(key, {
      id: existing?.id ?? null,
      category: normalizeCategory(observation.category),
      entity: existing?.entity ?? observation.entity,
      expectedState: observation.observedState,
      sourceType: "reference",
      confidence: observation.confidence,
      active: true,
      sourceEvidence: existing?.sourceEvidence ?? null,
      updatedAt: existing?.updatedAt ?? new Date(0),
    });
  }

  const previousApprovedChanges = await getApprovedChanges(sceneId, shotId, takeId);
  const changesByItem = new Map<string, typeof previousApprovedChanges[number]>();
  for (const change of previousApprovedChanges) {
    const existing = changesByItem.get(change.continuityItemId);
    if (!existing || change.createdAt >= existing.createdAt) changesByItem.set(change.continuityItemId, change);
  }
  for (const item of chosenByKey.values()) {
    if (!item.id) continue;
    const change = changesByItem.get(item.id);
    if (change) {
      item.expectedState = change.newState;
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
    previousApprovedChanges,
  };
}
