import { FastifyInstance } from "fastify";
import { jiraAuthService } from "../services/jiraAuth.service";
import { tokenStore } from "../utils/tokenStore";
import { encryptSymmetric, decryptSymmetric } from "../utils/crypto";

export async function authRoutes(fastify: FastifyInstance) {

  fastify.post("/api/auth/login", async (req, reply) => {
    const { token } = req.body as any;

    if (!token) {
      return reply.status(400).send({ error: "Token is required" });
    }

    // Validate PAT by calling Jira

    const res = await jiraAuthService.getCurrentUser(token);
    fastify.log.info(res);

    if (!res.ok) {
      return reply.status(401).send({
        error: "Invalid Personal Access Token"
      });
    }

    const user = await res.json();
    const { memberRole, teamId, teams } = await jiraAuthService.lookupMemberInfo(user?.name);

    // Store PAT securely for this user (server-side)
    tokenStore.save("user1", token);

    // Encrypt token before returning to client (client will store/send encrypted token)
    try {
      const encrypted = encryptSymmetric(token);
      return reply.send({
        message: "Login successful",
        user: { ...user, memberRole, teamId, teams },
        teams,
        token: encrypted
      });
    } catch (err) {
      req.log.error({ err }, 'Failed to encrypt token');
      return reply.code(500).send({ error: 'Failed to process token' });
    }
  });

  // Get my profile (using stored PAT)
  fastify.get("/api/auth/me", async (req, reply) => {

    const authHeader = (req.headers as any)['authorization'] as string | undefined;
		const token = authHeader && authHeader.trim().length > 0 ? authHeader.trim() : undefined;

    if (!token) {
      return reply.code(401).send({ error: "Not logged in" });
    }

  let plainToken: string;
  try {
    plainToken = decryptSymmetric(token);
  } catch (deErr) {
    req.log.error({ deErr }, 'Failed to decrypt auth token');
    return reply.code(401).send({ error: 'Invalid auth token' });
  }

  const res = await jiraAuthService.getCurrentUser(plainToken);
  const data = await res.json();

  // Attach memberRole + teamId from MongoDB `members` collection (docs: { name, role, teamId })
  const { memberRole, teamId, teams } = await jiraAuthService.lookupMemberInfo(data?.name);

  return reply.send({
    ...data,
    memberRole,
    teamId,
    teams,
  });
  });
}
