
export function buildSprintWorklogJql(
	sprintId: number,
	fromDate?: string,
	toDate?: string,
    members?: string[]
) {
	const parts: string[] = [`Sprint = ${sprintId}`];

	if (fromDate) {
		parts.push(`worklogDate >= "${fromDate}"`);
	}

	if (toDate) {
		parts.push(`worklogDate <= "${toDate}"`);
	}

    if (members && members.length > 0) {
        parts.push(`assignee in (${members.map(m => `"${m}"`).join(", ")})`);
    }

	return parts.join(" AND ");
}

export function buildIssuesForAssigneeJql(sprintId: number, assignee: string) {
	return `Sprint = ${sprintId} AND assignee = "${assignee}"`;
}

export function buildWorkItemsByFiltersJql(
	issueTypes?: string[],
	issueStatuses?: string[],
	assignees?: string[]
) {
	const jqlParts: string[] = [];

	if (assignees && assignees.length > 0) {
		jqlParts.push(`assignee in (${assignees.map(a => `"${a}"`).join(', ')})`);
	}

	if (issueTypes && issueTypes.length > 0) {
		jqlParts.push(`type in (${issueTypes.map(t => `"${t}"`).join(', ')})`);
	}

	if (issueStatuses && issueStatuses.length > 0) {
		// Special handling: if both "Active" and "Delivered" are selected, don't apply any status filter
		if (issueStatuses.includes('Active') && issueStatuses.includes('Delivered')) {
			// Don't add any status filter - show all statuses
		} else if (issueStatuses.includes('Active')) {
			// Active means not Delivered, Resolved, or Closed
			jqlParts.push(`status not in ("Delivered", "Closed", "Verify")`);
		} else {
			// Normal status filtering
			jqlParts.push(`status in (${issueStatuses.map(s => `"${s}"`).join(', ')})`);
		}
	} else {
		// Default: exclude resolved and closed issues if no specific statuses provided
		jqlParts.push(`status not in ("Resolved", "Closed")`);
	}

	return jqlParts.join(' AND ');
}

export function buildIssuesByFiltersJql(
	issueTypes?: string[],
	issueStatuses?: string[],
	assignees?: string[]
) {
	const jqlParts: string[] = [];

	if (assignees && assignees.length > 0) {
		jqlParts.push(`assignee in (${assignees.map(a => `"${a}"`).join(', ')})`);
	}

	if (issueTypes && issueTypes.length > 0) {
		jqlParts.push(`type in (${issueTypes.map(t => `"${t}"`).join(', ')})`);
	}

	if (issueStatuses && issueStatuses.length > 0) {
		// Special handling: if both "Active" and "Delivered" are selected, don't apply any status filter
		if (issueStatuses.includes('Active') && issueStatuses.includes('Delivered')) {
			// Don't add any status filter - show all statuses
		} else if (issueStatuses.includes('Active')) {
			// Active means not Delivered, Resolved, or Closed
			jqlParts.push(`status not in ("Resolved", "Closed", "Verify")`);
		} else {
			// Normal status filtering
			jqlParts.push(`status in (${issueStatuses.map(s => `"${s}"`).join(', ')})`);
		}
	} else {
		// Default: exclude resolved and closed issues if no specific statuses provided
		jqlParts.push(`status not in ("Resolved", "Closed")`);
	}

	jqlParts.push(`project not in (TVQEWEBTCT, "webOS TV Platform")`);

	return jqlParts.join(' AND ');
}
