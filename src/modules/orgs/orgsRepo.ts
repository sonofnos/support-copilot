import type { Kysely } from "kysely";
import type { Database } from "../../db/types.js";

export class OrgsRepo {
  constructor(private readonly db: Kysely<Database>) {}

  // Org + its first admin user are created in one transaction: an org with
  // no admin (insert 1 succeeds, insert 2 fails) would be an orphaned,
  // unusable tenant with no way to log in and fix it.
  async createWithAdmin(input: { orgName: string; adminEmail: string; adminPasswordHash: string }) {
    return this.db.transaction().execute(async (trx) => {
      const org = await trx.insertInto("orgs").values({ name: input.orgName }).returningAll().executeTakeFirstOrThrow();

      const admin = await trx
        .insertInto("users")
        .values({
          org_id: org.id,
          email: input.adminEmail,
          password_hash: input.adminPasswordHash,
          role: "admin",
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      return { org, admin };
    });
  }
}
