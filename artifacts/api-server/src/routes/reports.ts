import { Router, type IRouter } from "express";
import { GenerateDailyReportBody, GenerateDailyReportResponse, GetDailyReportQueryParams, GetDailyReportResponse } from "@workspace/api-zod";
import { getDailyReport, generateDailyReportForUser } from "../services/reports";
import { trackEvent } from "../services/analytics";

const router: IRouter = Router();

router.get("/reports/daily", async (req, res): Promise<void> => {
  const rawShootDate = typeof req.query.shootDate === "string" ? new Date(`${req.query.shootDate}T00:00:00.000Z`) : undefined;
  const query = GetDailyReportQueryParams.safeParse({ ...req.query, shootDate: rawShootDate });
  if (!query.success) return void res.status(400).json({ error: "Invalid daily report request", code: "INVALID_DAILY_REPORT_QUERY" });
  const shootDate = query.data.shootDate?.toISOString().slice(0, 10);
  const report = await getDailyReport(res.locals.userId as string, query.data.projectId, shootDate);
  if (!report) return void res.status(404).json({ error: "Project not found", code: "PROJECT_NOT_FOUND" });
  GetDailyReportResponse.parse(report);
  await trackEvent({ projectId: report.projectId, name: "report_viewed", metadata: { shootDate: report.shootDate } });
  res.json(report);
});

router.post("/reports/daily", async (req, res): Promise<void> => {
  const body = GenerateDailyReportBody.safeParse(req.body);
  if (!body.success) return void res.status(400).json({ error: "Invalid daily report request", code: "INVALID_DAILY_REPORT_REQUEST" });
  const shootDate = body.data.shootDate.toISOString().slice(0, 10);
  const report = await generateDailyReportForUser(res.locals.userId as string, body.data.projectId, shootDate);
  if (!report) return void res.status(404).json({ error: "Project not found", code: "PROJECT_NOT_FOUND" });
  GenerateDailyReportResponse.parse(report);
  res.json(report);
});

export default router;
