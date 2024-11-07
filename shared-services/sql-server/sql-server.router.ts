import { Router } from "express";
import type { Context } from "../types.ts";
import { runQuery } from "./sql-server.service.ts";
import type { Request, Response } from "npm:@types/express@5.0.0";
import { sqlServerServiceFunctions } from "./sql-server.description.ts";
import { defaultSettings } from "./sql-server.constants.ts";

export const sqlServerRouter = Router();

sqlServerRouter.get("/api/default-settings", (_req: Request, res: Response) => {
  res.status(200).json(defaultSettings);
});

sqlServerRouter.post("/api/run_query", async (req: Request, res: Response) => {
  const context: Context = res.locals.context;

  try {
    console.log(req.body.query);
    const results = await runQuery(req.body.query, context);
    res.status(200).json(results);
  } catch (e) {
    console.warn(e);
    res.status(500).send(`Error. Could not run given query. Cause ${e}`);
  }
});

sqlServerRouter.get("/api/description", (_req: Request, res: Response) => {
  res.status(200).send(sqlServerServiceFunctions);
});
