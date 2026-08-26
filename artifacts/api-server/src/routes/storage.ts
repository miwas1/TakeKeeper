import { Router, type IRouter } from "express";
import { and, eq, isNull, lt } from "drizzle-orm";
import { z } from "zod";
import { db, mediaTable, mediaUploadReservationsTable, projectsTable, scenesTable } from "@workspace/db";
import { mediaStorage } from "../services/storage";

const router: IRouter = Router();
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

async function cleanupExpiredReservations() {
  const expired = await db
    .select()
    .from(mediaUploadReservationsTable)
    .where(and(isNull(mediaUploadReservationsTable.consumedAt), lt(mediaUploadReservationsTable.expiresAt, new Date())))
    .limit(50);
  for (const reservation of expired) {
    try {
      await mediaStorage.delete(reservation.storageKey);
      await db.delete(mediaUploadReservationsTable).where(eq(mediaUploadReservationsTable.id, reservation.id));
    } catch {
      // Keep the reservation so the next cleanup pass retries object deletion.
    }
  }
}

const cleanupTimer = setInterval(() => {
  void cleanupExpiredReservations();
}, 10 * 60 * 1000);
cleanupTimer.unref();
void cleanupExpiredReservations();

router.post("/storage/uploads/request-url", async (req, res): Promise<void> => {
  void cleanupExpiredReservations();
  const body = z.object({
    projectId: z.string().uuid(),
    sceneId: z.string().uuid().optional(),
    fileName: z.string().min(1).max(240),
    contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
    size: z.number().int().positive().max(MAX_IMAGE_BYTES),
  }).safeParse(req.body);
  if (!body.success) {
    res.status(400).json({
      error: "Use a JPEG, PNG, or WebP image no larger than 20 MB.",
      code: "UNSUPPORTED_MEDIA",
    });
    return;
  }
  const [project] = await db
    .select({ id: projectsTable.id })
    .from(projectsTable)
    .where(and(eq(projectsTable.id, body.data.projectId), eq(projectsTable.ownerId, res.locals.userId as string)))
    .limit(1);
  if (!project) {
    res.status(404).json({ error: "Project not found", code: "PROJECT_NOT_FOUND" });
    return;
  }
  if (body.data.sceneId) {
    const [scene] = await db
      .select({ id: scenesTable.id })
      .from(scenesTable)
      .where(and(eq(scenesTable.id, body.data.sceneId), eq(scenesTable.projectId, project.id)))
      .limit(1);
    if (!scene) {
      res.status(404).json({ error: "Scene not found in this project", code: "SCENE_NOT_FOUND" });
      return;
    }
  }
  try {
    const { storageKey, uploadUrl } = await mediaStorage.createUploadTarget(body.data);
    await db.insert(mediaUploadReservationsTable).values({
      projectId: project.id,
      sceneId: body.data.sceneId,
      userId: res.locals.userId as string,
      storageKey,
      contentType: body.data.contentType,
      maxSize: body.data.size,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });
    res.json({ storageKey, uploadUrl });
  } catch (error) {
    req.log.error({ error }, "Failed to create upload target");
    res.status(503).json({ error: "Media storage is temporarily unavailable", code: "STORAGE_UNAVAILABLE" });
  }
});

router.get("/storage/objects/*path", async (req, res): Promise<void> => {
  const rawPath = req.params.path;
  const storageKey = Array.isArray(rawPath) ? rawPath.join("/") : rawPath;
  const [ownedMedia] = await db
    .select({ id: mediaTable.id })
    .from(mediaTable)
    .innerJoin(projectsTable, eq(mediaTable.projectId, projectsTable.id))
    .where(and(eq(mediaTable.storageKey, storageKey), eq(projectsTable.ownerId, res.locals.userId as string)))
    .limit(1);
  if (!ownedMedia) {
    res.status(404).json({ error: "Media not found", code: "MEDIA_NOT_FOUND" });
    return;
  }
  try {
    const signedUrl = await mediaStorage.createReadUrl(storageKey);
    res.redirect(302, signedUrl);
  } catch (error) {
    req.log.error({ error }, "Failed to read media");
    res.status(503).json({ error: "Media storage is temporarily unavailable", code: "STORAGE_UNAVAILABLE" });
  }
});

export default router;