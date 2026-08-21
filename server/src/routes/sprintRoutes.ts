import { FastifyInstance } from "fastify";
import { jiraService } from "../services/jira.service";
import { decryptSymmetric } from '../utils/crypto';
import { gerritService } from '../services/gerrit.service';

export async function sprintRoutes(fastify: FastifyInstance) {
	fastify.get("/api/sprints/:sprintId/worklogs", async (req, reply) => {
		const { sprintId } = req.params as { sprintId: string };
		const { fromDate, toDate, gerritFromDate, gerritToDate, teamId, hardLoad } = req.query as {
			fromDate?: string;
			toDate?: string;
			gerritFromDate?: string;
			gerritToDate?: string;
			teamId?: number;
			hardLoad?: boolean;
		};

		const isGerritConnectedHeader = (req.headers as any)['x-isgerritconnected'] as string | undefined;
		const isGerritConnected = String(isGerritConnectedHeader || '').toLowerCase() === 'true';
		const gerritTokenHeader = (req.headers as any)['x-gerrit-token'] as string | undefined;
		const gerritToken = gerritTokenHeader && gerritTokenHeader.trim().length > 0 ? gerritTokenHeader.trim() : undefined;

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

			const result = await jiraService.getSprintWorklogs(
				plainToken,
				Number(sprintId),
				// Do not pass from/to to Jira query: those add `worklogDate` JQL filters and change table totals.
				undefined,
				undefined,
				teamId,
				hardLoad
			);

			// Backward-compat: if clients still send fromDate/toDate, use them as Gerrit range when gerritFrom/To not provided.
			const gFrom = gerritFromDate || fromDate;
			const gTo = gerritToDate || toDate;

			let patchCountsByMember: Record<string, number> = {};
			if (isGerritConnected && Array.isArray((result as any)?.data) && (result as any).data.length > 0 && gFrom && gTo) {
				try {
					const getMemberIdFromMember = (memberText: any) => {
						if (!memberText || typeof memberText !== 'string') return null;
						const parts = memberText.trim().split(/\s+/).filter(Boolean);
						return parts.length ? String(parts[parts.length - 1]).replace(/[;,]+$/g, '') : null;
					};

					const owners = Array.from(
						new Set(
							(result as any).data
								.map((row: any) => {
									const fromName = getMemberIdFromMember(row?.assigneeName);
									const fromKey = row?.assigneeKey != null ? String(row.assigneeKey) : null;
									return fromName || fromKey;
								})
								.filter((x: any) => typeof x === 'string' && x.trim().length > 0)
						)
					);

					if (owners.length > 0) {
						const prefix = 'app/com.webos.app';
						patchCountsByMember = await gerritService.listCountsByOwnerUsingJiraToken(
							token,
							gerritToken,
							owners,
							gFrom,
							gTo,
							prefix,
						);
					}
				} catch (e: any) {
					// Do not fail worklog/table fetch if Gerrit fails; just omit patch counts
					req.log.warn({ err: e }, 'Failed to compute Gerrit patch counts');
					patchCountsByMember = {};
				}
			}

			return reply.send({
				sprintId: Number(sprintId),
				...result,
				patchCountsByMember
			});
		} catch (err: any) {
			req.log.error({ err }, "Failed to fetch sprint worklogs");
			return reply.code(500).send({ error: "Failed to fetch sprint worklogs" });
		}
	});

	// Get issues (with worklogs) for a specific assignee inside a sprint
	fastify.get("/api/sprints/:sprintId/assignees/:assignee/issues", async (req, reply) => {
		const { sprintId, assignee } = req.params as { sprintId: string; assignee: string };

		// Read token from Authorization header (raw token expected)
		const authHeader = (req.headers as any)["authorization"] as string | undefined;
		const token = authHeader && authHeader.trim().length > 0 ? authHeader.trim() : undefined;

		if (!token) {
			return reply.code(401).send({ error: "Missing auth token in header" });
		}

		let plainToken: string;
		try {
			plainToken = decryptSymmetric(token);
		} catch (deErr) {
			req.log.error({ deErr }, 'Failed to decrypt auth token');
			return reply.code(401).send({ error: 'Invalid auth token' });
		}

		try {
			const result = await jiraService.getIssuesForAssigneeInSprint(plainToken, Number(sprintId), assignee);
			return reply.send(result);
		} catch (err: any) {
			req.log.error({ err }, 'Failed to fetch issues for assignee in sprint');
			return reply.code(500).send({ error: 'Failed to fetch issues from Jira' });
		}
	});
}
