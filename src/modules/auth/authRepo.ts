import type { Kysely } from "kysely";
import type { Database, UserRole } from "../../db/types.js";

export class AuthRepo {
  constructor(private readonly db: Kysely<Database>) {}

  findUserByEmail(orgId: string, email: string) {
    return this.db
      .selectFrom("users")
      .selectAll()
      .where("org_id", "=", orgId)
      .where("email", "=", email)
      .executeTakeFirst();
  }

  findUserById(userId: string) {
    return this.db.selectFrom("users").selectAll().where("id", "=", userId).executeTakeFirst();
  }

  createUser(input: { orgId: string; email: string; passwordHash: string; role: UserRole }) {
    return this.db
      .insertInto("users")
      .values({
        org_id: input.orgId,
        email: input.email,
        password_hash: input.passwordHash,
        role: input.role,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  storeRefreshToken(input: { userId: string; tokenHash: string; expiresAt: Date }) {
    return this.db
      .insertInto("refresh_tokens")
      .values({ user_id: input.userId, token_hash: input.tokenHash, expires_at: input.expiresAt })
      .execute();
  }

  findLiveRefreshToken(tokenHash: string) {
    return this.db
      .selectFrom("refresh_tokens")
      .selectAll()
      .where("token_hash", "=", tokenHash)
      .where("revoked_at", "is", null)
      .where("expires_at", ">", new Date())
      .executeTakeFirst();
  }

  revokeRefreshToken(tokenHash: string) {
    return this.db
      .updateTable("refresh_tokens")
      .set({ revoked_at: new Date() })
      .where("token_hash", "=", tokenHash)
      .execute();
  }
}
