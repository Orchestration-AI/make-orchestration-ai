// @deno-types="npm:@types/express@5.0.0"
import { type NextFunction, type Request, type Response } from "express";

export const contextMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const layerId = req.get("X-LayerId");

  if (layerId) {
    // TODO: Fetch data and build context
    // <--- We are here
    res.locals.context = {};
  } else {
    // This call does not come from an agent. Depending on the service, such calls
    // can be ignored or flag an error.
  }

  next();
};
