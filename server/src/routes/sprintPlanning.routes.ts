import { FastifyInstance } from "fastify";
import { decryptSymmetric } from '../utils/crypto';
import { getMongoDb } from '../utils/mongo';

const JIRA_BASE_URL = 'http://jira.lge.com/issue';

async function callJira<T>(path: string, token: string, options: any = {}): Promise<T> {
    const url = `${JIRA_BASE_URL}${path}`;
    const res = await (fetch as any)(url, {
        ...options,
        headers: {
            ...(options.headers || {}),
            Authorization: `Bearer ${token}`,
            Cookie: process.env.JIRA_COOKIE,
            Accept: "application/json",
            "Content-Type": "application/json"
        }
    });
    const text = await res.text().catch(() => "");

    if (!res.ok) {
        throw new Error(`Jira API error ${res.status} ${res.statusText}: ${text}`);
    }

    // Writes (issue update, epic move, sprint assignment) answer 204 with an empty
    // body — parsing that as JSON would throw "Unexpected end of JSON input"
    if (!text.trim()) return undefined as T;

    try {
        return JSON.parse(text) as T;
    } catch {
        throw new Error(`Jira API returned a non-JSON response (${res.status}): ${text.slice(0, 200)}`);
    }
}

async function resolveBoardId(teamId: number): Promise<number | undefined> {
    try {
        const db = getMongoDb();
        const team = await db.collection('part_teams').findOne({ teamId });
        return team?.boardId;
    } catch {
        return undefined;
    }
}

async function getPlainToken(authHeader: string | undefined, reply: any): Promise<string | null> {
    const token = authHeader?.trim();
    if (!token) { reply.code(401).send({ error: 'Missing auth token' }); return null; }
    try {
        return await decryptSymmetric(token);
    } catch {
        reply.code(401).send({ error: 'Invalid auth token' });
        return null;
    }
}

export async function sprintPlanningRoutes(fastify: FastifyInstance) {

    // Get board info (boardId + projectKey) for the logged-in team
    fastify.get('/api/sprint-planning/board-info', async (req, reply) => {
        const { teamId } = req.query as { teamId?: string };
        const plainToken = await getPlainToken((req.headers as any)['authorization'], reply);
        if (!plainToken) return;

        const boardId = await resolveBoardId(Number(teamId));
        if (!boardId) return reply.send({ boardId: null, projectKey: null });

        try {
            const config = await callJira<any>(
                `/rest/agile/1.0/board/${boardId}/configuration`,
                plainToken
            );
            const projectKey = config.location?.projectKey || null;
            return reply.send({ boardId, projectKey });
        } catch (err: any) {
            req.log.warn({ err }, 'Failed to fetch board configuration');
            return reply.send({ boardId, projectKey: null });
        }
    });

    // Get epics for the team from MongoDB (team-scoped, not from Jira API)
    fastify.get('/api/sprint-planning/epics', async (req, reply) => {
        const { teamId } = req.query as { teamId?: string };
        const plainToken = await getPlainToken((req.headers as any)['authorization'], reply);
        if (!plainToken) return;

        try {
            const db = getMongoDb();
            const team = await db.collection('part_teams').findOne({ teamId: Number(teamId) });
            const epics = (team?.epics || []).map((e: any) => ({ key: e.key, name: e.name }));
            return reply.send({ epics });
        } catch (err: any) {
            req.log.warn({ err }, 'Failed to fetch epics from MongoDB');
            return reply.send({ epics: [] });
        }
    });

    // Stories the logged-in user already has in a sprint — the edit-mode source of truth
    fastify.get('/api/sprint-planning/sprint-stories', async (req, reply) => {
        const { sprintId } = req.query as { sprintId?: string };
        const plainToken = await getPlainToken((req.headers as any)['authorization'], reply);
        if (!plainToken) return;

        if (!sprintId) return reply.code(400).send({ error: 'sprintId is required' });

        try {
            // The Agile sprint endpoint resolves the epic link for us, which the
            // plain search API can't do without knowing the epic custom-field id
            const jql = encodeURIComponent('assignee = currentUser() AND issuetype = Story ORDER BY created ASC');
            const fields = 'summary,description,labels,status,epic,customfield_10002,customfield_35420';
            const data = await callJira<{ issues: any[] }>(
                `/rest/agile/1.0/sprint/${sprintId}/issue?jql=${jql}&fields=${fields}&maxResults=200`,
                plainToken
            );

            const stories = (data.issues || []).map((issue: any) => ({
                key: issue.key,
                summary: issue.fields?.summary || '',
                description: issue.fields?.description || '',
                storyPoints: issue.fields?.customfield_10002 ?? 0,
                labels: issue.fields?.labels || [],
                epic: issue.fields?.epic?.key || '',
                dod: issue.fields?.customfield_35420 || '',
                status: issue.fields?.status?.name || '',
            }));

            return reply.send({ stories });
        } catch (err: any) {
            req.log.error({ err }, `Failed to fetch stories for sprint ${sprintId}`);
            return reply.code(502).send({ error: 'Failed to fetch sprint stories from Jira' });
        }
    });

    // Apply edits to stories that already exist in Jira
    fastify.put('/api/sprint-planning/update-stories', async (req, reply) => {
        const plainToken = await getPlainToken((req.headers as any)['authorization'], reply);
        if (!plainToken) return;

        const { stories } = req.body as {
            stories: Array<{
                key: string;
                summary: string;
                description: string;
                storyPoints: number;
                labels: string[];
                epic: string;
                dod: string;
            }>;
        };

        if (!Array.isArray(stories) || stories.length === 0) {
            return reply.code(400).send({ error: 'Missing required field: stories' });
        }

        const updatedKeys: string[] = [];
        const errors: Array<{ story: string; error: string }> = [];

        for (const story of stories) {
            try {
                if (!story.key) {
                    errors.push({ story: story.summary, error: 'Issue key is required' });
                    continue;
                }
                // Same rule as creation — Jira stories must carry a description
                if (!story.description?.trim()) {
                    errors.push({ story: story.key, error: 'Description is required' });
                    continue;
                }

                await callJira(
                    `/rest/api/2/issue/${story.key}`,
                    plainToken,
                    {
                        method: 'PUT',
                        body: JSON.stringify({
                            fields: {
                                summary: story.summary,
                                description: story.description.trim(),
                                customfield_10002: Number(story.storyPoints) || 0,
                                labels: Array.isArray(story.labels) ? story.labels.filter(Boolean) : [],
                                customfield_35420: story.dod || '',
                            }
                        })
                    }
                );
                updatedKeys.push(story.key);

                // Epic moves go through the Agile API; both calls are no-ops when
                // the issue is already where we're putting it
                try {
                    const target = story.epic?.trim() || 'none';
                    await callJira(
                        `/rest/agile/1.0/epic/${target}/issue`,
                        plainToken,
                        { method: 'POST', body: JSON.stringify({ issues: [story.key] }) }
                    );
                } catch (epicErr: any) {
                    req.log.warn({ epicErr }, `Failed to move ${story.key} to epic ${story.epic || 'none'}`);
                }
            } catch (err: any) {
                errors.push({ story: story.key || story.summary, error: err.message });
            }
        }

        return reply.send({ updated: updatedKeys, errors, success: updatedKeys.length > 0 });
    });

    // Create stories in Jira and add them to the selected sprint
    fastify.post('/api/sprint-planning/create-stories', async (req, reply) => {
        const plainToken = await getPlainToken((req.headers as any)['authorization'], reply);
        if (!plainToken) return;

        const { sprintId, sprintName, projectKey, stories } = req.body as {
            sprintId: number;
            sprintName: string;
            projectKey: string;
            stories: Array<{
                summary: string;
                description: string;
                storyPoints: number;
                labels: string[];
                epic: string;
                dod: string;
            }>;
        };

        if (!sprintId || !projectKey || !Array.isArray(stories) || stories.length === 0) {
            return reply.code(400).send({ error: 'Missing required fields: sprintId, projectKey, stories' });
        }

        // Resolve the logged-in user's Jira username to set as assignee
        // Board 43300 filter requires assignee to be a team member
        let assigneeUsername: string | null = null;
        try {
            const myself = await callJira<{ name: string }>('/rest/api/2/myself', plainToken);
            assigneeUsername = myself.name || null;
        } catch (e) {
            req.log.warn('Could not resolve current Jira user for assignee');
        }

        const createdKeys: string[] = [];
        const errors: Array<{ story: string; error: string }> = [];

        const summaryPrefix = sprintName ? `${sprintName} ` : '';

        for (const story of stories) {
            try {
                // Jira rejects story creation when description is empty, so validate before calling the API
                if (!story.description?.trim()) {
                    errors.push({ story: story.summary, error: 'Description is required' });
                    continue;
                }

                const issueBody: any = {
                    fields: {
                        project: { key: projectKey },
                        summary: `${summaryPrefix}${story.summary}`,
                        issuetype: { name: 'Story' },
                        customfield_10002: Number(story.storyPoints) || 0,
                        labels: Array.isArray(story.labels) ? story.labels.filter(Boolean) : [],
                        components: [{ name: '_Task' }],
                        description: story.description.trim(),
                        ...(assigneeUsername ? { assignee: { name: assigneeUsername } } : {}),
                        ...(story.dod ? { customfield_35420: story.dod } : {}),
                    }
                };

                const created = await callJira<{ key: string }>(
                    '/rest/api/2/issue',
                    plainToken,
                    { method: 'POST', body: JSON.stringify(issueBody) }
                );
                createdKeys.push(created.key);

                // Link to epic via Agile API (bypasses screen field restrictions)
                if (story.epic?.trim()) {
                    try {
                        await callJira(
                            `/rest/agile/1.0/epic/${story.epic.trim()}/issue`,
                            plainToken,
                            { method: 'POST', body: JSON.stringify({ issues: [created.key] }) }
                        );
                    } catch (epicErr: any) {
                        req.log.warn({ epicErr }, `Failed to link ${created.key} to epic ${story.epic}`);
                    }
                }
            } catch (err: any) {
                errors.push({ story: story.summary, error: err.message });
            }
        }

        if (createdKeys.length > 0) {
            try {
                await callJira(
                    `/rest/agile/1.0/sprint/${sprintId}/issue`,
                    plainToken,
                    { method: 'POST', body: JSON.stringify({ issues: createdKeys }) }
                );
            } catch (err: any) {
                errors.push({ story: 'Sprint assignment', error: err.message });
            }
        }

        return reply.send({ created: createdKeys, errors, success: createdKeys.length > 0 });
    });
}
