import { Router, type IRouter } from "express";
import healthRouter from "./health";
import leadsRouter from "./leads";
import campaignsRouter from "./campaigns";
import conversationsRouter from "./conversations";
import callsRouter from "./calls";
import dashboardRouter from "./dashboard";

const router: IRouter = Router();

router.use(healthRouter);
router.use(leadsRouter);
router.use(campaignsRouter);
router.use(conversationsRouter);
router.use(callsRouter);
router.use(dashboardRouter);

export default router;
