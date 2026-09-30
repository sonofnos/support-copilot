import { createHash, randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import type { UserRole } from "../db/types.js";

export interface AccessTokenClaims {
  sub: string;
  orgId: string;
  role: UserRole;
}

export class TokenService {
  constructor(
    private readonly accessSecret: string,
    private readonly refreshSecret: string,
    private readonly accessTtlSeconds: number,
    private readonly refreshTtlSeconds: number,
  ) {}

  signAccessToken(claims: AccessTokenClaims): string {
    return jwt.sign(claims, this.accessSecret, { expiresIn: this.accessTtlSeconds });
  }

  verifyAccessToken(token: string): AccessTokenClaims {
    return jwt.verify(token, this.accessSecret) as unknown as AccessTokenClaims;
  }

  // Refresh tokens are opaque, random, and stored server-side only as a
  // hash (never the raw token) - matches the access-token pattern of
  // "possession of the secret proves identity" while making a leaked DB
  // useless to an attacker without also owning the JWT signing key.
  issueRefreshToken(): { raw: string; hash: string; expiresAt: Date } {
    const raw = randomBytes(48).toString("base64url");
    const hash = createHash("sha256").update(raw).digest("hex");
    const expiresAt = new Date(Date.now() + this.refreshTtlSeconds * 1000);
    return { raw, hash, expiresAt };
  }

  hashRefreshToken(raw: string): string {
    return createHash("sha256").update(raw).digest("hex");
  }
}
