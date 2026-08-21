import { FastifyInstance } from 'fastify';
import { jiraService } from '../services/jira.service';
import { aiAnalysisService, AIAnalysisRequest } from '../services/aiAnalysis.service';
import { decryptSymmetric } from '../utils/crypto';

export async function registerIssueRoutes(fastify: FastifyInstance) {
	// fetch bugs by date range / name / status
	// GET /api/issues/date-range?startDate=2025-01-01&endDate=2025-01-31&issueStatuses=Open,InProgress&name=QEVENTTG-8509
	fastify.get('/api/issues/date-range', async (req, reply) => {
		const {
			startDate,
			endDate,
			issueStatuses,
			name,
			assignee
		} = req.query as {
			startDate?: string;
			endDate?: string;
			issueStatuses?: string;
			name?: string;
			assignee?: string;
		};

		// Read token from Authorization header (strip Bearer prefix if present)
		const authHeader = (req.headers as any)['authorization'] as string | undefined;
		let token = authHeader && authHeader.trim().length > 0 ? authHeader.trim() : undefined;

		if (!token) {
			return reply.code(401).send({ error: 'Missing auth token in header' });
		}

		// Strip Bearer prefix if it exists
		if (token.toLowerCase().startsWith('bearer ')) {
			token = token.slice(7); // Remove "Bearer " prefix
		}

		try {
			const statusesArray = issueStatuses
				? issueStatuses.split(',').map(s => s.trim())
				: undefined;
			const result = await jiraService.getIssuesByDateName(
				token,
				startDate,
				endDate,
				statusesArray,
				name,
				assignee
			);

			return reply.send(result);
		} catch (err: any) {
			req.log.error({ err }, 'Failed to fetch issues by date/name');
			return reply.code(500).send({ error: 'Failed to fetch issues from Jira' });
		}
	});

	// Perform AI analysis on an issue
	// POST /api/issues/ai-analysis
	// Legacy bulk endpoint (returns all at once — kept for backward compatibility)
	fastify.post('/api/issues/ai-analysis-bulk', async (req, reply) => {
		try {
			const result = await aiAnalysisService.analyzeBulkFromDB();
			return reply.send(result);
		} catch (err: any) {
			req.log.error({ err }, 'Failed to perform AI analysis');
			return reply.code(500).send({ error: 'Failed to perform AI analysis' });
		}
	});

	// SSE streaming bulk endpoint — accepts ticketIds[], streams one result per issue
	fastify.post('/api/issues/ai-analysis-bulk-stream', async (req, reply) => {
		const { ticketIds } = req.body as { ticketIds: string[] };

		reply.raw.writeHead(200, {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			'Connection': 'keep-alive',
			'Access-Control-Allow-Origin': '*',
		});

		const send = (data: object) => {
			reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
		};

		try {
			await aiAnalysisService.analyzeBulkStreaming(ticketIds || [], (event) => {
				send(event);
			});
			send({ done: -1, total: -1, result: null, complete: true });
		} catch (err: any) {
			send({ error: err.message, complete: true });
		} finally {
			reply.raw.end();
		}
	});

	// Get saved analysis results for given ticket IDs (used on page load)
	fastify.post('/api/issues/ai-analysis-results', async (req, reply) => {
		try {
			const { ticketIds } = req.body as { ticketIds: string[] };
			const results = await aiAnalysisService.getAnalysisResults(ticketIds || []);
			return reply.send(results);
		} catch (err: any) {
			return reply.code(500).send({ error: err.message });
		}
	});

	fastify.post('/api/issues/ai-analysis', async (req, reply) => {

		try {
			const { ticketId } = req.body as { ticketId: string };
			const result = await aiAnalysisService.analyzeIssue(ticketId);

			return reply.send(result);
		} catch (err: any) {
			req.log.error({ err }, 'Failed to perform AI analysis');
			return reply.code(500).send({ error: 'Failed to perform AI analysis' });
		}
	});

	// Get TVPMs (Improvements) count for a team
	// GET /api/team/:teamId/tvpms/counts?from=2025-01-01&to=2025-01-31
	fastify.get('/api/team/:teamId/tvpms/counts', async (req, reply) => {
		const { teamId } = req.params as { teamId: string };
		const { from, to } = req.query as { from?: string; to?: string };

		// Read token from Authorization header
		const authHeader = (req.headers as any)['authorization'] as string | undefined;
		let token = authHeader && authHeader.trim().length > 0 ? authHeader.trim() : undefined;

		try {
			let plainToken: string;
            try {
                plainToken = await decryptSymmetric(token);
            } catch (deErr) {
                req.log.error({ deErr }, "Failed to decrypt auth token");
                return reply.code(401).send({ error: "Invalid auth token" });
            }

			if (!from || !to) {
				return reply.code(400).send({ error: 'Missing from or to date query parameters' });
			}

			const counts = await jiraService.getTeamTVPMsCount(
				plainToken,
				Number(teamId),
				from,
				to
			);

			return reply.send({ teamId: Number(teamId), from, to, counts });
		} catch (err: any) {
			req.log.error({ err }, 'Failed to fetch team TVPMs count');
			return reply.code(500).send({ error: 'Failed to fetch TVPMs count from Jira' });
		}
	});
}
