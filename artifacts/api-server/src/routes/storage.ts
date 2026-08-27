import { Router, type IRouter } from "express";
import { readFile } from "node:fs/promises";
import { and, eq, isNull, lt } from "drizzle-orm";
import { z } from "zod";
import { db, mediaTable, mediaUploadReservationsTable, projectsTable, scenesTable } from "@workspace/db";
import { MediaUploadTooLargeError, mediaStorage } from "../services/storage";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

async function cleanupExpiredReservations() {
  try {
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
  } catch (error) {
    logger.warn({ error }, "Expired media reservation cleanup skipped");
  }
}

async function cleanupOrphanedMedia() {
  try {
    const cutoff = new Date(Date.now() - 60 * 60 * 1000);
    const orphaned = await db
      .select()
      .from(mediaTable)
      .where(and(isNull(mediaTable.takeId), lt(mediaTable.createdAt, cutoff)))
      .limit(50);
    for (const media of orphaned) {
      try {
        await mediaStorage.delete(media.storageKey);
        await db.delete(mediaTable).where(eq(mediaTable.id, media.id));
      } catch {
        // Keep the row so a later cleanup pass retries object deletion.
      }
    }
  } catch (error) {
    logger.warn({ error }, "Orphaned media cleanup skipped");
  }
}

const cleanupTimer = setInterval(() => {
  void cleanupExpiredReservations();
  void cleanupOrphanedMedia();
}, 10 * 60 * 1000);
cleanupTimer.unref();
void cleanupExpiredReservations();
void cleanupOrphanedMedia();

router.put("/storage/local-uploads/:uploadId", async (req, res): Promise<void> => {
  const uploadId = z.string().uuid().safeParse(req.params.uploadId);
  if (!mediaStorage.isLocal || !mediaStorage.writeUpload) {
    res.status(404).json({ error: "Local media storage is not enabled", code: "LOCAL_STORAGE_DISABLED" });
    return;
  }
  if (!uploadId.success) {
    res.status(400).json({ error: "Invalid local upload id", code: "INVALID_UPLOAD_ID" });
    return;
  }
  const storageKey = `uploads/${uploadId.data}`;
  const [reservation] = await db
    .select()
    .from(mediaUploadReservationsTable)
    .where(and(
      eq(mediaUploadReservationsTable.storageKey, storageKey),
      eq(mediaUploadReservationsTable.userId, res.locals.userId as string),
      isNull(mediaUploadReservationsTable.consumedAt),
    ))
    .limit(1);
  if (!reservation || reservation.expiresAt <= new Date()) {
    res.status(403).json({ error: "Upload reservation is missing or expired", code: "INVALID_UPLOAD_RESERVATION" });
    return;
  }
  const contentType = req.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== reservation.contentType) {
    res.status(415).json({ error: "Upload content type does not match its reservation", code: "UPLOAD_METADATA_MISMATCH" });
    return;
  }
  const declaredSize = Number(req.headers["content-length"]);
  if (Number.isSafeInteger(declaredSize) && declaredSize > reservation.maxSize) {
    res.status(413).json({ error: "Uploaded media exceeds its reserved size", code: "MEDIA_UPLOAD_TOO_LARGE" });
    return;
  }
  try {
    await mediaStorage.writeUpload(req as unknown as AsyncIterable<Uint8Array>, storageKey, reservation.maxSize);
    res.status(204).end();
  } catch (error) {
    req.log.warn({ error, storageKey }, "Local media upload failed");
    if (error instanceof MediaUploadTooLargeError) {
      res.status(413).json({ error: error.message, code: error.code });
      return;
    }
    res.status(503).json({ error: "Local media storage could not save this upload", code: "LOCAL_STORAGE_WRITE_FAILED" });
  }
});

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
    const target = await mediaStorage.createUploadTarget(body.data);
    try {
      await db.insert(mediaUploadReservationsTable).values({
        projectId: project.id,
        sceneId: body.data.sceneId,
        userId: res.locals.userId as string,
        storageKey: target.storageKey,
        contentType: body.data.contentType,
        maxSize: body.data.size,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      });
    } catch (error) {
      await mediaStorage.delete(target.storageKey).catch((cleanupError) => {
        req.log.warn({ cleanupError, storageKey: target.storageKey }, "Failed to clean up unreserved media object");
      });
      throw error;
    }
    res.json(target);
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

router.get("/storage/local-objects/:token", async (req, res): Promise<void> => {
  if (!mediaStorage.isLocal || !mediaStorage.resolveReadToken || !mediaStorage.getFilePath) {
    res.status(404).json({ error: "Local media storage is not enabled", code: "LOCAL_STORAGE_DISABLED" });
    return;
  }
  const token = z.string().uuid().safeParse(req.params.token);
  if (!token.success) {
    res.status(404).json({ error: "Media not found", code: "MEDIA_NOT_FOUND" });
    return;
  }
  const storageKey = mediaStorage.resolveReadToken(token.data);
  if (!storageKey) {
    res.status(404).json({ error: "Media not found", code: "MEDIA_NOT_FOUND" });
    return;
  }
  const [ownedMedia] = await db
    .select({ mediaType: mediaTable.mediaType })
    .from(mediaTable)
    .innerJoin(projectsTable, eq(mediaTable.projectId, projectsTable.id))
    .where(and(eq(mediaTable.storageKey, storageKey), eq(projectsTable.ownerId, res.locals.userId as string)))
    .limit(1);
  if (!ownedMedia) {
    res.status(404).json({ error: "Media not found", code: "MEDIA_NOT_FOUND" });
    return;
  }
  try {
    const body = await readFile(mediaStorage.getFilePath(storageKey));
    res.type(ownedMedia.mediaType).send(body);
  } catch (error) {
    req.log.error({ error, storageKey }, "Failed to read local media");
    res.status(404).json({ error: "Media not found", code: "MEDIA_NOT_FOUND" });
  }
});

export default router;
