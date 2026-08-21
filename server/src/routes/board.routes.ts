// server/src/routes/board.routes.ts
import { FastifyInstance } from 'fastify';
import { jiraService } from '../services/jira.service';
import { decryptSymmetric } from '../utils/crypto';

export async function boardRoutes(fastify: FastifyInstance) {
	fastify.get('/api/boards/list', async (req, reply) => {
		// Read token from Authorization header (encrypted token expected)
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

			// Fetch boards from MongoDB sprintBoards collection with teamName and boardId
			const db = require('../utils/mongo').getMongoDb();
			const boards = await db.collection('sprintBoards').find({}, { projection: { teamName: 1, boardId: 1 } }).toArray();

			if (!boards || boards.length === 0) {
				return reply.send({
					count: 0,
					boards: []
				});
			}

			return reply.send({
				count: boards.length,
				boards: boards.map((board: any) => ({ 
					boardId: board.boardId,
					teamName: board.teamName || `Board ${board.boardId}`
				}))
			});
		} catch (err: any) {
			req.log.error({ err }, 'Failed to fetch boards');
			return reply
				.code(500)
				.send({ error: 'Failed to fetch boards' });
		}
	});

	fastify.get('/api/boards/sprints', async (req, reply) => {
		// Read token from Authorization header (raw token expected)
		const authHeader = (req.headers as any)['authorization'] as string | undefined;
		const token = authHeader && authHeader.trim().length > 0 ? authHeader.trim() : undefined;

		if (!token) {
			return reply.code(401).send({ error: 'Missing auth token in header' });
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

			// Fetch sprints across every board registered in the domain, not scoped to a single team/board
			const sprints = await jiraService.getAllDomainSprints(plainToken);

			return reply.send({
				count: sprints.length,
				sprints
			});
		} catch (err: any) {
			req.log.error({ err }, 'Failed to fetch board sprints');
			return reply
				.code(500)
				.send({ error: 'Failed to fetch sprints from Jira' });
		}
	});

	fastify.get('/api/team/:teamId/members', async (req, reply) => {
		const { teamId } = req.params as { teamId: string };

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

			// Fetch members for the given teamId from MongoDB members collection
			const db = require('../utils/mongo').getMongoDb();
			const members = await db.collection('members')
				.find({ teamId: Number(teamId) }, { projection: { name: 1, role: 1 } })
				.toArray();

			if (!members || members.length === 0) {
				return reply.send({
					members: []
				});
			}

			return reply.send({
				members: members.map((member: any) => ({
					name: member.name,
					role: member.role || 'Developer'
				}))
			});
		} catch (err: any) {
			req.log.error({ err }, 'Failed to fetch team members');
			return reply
				.code(500)
				.send({ error: 'Failed to fetch team members' });
		}
	});
}
