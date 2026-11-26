import { Router, type IRouter } from "express";
import healthRouter from "./health";
import leadsRouter from "./leads";
import campaignsRouter from "./campaigns";
import conversationsRouter from "./conversations";
import callsRouter from "./calls";
import dashboardRouter from "./dashboard";
import mailboxesRouter from "./mailboxes";
import tasksRouter from "./tasks";
import publicRouter from "./public";
import prospectsRouter from "./prospects";
import accountsRouter from "./accounts";
import dealsRouter from "./deals";
import crmRouter from "./crm";

const router: IRouter = Router();

router.use(healthRouter);
router.use(leadsRouter);
router.use(campaignsRouter);
router.use(conversationsRouter);
router.use(callsRouter);
router.use(dashboardRouter);
router.use(mailboxesRouter);
router.use(tasksRouter);
router.use(publicRouter);
router.use(prospectsRouter);
router.use(accountsRouter);
router.use(dealsRouter);
router.use(crmRouter);

export default router;
