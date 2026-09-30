import { createHmac, timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import type { Queue } from "bullmq";
import type { EmbedJobData } from "../../queue/embeddingQueue.js";
import type { TicketsRepo } from "../tickets/ticketsRepo.js";
import type { WebhooksRepo } from "./webhooksRepo.js";

const inboundEmailSchema = z.object({
  eventId: z.string().min(1),
  orgId: z.string().uuid(),
  customerId: z.string().uuid(),
  subject: z.string().min(1),
  body: z.string().min(1),
});

function verifySignature(secret: string, rawBody: Buffer, signatureHeader: string | undefined): boolean {
  if (!signatureHeader) return false;

  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const provided = Buffer.from(signatureHeader, "hex");

  // Constant-time compare so response timing can't be used to guess the
  // signature byte-by-byte; a naive `===`/Buffer.equals short-circuits on
  // the first mismatched byte.
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export function buildWebhooksRouter(deps: {
  repo: WebhooksRepo;
  ticketsRepo: TicketsRepo;
  embeddingQueue: Queue<EmbedJobData>;
  webhookSecret: string;
}) {
  const router = Router();
  const { repo, ticketsRepo, embeddingQueue, webhookSecret } = deps;

  // Mounted behind express.raw() in app.ts, NOT express.json() - the HMAC
  // must be computed over the exact bytes the sender signed, and JSON
  // re-serialization is not guaranteed to reproduce them byte-for-byte.
  router.post("/inbound-email", async (req, res) => {
    const rawBody = req.body as Buffer;
    if (!verifySignature(webhookSecret, rawBody, req.header("x-signature"))) {
      res.status(401).json({ error: "invalid signature" });
      return;
    }

    const parsed = inboundEmailSchema.safeParse(JSON.parse(rawBody.toString("utf8")));
    if (!parsed.success) {
      res.status(400).json({ error: "validation failed", details: parsed.error.flatten() });
      return;
    }

    const { eventId, orgId, customerId, subject, body } = parsed.data;
    const isNew = await repo.recordEventOnce("inbound-email", eventId, parsed.data);
    if (!isNew) {
      res.status(200).json({ status: "already processed" });
      return;
    }

    const ticket = await ticketsRepo.create({ orgId, customerId, subject });
    await ticketsRepo.addMessage({ ticketId: ticket.id, authorId: customerId, body });
    await embeddingQueue.add("embed-ticket", { kind: "ticket", id: ticket.id, orgId, text: `${subject}\n${body}` });

    res.status(201).json({ ticketId: ticket.id });
  });

  return router;
}
