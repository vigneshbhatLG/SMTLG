import { FastifyInstance } from 'fastify';
import { decryptSymmetric } from '../utils/crypto';
import { jiraService } from '../services/jira.service';

export async function registerWorkItemRoutes(fastify: FastifyInstance) {
	// Get issues by filters (issueTypes, issueStatuses, assignee, boardId)
	// GET /api/work-items/filters?issueTypes=Bug,Task&issueStatuses=Open,InProgress&boardId=123&assignee=user@example.com
	fastify.get('/api/work-items/filters', async (req, reply) => {
		const { issueStatuses, boardId, assignee } = req.query as {
			issueStatuses?: string;
			boardId?: string;
			assignee?: string;
		};

		// Read token from Authorization header
		const authHeader = (req.headers as any)['authorization'] as string | undefined;
		const token = authHeader && authHeader.trim().length > 0 ? authHeader.trim() : undefined;

		if (!token) {
			return reply.code(401).send({ error: 'Missing auth token in header' });
		}

		let plainToken: string;
		try {
			plainToken = decryptSymmetric(token);
		} catch (deErr) {
			req.log.error({ deErr }, 'Failed to decrypt auth token');
			return reply.code(401).send({ error: 'Invalid auth token' });
		}

		if (!boardId) {
			return reply.code(400).send({ error: 'Missing required parameter: boardId' });
		}

		try {
			// Parse query strings into arrays
			const issueStatusesArray = issueStatuses ? issueStatuses.split(',').map(s => s.trim()) : undefined;

			const result = await jiraService.getWorkItemsByFilters(
				plainToken,
				Number(boardId),
				issueStatusesArray,
				assignee
			);

			return reply.send(result);
		} catch (err: any) {
			req.log.error({ err }, 'Failed to fetch filtered issues');
			return reply.code(500).send({ error: 'Failed to fetch issues from Jira' });
		}
	});
}

export async function registerIssueItemRoutes(fastify: FastifyInstance) {
	// Get issues by filters (issueTypes, issueStatuses, assignee, boardId)
	// GET /api/work-items/filters?issueTypes=Bug,Task&issueStatuses=Open,InProgress&boardId=123&assignee=user@example.com
	fastify.get('/api/issue-items/filters', async (req, reply) => {
		const { issueStatuses, teamId, assignee } = req.query as {
			issueStatuses?: string;
			teamId?: string;
			assignee?: string;
		};

		// Read token from Authorization header
		const authHeader = (req.headers as any)['authorization'] as string | undefined;
		const token = authHeader && authHeader.trim().length > 0 ? authHeader.trim() : undefined;

		if (!token) {
			return reply.code(401).send({ error: 'Missing auth token in header' });
		}

		let plainToken: string;
		try {
			plainToken = decryptSymmetric(token);
		} catch (deErr) {
			req.log.error({ deErr }, 'Failed to decrypt auth token');
			return reply.code(401).send({ error: 'Invalid auth token' });
		}

		if (!teamId) {
			return reply.code(400).send({ error: 'Missing required parameter: teamId' });
		}

		try {

			const issueStatusesArray = issueStatuses ? issueStatuses.split(',').map(s => s.trim()) : undefined;

			const result = await jiraService.getIssuesByFilters(
				plainToken,
				Number(teamId),
				issueStatusesArray,
				assignee
			);

			return reply.send(result);
		} catch (err: any) {
			req.log.error({ err }, 'Failed to fetch filtered issues');
			return reply.code(500).send({ error: 'Failed to fetch issues from Jira' });
		}
	});
}


