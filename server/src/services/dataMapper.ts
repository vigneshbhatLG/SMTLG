import { JiraSprint } from "./jira.service";

export interface TransformedIssue {
    key: string;
    summary: string;
    assignee: string;
    storyPoints: number;
    originalEstimateSeconds: number;
    remainingEstimateSeconds: number;
    loggedSeconds: number;
    worklogs: any[];
}

export interface AssigneeSummary {
    assigneeKey: string; // e.g. "prajwal.r"
    assigneeName: string; // e.g. "Prajwal R"
    totalStoryPoints: number; // sum of customfield_10002
    totalOriginalEstimateSeconds: number;
    totalRemainingEstimateSeconds: number;
    totalTimeSpentSeconds: number;
    // totalOriginalEstimateHours: number;
    // totalRemainingEstimateHours: number;
    // totalTimeSpentHours: number;
    totalOriginalEstimateStoryPoints: number;
    totalRemainingEstimateStoryPoints: number;
    totalTimeSpentStoryPoints: number;
    labelBreakdown: {
        [label: string]: {
            // totalOriginalEstimateHours: number;
            // totalTimeSpentHours: number;
            totalOriginalEstimateStoryPoints: number;
            totalTimeSpentStoryPoints: number;
        };
    };
}

// Pass story points field ID from service
export function mapWorklog(issue: any, storyPointsField: string): TransformedIssue {
    const fields = issue.fields;

    const worklogs = fields.worklog?.worklogs || [];

    // total logged seconds
    const loggedSeconds = worklogs.reduce((sum: number, wl: any) => sum + (wl.timeSpentSeconds || 0), 0);

    return {
        key: issue.key,
        summary: fields.summary,
        assignee: fields.assignee?.displayName || "Unassigned",
        storyPoints: fields[storyPointsField] ?? 0,
        originalEstimateSeconds: fields.timeoriginalestimate || 0,
        remainingEstimateSeconds: fields.timeestimate || 0,
        loggedSeconds,
        worklogs,
    };
}

export function mapIssueWithWorklogs(issue: any, storyPointsField: any) {
    const f = issue.fields || {};
    const worklogs = f.worklog?.worklogs || [];


    const mappedWorklogs = worklogs.map((wl: any) => ({
        id: wl.id,
        author: wl.author?.displayName || wl.author?.name,
        timeSpentSeconds: wl.timeSpentSeconds,
        timeSpent: wl.timeSpent,
        started: wl.started,
        comment: wl.comment || ''
    }));

    return {
        key: issue.key,
        link: `http://jira.lge.com/issue/browse/${issue.key}`,
        summary: f.summary,
        status: f.status?.name || 'Unknown',
        labels: f.labels || [],
        epic: f.parent ? (f.parent.key || f.parent) : null,
        issueType: f.issuetype?.name,
        timeoriginalestimate: f.timetracking.originalEstimateSeconds || null,
        timeRemainingEstimate: f.timetracking.remainingEstimateSeconds || null,
        timeSpent: f.timetracking.timeSpentSeconds || null,
        storyPoints: f[storyPointsField] ?? 0,
        worklogs: mappedWorklogs
    };
}

export function getAssigneeHistory(changelog) {
    if (!changelog || !changelog.histories) return [];

    return changelog.histories
        .flatMap(history =>
            history.items
                .filter(item => item.field === "assignee")
                .map(item => ({
                    from: item.from,
                    to: item.to,
                    fromString: item.fromString,
                    toString: item.toString,
                    date: new Date(history.created) // ✅ convert here
                }))
        )
        .filter(change => change.to)
        .sort((a, b) => a.date - b.date);
}

export function mapIssueBasicDetails(issue: any) {
    const f = issue.fields || {};

    return {
        ticketId: issue.id,
        key: issue.key,
        link: `http://jira.lge.com/issue/browse/${issue.key}`,
        summary: f.summary,
        assignee: f.assignee?.displayName || f.assignee?.name || 'Unassigned',
        type: f.issuetype?.name,
        createdDate: f.created,
        dueDate: f.duedate,
        updatedDate: f.updated,
        priority: f.priority?.name,
        status: f.status?.name,
        resolution: f.resolution?.name,
        labels: f.labels || [],
        storyPoints: f['customfield_10002'] || null,
        description: f.description || '',
        assigneeHistory: getAssigneeHistory(issue.changelog),
        analysisResult: undefined, // Will be populated later from MongoDB
        analysisCompleted: undefined, // Will be populated later from MongoDB
    };
}

export function mapSprints(sprints: any[], fromDate: string): JiraSprint[] {
    const fromTs = new Date(fromDate).getTime();
    let mappedSprints = sprints.filter((s: any) => {
        if (!s.startDate) return false;
        return new Date(s.startDate).getTime() >= fromTs;
    });

    // sort newest → oldest
    mappedSprints = mappedSprints.sort((a: any, b: any) => {
        return new Date(b.startDate).getTime() - new Date(a.startDate).getTime();
    });

    return mappedSprints.map((s: any) => ({
        id: s.id,
        name: s.name,
        state: s.state,
        startDate: s.startDate,
        endDate: s.endDate,
    }));
}

export function buildWorklogAllAssignee(issues: any[]): AssigneeSummary[] {
    // For backward compatibility, accumulate using helper and finalize
    const map = new Map<string, AssigneeSummary>();
    accumulateWorklogMap(map, issues);
    return finalizeWorklogMap(map);
}

export function accumulateWorklogMap(map: Map<string, AssigneeSummary>, issues: any[]) {
    const storyPointsField = 'customfield_10002';
    const allowed = new Set(['issue', 'development', 'training', 'operation', 'planned_leave', 'unplanned_leave']);

    for (const issue of issues || []) {
        const fields = issue.fields || {};
        const assignee = fields.assignee || {};

        const key: string = assignee.key || assignee.name || 'unassigned';
        const name: string = assignee.displayName || assignee.name || 'Unassigned';

        const storyPoints: number = Number(fields[storyPointsField] || 0);
        const originalEstimateSeconds: number = Number(fields.timeoriginalestimate || fields.timetracking?.originalEstimateSeconds || 0);
        const remainingEstimateSeconds: number = Number(fields.timeestimate || fields.timetracking?.remainingEstimateSeconds || 0);
        const timeSpentSeconds: number = Number(fields.timetracking?.timeSpentSeconds || 0);

        let summary = map.get(key);
        if (!summary) {
            summary = {
                assigneeKey: key,
                assigneeName: name,
                totalStoryPoints: 0,
                totalOriginalEstimateSeconds: 0,
                totalRemainingEstimateSeconds: 0,
                totalTimeSpentSeconds: 0,
                totalOriginalEstimateStoryPoints: 0,
                totalRemainingEstimateStoryPoints: 0,
                totalTimeSpentStoryPoints: 0,
                labelBreakdown: {}
            } as AssigneeSummary;
            map.set(key, summary);
        }

        summary.totalStoryPoints += storyPoints;
        summary.totalOriginalEstimateSeconds += originalEstimateSeconds;
        summary.totalRemainingEstimateSeconds += remainingEstimateSeconds;
        summary.totalTimeSpentSeconds += timeSpentSeconds;

        const labels: string[] = fields.labels || [];
        const firstLabel = labels && labels.length ? String(labels[0]).toLowerCase() : null;
        if (key === 'JIRAUSER114732') {
            console.log('Processing issue', issue.key, 'assignee', name, 'labels', labels, 'firstLabel', firstLabel);
        }
        if (firstLabel && allowed.has(firstLabel)) {
            if (!summary.labelBreakdown[firstLabel]) {
                summary.labelBreakdown[firstLabel] = {
                    totalOriginalEstimateStoryPoints: 0,
                    totalTimeSpentStoryPoints: 0
                } as any;
            }
            summary.labelBreakdown[firstLabel].totalOriginalEstimateStoryPoints += storyPoints;
            summary.labelBreakdown[firstLabel].totalTimeSpentStoryPoints += (timeSpentSeconds / 3600) / 4;
        }

        if (key === 'JIRAUSER114732') {
            console.log('Accumulating for issue', issue.key, 'assignee', name, 'summary', summary);
        }
    }
}

export function finalizeWorklogMap(map: Map<string, AssigneeSummary>): AssigneeSummary[] {
    for (const summary of map.values()) {
        summary.totalOriginalEstimateStoryPoints = summary.totalStoryPoints;
        summary.totalRemainingEstimateStoryPoints = (summary.totalRemainingEstimateSeconds / 3600) / 4;
        summary.totalTimeSpentStoryPoints = (summary.totalTimeSpentSeconds / 3600) / 4;
    }
    return Array.from(map.values());
}

export interface MemberIssueCount {
    name: string;
    issuesCount: number;
    averageMttr: number;
}

const getLastAssignedDate = (issue: any): number | null => {
    const changelog = issue.changelog?.histories || [];
    const assigneeField = issue.fields?.assignee || issue.assignee;
    let currentAssignee: string | null = null;

    if (assigneeField) {
        if (typeof assigneeField === 'string') {
            currentAssignee = assigneeField;
        } else {
            currentAssignee = assigneeField.displayName && assigneeField.name
                ? `${assigneeField.displayName} ${assigneeField.name}`
                : assigneeField.displayName || assigneeField.name || null;
        }
    }

    if (!currentAssignee) {
        return null;
    }

    const histories = [...changelog].sort((a: any, b: any) => new Date(b.created).getTime() - new Date(a.created).getTime());
    for (const history of histories) {
        if (!history.items) continue;
        for (const item of history.items) {
            if (item.field !== 'assignee') continue;
            const assignedTo = String(item.toString || item.to || '').trim();
            if (assignedTo === currentAssignee) {
                const assignedDate = new Date(history.created).getTime();
                if (!isNaN(assignedDate)) {
                    return assignedDate;
                }
            }
        }
    }

    return null;
};

const calculateMttr = (issue: any): number => {
    const assignedTimestamp = getLastAssignedDate(issue);
    const startTimestamp = assignedTimestamp ?? new Date(issue.fields?.created).getTime();
    const resolved = issue.fields?.resolutiondate ? new Date(issue.fields.resolutiondate).getTime() : Date.now();
    const mttrSeconds = (resolved - startTimestamp) / 1000;
    return mttrSeconds / 86400; // convert to days
};

export function countIssuesPerMember(issues: any[]): MemberIssueCount[] {
    const memberCountMap = new Map<string, number>();
    const memberMttrMap = new Map<string, number>();
    const targetMember = 'Koppula Jagadeesh koppula.jagadeesh';

    for (const issue of issues) {
        const assignee =
            issue.fields?.assignee?.displayName ||
            issue.fields?.assignee?.name ||
            issue.fields?.assignee ||
            issue.assignee?.displayName ||
            issue.assignee?.name ||
            issue.assignee ||
            'Unassigned';
        
        // Log all issue IDs for the target member
        
        
        memberCountMap.set(assignee, (memberCountMap.get(assignee) || 0) + 1);
        
        const mttr = calculateMttr(issue);
        memberMttrMap.set(assignee, (memberMttrMap.get(assignee) || 0) + mttr);
        if (assignee === targetMember) {
            console.log(`Issue for ${targetMember}: ${issue.key} MTTR: ${mttr.toFixed(2)} days`); // Log MTTR for each issue of the target member   
        }
    }

    return Array.from(memberCountMap.entries()).map(([name, count]) => {
        const totalMttr = memberMttrMap.get(name) || 0;
        const averageMttr = count > 0 ? parseFloat((totalMttr / count).toFixed(2)) : 0;
        
        return {
            name,
            issuesCount: count,
            averageMttr
        };
    });
}
