import { Router } from "express";
import { z } from "zod";
import type { EmbeddingClient } from "../../ai/embeddings/EmbeddingClient.js";
import type { LlmClient } from "../../ai/llm/LlmClient.js";
import type { Queue } from "bullmq";
import type { EmbedJobData } from "../../queue/embeddingQueue.js";
import type { TicketVectorStore } from "../../qdrant/ticketsCollection.js";
import type { TicketEventPublisher, TicketEventSubscriber } from "../../redis/pubsub.js";
import { validateBody } from "../../middleware/validate.js";
import { requireRole } from "../../auth/middleware.js";
import type { TicketsRepo } from "./ticketsRepo.js";

const createSchema = z.object({ subject: z.string().min(3).max(200) });
const messageSchema = z.object({ body: z.string().min(1).max(10_000) });
const statusSchema = z.object({ status: z.enum(["open", "pending", "resolved", "closed"]) });

export function buildTicketsRouter(deps: {
  repo: TicketsRepo;
  embeddings: EmbeddingClient;
  llm: LlmClient;
  ticketStore: TicketVectorStore;
  embeddingQueue: Queue<EmbedJobData>;
  publisher: TicketEventPublisher;
  subscriberFactory: () => TicketEventSubscriber;
}) {
  const router = Router();
  const { repo, embeddings, llm, ticketStore, embeddingQueue, publisher, subscriberFactory } = deps;

  router.post("/", requireRole("customer", "admin"), validateBody(createSchema), async (req, res) => {
    const orgId = req.auth!.orgId;
    const { subject } = req.body as z.infer<typeof createSchema>;

    const ticket = await repo.create({ orgId, customerId: req.auth!.sub, subject });
    await embeddingQueue.add("embed-ticket", { kind: "ticket", id: ticket.id, orgId, text: subject });

    res.status(201).json(ticket);
  });

  router.get("/", requireRole("agent", "admin"), async (req, res) => {
    res.json(await repo.listOpenQueue(req.auth!.orgId));
  });

  router.get("/stats", requireRole("agent", "admin"), async (req, res) => {
    const stats = await repo.statsForOrg(req.auth!.orgId);
    res.json(
      stats ?? { org_id: req.auth!.orgId, open_count: "0", resolved_count: "0", avg_resolution_seconds: null },
    );
  });

  // Server-sent events: agents watching the live queue get pushed
  // ticket.message / ticket.status_changed events for their org without
  // polling. Backed by redis/pubsub.ts's TicketEventSubscriber. Registered
  // before "/:id" for the same reason "/stats" is above - otherwise "/:id"
  // would treat "stream" as a ticket id and 404 before this ever runs.
  router.get("/stream/live", requireRole("agent", "admin"), async (req, res) => {
    res.setHeader("content-type", "text/event-stream");
    res.setHeader("cache-control", "no-cache");
    res.setHeader("connection", "keep-alive");
    res.flushHeaders();

    const subscriber = subscriberFactory();
    const unsubscribe = await subscriber.subscribeToOrg(req.auth!.orgId, (event) => {
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    });

    req.on("close", () => {
      void unsubscribe();
    });
  });

  router.get("/:id", async (req, res) => {
    const ticket = await repo.findById(req.auth!.orgId, req.params.id!);
    if (!ticket) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.json({ ...ticket, messages: await repo.listMessages(ticket.id) });
  });

  router.post("/:id/messages", validateBody(messageSchema), async (req, res) => {
    const orgId = req.auth!.orgId;
    const ticket = await repo.findById(orgId, req.params.id!);
    if (!ticket) {
      res.status(404).json({ error: "not found" });
      return;
    }

    const { body } = req.body as z.infer<typeof messageSchema>;
    const message = await repo.addMessage({ ticketId: ticket.id, authorId: req.auth!.sub, body });

    await publisher.publish({
      type: "ticket.message",
      ticketId: ticket.id,
      orgId,
      payload: { messageId: message.id, authorId: message.author_id },
    });

    res.status(201).json(message);
  });

  router.patch("/:id/status", requireRole("agent", "admin"), validateBody(statusSchema), async (req, res) => {
    const orgId = req.auth!.orgId;
    const { status } = req.body as z.infer<typeof statusSchema>;
    const updated = await repo.updateStatus(orgId, req.params.id!, status);
    if (!updated) {
      res.status(404).json({ error: "not found" });
      return;
    }

    await publisher.publish({
      type: "ticket.status_changed",
      ticketId: updated.id,
      orgId,
      payload: { status },
    });

    res.json(updated);
  });

  // "Have we seen something like this before?" - embeds the ticket subject
  // + thread and searches the tickets Qdrant collection, scoped to the
  // caller's org via the payload filter in TicketVectorStore.findSimilar.
  router.get("/:id/similar", requireRole("agent", "admin"), async (req, res) => {
    const orgId = req.auth!.orgId;
    const ticket = await repo.findById(orgId, req.params.id!);
    if (!ticket) {
      res.status(404).json({ error: "not found" });
      return;
    }

    const messages = await repo.listMessages(ticket.id);
    const text = [ticket.subject, ...messages.map((m) => m.body)].join("\n");
    const vector = await embeddings.embed(text);
    const hits = await ticketStore.findSimilar(orgId, vector, ticket.id);

    const tickets = await repo.findManyByIds(orgId, hits.map((h) => h.ticketId));
    const byId = new Map(tickets.map((t) => [t.id, t]));
    res.json(
      hits.map((h) => ({ score: h.score, ticket: byId.get(h.ticketId) })).filter((h) => h.ticket !== undefined),
    );
  });

  router.get("/:id/summary", requireRole("agent", "admin"), async (req, res) => {
    const orgId = req.auth!.orgId;
    const ticket = await repo.findById(orgId, req.params.id!);
    if (!ticket) {
      res.status(404).json({ error: "not found" });
      return;
    }

    const messages = await repo.listMessages(ticket.id);
    const thread = messages.map((m) => `- ${m.body}`).join("\n");
    const summary = await llm.complete(
      "You are a support-desk assistant. Summarize the ticket thread in 2-3 sentences for an agent about to pick it up.",
      `Subject: ${ticket.subject}\n\nMessages:\n${thread}`,
    );

    res.json({ summary });
  });

  return router;
}
