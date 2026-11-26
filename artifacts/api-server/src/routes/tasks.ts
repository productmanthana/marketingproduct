import { Router, type IRouter } from "express";
import { and, asc, desc, eq, inArray, type SQL } from "drizzle-orm";
import { db, dealsTable, leadsTable, tasksTable, type TaskRow } from "@workspace/db";
import {
  CreateTaskBody,
  DeleteTaskParams,
  ListTasksQueryParams,
  ListTasksResponse,
  UpdateTaskBody,
  UpdateTaskParams,
  UpdateTaskResponse,
} from "@workspace/api-zod";
import { createTask, leadName } from "../lib/outreach";

const router: IRouter = Router();

export async function serializeTasks(tasks: TaskRow[]) {
  const ids = [...new Set(tasks.map((t) => t.leadId).filter((x): x is number => x != null))];
  const leads = ids.length ? await db.select().from(leadsTable).where(inArray(leadsTable.id, ids)) : [];
  const dealIds = [...new Set(tasks.map((t) => t.dealId).filter((x): x is number => x != null))];
  const deals = dealIds.length ? await db.select({ id: dealsTable.id, name: dealsTable.name }).from(dealsTable).where(inArray(dealsTable.id, dealIds)) : [];
  return tasks.map((t) => {
    const lead = leads.find((l) => l.id === t.leadId);
    return { ...t, leadName: lead ? leadName(lead) : null, dealName: deals.find((d) => d.id === t.dealId)?.name ?? null };
  });
}

router.get("/tasks", async (req, res): Promise<void> => {
  const q = ListTasksQueryParams.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: q.error.message });
    return;
  }
  const conds: SQL[] = [];
  // z.coerce.boolean() turns the string "false" into true, so read the flag from the raw query string.
  if (q.data.done !== undefined) conds.push(eq(tasksTable.done, String(req.query.done) === "true"));
  if (q.data.leadId) conds.push(eq(tasksTable.leadId, q.data.leadId));
  if (q.data.dealId) conds.push(eq(tasksTable.dealId, q.data.dealId));
  const rows = await db
    .select()
    .from(tasksTable)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(tasksTable.done), asc(tasksTable.dueAt), desc(tasksTable.createdAt));
  res.json(ListTasksResponse.parse(await serializeTasks(rows)));
});

router.post("/tasks", async (req, res): Promise<void> => {
  const parsed = CreateTaskBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const task = await createTask({
    title: parsed.data.title,
    leadId: parsed.data.leadId ?? null,
    dealId: parsed.data.dealId ?? null,
    dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null,
    source: "manual",
  });
  res.status(201).json((await serializeTasks([task]))[0]);
});

router.patch("/tasks/:id", async (req, res): Promise<void> => {
  const params = UpdateTaskParams.safeParse(req.params);
  const parsed = UpdateTaskBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: (params.error ?? parsed.error)?.message });
    return;
  }
  const { dueAt, ...rest } = parsed.data;
  const [task] = await db
    .update(tasksTable)
    .set({ ...rest, ...(dueAt !== undefined ? { dueAt: dueAt ? new Date(dueAt) : null } : {}) })
    .where(eq(tasksTable.id, params.data.id))
    .returning();
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  res.json(UpdateTaskResponse.parse((await serializeTasks([task]))[0]));
});

router.delete("/tasks/:id", async (req, res): Promise<void> => {
  const params = DeleteTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  await db.delete(tasksTable).where(eq(tasksTable.id, params.data.id));
  res.sendStatus(204);
});

export default router;
