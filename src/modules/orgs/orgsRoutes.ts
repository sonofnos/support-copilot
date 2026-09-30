import { Router } from "express";
import { z } from "zod";
import { hashPassword } from "../../auth/password.js";
import { validateBody } from "../../middleware/validate.js";
import type { OrgsRepo } from "./orgsRepo.js";

const createOrgSchema = z.object({
  orgName: z.string().min(2).max(120),
  adminEmail: z.string().email(),
  adminPassword: z.string().min(10),
});

export function buildOrgsRouter(deps: { repo: OrgsRepo }) {
  const router = Router();

  router.post("/", validateBody(createOrgSchema), async (req, res) => {
    const { orgName, adminEmail, adminPassword } = req.body as z.infer<typeof createOrgSchema>;
    const adminPasswordHash = await hashPassword(adminPassword);

    const { org, admin } = await deps.repo.createWithAdmin({ orgName, adminEmail, adminPasswordHash });
    res.status(201).json({ org: { id: org.id, name: org.name }, admin: { id: admin.id, email: admin.email } });
  });

  return router;
}
