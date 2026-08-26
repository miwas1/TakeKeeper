import { Router, type IRouter } from "express";
import {
  CreateProjectBody,
  CreateProjectResponse,
  CreateSceneBody,
  CreateSceneParams,
  CreateSceneResponse,
  GetProjectParams,
  GetProjectResponse,
  ListProjectsResponse,
  ListScenesParams,
  ListScenesResponse,
} from "@workspace/api-zod";
import { db, mediaTable, mediaUploadReservationsTable, projectsTable, scenesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  findOwnedProject,
  listOwnedProjects,
  listProjectScenes,
} from "../services/repository";
import { trackEvent } from "../services/analytics";
import { mediaStorage } from "../services/storage";

const router: IRouter = Router();

router.get("/projects", async (_req, res): Promise<void> => {
  const projects = await listOwnedProjects(res.locals.userId as string);
  res.json(ListProjectsResponse.parse(projects));
});

router.post("/projects", async (req, res): Promise<void> => {
  const body = CreateProjectBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message, code: "INVALID_PROJECT" });
    return;
  }

  const [project] = await db
    .insert(projectsTable)
    .values({
      ownerId: res.locals.userId as string,
      title: body.data.title,
      type: body.data.type,
    })
    .returning();

  await trackEvent({ projectId: project.id, name: "project_created" });
  res.status(201).json(
    CreateProjectResponse.parse({
      id: project.id,
      title: project.title,
      type: project.type,
      status: project.status,
      sceneCount: 0,
      activeIssueCount: 0,
      updatedAt: project.updatedAt,
    }),
  );
});

router.get("/projects/:projectId", async (req, res): Promise<void> => {
  const params = GetProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message, code: "INVALID_PROJECT_ID" });
    return;
  }

  const project = await findOwnedProject(res.locals.userId as string, params.data.projectId);
  if (!project) {
    res.status(404).json({ error: "Project not found", code: "PROJECT_NOT_FOUND" });
    return;
  }

  const [summary] = await listOwnedProjects(res.locals.userId as string).then((projects) =>
    projects.filter((item) => item.id === project.id),
  );
  const scenes = await listProjectScenes(project.id);
  res.json(GetProjectResponse.parse({ ...summary, scenes }));
});

router.patch("/projects/:projectId", async (req, res): Promise<void> => {
  const params = z.object({ projectId: z.string().uuid() }).safeParse(req.params);
  const body = z.object({
    title: z.string().min(1).max(120).optional(),
    type: z.string().min(1).optional(),
    status: z.enum(["active", "archived"]).optional(),
  }).safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid project update", code: "INVALID_PROJECT" });
    return;
  }
  const project = await findOwnedProject(res.locals.userId as string, params.data.projectId);
  if (!project) {
    res.status(404).json({ error: "Project not found", code: "PROJECT_NOT_FOUND" });
    return;
  }
  await db.update(projectsTable).set({ ...body.data, updatedAt: new Date() }).where(eq(projectsTable.id, project.id));
  await trackEvent({
    projectId: project.id,
    name: body.data.status === "archived" ? "project_archived" : "project_updated",
  });
  const [updated] = (await listOwnedProjects(res.locals.userId as string)).filter((item) => item.id === project.id);
  res.json(updated);
});

router.delete("/projects/:projectId", async (req, res): Promise<void> => {
  const params = z.object({ projectId: z.string().uuid() }).safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid project id", code: "INVALID_PROJECT_ID" });
    return;
  }
  const project = await findOwnedProject(res.locals.userId as string, params.data.projectId);
  if (!project) {
    res.status(404).json({ error: "Project not found", code: "PROJECT_NOT_FOUND" });
    return;
  }
  const projectMedia = await db.select().from(mediaTable).where(eq(mediaTable.projectId, project.id));
  const reservations = await db.select().from(mediaUploadReservationsTable).where(eq(mediaUploadReservationsTable.projectId, project.id));
  const storageKeys = [...new Set([
    ...projectMedia.map((media) => media.storageKey),
    ...reservations.map((reservation) => reservation.storageKey),
  ])];
  try {
    await Promise.all(storageKeys.map((storageKey) => mediaStorage.delete(storageKey)));
  } catch (error) {
    req.log.error({ error, projectId: project.id }, "Storage cleanup blocked project deletion");
    res.status(503).json({ error: "Project media could not be removed. No records were deleted.", code: "STORAGE_DELETE_FAILED" });
    return;
  }
  await db.delete(projectsTable).where(eq(projectsTable.id, project.id));
  res.status(204).end();
});

router.get("/projects/:projectId/scenes", async (req, res): Promise<void> => {
  const params = ListScenesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message, code: "INVALID_PROJECT_ID" });
    return;
  }
  const project = await findOwnedProject(res.locals.userId as string, params.data.projectId);
  if (!project) {
    res.status(404).json({ error: "Project not found", code: "PROJECT_NOT_FOUND" });
    return;
  }
  res.json(ListScenesResponse.parse(await listProjectScenes(project.id)));
});

router.post("/projects/:projectId/scenes", async (req, res): Promise<void> => {
  const params = CreateSceneParams.safeParse(req.params);
  const body = CreateSceneBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid scene data", code: "INVALID_SCENE" });
    return;
  }
  const project = await findOwnedProject(res.locals.userId as string, params.data.projectId);
  if (!project) {
    res.status(404).json({ error: "Project not found", code: "PROJECT_NOT_FOUND" });
    return;
  }

  const [scene] = await db
    .insert(scenesTable)
    .values({
      projectId: project.id,
      sceneNumber: body.data.sceneNumber,
      slugline: body.data.slugline,
      location: body.data.location,
      intExt: body.data.intExt,
      timeOfDay: body.data.timeOfDay,
      storyDay: body.data.storyDay,
      scriptText: body.data.scriptText,
      sortOrder: await listProjectScenes(project.id).then((scenes) => scenes.length),
    })
    .returning();
  await trackEvent({ projectId: project.id, name: "scene_created", metadata: { sceneId: scene.id } });
  res.status(201).json(
    CreateSceneResponse.parse({
      id: scene.id,
      projectId: scene.projectId,
      sceneNumber: scene.sceneNumber,
      slugline: scene.slugline,
      location: scene.location,
      intExt: scene.intExt,
      timeOfDay: scene.timeOfDay,
      storyDay: scene.storyDay,
      scriptText: scene.scriptText,
      shotCount: 0,
      continuityCount: 0,
      sortOrder: scene.sortOrder,
    }),
  );
});

export default router;