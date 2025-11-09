import { Router } from "express";
import type { Request, Response } from "npm:@types/express@5.0.0";
import { create, all } from "npm:mathjs";
import { mathJsServiceFunctions } from "./mathjs.description.ts";

const config = {};
const math = create(all, config);

export const mathjsRouter = Router();

mathjsRouter.post("/api/evaluate", (req: Request, res: Response) => {
  try {
    const expression = req.body.expression;
    const result = math.evaluate(expression);
    res.send(result);
  } catch (e) {
    res.status(500).send(`Error evaluating expression: ${e}`);
  }
});

mathjsRouter.get("/api/description", (_req: Request, res: Response) => {
  res.send(mathJsServiceFunctions);
});
