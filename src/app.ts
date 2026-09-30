import express, { type Express } from "express";
// Side-effect import that patches Express's Router/Route so a rejected
// promise from an async handler reaches errorHandler() below instead of
// becoming an unhandled rejection that crashes the process - Express 4
// (unlike 5) does not do this on its own. Must be imported before any
// route is registered; module evaluation order guarantees that here since
// every buildXRouter() call happens inside buildApp(), below.
import "express-async-errors";
import cors from "cors";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { requireAuth } from "./auth/middleware.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { logger } from "./logger.js";
import type { AppContext } from "./context.js";
import { buildOrgsRouter } from "./modules/orgs/orgsRoutes.js";
import { buildAuthRouter } from "./modules/auth/authRoutes.js";
import { buildArticlesRouter } from "./modules/articles/articlesRoutes.js";
import { buildTicketsRouter } from "./modules/tickets/ticketsRoutes.js";
import { buildWebhooksRouter } from "./modules/webhooks/webhooksRoutes.js";

export function buildApp(ctx: AppContext): Express {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(pinoHttp({ logger }));

  app.get("/health", (_req, res) => res.json({ status: "ok", aiBackend: ctx.aiBackend }));

  // Webhooks need the raw byte stream for HMAC verification - mounted
  // before the global express.json() so the body is never parsed/re-encoded
  // first (see webhooksRoutes.ts). `type: () => true` captures the body as
  // a Buffer regardless of the sender's declared Content-Type: providers
  // are inconsistent about the exact header value/charset they send, and
  // this route validates the payload itself (HMAC, then Zod) rather than
  // trusting the header either way.
  app.use(
    "/webhooks",
    express.raw({ type: () => true, limit: "1mb" }),
    buildWebhooksRouter({
      repo: ctx.repos.webhooks,
      ticketsRepo: ctx.repos.tickets,
      embeddingQueue: ctx.embeddingQueue,
      webhookSecret: ctx.webhookSecret,
    }),
  );

  app.use(express.json({ limit: "1mb" }));

  app.use("/orgs", buildOrgsRouter({ repo: ctx.repos.orgs }));
  app.use(
    "/auth",
    buildAuthRouter({ repo: ctx.repos.auth, tokens: ctx.tokens, loginLimiter: ctx.loginLimiter }),
  );

  app.use(
    "/articles",
    requireAuth(ctx.tokens),
    buildArticlesRouter({
      repo: ctx.repos.articles,
      embeddings: ctx.embeddings,
      articleStore: ctx.articleStore,
      embeddingQueue: ctx.embeddingQueue,
      searchCache: ctx.searchCache,
    }),
  );

  app.use(
    "/tickets",
    requireAuth(ctx.tokens),
    buildTicketsRouter({
      repo: ctx.repos.tickets,
      embeddings: ctx.embeddings,
      llm: ctx.llm,
      ticketStore: ctx.ticketStore,
      embeddingQueue: ctx.embeddingQueue,
      publisher: ctx.publisher,
      subscriberFactory: ctx.subscriberFactory,
    }),
  );

  app.use(errorHandler(logger));

  return app;
}
