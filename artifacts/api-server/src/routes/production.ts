import { Router, type IRouter } from "express";
import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
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
});

const shotUpdate = shotInput.partial().extend({
  status: z.enum(["planned", "active", "complete"]).optional(),
});

const takeInput = z.object({
  notes: z.string().max(2000).optional(),
  isReference: z.boolean().optional().default(false),
  mediaId: idSchema.optional(),
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

async function ownedScene(userId: string, sceneId: string) {
  const [row] = await db
    .select({ scene: scenesTable, project: projectsTable })
    .from(scenesTable)
    .innerJoin(projectsTable, eq(scenesTable.projectId, projectsTable.id))
    .where(and(eq(scenesTable.id, sceneId), eq(projectsTable.ownerId, userId)))
    .limit(1);
  return row;
}

async function ownedShot(userId: string, shotId: string) {
  const [row] = await db
    .select({ shot: shotsTable, scene: scenesTable, project: projectsTable })
    .from(shotsTable)
    .innerJoin(scenesTable, eq(shotsTable.sceneId, scenesTable.id))
    .innerJoin(projectsTable, eq(scenesTable.projectId, projectsTable.id))
    .where(and(eq(shotsTable.id, shotId), eq(projectsTable.ownerId, userId)))
    .limit(1);
  return row;
}

async function ownedTake(userId: string, takeId: string) {
  const [row] = await db
    .select({ take: takesTable, shot: shotsTable, scene: scenesTable, project: projectsTable })
    .from(takesTable)
    .innerJoin(shotsTable, eq(takesTable.shotId, shotsTable.id))
    .innerJoin(scenesTable, eq(shotsTable.sceneId, scenesTable.id))
    .innerJoin(projectsTable, eq(scenesTable.projectId, projectsTable.id))
    .where(and(eq(takesTable.id, takeId), eq(projectsTable.ownerId, userId)))
    .limit(1);
  return row;
}

async function ownedContinuityItem(userId: string, itemId: string) {
  const [row] = await db
    .select({ item: continuityItemsTable, scene: scenesTable, project: projectsTable })
    .from(continuityItemsTable)
    .innerJoin(scenesTable, eq(continuityItemsTable.sceneId, scenesTable.id))
    .innerJoin(projectsTable, eq(scenesTable.projectId, projectsTable.id))
    .where(and(eq(continuityItemsTable.id, itemId), eq(projectsTable.ownerId, userId)))
    .limit(1);
  return row;
}

async function continuityResponse(sceneId: string) {
  const rows = await db
    .select()
    .from(continuityItemsTable)
    .where(and(eq(continuityItemsTable.sceneId, sceneId), eq(continuityItemsTable.active, true)))
    .orderBy(continuityItemsTable.category, continuityItemsTable.entity);
  return rows.map((item) => ({
    ...item,
    confidence: item.confidence === null ? null : Number(item.confidence),
  }));
}

async function takeResponse(take: typeof takesTable.$inferSelect) {
  const [{ value: issueCount }] = await db
    .select({ value: count() })
    .from(continuityIssuesTable)
    .where(eq(continuityIssuesTable.takeId, take.id));
  const [media] = await db.select().from(mediaTable).where(eq(mediaTable.takeId, take.id)).limit(1);
  return {
    ...take,
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
  const row = await ownedScene(res.locals.userId as string, sceneId.data);
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
  const row = await ownedScene(res.locals.userId as string, sceneId.data);
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
  const row = await ownedShot(res.locals.userId as string, shotId.data);
  if (!row) return void res.status(404).json({ error: "Shot not found" });
  const [updated] = await db.update(shotsTable).set({ ...body.data, updatedAt: new Date() }).where(eq(shotsTable.id, row.shot.id)).returning();
  await trackEvent({ projectId: row.project.id, name: "shot_updated", metadata: { shotId: updated.id } });
  res.json(await shotResponse(updated));
});

router.delete("/shots/:shotId", async (req, res): Promise<void> => {
  const shotId = idSchema.safeParse(req.params.shotId);
  if (!shotId.success) return void res.status(400).json({ error: "Invalid shot id" });
  const row = await ownedShot(res.locals.userId as string, shotId.data);
  if (!row) return void res.status(404).json({ error: "Shot not found" });
  const shotTakes = await db.select({ id: takesTable.id }).from(takesTable).where(eq(takesTable.shotId, row.shot.id));
  const shotTakeIds = shotTakes.map((take) => take.id);
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
  const row = await ownedShot(res.locals.userId as string, shotId.data);
  if (!row) return void res.status(404).json({ error: "Shot not found" });
  const [{ value: currentCount }] = await db.select({ value: count() }).from(takesTable).where(eq(takesTable.shotId, row.shot.id));
  if (body.data.isReference) {
    await db.update(takesTable).set({ isReference: false }).where(eq(takesTable.shotId, row.shot.id));
  }
  const [take] = await db.insert(takesTable).values({
    shotId: row.shot.id,
    takeNumber: currentCount + 1,
    status: "unrated",
    notes: body.data.notes,
    isReference: body.data.isReference,
  }).returning();
  if (body.data.mediaId) {
    const [media] = await db.update(mediaTable).set({ takeId: take.id }).where(and(
      eq(mediaTable.id, body.data.mediaId),
      eq(mediaTable.projectId, row.project.id),
      eq(mediaTable.sceneId, row.scene.id),
      isNull(mediaTable.takeId),
    )).returning({ id: mediaTable.id });
    if (!media) {
      await db.delete(takesTable).where(eq(takesTable.id, take.id));
      return void res.status(400).json({
        error: "Media is missing, belongs to another scene, or is already attached",
        code: "INVALID_TAKE_MEDIA",
      });
    }
  }
  await trackEvent({
    projectId: row.project.id,
    name: body.data.isReference ? "reference_captured" : "take_created",
    metadata: { sceneId: row.scene.id, shotId: row.shot.id, takeId: take.id, takeNumber: take.takeNumber },
  });
  res.status(201).json(await takeResponse(take));
});

router.patch("/takes/:takeId", async (req, res): Promise<void> => {
  const takeId = idSchema.safeParse(req.params.takeId);
  const body = takeUpdate.safeParse(req.body);
  if (!takeId.success || !body.success) return void res.status(400).json({ error: "Invalid take update" });
  const row = await ownedTake(res.locals.userId as string, takeId.data);
  if (!row) return void res.status(404).json({ error: "Take not found" });
  if (body.data.isReference) {
    await db.update(takesTable).set({ isReference: false }).where(eq(takesTable.shotId, row.shot.id));
  }
  const isCircle = body.data.status === "circle" ? true : body.data.isCircle;
  const status = isCircle ? "circle" : body.data.status;
  const [updated] = await db.update(takesTable).set({ ...body.data, isCircle, status, updatedAt: new Date() }).where(eq(takesTable.id, row.take.id)).returning();
  await trackEvent({
    projectId: row.project.id,
    name: isCircle ? "take_circled" : "take_status_updated",
    metadata: { sceneId: row.scene.id, shotId: row.shot.id, takeId: updated.id, takeNumber: updated.takeNumber, status: updated.status },
  });
  res.json(await takeResponse(updated));
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
  const row = await ownedScene(res.locals.userId as string, sceneId.data);
  if (!row) return void res.status(404).json({ error: "Scene not found" });
  const [item] = await db.insert(continuityItemsTable).values({
    sceneId: row.scene.id,
    ...body.data,
    confidence: body.data.confidence?.toFixed(4),
  }).returning();
  await trackEvent({ projectId: row.project.id, name: "continuity_item_created", metadata: { sceneId: row.scene.id, itemId: item.id } });
  res.status(201).json({ ...item, confidence: item.confidence === null ? null : Number(item.confidence) });
});

router.patch("/continuity/:itemId", async (req, res): Promise<void> => {
  const itemId = idSchema.safeParse(req.params.itemId);
  const body = continuityUpdate.safeParse(req.body);
  if (!itemId.success || !body.success) return void res.status(400).json({ error: "Invalid continuity update" });
  const row = await ownedContinuityItem(res.locals.userId as string, itemId.data);
  if (!row) return void res.status(404).json({ error: "Continuity item not found" });
  const values = {
    ...body.data,
    confidence: body.data.confidence === undefined ? undefined : body.data.confidence.toFixed(4),
    updatedAt: new Date(),
  };
  const [item] = await db.update(continuityItemsTable).set(values).where(eq(continuityItemsTable.id, row.item.id)).returning();
  await trackEvent({ projectId: row.project.id, name: "continuity_item_updated", metadata: { itemId: item.id } });
  res.json({ ...item, confidence: item.confidence === null ? null : Number(item.confidence) });
});

router.delete("/continuity/:itemId", async (req, res): Promise<void> => {
  const itemId = idSchema.safeParse(req.params.itemId);
  if (!itemId.success) return void res.status(400).json({ error: "Invalid continuity item id" });
  const row = await ownedContinuityItem(res.locals.userId as string, itemId.data);
  if (!row) return void res.status(404).json({ error: "Continuity item not found" });
  await db.delete(continuityItemsTable).where(eq(continuityItemsTable.id, row.item.id));
  await trackEvent({ projectId: row.project.id, name: "continuity_item_deleted", metadata: { itemId: row.item.id } });
  res.status(204).end();
});

router.post("/continuity/:itemId/changes", async (req, res): Promise<void> => {
  const itemId = idSchema.safeParse(req.params.itemId);
  const body = z.object({
    newState: z.string().min(1).max(1000),
    effectiveScope: z.enum(["shot", "scene", "future"]),
    sourceTakeId: idSchema,
  }).safeParse(req.body);
  if (!itemId.success || !body.success) return void res.status(400).json({ error: "Invalid continuity change" });
  const row = await ownedContinuityItem(res.locals.userId as string, itemId.data);
  const take = body.success ? await ownedTake(res.locals.userId as string, body.data.sourceTakeId) : undefined;
  if (!row || !take || take.scene.id !== row.scene.id) return void res.status(404).json({ error: "Continuity context not found" });
  await db.transaction(async (tx) => {
    await tx.insert(continuityStateChangesTable).values({
      sceneId: row.scene.id,
      continuityItemId: row.item.id,
      previousState: row.item.expectedState,
      newState: body.data.newState,
      effectiveScope: body.data.effectiveScope,
      effectiveFromTakeId: take.take.id,
      sourceTakeId: take.take.id,
      userId: res.locals.userId as string,
    });
    if (body.data.effectiveScope !== "shot") {
      await tx.update(continuityItemsTable).set({ expectedState: body.data.newState, updatedAt: new Date() }).where(eq(continuityItemsTable.id, row.item.id));
    }
  });
  await trackEvent({ projectId: row.project.id, name: "issue_marked_intentional", metadata: { itemId: row.item.id, scope: body.data.effectiveScope } });
  const [updated] = await db.select().from(continuityItemsTable).where(eq(continuityItemsTable.id, row.item.id));
  res.status(201).json({ ...updated, confidence: updated.confidence === null ? null : Number(updated.confidence) });
});

router.post("/media", async (req, res): Promise<void> => {
  const body = z.object({
    projectId: idSchema,
    sceneId: idSchema.optional(),
    storageKey: z.string().min(1).max(1000),
    mediaType: z.string().min(1).max(100),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
  }).strict().safeParse(req.body);
  if (!body.success) return void res.status(400).json({ error: "Invalid media metadata" });
  const [project] = await db.select().from(projectsTable).where(and(eq(projectsTable.id, body.data.projectId), eq(projectsTable.ownerId, res.locals.userId as string))).limit(1);
  if (!project) return void res.status(404).json({ error: "Project not found" });
  if (body.data.sceneId) {
    const [scene] = await db.select({ id: scenesTable.id }).from(scenesTable).where(and(eq(scenesTable.id, body.data.sceneId), eq(scenesTable.projectId, project.id))).limit(1);
    if (!scene) return void res.status(404).json({ error: "Scene not found in this project", code: "SCENE_NOT_FOUND" });
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
  if (body.data.sceneId && reservation.sceneId !== body.data.sceneId) {
    return void res.status(403).json({ error: "Upload reservation does not match this scene", code: "INVALID_UPLOAD_RESERVATION" });
  }
  try {
    const object = await mediaStorage.readMetadata(reservation.storageKey);
    if (object.contentType !== reservation.contentType || object.contentType !== body.data.mediaType || object.size > reservation.maxSize) {
      return void res.status(422).json({ error: "Uploaded object does not match its reservation", code: "UPLOAD_METADATA_MISMATCH" });
    }
  } catch (error) {
    req.log.warn({ error, storageKey: reservation.storageKey }, "Upload verification failed");
    return void res.status(422).json({ error: "Uploaded object could not be verified", code: "UPLOAD_NOT_FOUND" });
  }
  const media = await db.transaction(async (tx) => {
    const [created] = await tx.insert(mediaTable).values(body.data).returning();
    await tx.update(mediaUploadReservationsTable).set({ consumedAt: new Date() }).where(eq(mediaUploadReservationsTable.id, reservation.id));
    return created;
  });
  res.status(201).json({ ...media, mediaUrl: `/api/storage/objects/${media.storageKey}` });
});

router.get("/reports/daily", async (req, res): Promise<void> => {
  const projectId = idSchema.safeParse(req.query.projectId);
  if (!projectId.success) return void res.status(400).json({ error: "Invalid project id" });
  const [project] = await db.select().from(projectsTable).where(and(eq(projectsTable.id, projectId.data), eq(projectsTable.ownerId, res.locals.userId as string))).limit(1);
  if (!project) return void res.status(404).json({ error: "Project not found" });
  const scenes = await db.select({ id: scenesTable.id }).from(scenesTable).where(eq(scenesTable.projectId, project.id));
  const sceneIds = scenes.map((scene) => scene.id);
  const shots = sceneIds.length ? await db.select({ id: shotsTable.id }).from(shotsTable).where(inArray(shotsTable.sceneId, sceneIds)) : [];
  const shotIds = shots.map((shot) => shot.id);
  const takes = shotIds.length ? await db.select().from(takesTable).where(inArray(takesTable.shotId, shotIds)) : [];
  const takeIds = takes.map((take) => take.id);
  const issues = takeIds.length ? await db.select().from(continuityIssuesTable).where(inArray(continuityIssuesTable.takeId, takeIds)) : [];
  res.json({
    available: false,
    message: "Daily report generation will be connected to the Report Agent in Phase 3.",
    project: project.title,
    shootDate: new Date().toISOString().slice(0, 10),
    scenesWorked: scenes.length,
    shots: shots.length,
    takeCount: takes.length,
    circleTakes: takes.filter((take) => take.isCircle).length,
    issuesCaught: issues.length,
    unresolvedWarnings: issues.filter((issue) => issue.status === "open").length,
  });
});

export default router;