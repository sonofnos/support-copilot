import { createHmac } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestStack, type TestStack } from "./setup.js";

let stack: TestStack;

beforeAll(async () => {
  stack = await startTestStack();
}, 120_000);

afterAll(async () => {
  await stack.teardown();
});

async function createOrgAndLogin(orgName: string) {
  const email = `admin@${orgName.toLowerCase().replace(/\s+/g, "-")}.test`;
  const password = "correct-horse-battery-staple";

  const createRes = await request(stack.app)
    .post("/orgs")
    .send({ orgName, adminEmail: email, adminPassword: password })
    .expect(201);

  const loginRes = await request(stack.app)
    .post("/auth/login")
    .send({ orgId: createRes.body.org.id, email, password })
    .expect(200);

  return { orgId: createRes.body.org.id as string, ...loginRes.body };
}

describe("auth", () => {
  it("registers an org with its admin and logs in", async () => {
    const { accessToken, refreshToken } = await createOrgAndLogin("Auth Test Co");
    expect(accessToken).toBeTruthy();
    expect(refreshToken).toBeTruthy();
  });

  it("rejects wrong passwords and rate-limits repeated attempts", async () => {
    const orgRes = await request(stack.app)
      .post("/orgs")
      .send({ orgName: "Rate Limit Co", adminEmail: "admin@ratelimit.test", adminPassword: "correct-password-1" })
      .expect(201);

    const attempt = () =>
      request(stack.app)
        .post("/auth/login")
        .send({ orgId: orgRes.body.org.id, email: "admin@ratelimit.test", password: "wrong-password" });

    // Bucket capacity is 5 (see src/context.ts); the first 5 should be
    // rejected as bad credentials, the 6th should be rejected by the
    // rate limiter itself before a password check even happens.
    for (let i = 0; i < 5; i++) {
      const res = await attempt();
      expect(res.status).toBe(401);
    }
    const limited = await attempt();
    expect(limited.status).toBe(429);
  });

  it("rotates refresh tokens and rejects a reused one", async () => {
    const { refreshToken } = await createOrgAndLogin("Rotation Co");

    const first = await request(stack.app).post("/auth/refresh").send({ refreshToken }).expect(200);
    expect(first.body.refreshToken).not.toEqual(refreshToken);

    // The original token was revoked on rotation; reusing it must fail.
    await request(stack.app).post("/auth/refresh").send({ refreshToken }).expect(401);
  });
});

describe("articles", () => {
  it("creates an article, embeds it asynchronously, and finds it via semantic search", async () => {
    const { accessToken } = await createOrgAndLogin("KB Co");
    const auth = { authorization: `Bearer ${accessToken}` };

    const passwordArticle = await request(stack.app)
      .post("/articles")
      .set(auth)
      .send({ title: "How to reset your password", body: "Go to settings and click reset password.", tags: ["auth"] })
      .expect(201);

    await request(stack.app)
      .post("/articles")
      .set(auth)
      .send({ title: "Refund policy", body: "Annual plans can be refunded within 30 days.", tags: ["billing"] })
      .expect(201);

    // The embedding worker isn't running in this test process; wait for the
    // queue to actually drain (qdrant_point_id set on the DB row) rather
    // than polling the search endpoint itself. Search is cache-aside (see
    // articlesRoutes.ts): calling it before indexing finishes would cache
    // an empty result for 60s and every later poll in this test would just
    // keep reading that same stale empty cache entry.
    const { buildEmbeddingWorker } = await import("../../src/queue/worker.js");
    const worker = await buildEmbeddingWorker(stack.env);
    await worker.waitUntilReady();

    let indexed = false;
    for (let i = 0; i < 20; i++) {
      const row = await stack.ctx.db
        .selectFrom("articles")
        .select("qdrant_point_id")
        .where("id", "=", passwordArticle.body.id)
        .executeTakeFirst();
      if (row?.qdrant_point_id) {
        indexed = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    await worker.close();
    expect(indexed).toBe(true);

    const res = await request(stack.app)
      .get("/articles/search")
      .set(auth)
      .query({ q: "I forgot my password", limit: 3 })
      .expect(200);

    expect(res.body.length).toBeGreaterThan(0);
    expect((res.body[0] as { title: string }).title).toMatch(/password/i);
  });

  it("scopes semantic search to the caller's org", async () => {
    const orgA = await createOrgAndLogin("Scope Org A");
    const orgB = await createOrgAndLogin("Scope Org B");

    const orgAArticle = await request(stack.app)
      .post("/articles")
      .set({ authorization: `Bearer ${orgA.accessToken}` })
      .send({ title: "Org A secret runbook", body: "Only org A should ever see this.", tags: [] })
      .expect(201);

    const { buildEmbeddingWorker } = await import("../../src/queue/worker.js");
    const worker = await buildEmbeddingWorker(stack.env);
    await worker.waitUntilReady();
    for (let i = 0; i < 20; i++) {
      const row = await stack.ctx.db
        .selectFrom("articles")
        .select("qdrant_point_id")
        .where("id", "=", orgAArticle.body.id)
        .executeTakeFirst();
      if (row?.qdrant_point_id) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    await worker.close();

    const res = await request(stack.app)
      .get("/articles/search")
      .set({ authorization: `Bearer ${orgB.accessToken}` })
      .query({ q: "Org A secret runbook", limit: 5 })
      .expect(200);

    expect(res.body).toEqual([]);
  });
});

describe("tickets", () => {
  it("supports the create -> message -> status -> stats lifecycle", async () => {
    const { accessToken } = await createOrgAndLogin("Tickets Co");
    const auth = { authorization: `Bearer ${accessToken}` };

    const ticketRes = await request(stack.app)
      .post("/tickets")
      .set(auth)
      .send({ subject: "Cannot access my account" })
      .expect(201);

    await request(stack.app)
      .post(`/tickets/${ticketRes.body.id}/messages`)
      .set(auth)
      .send({ body: "I get an error when logging in." })
      .expect(201);

    await request(stack.app)
      .patch(`/tickets/${ticketRes.body.id}/status`)
      .set(auth)
      .send({ status: "resolved" })
      .expect(200);

    const summaryRes = await request(stack.app)
      .get(`/tickets/${ticketRes.body.id}/summary`)
      .set(auth)
      .expect(200);
    expect(summaryRes.body.summary).toBeTruthy();

    const queueRes = await request(stack.app).get("/tickets").set(auth).expect(200);
    // Resolved tickets fall out of the open-queue partial index by design.
    expect(queueRes.body.find((t: { id: string }) => t.id === ticketRes.body.id)).toBeUndefined();
  });

  it("finds similar tickets scoped to the org", async () => {
    const { accessToken } = await createOrgAndLogin("Similar Tickets Co");
    const auth = { authorization: `Bearer ${accessToken}` };

    const first = await request(stack.app)
      .post("/tickets")
      .set(auth)
      .send({ subject: "Payment failed on checkout" })
      .expect(201);
    const second = await request(stack.app)
      .post("/tickets")
      .set(auth)
      .send({ subject: "My payment did not go through at checkout" })
      .expect(201);

    const { buildEmbeddingWorker } = await import("../../src/queue/worker.js");
    const worker = await buildEmbeddingWorker(stack.env);
    await worker.waitUntilReady();

    let hits: { ticket: { id: string } }[] = [];
    for (let i = 0; i < 20; i++) {
      const res = await request(stack.app).get(`/tickets/${first.body.id}/similar`).set(auth);
      hits = res.body;
      if (hits.length > 0) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    await worker.close();

    expect(hits.some((h) => h.ticket.id === second.body.id)).toBe(true);
  });
});

describe("inbound webhook", () => {
  it("verifies HMAC signatures and is idempotent on a replayed event id", async () => {
    const { orgId, accessToken } = await createOrgAndLogin("Webhook Co");

    // Grab the customer id back out via a ticket creation (auth's sub claim
    // is the admin; for this test we just reuse the admin as the customer).
    const meRes = await request(stack.app)
      .post("/tickets")
      .set({ authorization: `Bearer ${accessToken}` })
      .send({ subject: "seed" })
      .expect(201);
    const customerId = meRes.body.customer_id as string;

    const payload = { eventId: "evt-123", orgId, customerId, subject: "Inbound from email", body: "Help please" };
    const rawBody = Buffer.from(JSON.stringify(payload));
    const signature = createHmac("sha256", "test-webhook-secret").update(rawBody).digest("hex");

    const first = await request(stack.app)
      .post("/webhooks/inbound-email")
      .set("x-signature", signature)
      .send(rawBody)
      .expect(201);

    const replay = await request(stack.app)
      .post("/webhooks/inbound-email")
      .set("x-signature", signature)
      .send(rawBody)
      .expect(200);

    expect(replay.body.status).toBe("already processed");
    expect(first.body.ticketId).toBeTruthy();

    await request(stack.app)
      .post("/webhooks/inbound-email")
      .set("x-signature", "0".repeat(64))
      .send(rawBody)
      .expect(401);
  });
});
