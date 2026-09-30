import { env } from "../src/config/env.js";
import { buildContext } from "../src/context.js";
import { hashPassword } from "../src/auth/password.js";

async function main() {
  const ctx = await buildContext(env);

  const { org, admin } = await ctx.repos.orgs.createWithAdmin({
    orgName: "Demo Support Co",
    adminEmail: "admin@demo.test",
    adminPasswordHash: await hashPassword("demo-password-123"),
  });

  const agent = await ctx.repos.auth.createUser({
    orgId: org.id,
    email: "agent@demo.test",
    passwordHash: await hashPassword("demo-password-123"),
    role: "agent",
  });

  const customer = await ctx.repos.auth.createUser({
    orgId: org.id,
    email: "customer@demo.test",
    passwordHash: await hashPassword("demo-password-123"),
    role: "customer",
  });

  const articles = [
    {
      title: "How to reset your password",
      body: "Go to Settings > Security and click 'Reset password'. You'll get an email with a reset link valid for 1 hour.",
      tags: ["auth", "account"],
    },
    {
      title: "Refund policy for annual plans",
      body: "Annual plans can be refunded in full within 30 days of purchase. After 30 days, refunds are prorated for the remaining term.",
      tags: ["billing"],
    },
    {
      title: "Why did my payment fail at checkout?",
      body: "Most checkout failures are due to an expired card or insufficient funds. Try a different payment method or contact your bank.",
      tags: ["billing", "payments"],
    },
  ];

  for (const a of articles) {
    const article = await ctx.repos.articles.create({ orgId: org.id, ...a });
    await ctx.embeddingQueue.add("embed-article", {
      kind: "article",
      id: article.id,
      orgId: org.id,
      text: `${a.title}\n\n${a.body}`,
    });
  }

  const ticket = await ctx.repos.tickets.create({
    orgId: org.id,
    customerId: customer.id,
    subject: "Payment failed on checkout, please help",
  });
  await ctx.repos.tickets.addMessage({
    ticketId: ticket.id,
    authorId: customer.id,
    body: "I tried to upgrade to the annual plan three times and it keeps failing at payment.",
  });
  await ctx.embeddingQueue.add("embed-ticket", {
    kind: "ticket",
    id: ticket.id,
    orgId: org.id,
    text: ticket.subject,
  });

  console.log("Seeded demo org:", org.id);
  console.log("  admin:    admin@demo.test / demo-password-123 (role admin, id %s)", admin.id);
  console.log("  agent:    agent@demo.test / demo-password-123 (role agent, id %s)", agent.id);
  console.log("  customer: customer@demo.test / demo-password-123 (role customer, id %s)", customer.id);
  console.log("Run `npm run worker` to process the embedding queue for the seeded articles/ticket.");

  await ctx.db.destroy();
  await ctx.redis.quit();
  await ctx.embeddingQueue.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
