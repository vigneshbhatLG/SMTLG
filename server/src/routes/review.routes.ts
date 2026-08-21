import { FastifyInstance } from 'fastify';
import { jiraService } from '../services/jira.service';
import { decryptSymmetric } from '../utils/crypto';

export async function reviewRoutes(fastify: FastifyInstance) {
  // GET the resolved issues in a date range
  // POST /api/review/resolved-issues
  fastify.post('/api/review/resolved-issues', async (req, reply) => {
    const body = req.body as { startDate: string; endDate: string; teamId?: number | string; hardReload?: boolean };

    if (!body || !body.startDate || !body.endDate) {
      return reply.code(400).send({ error: 'Missing startDate or endDate in request body' });
    }

    // Validate date format (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(body.startDate) || !dateRegex.test(body.endDate)) {
      return reply.code(400).send({ error: 'Invalid date format. Use YYYY-MM-DD' });
    }

    // Read token from Authorization header
    const authHeader = (req.headers as any)['authorization'] as string | undefined;
    const token = authHeader && authHeader.trim().length > 0 ? authHeader.trim() : undefined;

    if (!token) {
      return reply.code(401).send({ error: 'Missing auth token in header' });
    }

    try {
      // Decrypt the token from header
      let plainToken: string;
      try {
        plainToken = await decryptSymmetric(token);
      } catch (deErr) {
        req.log.error({ deErr }, 'Failed to decrypt auth token');
        return reply.code(401).send({ error: 'Invalid auth token' });
      }

      const isHardReload = body.hardReload === true;
      console.log(`Fetching resolved issues from ${body.startDate} to ${body.endDate}` + (body.teamId ? ` for teamId ${body.teamId}` : '') + (isHardReload ? ' (hardReload)' : ' (cached)'));
      const result = await jiraService.getResolvedIssuesByDateRange(plainToken, body.startDate, body.endDate, body.teamId, isHardReload);

      return reply.send({
        ok: true,
        ...result
      });
    } catch (err: any) {
      req.log.error({ err }, 'Failed to fetch resolved issues');
      return reply.code(500).send({ error: 'Failed to fetch resolved issues from Jira' });
    }
  });

  // POST /api/review/issue-transfers
  fastify.post('/api/review/issue-transfers', async (req, reply) => {
    const body = req.body as { startDate: string; endDate: string; teamId?: number | string; hardReload?: boolean };

    if (!body || !body.startDate || !body.endDate) {
      return reply.code(400).send({ error: 'Missing startDate or endDate in request body' });
    }

    // Validate date format (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(body.startDate) || !dateRegex.test(body.endDate)) {
      return reply.code(400).send({ error: 'Invalid date format. Use YYYY-MM-DD' });
    }

    // Read token from Authorization header
    const authHeader = (req.headers as any)['authorization'] as string | undefined;
    const token = authHeader && authHeader.trim().length > 0 ? authHeader.trim() : undefined;

    if (!token) {
      return reply.code(401).send({ error: 'Missing auth token in header' });
    }

    try {
      // Decrypt the token from header
      let plainToken: string;
      try {
        plainToken = await decryptSymmetric(token);
      } catch (deErr) {
        req.log.error({ deErr }, 'Failed to decrypt auth token');
        return reply.code(401).send({ error: 'Invalid auth token' });
      }

      const isHardReload = body.hardReload === true;
      console.log(`Fetching issue transfers from ${body.startDate} to ${body.endDate}` + (body.teamId ? ` for teamId ${body.teamId}` : '') + (isHardReload ? ' (hardReload)' : ' (cached)'));
      const result = await jiraService.getIssueTransfersByDateRange(plainToken, body.startDate, body.endDate, body.teamId, isHardReload);

      return reply.send({
        ok: true,
        ...result
      });
    } catch (err: any) {
      req.log.error({ err }, 'Failed to fetch issue transfers');
      return reply.code(500).send({ error: 'Failed to fetch issue transfers from Jira' });
    }
  });
}
