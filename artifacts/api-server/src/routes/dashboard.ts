import { Router, type IRouter } from "express";
import {
  GetDashboardResponse,
  ListActivityQueryParams,
  ListActivityResponse,
} from "@workspace/api-zod";
import {
  getDashboardCounts,
  listOwnedActivity,
  listOwnedProjects,
} from "../services/repository";

const router: IRouter = Router();

router.get("/dashboard", async (_req, res): Promise<void> => {
  const userId = res.locals.userId as string;
  const [counts, projects, recentActivity] = await Promise.all([
    getDashboardCounts(userId),
    listOwnedProjects(userId),
    listOwnedActivity(userId, { limit: 6 }),
  ]);
  res.json(GetDashboardResponse.parse({ ...counts, projects, recentActivity }));
});

router.get("/activity", async (req, res): Promise<void> => {
  const query = ListActivityQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message, code: "INVALID_ACTIVITY_QUERY" });
    return;
  }
  const events = await listOwnedActivity(res.locals.userId as string, {
    limit: query.data.limit ?? 10,
    offset: query.data.offset ?? 0,
    agent: query.data.agent,
    status: query.data.status,
  });
  res.json(ListActivityResponse.parse(events));
});

export default router;
