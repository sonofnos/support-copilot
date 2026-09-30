import { env } from "./config/env.js";
import { buildContext } from "./context.js";
import { buildApp } from "./app.js";
import { logger } from "./logger.js";

const ctx = await buildContext(env);
const app = buildApp(ctx);

app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, aiBackend: ctx.aiBackend }, "support-copilot listening");
});
