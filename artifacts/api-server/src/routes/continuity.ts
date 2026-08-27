import { Router, type IRouter } from "express";
import {
  AnalyzeTakeVisualStateBody,
  GetTakeVisualStateParams,
  GetTakeVisualStateResponse,
  AnalyzeTakeVisualStateParams,
  RunContinuityCheckBody,
  RunContinuityCheckParams,
  RunContinuityCheckResponse,
  GetContinuityCheckParams,
  GetContinuityCheckResponse,
} from "@workspace/api-zod";
import {
  getOwnedContinuityCheckResult,
  getOwnedVisualStateResult,
  getContinuityCheckResult,
  getVisualStateResult,
  startContinuityCheck,
  startVisualStateAnalysis,
} from "../services/continuity/workflow";
import { getOwnedTakeContext } from "../services/continuity/approved-state";
import {
  ContinuityDecisionError,
  addIssueNote,
  approveIntentionalChange,
  getContinuityHistory,
  getIssueHistory,
  ignoreIssue,
  serializeContinuityIssue,
  serializeDecisionChange,
} from "../services/continuity/decisions";
import { z } from "zod";

const router: IRouter = Router();

const idSchema = z.string().uuid();
const intentionalChangeBody = z.object({
  newState: z.string().min(1).max(1000).optional(),
  effectiveScope: z.enum(["this_shot", "rest_of_scene", "from_now_on", "shot", "scene", "future"]),
  sourceTakeId: idSchema.optional(),
  effectiveFromTakeId: idSchema.optional(),
  effectiveUntilTakeId: idSchema.nullable().optional(),
  note: z.string().max(1000).optional(),
  idempotencyKey: z.string().min(1).max(240).optional(),
});

function decisionError(res: any, error: unknown) {
  if (error instanceof ContinuityDecisionError) {
    const status = error.code.endsWith("NOT_FOUND") || error.code === "SCENE_NOT_FOUND" ? 404 : 409;
    res.status(status).json({ error: error.message, code: error.code });
    return;
  }
  throw error;
}

async function validateRecheckTake(userId: string, issueId: string, takeId: string, shotId: string) {
  const previous = await getIssueHistory(userId, issueId);
  if (previous.issue.status !== "open") {
    throw new ContinuityDecisionError("ISSUE_ALREADY_RESOLVED", "This continuity issue already has a decision");
  }
  const previousTake = await getOwnedTakeContext(userId, previous.issue.takeId, "write");
  if (!previousTake || previousTake.shot.id !== shotId || previousTake.take.id === takeId) {
    throw new ContinuityDecisionError("RECHECK_SHOT_MISMATCH", "A recheck must use a different take from the same shot");
  }
}

router.get("/takes/:takeId/visual-state", async (req, res): Promise<void> => {
  const params = GetTakeVisualStateParams.safeParse(req.params);
  if (!params.success) return void res.status(400).json({ error: "Invalid take id", code: "INVALID_TAKE_ID" });
  const result = await getOwnedVisualStateResult(res.locals.userId as string, params.data.takeId);
  if (!result) return void res.status(404).json({ error: "Visual State analysis not found", code: "VISUAL_STATE_NOT_FOUND" });
  res.json(GetTakeVisualStateResponse.parse(result));
});

router.post("/takes/:takeId/visual-state", async (req, res): Promise<void> => {
  const params = AnalyzeTakeVisualStateParams.safeParse(req.params);
  const body = AnalyzeTakeVisualStateBody.safeParse(req.body ?? {});
  if (!params.success || !body.success) return void res.status(400).json({ error: "Invalid Visual State analysis request", code: "INVALID_VISUAL_STATE_REQUEST" });
  const ownedTake = await getOwnedTakeContext(res.locals.userId as string, params.data.takeId, "write");
  if (!ownedTake) return void res.status(404).json({ error: "Take not found", code: "TAKE_NOT_FOUND" });
  try {
    await startVisualStateAnalysis(params.data.takeId, body.data.force ?? false);
    const result = await getVisualStateResult(params.data.takeId);
    if (!result) return void res.status(500).json({ error: "Visual State analysis could not be created", code: "ANALYSIS_NOT_CREATED" });
    res.status(202).json(GetTakeVisualStateResponse.parse(result));
  } catch (error) {
    req.log.error({ error, takeId: params.data.takeId }, "Could not start Visual State analysis");
    res.status(409).json({ error: error instanceof Error ? error.message : "Visual State analysis could not start", code: "VISUAL_STATE_START_FAILED" });
  }
});

router.get("/takes/:takeId/continuity-check", async (req, res): Promise<void> => {
  const params = GetContinuityCheckParams.safeParse(req.params);
  if (!params.success) return void res.status(400).json({ error: "Invalid take id", code: "INVALID_TAKE_ID" });
  const result = await getOwnedContinuityCheckResult(res.locals.userId as string, params.data.takeId);
  if (!result) return void res.status(404).json({ error: "Continuity check not found", code: "CONTINUITY_CHECK_NOT_FOUND" });
  res.json(GetContinuityCheckResponse.parse(result));
});

router.post("/takes/:takeId/continuity-check", async (req, res): Promise<void> => {
  const params = RunContinuityCheckParams.safeParse(req.params);
  const body = RunContinuityCheckBody.safeParse(req.body ?? {});
  if (!params.success || !body.success) return void res.status(400).json({ error: "Invalid continuity check request", code: "INVALID_CONTINUITY_CHECK_REQUEST" });
  const ownedTake = await getOwnedTakeContext(res.locals.userId as string, params.data.takeId, "write");
  if (!ownedTake) return void res.status(404).json({ error: "Take not found", code: "TAKE_NOT_FOUND" });
  try {
    if (body.data.recheckIssueId) {
      await validateRecheckTake(res.locals.userId as string, body.data.recheckIssueId, ownedTake.take.id, ownedTake.shot.id);
    }
    await startContinuityCheck(params.data.takeId, body.data.retry ?? false, {
      recheckIssueId: body.data.recheckIssueId ?? null,
      requestedByUserId: res.locals.userId as string,
    });
    const result = await getContinuityCheckResult(params.data.takeId);
    if (!result) return void res.status(500).json({ error: "Continuity check could not be created", code: "CHECK_NOT_CREATED" });
    res.status(202).json(RunContinuityCheckResponse.parse(result));
  } catch (error) {
    if (error instanceof ContinuityDecisionError) return void decisionError(res, error);
    req.log.error({ error, takeId: params.data.takeId }, "Could not start continuity check");
    res.status(409).json({ error: error instanceof Error ? error.message : "Continuity check could not start", code: "CONTINUITY_CHECK_START_FAILED" });
  }
});

router.get("/scenes/:sceneId/continuity/history", async (req, res): Promise<void> => {
  const sceneId = idSchema.safeParse(req.params.sceneId);
  const itemId = req.query.itemId === undefined ? undefined : idSchema.safeParse(req.query.itemId);
  if (!sceneId.success || (itemId && !itemId.success)) return void res.status(400).json({ error: "Invalid continuity history request", code: "INVALID_CONTINUITY_HISTORY_REQUEST" });
  try {
    res.json(await getContinuityHistory(res.locals.userId as string, sceneId.data, itemId && itemId.success ? itemId.data : undefined));
  } catch (error) {
    decisionError(res, error);
  }
});

router.get("/continuity/issues/:issueId/history", async (req, res): Promise<void> => {
  const issueId = idSchema.safeParse(req.params.issueId);
  if (!issueId.success) return void res.status(400).json({ error: "Invalid continuity issue id", code: "INVALID_CONTINUITY_ISSUE_ID" });
  try {
    res.json(await getIssueHistory(res.locals.userId as string, issueId.data));
  } catch (error) {
    decisionError(res, error);
  }
});

router.post("/continuity/issues/:issueId/notes", async (req, res): Promise<void> => {
  const issueId = idSchema.safeParse(req.params.issueId);
  const body = z.object({ note: z.string().min(1).max(1000) }).safeParse(req.body);
  if (!issueId.success || !body.success) return void res.status(400).json({ error: "A short issue note is required", code: "INVALID_ISSUE_NOTE" });
  try {
    res.status(201).json(serializeContinuityIssue(await addIssueNote(res.locals.userId as string, issueId.data, body.data.note)));
  } catch (error) {
    decisionError(res, error);
  }
});

router.post("/continuity/issues/:issueId/ignore", async (req, res): Promise<void> => {
  const issueId = idSchema.safeParse(req.params.issueId);
  const body = z.object({ note: z.string().max(1000).optional() }).safeParse(req.body ?? {});
  if (!issueId.success || !body.success) return void res.status(400).json({ error: "Invalid ignore request", code: "INVALID_ISSUE_IGNORE" });
  try {
    res.json(serializeContinuityIssue(await ignoreIssue(res.locals.userId as string, issueId.data, body.data.note)));
  } catch (error) {
    decisionError(res, error);
  }
});

router.post("/continuity/issues/:issueId/intentional", async (req, res): Promise<void> => {
  const issueId = idSchema.safeParse(req.params.issueId);
  const body = intentionalChangeBody.safeParse(req.body);
  if (!issueId.success || !body.success) return void res.status(400).json({ error: "Invalid intentional continuity change", code: "INVALID_INTENTIONAL_CHANGE" });
  try {
    const result = await approveIntentionalChange(res.locals.userId as string, issueId.data, body.data);
    res.status(result.created ? 201 : 200).json({ issue: serializeContinuityIssue(result.issue), change: serializeDecisionChange(result.change), created: result.created });
  } catch (error) {
    decisionError(res, error);
  }
});

router.post("/continuity/issues/:issueId/recheck", async (req, res): Promise<void> => {
  const issueId = idSchema.safeParse(req.params.issueId);
  const body = z.object({ takeId: idSchema, retry: z.boolean().optional() }).safeParse(req.body);
  if (!issueId.success || !body.success) return void res.status(400).json({ error: "A new take is required for recheck", code: "INVALID_RECHECK_REQUEST" });
  const ownedTake = await getOwnedTakeContext(res.locals.userId as string, body.data.takeId, "write");
  if (!ownedTake) return void res.status(404).json({ error: "Take not found", code: "TAKE_NOT_FOUND" });
  try {
    await validateRecheckTake(res.locals.userId as string, issueId.data, ownedTake.take.id, ownedTake.shot.id);
    await startContinuityCheck(body.data.takeId, body.data.retry ?? false, { recheckIssueId: issueId.data, requestedByUserId: res.locals.userId as string });
    const result = await getContinuityCheckResult(body.data.takeId);
    if (!result) return void res.status(500).json({ error: "Recheck could not be created", code: "RECHECK_NOT_CREATED" });
    res.status(202).json(result);
  } catch (error) {
    decisionError(res, error);
  }
});

// A generic status endpoint keeps the decision surface useful to integrations while
// the named actions above make the human workflow explicit in the UI.
router.patch("/continuity/issues/:issueId", async (req, res): Promise<void> => {
  const issueId = idSchema.safeParse(req.params.issueId);
  const body = z.object({ status: z.enum(["ignored", "intentional"]), note: z.string().max(1000).optional(), effectiveScope: z.enum(["this_shot", "rest_of_scene", "from_now_on"]).optional(), newState: z.string().max(1000).optional() }).safeParse(req.body);
  if (!issueId.success || !body.success) return void res.status(400).json({ error: "Invalid continuity issue decision", code: "INVALID_ISSUE_DECISION" });
  try {
    if (body.data.status === "ignored") {
      res.json(serializeContinuityIssue(await ignoreIssue(res.locals.userId as string, issueId.data, body.data.note)));
    } else {
      const result = await approveIntentionalChange(res.locals.userId as string, issueId.data, {
        effectiveScope: body.data.effectiveScope ?? "from_now_on",
        newState: body.data.newState,
        note: body.data.note,
      });
      res.json({ issue: serializeContinuityIssue(result.issue), change: serializeDecisionChange(result.change), created: result.created });
    }
  } catch (error) {
    decisionError(res, error);
  }
});

export default router;
