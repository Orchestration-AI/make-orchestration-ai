// @deno-types="npm:@types/express@5.0.0"
import { type NextFunction, type Request, type Response } from "express";
import process from "node:process";
import type { Context } from "./types.ts";

export async function getContext(layerId: string): Promise<Context> {
  const endpoint = `${process.env.ENGINE_URL}/agents/context/${layerId}`;
  return (
    await fetch(endpoint, {
      headers: {
        Authorization: `Bearer ${process.env.OAI_ACCESS_KEY}`,
      },
    })
  ).json();
}

export const contextMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const layerId = req.get("X-LayerId");

  if (layerId) {
    res.locals.context = await getContext(layerId);
  } else {
    // This call does not come from an agent. Depending on the service, such calls
    // can be ignored or flag an error.
  }

  next();
};
