import { buildSprintWorklogJql, buildIssuesForAssigneeJql, buildIssuesByFiltersJql, buildWorkItemsByFiltersJql } from "./jql";
import { customFields } from '../constants/customeFields'
import { members } from '../constants/members'
import { getMongoDb } from '../utils/mongo';
import { mapSprints, buildWorklogAllAssignee, mapIssueWithWorklogs, mapIssueBasicDetails, accumulateWorklogMap, finalizeWorklogMap, countIssuesPerMember } from './dataMapper';

const JIRA_BASE_URL = 'http://jira.lge.com/issue';

export interface JiraUser {
	name?: string;
	displayName?: string;
	emailAddress?: string;
	[key: string]: any;
}

export interface JiraSprint {
	id: number;
	name: string;
	state: 'active' | 'future' | 'closed' | string;
	startDate?: string;
	endDate?: string;
	completeDate?: string;
	originBoardId?: number;
	goal?: string;
	[key: string]: any;
}

function buildAuthHeader(token: string): string {
	// Adjust this if your PAT is Basic instead of Bearer
	return `Bearer ${token}`;
}

async function callJira<T>(
    path: string,
    token: string,
    options: RequestInit = {}
): Promise<T> {

    const url = `${JIRA_BASE_URL}${path}`;
    console.log("Calling Jira:", url);

    const res = await fetch(url, {
        ...(options as any),
        headers: {
            ...(options.headers || {}),
            Authorization: `Bearer ${token}`,
            Cookie: process.env.JIRA_COOKIE,  // 🔥 ADD THIS
            Accept: "application/json",
            "Content-Type": "application/json"
        }
    });

    if (!res.ok) {
        const text = await res.text().catch(() => "");
        console.error(`Jira API error ${res.status} ${res.statusText}:`, text);
        throw new Error(
            `Jira API error ${res.status} ${res.statusText}: ${text}`
        );
    }

    const contentType = res.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
        const text = await res.text().catch(() => "");
        console.error(`Jira API returned non-JSON response:`, text);
        throw new Error(`Jira API returned non-JSON response: ${text}`);
    }

    return res.json() as Promise<T>;
}

async function validatePat(token: string): Promise<JiraUser> {
	return callJira<JiraUser>('/rest/api/2/myself', token);
}

// get all sprints for a board (with pagination)
async function getBoardSprints(
	token: string,
	teamId: number,
): Promise<JiraSprint[]> {

	const states = ["future", "active", "closed"];

	// Helper: fetch all pages for a single state
	// Uses a paging loop and is resilient when the API does not return `total`.
	async function fetchSprintsForState(state: string): Promise<JiraSprint[]> {
		const perPage = 50; // increase to reduce round trips; adjust for your Jira limits
		let startAt = 0;
		const collected: JiraSprint[] = [];

		// get the boardId from part_teams collection where teamId matches
		let boardId: number | undefined;
		try {
			const db = getMongoDb();
			const team = await db.collection('part_teams').findOne({ teamId });
			if (team) {
				console.log(`Resolved boardId ${team.boardId} for teamId ${teamId} from MongoDB part_teams collection`)
				boardId = team.boardId;
			}
		} catch (e) {
			console.warn('Failed to resolve boardId from teamId', e);
		}

		while (true) {
			const resp = await callJira<{ values: JiraSprint[]; total?: number }>(
				`/rest/agile/1.0/board/${boardId}/sprint?state=${state}&maxResults=${perPage}&startAt=${startAt}`,
				token
			);

			collected.push(...(resp.values || []));

			// If `total` is not provided, stop when returned page has fewer items than requested
			if (!resp.values || resp.values.length < perPage) break;

			startAt += perPage;
		}

		console.log('Fetched Sprints for state=', state, ' total=', collected.length);
		return collected;
	}

	// Fetch each state in parallel (each state will itself paginate as needed)
	const perStatePromises = states.map((s) => fetchSprintsForState(s));
	const perStateResults = await Promise.all(perStatePromises);

	// flatten and dedupe by id (some APIs might return duplicates across states)
	const all = perStateResults.flat();
	const seen = new Map<number, JiraSprint>();
	for (const sp of all) {
		if (!seen.has(sp.id)) seen.set(sp.id, sp);
	}

	const responseData = mapSprints(Array.from(seen.values()), '2025-01-01');
	return responseData;
}

// get all sprints across every board registered in the domain (sprintBoards collection),
// rather than sprints scoped to a single board/team
async function getAllDomainSprints(token: string): Promise<JiraSprint[]> {
	const states = ["future", "active", "closed"];
	const perPage = 50;

	let boards: Array<{ boardId: number; teamName?: string }> = [];
	try {
		const db = getMongoDb();
		boards = await db.collection('sprintBoards')
			.find({}, { projection: { boardId: 1, teamName: 1 } })
			.toArray() as any;
	} catch (e) {
		console.warn('Failed to load boards from MongoDB sprintBoards collection', e);
	}

	if (!boards || boards.length === 0) {
		console.warn('No boards found in sprintBoards collection; returning empty sprint list');
		return [];
	}

	async function fetchSprintsForBoardAndState(boardId: number, state: string): Promise<JiraSprint[]> {
		let startAt = 0;
		const collected: JiraSprint[] = [];

		while (true) {
			const resp = await callJira<{ values: JiraSprint[]; total?: number }>(
				`/rest/agile/1.0/board/${boardId}/sprint?state=${state}&maxResults=${perPage}&startAt=${startAt}`,
				token
			);

			collected.push(...(resp.values || []));

			if (!resp.values || resp.values.length < perPage) break;

			startAt += perPage;
		}

		return collected;
	}

	const fetchPromises = boards.flatMap((board) =>
		states.map((state) =>
			fetchSprintsForBoardAndState(board.boardId, state).catch((e) => {
				console.warn(`Failed to fetch ${state} sprints for board ${board.boardId}`, e);
				return [] as JiraSprint[];
			})
		)
	);

	const results = await Promise.all(fetchPromises);
	const all = results.flat();

	const seen = new Map<number, JiraSprint>();
	for (const sp of all) {
		if (!seen.has(sp.id)) seen.set(sp.id, sp);
	}

	console.log(`Fetched ${seen.size} unique sprints across ${boards.length} boards in domain`);
	return mapSprints(Array.from(seen.values()), '2025-01-01');
}

async function getSprintWorklogs(
	token: string,
	sprintId: number,
	fromDate?: string,
	toDate?: string,
	teamId?: number,
	hardLoad?:boolean
) {
	// If hardLoad is not true, try to return a cached snapshot from MongoDB
	if (!hardLoad) {
		try {
			const db = getMongoDb();
			const filter: any = { sprintId };
			if (teamId !== undefined && teamId !== null) filter.teamId = parseInt(String(teamId), 10);
			console.log(filter);
			const snap = await db.collection('worklogSnapshots').findOne(filter);
			console.log('Loaded worklog snapshot from MongoDB for sprint', sprintId, snap ? 'FOUND' : 'NOT FOUND');
			if (snap && snap.data) {
				console.log(`Returning cached worklogs for sprint ${sprintId} from MongoDB`);
				// Return the stored result merged with the snapshot timestamp as `updated`
				return {
					...(snap.data || {}),
					updated: snap.timestamp || new Date()
				};
			}
		} catch (e) {
			console.warn('Failed to load cached sprint worklogs from MongoDB, falling back to Jira fetch', e);
		}
	}

	// Attempt to load members from MongoDB `members` collection.
	// If `boardId` isn't provided, try to resolve boardId for the current user via `/rest/api/2/myself`.
	let memberList: string[] = members;
	try {
		const db = getMongoDb();
		const query: any = {};

		if(teamId) {
			query.teamId = Number(teamId);
		}
		// get the memberlist based on the teamId from MongoDB `members` collection. If teamId is not provided, get all members without filtering by teamId
		
		const docs = await db.collection('members').find(query, { projection: { name: 1 } }).toArray();
		const names = (docs || []).map((d: any) => d && d.name).filter(Boolean);
		if (names.length > 0) memberList = names;
	} catch (e) {
		// If DB not available or query fails, fall back to static list
		console.warn('Failed to load members from MongoDB, falling back to constants.members', e);
	}

	const fields = [
		"summary",
		"assignee",
		"timeoriginalestimate",
		"timeestimate",
		customFields.STORY_POINT_FIELD,
		"timetracking",
		"labels",
	];

	// Helper function to fetch worklogs for a single member
	async function fetchWorklogsForMember(member: string) {
		let jql = `Sprint = ${sprintId} AND assignee = "${member}"`;
		if (fromDate) jql += ` AND worklogDate >= "${fromDate}"`;
		if (toDate) jql += ` AND worklogDate <= "${toDate}"`;

		const aggMap = new Map<string, any>();
		const maxResults = 500;

		// Fetch first page to learn total
		const first = await callJira<any>(
			`/rest/api/2/search`,
			token,
			{
				method: "POST",
				body: JSON.stringify({
					jql,
					fields,
					startAt: 0,
					maxResults,
					expand: ["worklog"]
				})
			}
		).catch((err) => ({ issues: [], total: 0 }));

		accumulateWorklogMap(aggMap, first.issues || []);
		const total = first.total || 0;

		// Fetch remaining pages if needed
		if ((first.issues || []).length < total) {
			const offsets: number[] = [];
			for (let s = maxResults; s < total; s += maxResults) offsets.push(s);

			// Fetch remaining pages in batches
			const concurrency = 5;
			for (let i = 0; i < offsets.length; i += concurrency) {
				const batch = offsets.slice(i, i + concurrency);
				const promises = batch.map((startAt) =>
					callJira<any>(
						`/rest/api/2/search`,
						token,
						{
							method: "POST",
							body: JSON.stringify({
								jql,
								fields,
								startAt,
								maxResults,
								expand: ["worklog"]
							})
						}
					).catch((err) => ({ issues: [] }))
				);

				const results = await Promise.all(promises);
				for (const r of results) accumulateWorklogMap(aggMap, r.issues || []);
			}
		}

		return aggMap;
	}

	// Make parallel calls for each member
	const memberPromises = memberList.map(member => fetchWorklogsForMember(member));
	const memberResults = await Promise.all(memberPromises);

	// Combine all results into a single map
	const combinedAggMap = new Map<string, any>();
	for (const memberMap of memberResults) {
		for (const [key, value] of memberMap) {
			if (combinedAggMap.has(key)) {
				// Merge worklogs if issue already exists
				const existing = combinedAggMap.get(key);
				if (existing.worklogs && value.worklogs) {
					existing.worklogs.push(...value.worklogs);
				}
			} else {
				combinedAggMap.set(key, value);
			}
		}
	}

	const responseData = finalizeWorklogMap(combinedAggMap);

	const result = {
		jql: `Parallel queries for ${memberList.length} members`,
		data: responseData,
		updated: new Date().toISOString()
	};

	// Save snapshot to MongoDB after successful Jira fetch
	try {
		const db = getMongoDb();
		const filter: any = { sprintId };
		const parsedTeamId = teamId !== undefined && teamId !== null ? parseInt(String(teamId), 10) : null;
		if (teamId !== undefined && teamId !== null) filter.teamId = parsedTeamId;

		const doc = {
			sprintId,
			teamId: parsedTeamId,
			timestamp: new Date(),
			data: result
		};

		await db.collection('worklogSnapshots').replaceOne(filter, doc, { upsert: true });
		console.log(`[JIRA] Saved worklog snapshot for Sprint ${sprintId} to MongoDB`);
	} catch (e) {
		console.warn(`[JIRA] Failed to save worklog snapshot for Sprint ${sprintId}:`, e);
		// Don't throw; continue with response
	}

	return result;
}

/**
 * Get all issues assigned to a specific assignee within a sprint, including labels, epic/parent, title,
 * time estimates and all worklogs for each issue.
 */
async function getIssuesForAssigneeInSprint(
	token: string,
	sprintId: number,
	assignee: string
) {
	const jql = buildIssuesForAssigneeJql(sprintId, assignee);
	let allIssues: any[] = [];
	let startAt = 0;
	const maxResults = 50;

	// fields: include labels, summary, parent (epic link), timetracking estimates, worklog
	const fields = [
		'summary',
		'labels',
		'status',
		'parent',
		'issuetype',
		'key',
		'timetracking',
		customFields.STORY_POINT_FIELD,
		'worklog'
	];

	while (true) {
		const result = await callJira<any>(
			`/rest/api/2/search`,
			token,
			{
				method: 'POST',
				body: JSON.stringify({
					jql,
					fields,
					startAt,
					maxResults,
					expand: ['worklog']
				})
			}
		);

		allIssues.push(...result.issues);

		if (startAt + maxResults >= result.total) break;
		startAt += maxResults;
	}

	// Log the first issue details
	if (allIssues.length > 0) {
		console.log('Sample Jira issue details:', JSON.stringify(allIssues[0], null, 2));
	}

	// Map issues to a simpler shape including worklogs using dataMapper
	const mapped = allIssues.map((iss: any) => mapIssueWithWorklogs(iss, customFields.STORY_POINT_FIELD));

	return {
		jql,
		total: mapped.length,
		issues: mapped
	};
}

const getIssues = async (
	token: string,
	fields?: string[],
	jql?: string
) => {
	let allIssues: any[] = [];
	let startAt = 0;
	const maxResults = 50;

	while (true) {
		const result = await callJira<any>(
			`/rest/api/2/search`,
			token,
			{
				method: 'POST',
				body: JSON.stringify({
					jql,
					fields,
					startAt,
					maxResults,
					expand: ['changelog']
				})
			}
		);

		allIssues.push(...result.issues);

		if (startAt + maxResults >= result.total) break;
		startAt += maxResults;
	}

	return allIssues;
}

async function getWorkItemsForAssignee(
	token: string,
	assignee: string,
	issueTypes?: string[],
	issueStatuses?: string[],
	fields?: string[]
) {
	const jql = buildWorkItemsByFiltersJql(issueTypes, issueStatuses, [assignee]);
	const allIssues = await getIssues(token, fields, jql);

	return allIssues;
}

async function getIssuesForAssignee(
	token: string,
	assignee: string,
	issueTypes?: string[],
	issueStatuses?: string[],
	fields?: string[]
) {
	const jql = buildIssuesByFiltersJql(issueTypes, issueStatuses, [assignee]);

	const allIssues = await getIssues(token, fields, jql);
	return allIssues;
}

const IssueFields = [
		'summary',
		'description',
		'status',
		'issuetype',
		'key',
		'id',
		'assignee',
		'created',
		'duedate',
		'updated',
		'priority',
		'resolution',
		'labels',
		customFields.STORY_POINT_FIELD,
		'changelog',
	] as string[];

const getTeamMembers = async (assignee: string, teamId: number) => {
	let assignees: string[] | undefined = undefined;
	if (!assignee) {
		try {
			const db = getMongoDb();
			const docs = await db.collection('members').find({ teamId: Number(teamId) }, { projection: { name: 1 } }).toArray();
			assignees = (docs || []).map((d: any) => d && d.name).filter(Boolean);
			// If no assignees found, don't filter by assignee
			if (!assignees || assignees.length === 0) {
				assignees = undefined;
			}
		} catch (e) {
			console.warn('Failed to load members from MongoDB for boardId', teamId, e);
			// Fall back to no assignee filter if DB fails
			assignees = undefined;
		}
	} else {
		assignees = [assignee];
	}

	return assignees;
}

/**
 * Save issues to MongoDB issueAnalysis collection
 * Extracts ticketId, summary, and description fields
 */
const saveIssuesToAnalysisCollection = async (issues: any[]) => {
	if (!issues || issues.length === 0) {
		console.log('No issues to save');
		return;
	}

	try {
		const db = getMongoDb();
		const collection = db.collection('issueAnalysis');

		// Transform issues to extract required fields
		const analysisRecords = issues.map((issue: any) => ({
			ticketId: issue.key,
			summary: issue.fields?.summary || '',
			description: issue.fields?.description || '',
			issueId: issue.id,
			updatedAt: new Date()
		}));

		// Use upsert to avoid duplicates - update if ticketId exists, insert if not
		const bulkOps = analysisRecords.map((record: any) => ({
			updateOne: {
				filter: { ticketId: record.ticketId },
				update: {
					$set: {
						ticketId: record.ticketId,
						summary: record.summary,
						description: record.description,
						issueId: record.issueId,
						updatedAt: record.updatedAt
					},
					$setOnInsert: { 
						createdAt: new Date()
					}
				},
				upsert: true
			}
		}));

		const result = await collection.bulkWrite(bulkOps);
		console.log(`Saved/Updated ${result.upsertedCount + result.modifiedCount} issues to issueAnalysis collection`);
	} catch (error) {
		console.error('Error saving issues to issueAnalysis collection:', error);
		throw error;
	}
}

const getMappedIssues = async (issues: any[]) => {
	const mapped = issues.map((iss: any) => mapIssueBasicDetails(iss));

	// Fetch AI analysis results from MongoDB for each issue
	try {
		const db = getMongoDb();
		const analysisCollection = db.collection('issueAnalysis');
		
		for (let i = 0; i < mapped.length; i++) {
			const ticketId = mapped[i].key;
			const analysis = await analysisCollection.findOne({ ticketId });
			if (analysis) {
				mapped[i].analysisCompleted = analysis.analysisCompleted || false;
				mapped[i].analysisResult = analysis.analysisResult || null;
			}
		}
	} catch (e) {
		console.warn('Failed to fetch AI analysis results from MongoDB', e);
		// Continue without analysis results if lookup fails
	}

	// Count bugs per user
	const bugCountByUser: { [user: string]: number } = {};
	mapped.forEach((issue: any) => {
		if (issue.type === 'Bug') {
			const user = issue.assignee || 'Unassigned';
			bugCountByUser[user] = (bugCountByUser[user] || 0) + 1;
		}
	});

	return  {
		mapped,
		bugCountByUser
	}
}

async function getWorkItemsByFilters(
	token: string,
	boardId: number,
	issueStatuses?: string[],
	assignee?: string
) {

	const assignees = await getTeamMembers(assignee, boardId);

	let allIssues: any[] = [];

	const issueTypes = ['epic', 'initiative']

	if (assignees && assignees.length > 0) {
		// Make parallel calls for each assignee
		const promises = assignees.map(assigneeName => 
			getWorkItemsForAssignee(token, assigneeName, issueTypes, issueStatuses, IssueFields)
		);
		
		const results = await Promise.all(promises);
		allIssues = results.flat();
		console.log(`Total issues fetched: ${allIssues.length}`);
		console.log('Sample issue details:', JSON.stringify(allIssues[0], null, 2));
	} else {
		console.log('No assignees found');
	}

	const {mapped, bugCountByUser} = await getMappedIssues(allIssues);

	return {
		jql: assignees ? `Parallel queries for ${assignees.length} assignees` : 'Single query without assignee filter',
		total: mapped.length,
		issues: mapped,
		bugCountByUser,
		filters: {
			issueTypes,
			issueStatuses,
			assignee,
			boardId
		}
	};
}

async function getIssuesByFilters(
	token: string,
	teamId: number,
	issueStatuses?: string[],
	assignee?: string
) {

	// If assignee is null, read users from MongoDB based on teamId
	const assignees = await getTeamMembers(assignee, teamId);

	let allIssues: any[] = [];

	const issueTypes = ['bug'];
	
	// todo: If issue status first index value "Done" then we need to include all the done statuses like "Done", "Resolved", "Closed" etc.
	if (issueStatuses && issueStatuses.length > 0 && issueStatuses[0] === 'Done') {
		issueStatuses = ['Done', 'Resolved', 'Closed'];
	}

	if (assignees && assignees.length > 0) {
		// Make parallel calls for each assignee
		const promises = assignees.map(assigneeName => 
			getIssuesForAssignee(token, assigneeName, issueTypes, issueStatuses, IssueFields)
		);
		
		const results = await Promise.all(promises);
		allIssues = results.flat();
		console.log(`Total issues fetched: ${allIssues.length}`);
	} else {
		// Fallback: make a single call without assignee filter
		console.log('No assignees found');
	}

	// Save issues to MongoDB issueAnalysis collection
	try {
		await saveIssuesToAnalysisCollection(allIssues);
	} catch (error) {
		console.error('Failed to save issues to issueAnalysis collection:', error);
		// Continue even if save fails, don't block the response
	}

	const {mapped, bugCountByUser} = await getMappedIssues(allIssues);
	return {
		jql: assignees ? `Parallel queries for ${assignees.length} assignees` : 'Single query without assignee filter',
		total: mapped.length,
		issues: mapped,
		bugCountByUser,
		filters: {
			issueTypes,
			issueStatuses,
			assignee,
			teamId
		}
	};
}

async function getIssuesByDateName(
	token: string,
	startDate?: string,
	endDate?: string,
	issueStatuses?: string[],
 	name?: string,
 	assignee?: string
) {
	const parts: string[] = ['type = Bug'];

	if (startDate) {
		parts.push(`created >= "${startDate}"`);
	}

	if (endDate) {
		parts.push(`created <= "${endDate}"`);
	}

	if (issueStatuses && issueStatuses.length > 0) {
		if (issueStatuses.includes('Active') && issueStatuses.includes('Delivered')) {
			// no status filter
		} else if (issueStatuses.includes('Active')) {
			parts.push('status not in ("Resolved", "Closed", "Verify")');
		} else {
			parts.push(`status in (${issueStatuses.map(s => `"${s}"`).join(', ')})`);
		}
	} else {
		parts.push('status not in ("Resolved", "Closed")');
	}

	if (name) {
		// match summary or exact key
		parts.push(`(summary ~ "${name}" OR key = "${name}")`);
	}

	// base JQL parts (without assignee)
	const baseJql = parts.join(' AND ');
	const fields = [
		'id',
		'key',
		'summary',
		'assignee',
		'labels',
		'description',
		'comment',
		'status',
		'issuetype',
		'created',
		'updated',
		'customfield_34205', // Issue Cause_cf
		'customfield_34206',  // Issue Improvement
		'changelog',
	];

	// If assignee specified, query only for that assignee. Otherwise, resolve members from MongoDB
	let assignees: string[] | undefined = undefined;
	if (assignee) {
		assignees = [assignee];
	} else {
		try {
			const db = getMongoDb();
			// only include members for boardId 40046 as requested
			const docs = await db.collection('members')
				.find({ boardId: 40046 }, { projection: { name: 1 } })
				.toArray();
			const names = (docs || []).map((d: any) => d && d.name).filter(Boolean);
			if (names.length > 0) assignees = names;
		} catch (e) {
			console.warn('Failed to load members from MongoDB for issues by date/name', e);
			assignees = undefined;
		}
	}

	let allIssues: any[] = [];
	const maxResults = 50;

	if (assignees && assignees.length > 0) {
		// Parallel queries per assignee
		const promises = assignees.map(async (a) => {
			const jql = `${baseJql} AND assignee = "${a}"`;
			return await getIssues(token, fields, jql).catch(() => []);
		});

		const results = await Promise.all(promises);
		allIssues = results.flat();
	} else {
		// Single query without assignee filter
		const jql = baseJql;
		allIssues = await getIssues(token, fields, jql).catch(() => []);
	}

	// Map to simplified structure matching user request
	const mapped = allIssues.map((iss: any) => {
		const f = iss.fields || {};
		return {
			ID: iss.key,
			label: f.labels || [],
			summary: f.summary || '',
			assignee: f.assignee ? (f.assignee.displayName || f.assignee.name) : 'Unassigned',
			description: f.description || '',
			comment: (f.comment && f.comment.comments ? f.comment.comments.map((c: any) => ({
				author: c.author?.name || c.author?.displayName,
				name: c.author?.displayName || c.author?.name,
				date: c.created,
				content: c.body
			})) : []),
			"Issue Cause_cf": f['Issue Cause_cf'] || f['customfield_34205'] || '',
			"Issue Improvement": f['Issue Improvement'] || f['customfield_34206'] || '',
			analysisResult: undefined
		};
	});

	// Fetch AI analysis results from MongoDB for each issue
	try {
		const db = getMongoDb();
		const analysisCollection = db.collection('issueAnalysis');
		
		for (let i = 0; i < mapped.length; i++) {
			const issueKey = mapped[i].ID;
			const analysis = await analysisCollection.findOne({ ticketId: issueKey });
			if (analysis) {
				mapped[i].analysisResult = analysis;
			}
		}
	} catch (e) {
		console.warn('Failed to fetch AI analysis results from MongoDB', e);
		// Continue without analysis results if lookup fails
	}

	const jqlReturn = (assignees && assignees.length > 0)
		? (assignees.length === 1 ? `${baseJql} AND assignee = "${assignees[0]}"` : `Parallel queries for ${assignees.length} assignees`)
		: baseJql;

	return {
		jql: jqlReturn,
		count: mapped.length,
		issues: mapped
	};
}

function parseTimeSpentToSeconds(timeSpent: string): number {
	// Parse strings like "1h 30m", "2h", "45m", "3600" (assuming seconds if no unit)
	const regex = /(\d+)\s*([hms]?)/gi;
	let totalSeconds = 0;
	let match;

	while ((match = regex.exec(timeSpent)) !== null) {
		const value = parseInt(match[1], 10);
		const unit = match[2].toLowerCase();

		switch (unit) {
			case 'h':
				totalSeconds += value * 3600;
				break;
			case 'm':
				totalSeconds += value * 60;
				break;
			case 's':
				totalSeconds += value;
				break;
			default:
				// If no unit, assume seconds
				totalSeconds += value;
				break;
		}
	}

	return totalSeconds;
}

async function postWorklog(
	token: string,
	issueIdOrKey: string,
	timeSpent: string,
	started?: string,
	comment?: string
): Promise<any> {
	// Parse timeSpent string to seconds
	const timeSpentSeconds = parseTimeSpentToSeconds(timeSpent);

	const body: any = {
		timeSpentSeconds,
		started: started ? new Date(started).toISOString().replace('Z', '+0000') : new Date().toISOString().replace('Z', '+0000'),
	};

	body.comment = comment || '[Logged via API]';

	console.log('Token:', token);

	return callJira(`/rest/api/2/issue/${encodeURIComponent(issueIdOrKey)}/worklog`, token, {
		method: "POST",
		body: JSON.stringify(body),
	});
}
async function getWorklogsForIssue(token: string, issueIdOrKey: string): Promise<any> {
	return callJira(`/rest/api/2/issue/${encodeURIComponent(issueIdOrKey)}/worklog`, token);
}

async function getTeamTVPMsCount(
	token: string,
	teamId: number,
	fromDate?: string,
	toDate?: string
): Promise<Record<string, number>> {
	try {
		const db = getMongoDb();
		
		// Fetch team members from MongoDB
		const members = await db.collection('members')
			.find({ teamId }, { projection: { name: 1 } })
			.toArray();

		if (!members || members.length === 0) {
			return {};
		}

		const memberNames = members.map((m: any) => m.name).filter(Boolean);
		if (memberNames.length === 0) {
			return {};
		}

		// Build JQL for TVPMs (type = Improvement)
		const jqlParts: string[] = ['type = Improvement'];

		if (fromDate) {
			jqlParts.push(`created >= "${fromDate}"`);
		}

		if (toDate) {
			jqlParts.push(`created <= "${toDate}"`);
		}

		// Add assignees filter
		jqlParts.push(`assignee in (${memberNames.map(m => `"${m}"`).join(', ')})`);

		const jql = jqlParts.join(' AND ');
		const fields = ['id', 'key', 'summary', 'assignee', 'created', 'issuetype'];
		const maxResults = 50;

		let allIssues: any[] = [];
		let startAt = 0;
		let totalFetched = 0;

		// Paginate through all issues
		while (true) {
			const response = await callJira<any>(
				`/rest/api/2/search?jql=${encodeURIComponent(jql)}&fields=${fields.join(',')}&maxResults=${maxResults}&startAt=${startAt}`,
				token
			);

			const issues = response.issues || [];
			if (issues.length === 0) break;

			allIssues.push(...issues);
			totalFetched += issues.length;

			if (issues.length < maxResults) break;
			startAt += maxResults;
		}

		// Count issues per assignee
		const counts: Record<string, number> = {};
		for (const memberName of memberNames) {
			counts[memberName] = 0;
		}

		for (const issue of allIssues) {
			const assignee = issue.fields?.assignee?.name;
			if (assignee && typeof counts[assignee] === 'number') {
				counts[assignee] += 1;
			}
		}

		return counts;
	} catch (err: any) {
		console.error('Failed to fetch team TVPMs count:', err);
		throw err;
	}
}

const escapeJiraValue = (value: string) => String(value).replace(/"/g, '\\"');

async function getDueTodayIssues(token: string, teamId?: number): Promise<{ key: string; assignee: string; duedate: string }[]> {
	const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); // "YYYY-MM-DD" in IST
	const fields = ['assignee', 'reporter', 'duedate', 'status'];

	// Resolve team members from MongoDB to scope the query
	let teamMembers: string[] = [];
	try {
		const db = getMongoDb();
		const query: any = teamId ? { teamId: Number(teamId) } : {};
		const docs = await db.collection('members').find(query, { projection: { name: 1 } }).toArray();
		teamMembers = (docs || []).map((d: any) => d?.name).filter(Boolean);
	} catch (e) {
		console.warn('[TEAMS] Failed to load members from MongoDB, will fetch without member filter:', e);
	}

	let allIssues: any[] = [];

	if (teamMembers.length > 0) {
		const promises = teamMembers.map(member => {
			const jql = `duedate = "${today}" AND status not in ("Done", "Resolved", "Closed") AND assignee = "${escapeJiraValue(member)}"`;
			return getIssues(token, fields, jql).catch(() => []);
		});
		const results = await Promise.all(promises);
		allIssues = results.flat();
	} else {
		const jql = `duedate = "${today}" AND status not in ("Done", "Resolved", "Closed")`;
		allIssues = await getIssues(token, fields, jql).catch(() => []);
	}

	return allIssues
		.filter((iss: any) => {
			const assigneeName = iss.fields?.assignee?.name || '';
			const reporterName = iss.fields?.reporter?.name || '';
			// exclude if assignee == reporter (self-reported)
			if (assigneeName && assigneeName === reporterName) return false;
			// exclude if reporter is also a team member
			if (reporterName && teamMembers.includes(reporterName)) return false;
			return true;
		})
		.map((iss: any) => ({
			key: iss.key,
			assignee: iss.fields?.assignee?.displayName || iss.fields?.assignee?.name || 'Unassigned',
			duedate: iss.fields?.duedate || today,
		}));
}

async function getReopenedIssues(token: string, teamId?: number): Promise<{ key: string; assignee: string }[]> {
	const fields = ['assignee', 'reporter', 'status'];

	let teamMembers: string[] = [];
	try {
		const db = getMongoDb();
		const query: any = teamId ? { teamId: Number(teamId) } : {};
		const docs = await db.collection('members').find(query, { projection: { name: 1 } }).toArray();
		teamMembers = (docs || []).map((d: any) => d?.name).filter(Boolean);
	} catch (e) {
		console.warn('[TEAMS] Failed to load members from MongoDB for reopened issues:', e);
	}

	let allIssues: any[] = [];

	if (teamMembers.length > 0) {
		const promises = teamMembers.map(member => {
			const jql = `type = Bug AND status = "Reopened" AND assignee = "${escapeJiraValue(member)}"`;
			return getIssues(token, fields, jql).catch(() => []);
		});
		const results = await Promise.all(promises);
		allIssues = results.flat();
	} else {
		allIssues = await getIssues(token, fields, `type = Bug AND status = "Reopened"`).catch(() => []);
	}

	return allIssues
		.filter((iss: any) => {
			const assigneeName = iss.fields?.assignee?.name || '';
			const reporterName = iss.fields?.reporter?.name || '';
			if (assigneeName && assigneeName === reporterName) return false;
			if (reporterName && teamMembers.includes(reporterName)) return false;
			return true;
		})
		.map((iss: any) => ({
			key: iss.key,
			assignee: iss.fields?.assignee?.displayName || iss.fields?.assignee?.name || 'Unassigned',
		}));
}

async function getDueDateChangeIssues(token: string, teamId?: number): Promise<{ key: string; assignee: string; dueDateChangeCount: number }[]> {
	const fields = ['assignee', 'reporter', 'duedate', 'status'];

	let teamMembers: string[] = [];
	try {
		const db = getMongoDb();
		const query: any = teamId ? { teamId: Number(teamId) } : {};
		const docs = await db.collection('members').find(query, { projection: { name: 1 } }).toArray();
		teamMembers = (docs || []).map((d: any) => d?.name).filter(Boolean);
	} catch (e) {
		console.warn('[TEAMS] Failed to load members from MongoDB for due date changes:', e);
	}

	let allIssues: any[] = [];

	if (teamMembers.length > 0) {
		// Query per member in parallel — scoped + avoids huge single query
		const promises = teamMembers.map(member => {
			const jql = `type = Bug AND status not in ("Done", "Resolved", "Closed") AND assignee = "${escapeJiraValue(member)}"`;
			return getIssues(token, fields, jql).catch(() => []);
		});
		const results = await Promise.all(promises);
		allIssues = results.flat();
	} else {
		const jql = `type = Bug AND status not in ("Done", "Resolved", "Closed")`;
		allIssues = await getIssues(token, fields, jql).catch(() => []);
	}

	console.log(`[TEAMS] Fetched ${allIssues.length} open bug(s) to check for due date changes`);

	const result: { key: string; assignee: string; dueDateChangeCount: number }[] = [];

	for (const iss of allIssues) {
		const assigneeName = iss.fields?.assignee?.name || '';
		const reporterName = iss.fields?.reporter?.name || '';

		// Skip if reporter is internal (team member or same as assignee)
		if (assigneeName && assigneeName === reporterName) continue;
		if (reporterName && teamMembers.includes(reporterName)) continue;

		const changelog = iss.changelog?.histories || [];

		// Count only due date changes made by a team member (not external users)
		const dueDateChanges = changelog.reduce((count: number, history: any) => {
			const authorName = history.author?.name || '';
			const changedDueDate = (history.items || []).some((item: any) => item.field === 'duedate');
			const changedByTeam = teamMembers.includes(authorName);
			return (changedDueDate && changedByTeam) ? count + 1 : count;
		}, 0);

		if (dueDateChanges > 1) {
			result.push({
				key: iss.key,
				assignee: iss.fields?.assignee?.displayName || iss.fields?.assignee?.name || 'Unassigned',
				dueDateChangeCount: dueDateChanges,
			});
		}
	}

	return result.sort((a, b) => b.dueDateChangeCount - a.dueDateChangeCount);
}

async function getParkedIssues(token: string): Promise<{ key: string; assignee: string; created: string; status: string }[]> {
	const jql = `project in (QEVENTTH, QEVENTTG, QEVENTTF, QEVENTSIT, TVCSISSUE, DITTEST, IDOQAISSUE, INOQAISSUE, INQAISSUE) AND assignee in membersOf("LGSI MS System App Solution(11018653)_grp") AND created <= -7d AND status not in (Resolved, Closed, "SW MP RELEASE") ORDER BY created ASC`;
	const fields = ['assignee', 'status', 'created', 'summary'];

	const issues = await getIssues(token, fields, jql).catch((err) => {
		console.warn('[TEAMS] Failed to fetch parked issues:', err.message);
		return [];
	});

	return issues.map((iss: any) => ({
		key: iss.key,
		assignee: iss.fields?.assignee?.displayName || iss.fields?.assignee?.name || 'Unassigned',
		created: iss.fields?.created
			? new Date(iss.fields.created).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
			: '',
		status: iss.fields?.status?.name || '',
	}));
}

// Get issues that were resolved in a specific date range
async function getResolvedIssuesByDateRange(
	token: string,
	startDate: string,
	endDate: string,
	teamId?: number | string,
	hardReload: boolean = false
): Promise<{ memberIssueCounts: { name: string; issuesCount: number }[]; total: number; jql: string; fromCache?: boolean }> {
	try {
		const db = getMongoDb();
		const snapshotId = `resolved_${startDate}_${endDate}_${teamId || 'all'}`;

		// If not hardReload, try to fetch from cache first
		if (!hardReload) {
			try {
				const cached = await db.collection('reviewSnapshots').findOne({ snapshotKey: snapshotId });
				if (cached && cached.data) {
					console.log(`Returning cached snapshot for resolved issues: ${snapshotId}`);
					return {
						...cached.data,
						fromCache: true
					};
				}
			} catch (cacheErr) {
				console.warn(`Failed to fetch from cache:`, cacheErr);
				// Continue with Jira fetch
			}
		}

		const fields = [
			'key',
			'summary',
			'status',
			'assignee',
			'issuetype',
			'created',
			'resolutiondate',
			'priority',
			'description',
			'changelog',
		];

		// Fetch team members from MongoDB
		let teamMembers: string[] = [];
		if (teamId) {
			try {
				const docs = await db.collection('members').find({ teamId: Number(teamId) }, { projection: { name: 1 } }).toArray();
				teamMembers = (docs || []).map((d: any) => d && d.name).filter(Boolean);
				console.log(`Fetched ${teamMembers.length} team members for teamId ${teamId}`);
			} catch (e) {
				console.warn(`Failed to fetch team members from MongoDB for teamId ${teamId}:`, e);
			}
		}

		// If no team members found, return empty result
		if (teamMembers.length === 0) {
			console.log(`No team members found for teamId ${teamId}. Returning empty member counts.`);
			return {
				memberIssueCounts: [],
				total: 0,
				jql: `No team members found for teamId ${teamId}`
			};
		}

		async function fetchResolvedIssuesForMember(member: string) {
			const escapedMember = escapeJiraValue(member);
			const memberJql = `type = Bug AND status in ("Resolved", "Closed") AND resolutiondate >= "${startDate}" AND resolutiondate <= "${endDate}" AND assignee = "${escapedMember}"`;
			return getIssues(token, fields, memberJql).catch((err) => {
				console.warn(`Failed to fetch resolved issues for ${member}:`, err);
				return [];
			});
		}

		const memberPromises = teamMembers.map(member => fetchResolvedIssuesForMember(member));
		const memberResults = await Promise.all(memberPromises);
		const allIssues = memberResults.flat();

		const countedMembers = countIssuesPerMember(allIssues);

		// Ensure all team members are in the response, including those with 0 issues
		const memberIssueCounts = teamMembers.map(member => {
			const found = countedMembers.find(m => m.name.includes(member));
			return {
				name: member,
				issuesCount: found ? found.issuesCount : 0,
				averageMttr: found ? found.averageMttr : 0
			};
		});

		const result = {
			memberIssueCounts,
			total: allIssues.length,
			jql: `Parallel queries for ${teamMembers.length} team members`
		};

		// Save snapshot to MongoDB
		try {
			await db.collection('reviewSnapshots').updateOne(
				{ snapshotKey: snapshotId },
				{
					$set: {
						startDate,
						endDate,
						teamId: teamId || null,
						data: result,
						createdAt: new Date(),
					}
				},
				{ upsert: true }
			);
			console.log(`Saved snapshot for resolved issues: ${snapshotId}`);
		} catch (saveErr) {
			console.warn(`Failed to save snapshot:`, saveErr);
			// Continue - snapshot save failure should not block response
		}

		return result;
	} catch (err: any) {
		console.error('Failed to fetch resolved issues by date range:', err);
		throw err;
	}
}

async function getIssueTransfersByDateRange(
	token: string,
	startDate: string,
	endDate: string,
	teamId?: number | string,
	hardReload: boolean = false
): Promise<{ memberIssueCounts: { name: string; issuesCount: { fixed: number; transferred: number } }[]; jql: string; fromCache?: boolean }> {
	try {
		const db = getMongoDb();
		const snapshotId = `transfers_${startDate}_${endDate}_${teamId || 'all'}`;

		// If not hardReload, try to fetch from cache first
		console.log(`Fetching issue transfers for ${startDate} to ${endDate} for teamId ${teamId} with hardReload=${hardReload}`);
		if (!hardReload) {
			try {
				const cached = await db.collection('reviewSnapshots').findOne({ snapshotKey: snapshotId });
				if (cached && cached.data) {
					console.log(`Returning cached snapshot for issue transfers: ${snapshotId}`);
					return {
						...cached.data,
						fromCache: true
					};
				}
			} catch (cacheErr) {
				console.warn(`Failed to fetch from cache:`, cacheErr);
				// Continue with Jira fetch
			}
		}

		const fields = [
			'key',
			'summary',
			'status',
			'assignee',
			'issuetype',
			'created',
			'resolutiondate',
			'priority',
			'description',
			'changelog',
		];

		// Fetch team members from MongoDB
		let teamMembers: string[] = [];
		if (teamId) {
			try {
				const docs = await db.collection('members').find({ teamId: Number(teamId) }, { projection: { name: 1 } }).toArray();
				teamMembers = (docs || []).map((d: any) => d && d.name).filter(Boolean);
				console.log(`Fetched ${teamMembers.length} team members for teamId ${teamId}`);
			} catch (e) {
				console.warn(`Failed to fetch team members from MongoDB for teamId ${teamId}:`, e);
			}
		}

		// If no team members found, return empty result
		if (teamMembers.length === 0) {
			console.log(`No team members found for teamId ${teamId}. Returning empty member counts.`);
			return {
				memberIssueCounts: [],
				jql: `No team members found for teamId ${teamId}`
			};
		}

		const projects = ['QEVENTTWT', 'QEVENTTH', 'QEVENTSIT', 'DITTEST', 'ITQEVENTA'];
		const projectClause = `project in (${projects.join(', ')})`;
		const allTeamAssignees = teamMembers.map(m => `"${escapeJiraValue(m)}"`).join(', ');

		async function fetchCountsForMember(member: string) {
			const escapedMember = escapeJiraValue(member);
			const fixedJql = `${projectClause} AND type = Bug AND status in ("Resolved", "Closed") AND resolutiondate >= "${startDate}" AND resolutiondate <= "${endDate}" AND assignee = "${escapedMember}"`;
			const transferredJql = `${projectClause} AND type = Bug AND assignee not in (${allTeamAssignees}) AND assignee was in ("${escapedMember}") AND assignee changed from ("${escapedMember}") during ("${startDate}", "${endDate}")`;

			const [fixedIssues, transferredIssues] = await Promise.all([
				getIssues(token, fields, fixedJql).catch((err) => {
					console.warn(`Failed to fetch fixed issues for ${member}:`, err);
					return [];
				}),
				getIssues(token, fields, transferredJql).catch((err) => {
					console.warn(`Failed to fetch transferred issues for ${member}:`, err);
					return [];
				})
			]);

			return {
				member,
				fixedCount: fixedIssues.length,
				transferredCount: transferredIssues.length,
			};
		}

		const memberPromises = teamMembers.map(member => fetchCountsForMember(member));
		const memberResults = await Promise.all(memberPromises);

		// Ensure all team members are in the response, including those with 0 issues
		const memberIssueCounts = teamMembers.map(member => {
			const found = memberResults.find(r => r.member === member);
			return {
				name: member,
				issuesCount: found ? {
					fixed: found.fixedCount,
					transferred: found.transferredCount
				} : { fixed: 0, transferred: 0 }
			};
		});

		const result = {
			memberIssueCounts,
			jql: `Parallel queries for ${teamMembers.length} team members`
		};

		// Save snapshot to MongoDB
		try {
			await db.collection('reviewSnapshots').updateOne(
				{ snapshotKey: snapshotId },
				{
					$set: {
						startDate,
						endDate,
						teamId: teamId || null,
						data: result,
						createdAt: new Date(),
					}
				},
				{ upsert: true }
			);
			console.log(`Saved snapshot for issue transfers: ${snapshotId}`);
		} catch (saveErr) {
			console.warn(`Failed to save snapshot:`, saveErr);
			// Continue - snapshot save failure should not block response
		}

		return result;
	} catch (err: any) {
		console.error('Failed to fetch issue transfers by date range:', err);
		throw err;
	}
}

export const jiraService = {
	validatePat,
	getBoardSprints,
	getAllDomainSprints,
	callJira,
	getSprintWorklogs,
	getIssuesForAssigneeInSprint,
	getWorkItemsByFilters,
	getIssuesByFilters,
	getIssuesByDateName,
	postWorklog,
	getWorklogsForIssue,
	getTeamTVPMsCount,
	getResolvedIssuesByDateRange,
	getIssueTransfersByDateRange,
	getDueTodayIssues,
	getReopenedIssues,
	getDueDateChangeIssues,
	getParkedIssues,
};
