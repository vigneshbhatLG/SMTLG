import axios from 'axios';
import { config } from '../config';
import { getMongoDb } from '../utils/mongo';
import { jiraService } from './jira.service';
import { logTeamsAlert, TeamsAlertLogEntry } from './memberAnalytics.service';

/** Today in IST, as YYYY-MM-DD — matches the date shown on the cards. */
function alertDate(): string {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

/** Capture what an alert contained so the Members Console can chart it later. */
async function recordAlert(
    type: TeamsAlertLogEntry['type'],
    memberMap: Map<string, { key: string }[]>,
): Promise<void> {
    const byMember: Record<string, number> = {};
    const issueKeys: string[] = [];
    let totalCount = 0;
    for (const [assignee, issues] of memberMap.entries()) {
        byMember[assignee] = issues.length;
        totalCount += issues.length;
        for (const issue of issues) issueKeys.push(issue.key);
    }
    await logTeamsAlert({
        type,
        date: alertDate(),
        totalCount,
        memberCount: memberMap.size,
        byMember,
        issueKeys,
    });
}

function makeIssueItem(key: string, label: string): object {
    return {
        type: 'TextBlock',
        text: `• ${key}${label}`,
        color: 'Accent',
        wrap: true,
        spacing: 'None'
    };
}

function buildMemberBlock(assignee: string, issueItems: object[]): object {
    return {
        type: 'Container',
        spacing: 'Small',
        style: 'emphasis',
        items: [
            {
                type: 'TextBlock',
                text: `👤 **${assignee}** — ${issueItems.length} issue(s)`,
                wrap: true,
                weight: 'Bolder'
            },
            ...issueItems
        ],
    };
}

async function fetchToken(): Promise<{ token: string; teamId?: number }> {
    const db = getMongoDb();
    const cronConfigs = await db.collection('cronConfig')
        .find({ enabled: { $ne: false } })
        .toArray();

    if (!cronConfigs || cronConfigs.length === 0) {
        throw new Error('[TEAMS] No enabled cron config found for token');
    }

    const team = await db.collection('sprintBoards')
        .findOne({ teamName: /smart media connectivity/i });

    return {
        token: cronConfigs[0].token,
        teamId: team?.boardId || cronConfigs[0].teamId,
    };
}






export async function runParkedNotification(): Promise<void> {
    console.log(`[TEAMS] Starting parked issues check at ${new Date().toISOString()}`);

    if (!config.teams.parkedWebhookUrl) {
        console.warn('[TEAMS] TEAMS_WEBHOOK_URL_PLS not configured, skipping parked issues notification');
        return;
    }

    try {
        const { token } = await fetchToken();
        const issues = await jiraService.getParkedIssues(token);

        if (issues.length === 0) {
            console.log('[TEAMS] No parked issues found, skipping notification');
            return;
        }

        console.log(`[TEAMS] Found ${issues.length} parked issue(s)`);

        const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
        const totalCount = issues.length;

        // Group by assignee
        const memberMap = new Map<string, typeof issues>();
        for (const issue of issues) {
            if (!memberMap.has(issue.assignee)) memberMap.set(issue.assignee, []);
            memberMap.get(issue.assignee)!.push(issue);
        }

        const memberBlocks = Array.from(memberMap.entries()).map(([assignee, memberIssues]) => {
            const issueItems = memberIssues.map(issue =>
                makeIssueItem(issue.key, `  (${issue.status}, created ${issue.created})`)
            );
            return buildMemberBlock(assignee, issueItems);
        });

        const MEMBERS_PER_CARD = 10;
        const cardChunks: typeof memberBlocks[] = [];
        for (let i = 0; i < memberBlocks.length; i += MEMBERS_PER_CARD) {
            cardChunks.push(memberBlocks.slice(i, i + MEMBERS_PER_CARD));
        }

        for (let i = 0; i < cardChunks.length; i++) {
            const isFirst = i === 0;
            const payload = {
                type: 'AdaptiveCard',
                $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
                version: '1.4',
                body: [
                    {
                        type: 'TextBlock',
                        size: 'Large',
                        weight: 'Bolder',
                        color: 'Attention',
                        text: isFirst
                            ? `🅿️ Parked Issues Alert — ${today}`
                            : `🅿️ Parked Issues Alert — ${today} (Continued...)`
                    },
                    ...(isFirst ? [{
                        type: 'TextBlock',
                        text: `**${totalCount}** issue(s) across **${memberMap.size}** member(s) are long pending (created more than 7 days ago and still open). Kindly take immediate action to resolve or update these issues.`,
                        wrap: true,
                        spacing: 'Small'
                    }] : []),
                    ...cardChunks[i]
                ]
            };

            const response = await axios.post(config.teams.parkedWebhookUrl, payload, {
                headers: { 'Content-Type': 'application/json' }
            });
            console.log(`[TEAMS] Parked message ${i + 1}/${cardChunks.length} response: ${response.status} ${JSON.stringify(response.data)}`);
            if (i < cardChunks.length - 1) await new Promise(resolve => setTimeout(resolve, 1500));
        }

        await recordAlert('parked', memberMap);
        console.log(`[TEAMS] Parked issues notification sent for ${totalCount} issue(s) across ${memberMap.size} member(s)`);
    } catch (error: any) {
        console.error('[TEAMS] Failed to send parked issues notification:', error.message || error);
        throw error;
    }
}

export async function runDueDateChangeNotification(): Promise<void> {
    console.log(`[TEAMS] Starting due date change check at ${new Date().toISOString()}`);

    if (!config.teams.dueDateChangeWebhookUrl) {
        console.warn('[TEAMS] TEAMS_WEBHOOK_URL_PLS not configured, skipping due date change notification');
        return;
    }

    try {
        const { token, teamId } = await fetchToken();
        const issues = await jiraService.getDueDateChangeIssues(token, teamId);

        if (issues.length === 0) {
            console.log('[TEAMS] No issues with multiple due date changes found, skipping notification');
            return;
        }

        console.log(`[TEAMS] Found ${issues.length} issue(s) with multiple due date changes`);

        const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
        const totalCount = issues.length;

        // Group by assignee — issues already sorted by dueDateChangeCount desc
        const memberMap = new Map<string, typeof issues>();
        for (const issue of issues) {
            if (!memberMap.has(issue.assignee)) memberMap.set(issue.assignee, []);
            memberMap.get(issue.assignee)!.push(issue);
        }

        const memberBlocks = Array.from(memberMap.entries()).map(([assignee, memberIssues]) => {
            const sorted = [...memberIssues].sort((a, b) => b.dueDateChangeCount - a.dueDateChangeCount);
            const issueItems = sorted.map(issue => makeIssueItem(issue.key, `  (changed ${issue.dueDateChangeCount}x)`));
            return buildMemberBlock(assignee, issueItems);
        });

        const MEMBERS_PER_CARD = 10;
        const cardChunks: typeof memberBlocks[] = [];
        for (let i = 0; i < memberBlocks.length; i += MEMBERS_PER_CARD) {
            cardChunks.push(memberBlocks.slice(i, i + MEMBERS_PER_CARD));
        }

        for (let i = 0; i < cardChunks.length; i++) {
            const isFirst = i === 0;
            const payload = {
                type: 'AdaptiveCard',
                $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
                version: '1.4',
                body: [
                    {
                        type: 'TextBlock',
                        size: 'Large',
                        weight: 'Bolder',
                        color: 'Attention',
                        text: isFirst
                            ? `📅 Due Date Change Alert — ${today}`
                            : `📅 Due Date Change Alert — ${today} (Continued...)`
                    },
                    ...(isFirst ? [{
                        type: 'TextBlock',
                        text: `**${totalCount}** issue(s) across **${memberMap.size}** member(s) have had their due date changed more than once. Issues are listed from most changed to least. Kindly review and resolve without further delays.`,
                        wrap: true,
                        spacing: 'Small'
                    }] : []),
                    ...cardChunks[i]
                ]
            };

            const response = await axios.post(config.teams.dueDateChangeWebhookUrl, payload, {
                headers: { 'Content-Type': 'application/json' }
            });
            console.log(`[TEAMS] DueDateChange message ${i + 1}/${cardChunks.length} response: ${response.status} ${JSON.stringify(response.data)}`);
            if (i < cardChunks.length - 1) await new Promise(resolve => setTimeout(resolve, 1000));
        }

        await recordAlert('dueDateChange', memberMap);
        console.log(`[TEAMS] Due date change notification sent for ${totalCount} issue(s) across ${memberMap.size} member(s)`);
    } catch (error: any) {
        console.error('[TEAMS] Failed to send due date change notification:', error.message || error);
        throw error;
    }
}

export async function runReopenedNotification(): Promise<void> {
    console.log(`[TEAMS] Starting reopened issues check at ${new Date().toISOString()}`);

    if (!config.teams.reopenWebhookUrl) {
        console.warn('[TEAMS] TEAMS_WEBHOOK_URL_PLS not configured, skipping reopened notification');
        return;
    }

    try {
        const { token, teamId } = await fetchToken();
        const issues = await jiraService.getReopenedIssues(token, teamId);

        if (issues.length === 0) {
            console.log('[TEAMS] No reopened issues found, skipping notification');
            return;
        }

        console.log(`[TEAMS] Found ${issues.length} reopened issue(s)`);

        const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
        const totalCount = issues.length;

        // Group by assignee
        const memberMap = new Map<string, typeof issues>();
        for (const issue of issues) {
            if (!memberMap.has(issue.assignee)) memberMap.set(issue.assignee, []);
            memberMap.get(issue.assignee)!.push(issue);
        }

        const memberBlocks = Array.from(memberMap.entries()).map(([assignee, memberIssues]) => {
            const issueItems = memberIssues.map(issue => makeIssueItem(issue.key, ''));
            return buildMemberBlock(assignee, issueItems);
        });

        const MEMBERS_PER_CARD = 10;
        const cardChunks: typeof memberBlocks[] = [];
        for (let i = 0; i < memberBlocks.length; i += MEMBERS_PER_CARD) {
            cardChunks.push(memberBlocks.slice(i, i + MEMBERS_PER_CARD));
        }

        for (let i = 0; i < cardChunks.length; i++) {
            const isFirst = i === 0;
            const payload = {
                type: 'AdaptiveCard',
                $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
                version: '1.4',
                body: [
                    {
                        type: 'TextBlock',
                        size: 'Large',
                        weight: 'Bolder',
                        color: 'Warning',
                        text: isFirst
                            ? `⚠️ Reopened Issues Alert — ${today}`
                            : `⚠️ Reopened Issues Alert — ${today} (Continued...)`
                    },
                    ...(isFirst ? [{
                        type: 'TextBlock',
                        text: `**${totalCount}** issue(s) reopened across **${memberMap.size}** member(s). Please recheck and resolve these issues at the earliest.`,
                        wrap: true,
                        spacing: 'Small'
                    }] : []),
                    ...cardChunks[i]
                ]
            };

            const response = await axios.post(config.teams.reopenWebhookUrl, payload, {
                headers: { 'Content-Type': 'application/json' }
            });
            console.log(`[TEAMS] Reopened message ${i + 1}/${cardChunks.length} response: ${response.status} ${JSON.stringify(response.data)}`);
            if (i < cardChunks.length - 1) await new Promise(resolve => setTimeout(resolve, 1000));
        }

        await recordAlert('reopened', memberMap);
        console.log(`[TEAMS] Reopened notification sent for ${totalCount} issue(s) across ${memberMap.size} member(s)`);
    } catch (error: any) {
        console.error('[TEAMS] Failed to send reopened notification:', error.message || error);
        throw error;
    }
}

export async function runTeamsNotification(): Promise<void> {
    console.log(`[TEAMS] Starting due-date check at ${new Date().toISOString()}`);

    if (!config.teams.webhookUrl) {
        console.warn('[TEAMS] TEAMS_WEBHOOK_URL_INTERNAL not configured, skipping');
        return;
    }

    try {
        const { token, teamId } = await fetchToken();
        const issues = await jiraService.getDueTodayIssues(token, teamId);

        if (issues.length === 0) {
            console.log('[TEAMS] No issues due today, skipping notification');
            return;
        }

        console.log(`[TEAMS] Found ${issues.length} issue(s) due today`);

        const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
        const totalCount = issues.length;

        // Group by assignee
        const memberMap = new Map<string, typeof issues>();
        for (const issue of issues) {
            if (!memberMap.has(issue.assignee)) memberMap.set(issue.assignee, []);
            memberMap.get(issue.assignee)!.push(issue);
        }

        const memberBlocks = Array.from(memberMap.entries()).map(([assignee, memberIssues]) => {
            const issueItems = memberIssues.map(issue => makeIssueItem(issue.key, ''));
            return buildMemberBlock(assignee, issueItems);
        });

        // Split into chunks of 10 members per card to stay within payload limit
        const MEMBERS_PER_CARD = 10;
        const cardChunks: typeof memberBlocks[] = [];
        for (let i = 0; i < memberBlocks.length; i += MEMBERS_PER_CARD) {
            cardChunks.push(memberBlocks.slice(i, i + MEMBERS_PER_CARD));
        }

        for (let i = 0; i < cardChunks.length; i++) {
            const isFirst = i === 0;
            const payload = {
                type: 'AdaptiveCard',
                $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
                version: '1.4',
                body: [
                    {
                        type: 'TextBlock',
                        size: 'Large',
                        weight: 'Bolder',
                        color: 'Attention',
                        text: isFirst
                            ? `🔔 Due Date Alert — ${today}`
                            : `🔔 Due Date Alert — ${today} (Continued...)`
                    },
                    ...(isFirst ? [{
                        type: 'TextBlock',
                        text: `**${totalCount}** issue(s) due today across **${memberMap.size}** member(s). Please resolve at the earliest.`,
                        wrap: true,
                        spacing: 'Small'
                    }] : []),
                    ...cardChunks[i]
                ]
            };

            const response = await axios.post(config.teams.webhookUrl, payload, {
                headers: { 'Content-Type': 'application/json' }
            });
            console.log(`[TEAMS] DueToday message ${i + 1}/${cardChunks.length} response: ${response.status} ${JSON.stringify(response.data)}`);
            if (i < cardChunks.length - 1) await new Promise(resolve => setTimeout(resolve, 1000));
        }

        await recordAlert('dueToday', memberMap);
        console.log(`[TEAMS] Notification sent successfully for ${totalCount} issue(s) across ${memberMap.size} member(s)`);
    } catch (error: any) {
        console.error('[TEAMS] Failed to send Teams notification:', error.message || error);
        throw error;
    }
}
