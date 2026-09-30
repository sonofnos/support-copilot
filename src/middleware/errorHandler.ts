import type { NextFunction, Request, Response } from "express";
import type { Logger } from "pino";

export function errorHandler(logger: Logger) {
  // Express only recognizes this as an error-handling middleware because it
  // has exactly 4 parameters - do not remove the unused `_next`.
  return (err: unknown, req: Request, res: Response, _next: NextFunction) => {
    logger.error({ err, path: req.path }, "unhandled request error");

    if (res.headersSent) return;
    res.status(500).json({ error: "internal server error" });
  };
}
