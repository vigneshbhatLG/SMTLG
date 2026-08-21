import { FastifyInstance } from 'fastify';
import { gerritService } from '../services/gerrit.service';
import { tokenStore } from '../utils/tokenStore';
import { encryptSymmetric, decryptSymmetric } from '../utils/crypto';
import { jiraAuthService } from '../services/jiraAuth.service';

export async function gerritRoutes(fastify: FastifyInstance) {
  fastify.post('/api/gerrit/login', async (req, reply) => {
    const { username, password } = req.body as any;

    if (!username || !password) {
      return reply.code(400).send({ error: 'username and password are required' });
    }

    try {
      const account = await gerritService.validateHttpAuth(username, password);

      // Persist encrypted credentials server-side for this user (keyed by username)
      const combined = `${username}:${password}`;
      const encrypted = encryptSymmetric(combined);
      tokenStore.save(`gerrit:${username}`, encrypted);
      
      req.log.info(`[Gerrit Login] Saved token for user key: ${username}`); // DEBUG LOG

      // Return encrypted token to client (similar to Jira flow)
      return reply.send({ message: 'Gerrit authentication successful', account, token: encrypted });
    } catch (err: any) {
      req.log?.error?.(err, 'Gerrit auth failed');
      return reply.code(401).send({ error: 'Gerrit authentication failed' });
    }
  });

  fastify.post('/api/gerrit/changes/counts-by-owner', async (req, reply) => {
    const authHeader = (req.headers as any)['authorization'] as string | undefined;
    const gerritHeader = (req.headers as any)['x-gerrit-token'] as string | undefined;
    const gerritToken = gerritHeader && gerritHeader.trim().length > 0 ? gerritHeader.trim() : undefined;
    const body = (req.body as any) || {};
    const owners = body.owners;
    const from = body.from;
    const to = body.to;
    const projectPrefix = body.projectPrefix;

    try {
      const counts = await gerritService.listCountsByOwnerUsingJiraToken(
        authHeader,
        gerritToken,
        owners,
        from,
        to,
        projectPrefix,
      );
      return reply.send({ counts });
    } catch (err: any) {
      const msg = err?.message || '';
      if (msg === 'MISSING_JIRA_TOKEN') {
        return reply.code(401).send({ error: 'Not logged in (Jira)' });
      }
      if (msg === 'INVALID_JIRA_TOKEN') {
        return reply.code(401).send({ error: 'Invalid Authentication' });
      }
      if (msg === 'GERRIT_NOT_CONNECTED') {
        return reply.code(401).send({ error: 'Gerrit not connected. Please sign in to Gerrit first.' });
      }
      if (msg === 'MISSING_FROM_TO') {
        return reply.code(400).send({ error: 'Missing from/to in request body' });
      }
      req.log.error(err);
      return reply.code(500).send({ error: 'Failed to count Gerrit changes' });
    }
  });

  fastify.get('/api/gerrit/team/:teamId/patches/counts', async (req, reply) => {
    const { teamId } = req.params as { teamId: string };
    const { from, to, projectPrefix } = req.query as { from?: string; to?: string; projectPrefix?: string };

    // Read token from Authorization header
    const authHeader = (req.headers as any)['authorization'] as string | undefined;
    const gerritHeader = (req.headers as any)['x-gerrit-token'] as string | undefined;
    const gerritToken = gerritHeader && gerritHeader.trim().length > 0 ? gerritHeader.trim() : undefined;

    try {
      if (!from || !to) {
        return reply.code(400).send({ error: 'Missing from or to date query parameters' });
      }

      const result = await gerritService.getPatchCountsByTeamId(
        authHeader,
        gerritToken,
        Number(teamId),
        from,
        to,
        projectPrefix
      );

      return reply.send({ teamId: Number(teamId), from, to, counts: result.counts, applications: result.applications });
    } catch (err: any) {
      const msg = err?.message || '';
      if (msg === 'MISSING_JIRA_TOKEN') {
        return reply.code(401).send({ error: 'Not logged in (Jira)' });
      }
      if (msg === 'INVALID_JIRA_TOKEN') {
        return reply.code(401).send({ error: 'Invalid Authentication' });
      }
      if (msg === 'GERRIT_NOT_CONNECTED') {
        return reply.code(401).send({ error: 'Gerrit not connected. Please sign in to Gerrit first.' });
      }
      if (msg === 'MISSING_FROM_TO') {
        return reply.code(400).send({ error: 'Missing from/to in request' });
      }
      req.log.error(err);
      return reply.code(500).send({ error: 'Failed to fetch patch counts for team' });
    }
  });
}
