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

const router: IRouter = Router();

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
  const ownedTake = await getOwnedTakeContext(res.locals.userId as string, params.data.takeId);
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
  const ownedTake = await getOwnedTakeContext(res.locals.userId as string, params.data.takeId);
  if (!ownedTake) return void res.status(404).json({ error: "Take not found", code: "TAKE_NOT_FOUND" });
  try {
    await startContinuityCheck(params.data.takeId, body.data.retry ?? false);
    const result = await getContinuityCheckResult(params.data.takeId);
    if (!result) return void res.status(500).json({ error: "Continuity check could not be created", code: "CHECK_NOT_CREATED" });
    res.status(202).json(RunContinuityCheckResponse.parse(result));
  } catch (error) {
    req.log.error({ error, takeId: params.data.takeId }, "Could not start continuity check");
    res.status(409).json({ error: error instanceof Error ? error.message : "Continuity check could not start", code: "CONTINUITY_CHECK_START_FAILED" });
  }
});

export default router;
