import type { NextFunction, Request, Response } from "express";
import type { UserRole } from "../db/types.js";
import type { AccessTokenClaims, TokenService } from "./jwt.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AccessTokenClaims;
    }
  }
}

export function requireAuth(tokens: TokenService) {
  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.header("authorization");
    if (!header?.startsWith("Bearer ")) {
      res.status(401).json({ error: "missing bearer token" });
      return;
    }

    try {
      req.auth = tokens.verifyAccessToken(header.slice("Bearer ".length));
      next();
    } catch {
      res.status(401).json({ error: "invalid or expired token" });
    }
  };
}

// Role check is a separate middleware from requireAuth so routes can
// compose "authenticated" and "authenticated as role X" independently
// instead of one monolithic auth function branching on every route's needs.
export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth || !roles.includes(req.auth.role)) {
      res.status(403).json({ error: "insufficient role" });
      return;
    }
    next();
  };
}
