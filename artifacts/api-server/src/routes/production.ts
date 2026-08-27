import { Router, type IRouter } from "express";
import { and, count, desc, eq, inArray, isNull, max, or } from "drizzle-orm";
import { z } from "zod";
import {
  continuityIssuesTable,
  continuityItemsTable,
  continuityStateChangesTable,
  db,
  mediaTable,
  mediaUploadReservationsTable,
  projectsTable,
  scenesTable,
  shotsTable,
  takesTable,
} from "@workspace/db";
import { trackEvent } from "../services/analytics";
import { mediaStorage } from "../services/storage";
import { approveContinuityItemChange, ContinuityDecisionError } from "../services/continuity/decisions";
import { getContinuityOverview, resolveApprovedContinuityState } from "../services/continuity/approved-state";
import { normalizeCategory, normalizeState } from "../services/continuity/normalization";
import { projectAccessCondition, type ProjectCapability } from "../services/authorization";

const router: IRouter = Router();
const idSchema = z.string().uuid();

const sceneInput = z.object({
  sceneNumber: z.string().min(1).max(20).optional(),
  slugline: z.string().min(1).max(200).optional(),
  location: z.string().max(160).optional(),
  intExt: z.string().max(20).optional(),
  timeOfDay: z.string().max(40).optional(),
  storyDay: z.string().max(40).optional(),
  scriptText: z.string().max(100000).optional(),
});

const shotInput = z.object({
  label: z.string().min(1).max(40),
  description: z.string().max(500).optional(),
  notes: z.string().max(2000).optional(),
});

const shotUpdate = shotInput.partial().extend({
  status: z.enum(["planned", "active", "complete"]).optional(),
});

const takeInput = z.object({
  notes: z.string().max(2000).optional(),
  isReference: z.boolean().optional().default(false),
  mediaId: idSchema.optional(),
  submissionKey: z.string().min(1).max(120).optional(),
});

const takeUpdate = z.object({
  status: z.enum(["unrated", "hold", "circle", "reject", "captured"]).optional(),
  notes: z.string().max(2000).optional(),
  isReference: z.boolean().optional(),
  isCircle: z.boolean().optional(),
});

const continuityInput = z.object({
  category: z.enum(["wardrobe", "props", "hair_makeup", "blocking", "set", "action", "other"]),
  entity: z.string().min(1).max(160),
  expectedState: z.string().min(1).max(1000),
  sourceType: z.enum(["manual", "script", "reference", "agent"]).optional().default("manual"),
  confidence: z.number().min(0).max(1).optional(),
});

const continuityUpdate = continuityInput.partial().extend({ active: z.boolean().optional() });

async function ownedScene(userId: string, sceneId: string, capability: ProjectCapability = "read") {
  const [row] = await db
    .select({ scene: scenesTable, project: projectsTable })
    .from(scenesTable)
    .innerJoin(projectsTable, eq(scenesTable.projectId, projectsTable.id))
    .where(and(eq(scenesTable.id, sceneId), projectAccessCondition(userId, capability)))
    .limit(1);
  return row;
}

async function ownedShot(userId: string, shotId: string, capability: ProjectCapability = "read") {
  const [row] = await db
    .select({ shot: shotsTable, scene: scenesTable, project: projectsTable })
    .from(shotsTable)
    .innerJoin(scenesTable, eq(shotsTable.sceneId, scenesTable.id))
    .innerJoin(projectsTable, eq(scenesTable.projectId, projectsTable.id))
    .where(and(eq(shotsTable.id, shotId), projectAccessCondition(userId, capability)))
    .limit(1);
  return row;
}

async function ownedTake(userId: string, takeId: string, capability: ProjectCapability = "read") {
  const [row] = await db
    .select({ take: takesTable, shot: shotsTable, scene: scenesTable, project: projectsTable })
    .from(takesTable)
    .innerJoin(shotsTable, eq(takesTable.shotId, shotsTable.id))
    .innerJoin(scenesTable, eq(shotsTable.sceneId, scenesTable.id))
    .innerJoin(projectsTable, eq(scenesTable.projectId, projectsTable.id))
    .where(and(eq(takesTable.id, takeId), projectAccessCondition(userId, capability)))
    .limit(1);
  return row;
}

async function ownedContinuityItem(userId: string, itemId: string, capability: ProjectCapability = "read") {
  const [row] = await db
    .select({ item: continuityItemsTable, scene: scenesTable, project: projectsTable })
    .from(continuityItemsTable)
    .innerJoin(scenesTable, eq(continuityItemsTable.sceneId, scenesTable.id))
    .innerJoin(projectsTable, eq(scenesTable.projectId, projectsTable.id))
    .where(and(eq(continuityItemsTable.id, itemId), projectAccessCondition(userId, capability)))
    .limit(1);
  return row;
}

async function continuityResponse(sceneId: string) {
  return getContinuityOverview(sceneId);
}

async function continuityItemResponse(sceneId: string, itemId: string) {
  const item = (await getContinuityOverview(sceneId)).find((candidate) => candidate.id === itemId);
  if (item) return item;
  const [row] = await db.select().from(continuityItemsTable).where(and(eq(continuityItemsTable.id, itemId), eq(continuityItemsTable.sceneId, sceneId))).limit(1);
  if (!row) return null;
  const baseState = normalizeState(row.category, row.entity, row.expectedState);
  return {
    id: row.id,
    sceneId: row.sceneId,
    category: normalizeCategory(row.category),
    entity: row.entity,
    expectedState: baseState,
    originalState: baseState,
    currentApprovedState: baseState,
    lastChange: null,
    sourceType: row.sourceType,
    confidence: row.confidence === null ? null : Number(row.confidence),
    active: row.active,
    updatedAt: row.updatedAt,
  };
}

async function takeResponse(take: typeof takesTable.$inferSelect) {
  const [{ value: issueCount }] = await db
    .select({ value: count() })
    .from(continuityIssuesTable)
    .where(eq(continuityIssuesTable.takeId, take.id));
  const [media] = await db.select().from(mediaTable).where(eq(mediaTable.takeId, take.id)).limit(1);
  const { circleContinuitySnapshotJson, ...takeFields } = take;
  return {
    ...takeFields,
    referenceStatus: take.isReference ? "active" : take.referenceStatus,
    circleContinuitySnapshot: circleContinuitySnapshotJson,
    issueCount,
    mediaUrl: media ? `/api/storage/objects/${media.storageKey}` : null,
  };
}

async function shotResponse(shot: typeof shotsTable.$inferSelect) {
  const takes = await db.select().from(takesTable).where(eq(takesTable.shotId, shot.id));
  const takeIds = takes.map((take) => take.id);
  const issueCount = takeIds.length
    ? await db
        .select({ value: count() })
        .from(continuityIssuesTable)
        .where(inArray(continuityIssuesTable.takeId, takeIds))
        .then(([row]) => row.value)
    : 0;
  return {
    ...shot,
    takeCount: takes.length,
    issueCount,
    referenceTakeId: takes.find((take) => take.isReference)?.id ?? null,
  };
}

async function sceneResponse(scene: typeof scenesTable.$inferSelect) {
  const [shotCount, continuityCount] = await Promise.all([
    db.select({ value: count() }).from(shotsTable).where(eq(shotsTable.sceneId, scene.id)).then(([row]) => row.value),
    db.select({ value: count() }).from(continuityItemsTable).where(and(eq(continuityItemsTable.sceneId, scene.id), eq(continuityItemsTable.active, true))).then(([row]) => row.value),
  ]);
  return { ...scene, shotCount, continuityCount };
}

router.get("/scenes/:sceneId", async (req, res): Promise<void> => {
  const parsed = idSchema.safeParse(req.params.sceneId);
  if (!parsed.success) return void res.status(400).json({ error: "Invalid scene id" });
  const row = await ownedScene(res.locals.userId as string, parsed.data);
  if (!row) return void res.status(404).json({ error: "Scene not found" });
  const [scene, continuity, shots] = await Promise.all([
    sceneResponse(row.scene),
    continuityResponse(row.scene.id),
    db.select().from(shotsTable).where(eq(shotsTable.sceneId, row.scene.id)).orderBy(shotsTable.createdAt),
  ]);
  res.json({ scene, continuity, shots: await Promise.all(shots.map(shotResponse)) });
});

router.patch("/scenes/:sceneId", async (req, res): Promise<void> => {
  const sceneId = idSchema.safeParse(req.params.sceneId);
  const body = sceneInput.safeParse(req.body);
  if (!sceneId.success || !body.success) return void res.status(400).json({ error: "Invalid scene update" });
  const row = await ownedScene(res.locals.userId as string, sceneId.data, "write");
  if (!row) return void res.status(404).json({ error: "Scene not found" });
  const [updated] = await db.update(scenesTable).set({ ...body.data, updatedAt: new Date() }).where(eq(scenesTable.id, row.scene.id)).returning();
  res.json(await sceneResponse(updated));
});

router.get("/scenes/:sceneId/shots", async (req, res): Promise<void> => {
  const sceneId = idSchema.safeParse(req.params.sceneId);
  if (!sceneId.success) return void res.status(400).json({ error: "Invalid scene id" });
  const row = await ownedScene(res.locals.userId as string, sceneId.data);
  if (!row) return void res.status(404).json({ error: "Scene not found" });
  const shots = await db.select().from(shotsTable).where(eq(shotsTable.sceneId, row.scene.id)).orderBy(shotsTable.createdAt);
  res.json(await Promise.all(shots.map(shotResponse)));
});

router.post("/scenes/:sceneId/shots", async (req, res): Promise<void> => {
  const sceneId = idSchema.safeParse(req.params.sceneId);
  const body = shotInput.safeParse(req.body);
  if (!sceneId.success || !body.success) return void res.status(400).json({ error: "Invalid shot" });
  const row = await ownedScene(res.locals.userId as string, sceneId.data, "write");
  if (!row) return void res.status(404).json({ error: "Scene not found" });
  const [shot] = await db.insert(shotsTable).values({ sceneId: row.scene.id, ...body.data }).returning();
  await trackEvent({ projectId: row.project.id, name: "shot_created", metadata: { sceneId: row.scene.id, shotId: shot.id, label: shot.label } });
  res.status(201).json(await shotResponse(shot));
});

router.get("/shots/:shotId", async (req, res): Promise<void> => {
  const shotId = idSchema.safeParse(req.params.shotId);
  if (!shotId.success) return void res.status(400).json({ error: "Invalid shot id" });
  const row = await ownedShot(res.locals.userId as string, shotId.data);
  if (!row) return void res.status(404).json({ error: "Shot not found" });
  const takes = await db.select().from(takesTable).where(eq(takesTable.shotId, row.shot.id)).orderBy(desc(takesTable.takeNumber));
  res.json({
    shot: await shotResponse(row.shot),
    scene: await sceneResponse(row.scene),
    takes: await Promise.all(takes.map(takeResponse)),
  });
});

router.patch("/shots/:shotId", async (req, res): Promise<void> => {
  const shotId = idSchema.safeParse(req.params.shotId);
  const body = shotUpdate.safeParse(req.body);
  if (!shotId.success || !body.success) return void res.status(400).json({ error: "Invalid shot update" });
  const row = await ownedShot(res.locals.userId as string, shotId.data, "write");
  if (!row) return void res.status(404).json({ error: "Shot not found" });
  const [updated] = await db.update(shotsTable).set({ ...body.data, updatedAt: new Date() }).where(eq(shotsTable.id, row.shot.id)).returning();
  await trackEvent({ projectId: row.project.id, name: "shot_updated", metadata: { shotId: updated.id } });
  res.json(await shotResponse(updated));
});

router.delete("/shots/:shotId", async (req, res): Promise<void> => {
  const shotId = idSchema.safeParse(req.params.shotId);
  if (!shotId.success) return void res.status(400).json({ error: "Invalid shot id" });
  const row = await ownedShot(res.locals.userId as string, shotId.data, "manage");
  if (!row) return void res.status(404).json({ error: "Shot not found" });
  const shotTakes = await db.select({ id: takesTable.id }).from(takesTable).where(eq(takesTable.shotId, row.shot.id));
  const shotTakeIds = shotTakes.map((take) => take.id);
  if (shotTakeIds.length) {
    const [protectedChange] = await db
      .select({ id: continuityStateChangesTable.id })
      .from(continuityStateChangesTable)
      .where(or(
        inArray(continuityStateChangesTable.sourceTakeId, shotTakeIds),
        inArray(continuityStateChangesTable.effectiveFromTakeId, shotTakeIds),
        inArray(continuityStateChangesTable.effectiveUntilTakeId, shotTakeIds),
      ))
      .limit(1);
    if (protectedChange) {
      return void res.status(409).json({ error: "This shot is referenced by continuity history and cannot be deleted", code: "CONTINUITY_HISTORY_PROTECTED" });
    }
  }
  const shotMedia = shotTakeIds.length ? await db.select().from(mediaTable).where(inArray(mediaTable.takeId, shotTakeIds)) : [];
  try {
    await Promise.all(shotMedia.map((media) => mediaStorage.delete(media.storageKey)));
  } catch (error) {
    req.log.error({ error, shotId: row.shot.id }, "Storage cleanup blocked shot deletion");
    return void res.status(503).json({ error: "Shot media could not be removed. No records were deleted.", code: "STORAGE_DELETE_FAILED" });
  }
  if (shotMedia.length) await db.delete(mediaTable).where(inArray(mediaTable.id, shotMedia.map((media) => media.id)));
  await db.delete(shotsTable).where(eq(shotsTable.id, row.shot.id));
  res.status(204).end();
});

router.get("/shots/:shotId/takes", async (req, res): Promise<void> => {
  const shotId = idSchema.safeParse(req.params.shotId);
  if (!shotId.success) return void res.status(400).json({ error: "Invalid shot id" });
  const row = await ownedShot(res.locals.userId as string, shotId.data);
  if (!row) return void res.status(404).json({ error: "Shot not found" });
  const takes = await db.select().from(takesTable).where(eq(takesTable.shotId, row.shot.id)).orderBy(desc(takesTable.takeNumber));
  res.json(await Promise.all(takes.map(takeResponse)));
});

router.post("/shots/:shotId/takes", async (req, res): Promise<void> => {
  const shotId = idSchema.safeParse(req.params.shotId);
  const body = takeInput.safeParse(req.body);
  if (!shotId.success || !body.success) return void res.status(400).json({ error: "Invalid take" });
  const row = await ownedShot(res.locals.userId as string, shotId.data, "write");
  if (!row) return void res.status(404).json({ error: "Shot not found" });
  const result = await db.transaction(async (tx) => {
    // Lock the shot row so concurrent submissions for the same shot cannot
    // choose the same next number.
    const [lockedShot] = await tx
      .select({ id: shotsTable.id })
      .from(shotsTable)
      .where(eq(shotsTable.id, row.shot.id))
      .for("update");
    if (!lockedShot) return { kind: "missing" as const };

    if (body.data.submissionKey) {
      const [existing] = await tx
        .select()
        .from(takesTable)
        .where(and(
          eq(takesTable.shotId, row.shot.id),
          eq(takesTable.submissionKey, body.data.submissionKey),
        ))
        .limit(1);
      if (existing) return { kind: "existing" as const, take: existing };
    }

    if (body.data.mediaId) {
      const [media] = await tx
        .select({ id: mediaTable.id })
        .from(mediaTable)
        .where(and(
          eq(mediaTable.id, body.data.mediaId),
          eq(mediaTable.projectId, row.project.id),
          eq(mediaTable.sceneId, row.scene.id),
          isNull(mediaTable.takeId),
        ))
        .limit(1)
        .for("update");
      if (!media) return { kind: "invalid-media" as const };
    }

    const [{ value: currentMax }] = await tx
      .select({ value: max(takesTable.takeNumber) })
      .from(takesTable)
      .where(eq(takesTable.shotId, row.shot.id));
    const [activeReference] = await tx
      .select({ id: takesTable.id })
      .from(takesTable)
      .where(and(eq(takesTable.shotId, row.shot.id), eq(takesTable.isReference, true)))
      .limit(1);
    if (body.data.isReference) {
      await tx.update(takesTable).set({ isReference: false, referenceStatus: "superseded" }).where(eq(takesTable.shotId, row.shot.id));
    }
    const [take] = await tx.insert(takesTable).values({
      shotId: row.shot.id,
      takeNumber: Number(currentMax ?? 0) + 1,
      status: "unrated",
      notes: body.data.notes,
      isReference: body.data.isReference,
      referenceStatus: body.data.isReference ? "active" : "none",
      submissionKey: body.data.submissionKey,
    }).returning();
    if (body.data.mediaId) {
      await tx.update(mediaTable).set({ takeId: take.id }).where(and(
        eq(mediaTable.id, body.data.mediaId),
        eq(mediaTable.projectId, row.project.id),
        eq(mediaTable.sceneId, row.scene.id),
        isNull(mediaTable.takeId),
      ));
    }
    return {
      kind: "created" as const,
      take,
      replacedReference: body.data.isReference && Boolean(activeReference),
      previousReferenceTakeId: body.data.isReference ? activeReference?.id ?? null : null,
    };
  });
  if (result.kind === "missing") return void res.status(404).json({ error: "Shot not found" });
  if (result.kind === "invalid-media") {
    return void res.status(400).json({
      error: "Media is missing, belongs to another scene, or is already attached",
      code: "INVALID_TAKE_MEDIA",
    });
  }
  const take = result.take;
  if (result.kind === "existing") return void res.status(200).json(await takeResponse(take));
  await trackEvent({
    projectId: row.project.id,
    name: result.replacedReference ? "reference_replaced" : body.data.isReference ? "reference_captured" : "take_created",
    metadata: { sceneId: row.scene.id, shotId: row.shot.id, takeId: take.id, takeNumber: take.takeNumber, previousReferenceTakeId: result.previousReferenceTakeId },
  });
  res.status(201).json(await takeResponse(take));
});

router.patch("/takes/:takeId", async (req, res): Promise<void> => {
  const takeId = idSchema.safeParse(req.params.takeId);
  const body = takeUpdate.safeParse(req.body);
  if (!takeId.success || !body.success) return void res.status(400).json({ error: "Invalid take update" });
  const row = await ownedTake(res.locals.userId as string, takeId.data, "write");
  if (!row) return void res.status(404).json({ error: "Take not found" });
  const nextIsReference = body.data.isReference ?? row.take.isReference;
  const nextIsCircle = body.data.status ? body.data.status === "circle" : body.data.isCircle ?? row.take.isCircle;
  const nextStatus = body.data.status ?? (body.data.isCircle === undefined ? row.take.status : nextIsCircle ? "circle" : "unrated");
  const result = await db.transaction(async (tx) => {
    await tx.select({ id: shotsTable.id }).from(shotsTable).where(eq(shotsTable.id, row.shot.id)).for("update");
    const [activeReference] = await tx
      .select({ id: takesTable.id })
      .from(takesTable)
      .where(and(eq(takesTable.shotId, row.shot.id), eq(takesTable.isReference, true)))
      .limit(1);
    if (nextIsReference) {
      await tx.update(takesTable).set({ isReference: false, referenceStatus: "superseded" }).where(eq(takesTable.shotId, row.shot.id));
    }
    const [updated] = await tx
      .update(takesTable)
      .set({
        notes: body.data.notes,
        isReference: nextIsReference,
        referenceStatus: nextIsReference ? "active" : row.take.isReference || row.take.referenceStatus === "active" ? "superseded" : row.take.referenceStatus,
        isCircle: nextIsCircle,
        status: nextStatus,
        updatedAt: new Date(),
      })
      .where(eq(takesTable.id, row.take.id))
      .returning();
    return {
      updated,
      replacedReference: nextIsReference && Boolean(activeReference && activeReference.id !== row.take.id),
      previousReferenceTakeId: activeReference && activeReference.id !== row.take.id ? activeReference.id : null,
    };
  });
  if (body.data.isReference === true && result.replacedReference) {
    await trackEvent({
      projectId: row.project.id,
      name: "reference_replaced",
      metadata: { sceneId: row.scene.id, shotId: row.shot.id, takeId: result.updated.id, previousReferenceTakeId: result.previousReferenceTakeId },
    });
  }
  if (body.data.status !== undefined || body.data.isCircle !== undefined) {
    await trackEvent({
      projectId: row.project.id,
      name: result.updated.isCircle && !row.take.isCircle ? "take_circled" : result.updated.status === "reject" ? "take_rejected" : "take_status_updated",
      metadata: { sceneId: row.scene.id, shotId: row.shot.id, takeId: result.updated.id, takeNumber: result.updated.takeNumber, status: result.updated.status },
    });
  }
  let updated = result.updated;
  if (updated.isCircle && (!row.take.isCircle || !updated.circleContinuitySnapshotJson)) {
    try {
      const approvedState = await resolveApprovedContinuityState(row.scene.id, row.shot.id, updated.id);
      const [marked] = await db.update(takesTable).set({
        circleMarkedAt: new Date(),
        circleMarkedByUserId: res.locals.userId as string,
        circleContinuitySnapshotJson: {
          sceneId: approvedState.sceneId,
          shotId: approvedState.shotId,
          takeId: approvedState.takeId,
          referenceTakeId: approvedState.referenceTakeId,
          items: approvedState.items.map((item) => ({
            id: item.id,
            category: item.category,
            entity: item.entity,
            originalState: item.originalState ?? item.expectedState,
            approvedState: item.expectedState,
            sourceType: item.sourceType,
            confidence: item.confidence,
            appliedChangeId: item.appliedChangeId ?? null,
          })),
          capturedAt: new Date().toISOString(),
        },
        updatedAt: new Date(),
      }).where(eq(takesTable.id, updated.id)).returning();
      if (marked) updated = marked;
    } catch (error) {
      req.log.warn({ error, takeId: updated.id }, "Circle saved without a continuity snapshot");
    }
  }
  res.json(await takeResponse(updated));
});

router.delete("/takes/:takeId", async (req, res): Promise<void> => {
  const takeId = idSchema.safeParse(req.params.takeId);
  if (!takeId.success) return void res.status(400).json({ error: "Invalid take id" });
  const row = await ownedTake(res.locals.userId as string, takeId.data, "manage");
  if (!row) return void res.status(404).json({ error: "Take not found" });

  const [protectedChange] = await db
    .select({ id: continuityStateChangesTable.id })
    .from(continuityStateChangesTable)
    .where(or(
      eq(continuityStateChangesTable.sourceTakeId, row.take.id),
      eq(continuityStateChangesTable.effectiveFromTakeId, row.take.id),
      eq(continuityStateChangesTable.effectiveUntilTakeId, row.take.id),
    ))
    .limit(1);
  if (protectedChange) {
    return void res.status(409).json({ error: "This take is referenced by continuity history and cannot be deleted", code: "CONTINUITY_HISTORY_PROTECTED" });
  }

  const media = await db.select().from(mediaTable).where(eq(mediaTable.takeId, row.take.id));
  try {
    await Promise.all(media.map((item) => mediaStorage.delete(item.storageKey)));
  } catch (error) {
    req.log.error({ error, takeId: row.take.id }, "Storage cleanup blocked take deletion");
    return void res.status(503).json({ error: "Take media could not be removed. Nothing was deleted.", code: "STORAGE_DELETE_FAILED" });
  }

  await db.transaction(async (tx) => {
    if (media.length) await tx.delete(mediaTable).where(inArray(mediaTable.id, media.map((item) => item.id)));
    await tx.delete(takesTable).where(eq(takesTable.id, row.take.id));
  });
  await trackEvent({
    projectId: row.project.id,
    name: "take_deleted",
    metadata: { sceneId: row.scene.id, shotId: row.shot.id, takeId: row.take.id, takeNumber: row.take.takeNumber },
  });
  res.status(204).end();
});

router.get("/scenes/:sceneId/continuity", async (req, res): Promise<void> => {
  const sceneId = idSchema.safeParse(req.params.sceneId);
  if (!sceneId.success) return void res.status(400).json({ error: "Invalid scene id" });
  const row = await ownedScene(res.locals.userId as string, sceneId.data);
  if (!row) return void res.status(404).json({ error: "Scene not found" });
  res.json(await continuityResponse(row.scene.id));
});

router.post("/scenes/:sceneId/continuity", async (req, res): Promise<void> => {
  const sceneId = idSchema.safeParse(req.params.sceneId);
  const body = continuityInput.safeParse(req.body);
  if (!sceneId.success || !body.success) return void res.status(400).json({ error: "Invalid continuity item" });
  const row = await ownedScene(res.locals.userId as string, sceneId.data, "write");
  if (!row) return void res.status(404).json({ error: "Scene not found" });
  const [item] = await db.insert(continuityItemsTable).values({
    sceneId: row.scene.id,
    ...body.data,
    confidence: body.data.confidence?.toFixed(4),
  }).returning();
  await trackEvent({ projectId: row.project.id, name: "continuity_item_created", metadata: { sceneId: row.scene.id, itemId: item.id } });
  res.status(201).json(await continuityItemResponse(row.scene.id, item.id));
});

router.patch("/continuity/:itemId", async (req, res): Promise<void> => {
  const itemId = idSchema.safeParse(req.params.itemId);
  const body = continuityUpdate.safeParse(req.body);
  if (!itemId.success || !body.success) return void res.status(400).json({ error: "Invalid continuity update" });
  const row = await ownedContinuityItem(res.locals.userId as string, itemId.data, "write");
  if (!row) return void res.status(404).json({ error: "Continuity item not found" });
  const values = {
    ...body.data,
    confidence: body.data.confidence === undefined ? undefined : body.data.confidence.toFixed(4),
    updatedAt: new Date(),
  };
  const [item] = await db.update(continuityItemsTable).set(values).where(eq(continuityItemsTable.id, row.item.id)).returning();
  await trackEvent({ projectId: row.project.id, name: "continuity_item_updated", metadata: { itemId: item.id } });
  res.json(await continuityItemResponse(row.scene.id, item.id));
});

router.delete("/continuity/:itemId", async (req, res): Promise<void> => {
  const itemId = idSchema.safeParse(req.params.itemId);
  if (!itemId.success) return void res.status(400).json({ error: "Invalid continuity item id" });
  const row = await ownedContinuityItem(res.locals.userId as string, itemId.data, "manage");
  if (!row) return void res.status(404).json({ error: "Continuity item not found" });
  const [protectedChange] = await db
    .select({ id: continuityStateChangesTable.id })
    .from(continuityStateChangesTable)
    .where(eq(continuityStateChangesTable.continuityItemId, row.item.id))
    .limit(1);
  if (protectedChange) {
    return void res.status(409).json({ error: "This continuity item has approved history and cannot be deleted", code: "CONTINUITY_HISTORY_PROTECTED" });
  }
  await db.delete(continuityItemsTable).where(eq(continuityItemsTable.id, row.item.id));
  await trackEvent({ projectId: row.project.id, name: "continuity_item_deleted", metadata: { itemId: row.item.id } });
  res.status(204).end();
});

router.post("/continuity/:itemId/changes", async (req, res): Promise<void> => {
  const itemId = idSchema.safeParse(req.params.itemId);
  const body = z.object({
    newState: z.string().min(1).max(1000).optional(),
    effectiveScope: z.enum(["this_shot", "rest_of_scene", "from_now_on", "shot", "scene", "future"]),
    sourceTakeId: idSchema,
    effectiveFromTakeId: idSchema.optional(),
    effectiveUntilTakeId: idSchema.nullable().optional(),
    note: z.string().max(1000).optional(),
    idempotencyKey: z.string().min(1).max(240).optional(),
  }).safeParse(req.body);
  if (!itemId.success || !body.success) return void res.status(400).json({ error: "Invalid continuity change" });
  try {
    const result = await approveContinuityItemChange(res.locals.userId as string, itemId.data, body.data);
    const updated = await continuityItemResponse(result.item.sceneId, itemId.data);
    res.status(result.created ? 201 : 200).json(updated);
  } catch (error) {
    if (error instanceof ContinuityDecisionError) {
      const status = error.code.endsWith("NOT_FOUND") ? 404 : 409;
      res.status(status).json({ error: error.message, code: error.code });
      return;
    }
    throw error;
  }
});

router.post("/media", async (req, res): Promise<void> => {
  const body = z.object({
    projectId: idSchema,
    sceneId: idSchema.optional(),
    takeId: idSchema.optional(),
    storageKey: z.string().min(1).max(1000),
    mediaType: z.string().min(1).max(100),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
  }).strict().safeParse(req.body);
  if (!body.success) return void res.status(400).json({ error: "Invalid media metadata" });
  const [project] = await db.select().from(projectsTable).where(and(eq(projectsTable.id, body.data.projectId), projectAccessCondition(res.locals.userId as string, "write"))).limit(1);
  if (!project) return void res.status(404).json({ error: "Project not found" });
  if (body.data.sceneId) {
    const [scene] = await db.select({ id: scenesTable.id }).from(scenesTable).where(and(eq(scenesTable.id, body.data.sceneId), eq(scenesTable.projectId, project.id))).limit(1);
    if (!scene) return void res.status(404).json({ error: "Scene not found in this project", code: "SCENE_NOT_FOUND" });
  }
  if (body.data.takeId) {
    const [take] = await db
      .select({ id: takesTable.id })
      .from(takesTable)
      .innerJoin(shotsTable, eq(takesTable.shotId, shotsTable.id))
      .where(and(
        eq(takesTable.id, body.data.takeId),
        eq(shotsTable.sceneId, body.data.sceneId ?? ""),
      ))
      .limit(1);
    if (!take) return void res.status(404).json({ error: "Take not found in this scene", code: "TAKE_NOT_FOUND" });
  }

  // Registration is safe to retry after a lost response. The storage key is
  // unique, so return the already-registered record instead of creating a
  // second media row or forcing the client to start over.
  const [alreadyRegistered] = await db
    .select()
    .from(mediaTable)
    .where(and(eq(mediaTable.storageKey, body.data.storageKey), eq(mediaTable.projectId, project.id)))
    .limit(1);
  if (alreadyRegistered) {
    if (body.data.sceneId && alreadyRegistered.sceneId !== body.data.sceneId) {
      return void res.status(403).json({ error: "Media does not belong to this scene", code: "MEDIA_NOT_AUTHORIZED" });
    }
    return void res.status(200).json({ ...alreadyRegistered, mediaUrl: `/api/storage/objects/${alreadyRegistered.storageKey}` });
  }

  const [reservation] = await db
    .select()
    .from(mediaUploadReservationsTable)
    .where(and(
      eq(mediaUploadReservationsTable.storageKey, body.data.storageKey),
      eq(mediaUploadReservationsTable.projectId, project.id),
      eq(mediaUploadReservationsTable.userId, res.locals.userId as string),
    ))
    .limit(1);
  if (!reservation || reservation.consumedAt || reservation.expiresAt <= new Date()) {
    return void res.status(403).json({ error: "Upload reservation is missing, expired, or already used", code: "INVALID_UPLOAD_RESERVATION" });
  }
  if ((body.data.sceneId ?? null) !== reservation.sceneId) {
    return void res.status(403).json({ error: "Upload reservation does not match this scene", code: "INVALID_UPLOAD_RESERVATION" });
  }
  let verifiedObject: { contentType: string; size: number; width: number; height: number };
  try {
    const object = await mediaStorage.readMetadata(reservation.storageKey);
    if (object.contentType !== reservation.contentType || object.contentType !== body.data.mediaType || object.size > reservation.maxSize) {
      return void res.status(422).json({ error: "Uploaded object does not match its reservation", code: "UPLOAD_METADATA_MISMATCH" });
    }
    verifiedObject = object;
  } catch (error) {
    req.log.warn({ error, storageKey: reservation.storageKey }, "Upload verification failed");
    return void res.status(422).json({ error: "Uploaded object could not be verified", code: "UPLOAD_NOT_FOUND" });
  }
  const result = await db.transaction(async (tx) => {
    const [created] = await tx.insert(mediaTable).values({
      projectId: body.data.projectId,
      sceneId: body.data.sceneId,
      takeId: body.data.takeId,
      storageKey: body.data.storageKey,
      mediaType: body.data.mediaType,
      width: verifiedObject.width,
      height: verifiedObject.height,
    }).onConflictDoNothing({ target: mediaTable.storageKey }).returning();
    if (created) {
      await tx.update(mediaUploadReservationsTable).set({ consumedAt: new Date() }).where(eq(mediaUploadReservationsTable.id, reservation.id));
      return { media: created, created: true } as const;
    }
    const [existing] = await tx
      .select()
      .from(mediaTable)
      .where(and(eq(mediaTable.storageKey, body.data.storageKey), eq(mediaTable.projectId, project.id)))
      .limit(1);
    if (!existing) throw new Error("Media registration conflict could not be resolved");
    return { media: existing, created: false } as const;
  });
  res.status(result.created ? 201 : 200).json({ ...result.media, mediaUrl: `/api/storage/objects/${result.media.storageKey}` });
});

router.delete("/media/:mediaId", async (req, res): Promise<void> => {
  const mediaId = idSchema.safeParse(req.params.mediaId);
  if (!mediaId.success) return void res.status(400).json({ error: "Invalid media id" });
  const [media] = await db
    .select({ media: mediaTable, project: projectsTable })
    .from(mediaTable)
    .innerJoin(projectsTable, eq(mediaTable.projectId, projectsTable.id))
    .where(and(eq(mediaTable.id, mediaId.data), projectAccessCondition(res.locals.userId as string, "manage")))
    .limit(1);
  if (!media) return void res.status(404).json({ error: "Media not found", code: "MEDIA_NOT_FOUND" });
  if (media.media.takeId) {
    return void res.status(409).json({ error: "Attached media must be deleted with its take", code: "MEDIA_ATTACHED" });
  }
  try {
    await mediaStorage.delete(media.media.storageKey);
  } catch (error) {
    req.log.error({ error, mediaId: media.media.id }, "Storage cleanup blocked media deletion");
    return void res.status(503).json({ error: "Media could not be removed. Nothing was deleted.", code: "STORAGE_DELETE_FAILED" });
  }
  await db.delete(mediaTable).where(eq(mediaTable.id, media.media.id));
  res.status(204).end();
});

export default router;
