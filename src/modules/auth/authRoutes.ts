import { Router } from "express";
import { z } from "zod";
import { hashPassword, verifyPassword } from "../../auth/password.js";
import type { TokenService } from "../../auth/jwt.js";
import type { TokenBucketRateLimiter } from "../../redis/rateLimiter.js";
import { validateBody } from "../../middleware/validate.js";
import type { AuthRepo } from "./authRepo.js";

const registerSchema = z.object({
  orgId: z.string().uuid(),
  email: z.string().email(),
  password: z.string().min(10),
  role: z.enum(["admin", "agent", "customer"]).default("customer"),
});

const loginSchema = z.object({
  orgId: z.string().uuid(),
  email: z.string().email(),
  password: z.string().min(1),
});

const refreshSchema = z.object({ refreshToken: z.string().min(1) });

export function buildAuthRouter(deps: { repo: AuthRepo; tokens: TokenService; loginLimiter: TokenBucketRateLimiter }) {
  const router = Router();
  const { repo, tokens, loginLimiter } = deps;

  router.post("/register", validateBody(registerSchema), async (req, res) => {
    const { orgId, email, password, role } = req.body as z.infer<typeof registerSchema>;

    const existing = await repo.findUserByEmail(orgId, email);
    if (existing) {
      res.status(409).json({ error: "email already registered for this org" });
      return;
    }

    const passwordHash = await hashPassword(password);
    const user = await repo.createUser({ orgId, email, passwordHash, role });
    res.status(201).json({ id: user.id, email: user.email, role: user.role });
  });

  router.post("/login", validateBody(loginSchema), async (req, res) => {
    const { orgId, email, password } = req.body as z.infer<typeof loginSchema>;

    // Rate-limit by (org, email) rather than by IP alone: an attacker behind
    // NAT/a shared corporate IP shouldn't be able to lock out that whole
    // IP's legitimate logins, but repeated guesses against one account are
    // still capped regardless of which IP they come from.
    const { allowed } = await loginLimiter.consume(`login:${orgId}:${email}`);
    if (!allowed) {
      res.status(429).json({ error: "too many login attempts, try again shortly" });
      return;
    }

    const user = await repo.findUserByEmail(orgId, email);
    const valid = user ? await verifyPassword(user.password_hash, password) : false;

    if (!user || !valid) {
      res.status(401).json({ error: "invalid credentials" });
      return;
    }

    const accessToken = tokens.signAccessToken({ sub: user.id, orgId: user.org_id, role: user.role });
    const refresh = tokens.issueRefreshToken();
    await repo.storeRefreshToken({ userId: user.id, tokenHash: refresh.hash, expiresAt: refresh.expiresAt });

    res.json({ accessToken, refreshToken: refresh.raw });
  });

  router.post("/refresh", validateBody(refreshSchema), async (req, res) => {
    const { refreshToken } = req.body as z.infer<typeof refreshSchema>;
    const tokenHash = tokens.hashRefreshToken(refreshToken);

    const stored = await repo.findLiveRefreshToken(tokenHash);
    if (!stored) {
      res.status(401).json({ error: "invalid or expired refresh token" });
      return;
    }

    const user = await repo.findUserById(stored.user_id);
    if (!user) {
      res.status(401).json({ error: "invalid refresh token" });
      return;
    }

    // Rotate on every use: the old token is revoked immediately so a stolen
    // refresh token can be used at most once before this endpoint would
    // start rejecting both the thief's and the legitimate holder's copy,
    // which is the standard signal to force a full re-login.
    await repo.revokeRefreshToken(tokenHash);
    const newRefresh = tokens.issueRefreshToken();
    await repo.storeRefreshToken({
      userId: user.id,
      tokenHash: newRefresh.hash,
      expiresAt: newRefresh.expiresAt,
    });

    const accessToken = tokens.signAccessToken({ sub: user.id, orgId: user.org_id, role: user.role });
    res.json({ accessToken, refreshToken: newRefresh.raw });
  });

  router.post("/logout", validateBody(refreshSchema), async (req, res) => {
    const { refreshToken } = req.body as z.infer<typeof refreshSchema>;
    await repo.revokeRefreshToken(tokens.hashRefreshToken(refreshToken));
    res.status(204).send();
  });

  return router;
}
