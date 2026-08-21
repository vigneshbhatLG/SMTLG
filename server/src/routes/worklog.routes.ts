import { FastifyInstance } from 'fastify';
import { saveWorklogComment } from '../services/worklog.service';
import { jiraService } from '../services/jira.service';
import { decryptSymmetric } from '../utils/crypto';

export async function worklogRoutes(fastify: FastifyInstance) {
  // Post a worklog to Jira
  // POST /api/issues/:issueId/worklog
  fastify.post('/api/issues/:issueId/worklog', async (req, reply) => {
    const { issueId } = req.params as { issueId: string };
    const body = req.body as { timeSpent: string; comment?: string };

    if (!body || !body.timeSpent) {
      return reply.code(400).send({ error: 'Missing timeSpent in request body' });
    }

    // Read token from Authorization header (raw token expected)
    const authHeader = (req.headers as any)["authorization"] as string | undefined;
    const token = authHeader && authHeader.trim().length > 0 ? authHeader.trim() : undefined;

    if (!token) {
      return reply.code(401).send({ error: "Missing auth token in header" });
    }

    try {
      // Decrypt the token from header. If decryption fails, reject the request.
      let plainToken: string;
      try {
        plainToken = await decryptSymmetric(token);
      } catch (deErr) {
        req.log.error({ deErr }, 'Failed to decrypt auth token');
        return reply.code(401).send({ error: 'Invalid auth token' });
      }
      console.log(`Posting worklog for issue ${issueId} with timeSpent ${body.timeSpent} and comment ${body.comment || ''}`);
      const result = await jiraService.postWorklog(plainToken, issueId, body.timeSpent, body.started, body.comment);
      return reply.code(201).send({ ok: true, worklog: result });
    } catch (err: any) {
      req.log.error({ err }, 'Failed to post worklog:');
      return reply.code(500).send({ error: 'Failed to post worklog' });
    }
  });

  // Save a comment for a worklog
  // POST /api/worklogs/:worklogId/comments
  fastify.post('/api/worklogs/:worklogId/comments', async (req, reply) => {
    const { worklogId } = req.params as { worklogId: string };
    const body = req.body as any;

    if (!body || !body.comment) {
      return reply.code(400).send({ error: 'Missing comment in request body' });
    }

    const payload = {
      worklogId,
      issueId: body.issueId || body.issue || null,
      username: body.username || body.user || 'unknown',
      datetime: body.datetime || new Date().toISOString(),
      comment: body.comment
    };

    try {
      const result = await saveWorklogComment(payload);
      return reply.code(201).send({ ok: true, ...result });
    } catch (err: any) {
      req.log.error({ err }, 'Failed to save worklog comment');
      return reply.code(500).send({ error: 'Failed to save comment' });
    }
  });

  // Get comments for an issue
  // GET /api/issues/:issueId/worklog-comments
  fastify.get('/api/issues/:issueId/worklog-comments', async (req, reply) => {
    const { issueId } = req.params as { issueId: string };
    // Read token from Authorization header (raw token expected)
    const authHeader = (req.headers as any)["authorization"] as string | undefined;
    const token = authHeader && authHeader.trim().length > 0 ? authHeader.trim() : undefined;

    if (!token) {
      return reply.code(401).send({ error: "Missing auth token in header" });
    }

    try {
      // Decrypt the token from header. If decryption fails, reject the request.
      let plainToken: string;
      try {
        plainToken = await decryptSymmetric(token);
      } catch (deErr) {
        req.log.error({ deErr }, 'Failed to decrypt auth token');
        return reply.code(401).send({ error: 'Invalid auth token' });
      }
      const rows = await (await import('../services/worklog.service')).getWorklogCommentsByIssue(plainToken, issueId);
      return reply.send({ ok: true, comments: rows });
    } catch (err: any) {
      req.log.error({ err }, 'Failed to fetch worklog comments');
      return reply.code(500).send({ error: 'Failed to fetch comments' });
    }
  });
}
