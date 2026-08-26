import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  ApproveScreenplayImportBody,
  ApproveScreenplayImportParams,
  ApproveScreenplayImportResponse,
  CreateScreenplayImportBody,
  CreateScreenplayImportParams,
  CreateScreenplayImportResponse,
  GetScreenplayImportParams,
  GetScreenplayImportResponse,
  RetryScreenplayImportParams,
  RetryScreenplayImportResponse,
  UpdateScreenplayImportBody,
  UpdateScreenplayImportParams,
  UpdateScreenplayImportResponse,
} from "@workspace/api-zod";
import {
  agentEventsTable,
  continuityItemsTable,
  continuityStateChangesTable,
  db,
  projectsTable,
  scenesTable,
  screenplaySourcesTable,
  shotsTable,
} from "@workspace/db";
import {
  screenplayBreakdownSchema,
  type ScreenplayBreakdown,
} from "@workspace/takekeeper-domain";
import { env } from "../config/env";
import { analyzeScreenplay } from "../services/google-ai";
import { findOwnedProject } from "../services/repository";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function normalizeBreakdown(input: {
  scenes: Array<{
    id?: string | null;
    sceneNumber: string;
    slugline: string;
    location: string;
    intExt: "INT" | "EXT" | "INT/EXT" | "";
    timeOfDay: string;
    storyDay: string;
    scriptText: string | null;
    characters: string[];
    continuityItems: Array<{
      category: string;
      entity: string;
      expectedState: string;
      sourceType: "script";
      confidence: number;
      active: boolean;
      sourceEvidence: string | null;
    }>;
  }>;
}): ScreenplayBreakdown {
  return screenplayBreakdownSchema.parse({
    scenes: input.scenes.map(({ id, ...scene }) => ({
      ...scene,
      ...(id ? { id } : {}),
    })),
  });
}

function duplicateSceneNumber(scenes: Array<{ sceneNumber: string }>) {
  const seen = new Set<string>();
  for (const scene of scenes) {
    const normalized = scene.sceneNumber.trim().toLocaleLowerCase();
    if (seen.has(normalized)) return scene.sceneNumber.trim();
    seen.add(normalized);
  }
  return null;
}

function toResponse(row: typeof screenplaySourcesTable.$inferSelect) {
  const analysis = row.analysisJson
    ? screenplayBreakdownSchema.safeParse(row.analysisJson)
    : null;
  return {
    id: row.id,
    projectId: row.projectId,
    sourceType: row.sourceType,
    fileName: row.fileName,
    content: row.content,
    status: row.status,
    errorMessage: row.errorMessage,
    model: row.model,
    analysis: analysis?.success ? analysis.data : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function ownedImport(userId: string, importId: string) {
  const [row] = await db
    .select({ source: screenplaySourcesTable, project: projectsTable })
    .from(screenplaySourcesTable)
    .innerJoin(projectsTable, eq(screenplaySourcesTable.projectId, projectsTable.id))
    .where(and(eq(screenplaySourcesTable.id, importId), eq(projectsTable.ownerId, userId)))
    .limit(1);
  return row;
}

async function recordAgentEvent(input: {
  projectId: string;
  action: string;
  toolName: string;
  status: "started" | "completed" | "failed";
  latencyMs?: number;
  metadata?: Record<string, unknown>;
}) {
  await db.insert(agentEventsTable).values({
    projectId: input.projectId,
    agent: "script-breakdown-agent",
    action: input.action,
    toolName: input.toolName,
    status: input.status,
    latencyMs: input.latencyMs,
    metadataJson: input.metadata,
  });
}

async function runAnalysis(importId: string, attemptId: string) {
  const [source] = await db
    .select()
    .from(screenplaySourcesTable)
    .where(eq(screenplaySourcesTable.id, importId))
    .limit(1);
  if (!source || source.status !== "analyzing" || source.analysisAttemptId !== attemptId) return;

  const startedAt = Date.now();
  await recordAgentEvent({
    projectId: source.projectId,
    action: "script_breakdown_analysis",
    toolName: "gemini.generateContent",
    status: "started",
    metadata: { importId: source.id, sourceType: source.sourceType, characterCount: source.content.length },
  });

  try {
    const analysis = await analyzeScreenplay(source.content);
    const latencyMs = Date.now() - startedAt;
    await db
      .update(screenplaySourcesTable)
      .set({
        analysisJson: analysis,
        status: "review",
        errorMessage: null,
        model: env.GEMINI_MODEL,
        updatedAt: new Date(),
      })
      .where(and(
        eq(screenplaySourcesTable.id, source.id),
        eq(screenplaySourcesTable.status, "analyzing"),
        eq(screenplaySourcesTable.analysisAttemptId, attemptId),
      ))
      .returning({ id: screenplaySourcesTable.id });
    const [claimed] = await db
      .select({ status: screenplaySourcesTable.status, attemptId: screenplaySourcesTable.analysisAttemptId })
      .from(screenplaySourcesTable)
      .where(eq(screenplaySourcesTable.id, source.id))
      .limit(1);
    if (!claimed || claimed.attemptId !== attemptId || claimed.status !== "review") return;
    await recordAgentEvent({
      projectId: source.projectId,
      action: "script_breakdown_analysis",
      toolName: "gemini.generateContent",
      status: "completed",
      latencyMs,
      metadata: {
        importId: source.id,
        model: env.GEMINI_MODEL,
        sceneCount: analysis.scenes.length,
        continuityCount: analysis.scenes.reduce((total, scene) => total + scene.continuityItems.length, 0),
      },
    });
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    logger.error({
      err: error,
      errorMessage: error instanceof Error ? error.message : String(error),
      importId: source.id,
      projectId: source.projectId,
    }, "Script breakdown analysis failed");
    await db
      .update(screenplaySourcesTable)
      .set({
        status: "failed",
        errorMessage: "Gemini could not produce a valid screenplay breakdown. The saved screenplay is ready to retry.",
        updatedAt: new Date(),
      })
      .where(and(
        eq(screenplaySourcesTable.id, source.id),
        eq(screenplaySourcesTable.status, "analyzing"),
        eq(screenplaySourcesTable.analysisAttemptId, attemptId),
      ))
      .returning({ id: screenplaySourcesTable.id });
    await recordAgentEvent({
      projectId: source.projectId,
      action: "script_breakdown_analysis",
      toolName: "gemini.generateContent",
      status: "failed",
      latencyMs,
      metadata: { importId: source.id, errorType: error instanceof Error ? error.name : "UnknownError" },
    });
  }
}

router.get("/projects/:projectId/screenplay-import", async (req, res): Promise<void> => {
  const params = GetScreenplayImportParams.safeParse(req.params);
  if (!params.success) return void res.status(400).json({ error: "Invalid project id" });
  const project = await findOwnedProject(res.locals.userId as string, params.data.projectId);
  if (!project) return void res.status(404).json({ error: "Project not found", code: "PROJECT_NOT_FOUND" });
  const [source] = await db
    .select()
    .from(screenplaySourcesTable)
    .where(eq(screenplaySourcesTable.projectId, project.id))
    .orderBy(desc(screenplaySourcesTable.createdAt))
    .limit(1);
  if (!source) return void res.status(404).json({ error: "No screenplay has been imported", code: "SCREENPLAY_NOT_FOUND" });
  res.json(GetScreenplayImportResponse.parse(toResponse(source)));
});

router.post("/projects/:projectId/screenplay-import", async (req, res): Promise<void> => {
  const params = CreateScreenplayImportParams.safeParse(req.params);
  const body = CreateScreenplayImportBody.safeParse(req.body);
  if (!params.success || !body.success) {
    return void res.status(400).json({
      error: "Provide at least 40 readable characters of screenplay text in paste or .txt format.",
      code: "INVALID_SCREENPLAY",
    });
  }
  const project = await findOwnedProject(res.locals.userId as string, params.data.projectId);
  if (!project) return void res.status(404).json({ error: "Project not found", code: "PROJECT_NOT_FOUND" });
  const content = body.data.content.replace(/\u0000/g, "").trim();
  if (content.length < 40) {
    return void res.status(400).json({ error: "The screenplay is too short to analyze.", code: "SCREENPLAY_TOO_SHORT" });
  }
  if (body.data.sourceType === "txt" && !body.data.fileName?.toLowerCase().endsWith(".txt")) {
    return void res.status(400).json({ error: "Only readable .txt screenplay files are supported.", code: "UNSUPPORTED_SCREENPLAY_FILE" });
  }

  const [source] = await db
    .insert(screenplaySourcesTable)
    .values({
      projectId: project.id,
      sourceType: body.data.sourceType,
      fileName: body.data.fileName ?? null,
      content,
      status: "analyzing",
      analysisAttemptId: randomUUID(),
      analysisStartedAt: new Date(),
      model: env.GEMINI_MODEL,
    })
    .returning();

  void runAnalysis(source.id, source.analysisAttemptId!);
  res.status(202).json(CreateScreenplayImportResponse.parse(toResponse(source)));
});

router.patch("/screenplay-imports/:importId", async (req, res): Promise<void> => {
  const params = UpdateScreenplayImportParams.safeParse(req.params);
  const body = UpdateScreenplayImportBody.safeParse(req.body);
  if (!params.success || !body.success) return void res.status(400).json({ error: "Invalid screenplay review" });
  const duplicate = duplicateSceneNumber(body.data.analysis.scenes);
  if (duplicate) {
    return void res.status(409).json({ error: `Scene number "${duplicate}" appears more than once. Give every scene a unique number before saving.` });
  }
  const row = await ownedImport(res.locals.userId as string, params.data.importId);
  if (!row) return void res.status(404).json({ error: "Screenplay import not found" });
  if (row.source.status !== "review") return void res.status(409).json({ error: "Only a screenplay awaiting review can be edited." });
  const analysis = normalizeBreakdown(body.data.analysis);
  const [updated] = await db
    .update(screenplaySourcesTable)
    .set({ analysisJson: analysis, status: "review", errorMessage: null, updatedAt: new Date() })
    .where(and(
      eq(screenplaySourcesTable.id, row.source.id),
      eq(screenplaySourcesTable.status, "review"),
      eq(screenplaySourcesTable.updatedAt, row.source.updatedAt),
    ))
    .returning();
  if (!updated) return void res.status(409).json({ error: "The screenplay changed while saving. Refresh and review again." });
  await recordAgentEvent({
    projectId: row.project.id,
    action: "script_breakdown_review_saved",
    toolName: "save_breakdown_review",
    status: "completed",
    metadata: { importId: row.source.id, sceneCount: analysis.scenes.length },
  });
  res.json(UpdateScreenplayImportResponse.parse(toResponse(updated)));
});

router.post("/screenplay-imports/:importId/retry", async (req, res): Promise<void> => {
  const params = RetryScreenplayImportParams.safeParse(req.params);
  if (!params.success) return void res.status(400).json({ error: "Invalid screenplay import id" });
  const row = await ownedImport(res.locals.userId as string, params.data.importId);
  if (!row) return void res.status(404).json({ error: "Screenplay import not found" });
  if (row.source.status !== "failed" && row.source.status !== "analyzing") {
    return void res.status(409).json({ error: "Only failed or interrupted analysis can be retried." });
  }
  const staleBefore = Date.now() - 2 * 60 * 1000;
  if (
    row.source.status === "analyzing" &&
    row.source.analysisStartedAt &&
    row.source.analysisStartedAt.getTime() > staleBefore
  ) {
    return void res.status(409).json({ error: "Analysis is already running" });
  }
  const attemptId = randomUUID();
  const ownershipCondition = row.source.analysisAttemptId
    ? eq(screenplaySourcesTable.analysisAttemptId, row.source.analysisAttemptId)
    : isNull(screenplaySourcesTable.analysisAttemptId);
  const [updated] = await db
    .update(screenplaySourcesTable)
    .set({
      status: "analyzing",
      errorMessage: null,
      analysisAttemptId: attemptId,
      analysisStartedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(
      eq(screenplaySourcesTable.id, row.source.id),
      eq(screenplaySourcesTable.status, row.source.status),
      ownershipCondition,
    ))
    .returning();
  if (!updated) return void res.status(409).json({ error: "Analysis state changed. Refresh before retrying." });
  void runAnalysis(updated.id, attemptId);
  res.status(202).json(RetryScreenplayImportResponse.parse(toResponse(updated)));
});

router.post("/screenplay-imports/:importId", async (req, res): Promise<void> => {
  const params = ApproveScreenplayImportParams.safeParse(req.params);
  const body = ApproveScreenplayImportBody.safeParse(req.body);
  if (!params.success || !body.success) return void res.status(400).json({ error: "Invalid screenplay approval" });
  const duplicate = duplicateSceneNumber(body.data.analysis.scenes);
  if (duplicate) {
    return void res.status(409).json({ error: `Scene number "${duplicate}" appears more than once. Give every scene a unique number before approving.` });
  }
  const row = await ownedImport(res.locals.userId as string, params.data.importId);
  if (!row) return void res.status(404).json({ error: "Screenplay import not found" });
  if (row.source.status !== "review") return void res.status(409).json({ error: "Only a reviewed screenplay can be approved." });
  const analysis = normalizeBreakdown(body.data.analysis);
  if (analysis.scenes.length === 0) return void res.status(400).json({ error: "Keep at least one scene before approval." });

  try {
    const approvedAnalysis = await db.transaction(async (tx) => {
      const existingScenes = await tx
        .select()
        .from(scenesTable)
        .where(eq(scenesTable.projectId, row.project.id));
      const existingById = new Map(existingScenes.map((scene) => [scene.id, scene]));
      const retainedIds = new Set<string>();
      const persistedScenes: ScreenplayBreakdown["scenes"] = [];

      for (const [sortOrder, draft] of analysis.scenes.entries()) {
        const existing = draft.id ? existingById.get(draft.id) : undefined;
        if (existing && existing.scriptSourceId !== row.source.id) {
          throw new Error("SCREENPLAY_SCENE_OWNERSHIP_CONFLICT");
        }
        const sceneNumberCollision = existingScenes.find((scene) =>
          scene.sceneNumber === draft.sceneNumber &&
          scene.id !== existing?.id &&
          scene.scriptSourceId !== row.source.id
        );
        if (sceneNumberCollision) throw new Error("SCREENPLAY_SCENE_NUMBER_CONFLICT");
        const values = {
          projectId: row.project.id,
          scriptSourceId: row.source.id,
          sceneNumber: draft.sceneNumber,
          slugline: draft.slugline,
          location: draft.location,
          intExt: draft.intExt,
          timeOfDay: draft.timeOfDay,
          storyDay: draft.storyDay,
          scriptText: draft.scriptText,
          sortOrder,
          updatedAt: new Date(),
        };
        const [scene] = existing
          ? await tx.update(scenesTable).set(values).where(eq(scenesTable.id, existing.id)).returning()
          : await tx.insert(scenesTable).values(values).returning();
        retainedIds.add(scene.id);
        await tx
          .delete(continuityItemsTable)
          .where(and(eq(continuityItemsTable.sceneId, scene.id), eq(continuityItemsTable.sourceType, "script")));
        if (draft.continuityItems.length > 0) {
          await tx.insert(continuityItemsTable).values(
            draft.continuityItems.map((item) => ({
              sceneId: scene.id,
              category: item.category,
              entity: item.entity,
              expectedState: item.expectedState,
              sourceType: "script",
              confidence: item.confidence.toFixed(4),
              sourceEvidence: item.sourceEvidence,
              active: item.active,
            })),
          );
        }
        persistedScenes.push({ ...draft, id: scene.id });
      }

      const removedSourceScenes = existingScenes.filter(
        (scene) => scene.scriptSourceId === row.source.id && !retainedIds.has(scene.id),
      );
      if (removedSourceScenes.length > 0) {
        const removedIds = removedSourceScenes.map((scene) => scene.id);
        const linkedShots = await tx.select({ id: shotsTable.id }).from(shotsTable).where(inArray(shotsTable.sceneId, removedIds));
        const manualContinuity = await tx
          .select({ id: continuityItemsTable.id, sourceType: continuityItemsTable.sourceType })
          .from(continuityItemsTable)
          .where(inArray(continuityItemsTable.sceneId, removedIds));
        const itemIds = manualContinuity.map((item) => item.id);
        const stateChanges = itemIds.length > 0
          ? await tx
              .select({ id: continuityStateChangesTable.id })
              .from(continuityStateChangesTable)
              .where(inArray(continuityStateChangesTable.continuityItemId, itemIds))
          : [];
        if (
          linkedShots.length > 0 ||
          manualContinuity.some((item) => item.sourceType !== "script") ||
          stateChanges.length > 0
        ) {
          throw new Error("SCREENPLAY_SCENE_HAS_PRODUCTION_DATA");
        }
        await tx.delete(scenesTable).where(inArray(scenesTable.id, removedIds));
      }

      const result = screenplayBreakdownSchema.parse({ scenes: persistedScenes });
      const [updatedSource] = await tx
        .update(screenplaySourcesTable)
        .set({ analysisJson: result, status: "approved", errorMessage: null, updatedAt: new Date() })
        .where(and(
          eq(screenplaySourcesTable.id, row.source.id),
          eq(screenplaySourcesTable.status, "review"),
          eq(screenplaySourcesTable.updatedAt, row.source.updatedAt),
        ))
        .returning();
      if (!updatedSource) throw new Error("SCREENPLAY_APPROVAL_STATE_CHANGED");
      return { result, updatedSource };
    });

    await recordAgentEvent({
      projectId: row.project.id,
      action: "script_breakdown_approved",
      toolName: "approve_breakdown",
      status: "completed",
      metadata: {
        importId: row.source.id,
        sceneCount: approvedAnalysis.result.scenes.length,
        continuityCount: approvedAnalysis.result.scenes.reduce((total, scene) => total + scene.continuityItems.length, 0),
      },
    });
    res.json(ApproveScreenplayImportResponse.parse(toResponse(approvedAnalysis.updatedSource)));
  } catch (error) {
    if (error instanceof Error && error.message === "SCREENPLAY_SCENE_HAS_PRODUCTION_DATA") {
      return void res.status(409).json({
        error: "A removed screenplay scene already has shots or continuity history. Keep that scene in the review.",
        code: "SCREENPLAY_SCENE_HAS_PRODUCTION_DATA",
      });
    }
    if (error instanceof Error && error.message === "SCREENPLAY_SCENE_NUMBER_CONFLICT") {
      return void res.status(409).json({
        error: "A manual scene already uses one of these scene numbers. Rename the imported scene in review before approving.",
        code: "SCREENPLAY_SCENE_NUMBER_CONFLICT",
      });
    }
    if (error instanceof Error && ["SCREENPLAY_SCENE_OWNERSHIP_CONFLICT", "SCREENPLAY_APPROVAL_STATE_CHANGED"].includes(error.message)) {
      return void res.status(409).json({ error: "The screenplay changed during approval. Refresh and review again." });
    }
    throw error;
  }
});

export default router;