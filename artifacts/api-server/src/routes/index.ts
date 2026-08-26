import { Router, type IRouter } from "express";
import healthRouter from "./health";
import dashboardRouter from "./dashboard";
import projectsRouter from "./projects";
import { requireIdentity } from "../middlewares/identity";

const router: IRouter = Router();

router.use(healthRouter);
router.use(requireIdentity);
router.use(dashboardRouter);
router.use(projectsRouter);

export default router;
