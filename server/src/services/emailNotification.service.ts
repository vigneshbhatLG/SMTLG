import * as nodemailer from 'nodemailer';
import { config } from '../config';
import { getMongoDb } from '../utils/mongo';
import { jiraService } from './jira.service';
import { getAssigneeHistory } from './dataMapper';
import { members } from '../constants/members';

interface ProcessedIssue {
    key: string;
    link: string;
    createdDate: string;
    currentUser: string;
    flow: string;
    currentHoldingMs: number;
    currentHolding: string;
    totalHolding: string;
    assignmentCount: number;
}

const FOUR_DAYS_MS = 4 * 24 * 3600000;

function formatDuration(ms: number): string {
    const h = Math.floor(ms / 3600000);
    const d = Math.floor(h / 24);
    return d > 0 ? `${d}d ${h % 24}h` : `${h}h`;
}

function processIssues(issues: any[]): ProcessedIssue[] {
    return issues.map(item => {
        const history = item.assigneeHistory || getAssigneeHistory(item.changelog) || [];

        const timeline = history.map((h: any, i: number) => {
            const start = new Date(h.date);
            const end = history[i + 1]
                ? new Date(history[i + 1].date)
                : new Date();

            return {
                user: h.toString,
                start,
                end,
                duration: end.getTime() - start.getTime()
            };
        });

        const flow = timeline
            .map((t: any) => `${t.user} (${formatDuration(t.duration)})`)
            .join(' → ');

        const current = timeline[timeline.length - 1];
        const currentUser = current?.user || item.assignee || 'Unassigned';

        const currentHoldingMs = current
            ? new Date().getTime() - current.start.getTime()
            : 0;

        const currentHolding = formatDuration(currentHoldingMs);

        const userEntries = timeline.filter((t: any) => t.user === currentUser);
        const totalHoldingTime = userEntries.reduce((sum: number, t: any) => sum + t.duration, 0);
        const assignmentCount = userEntries.length;

        const firstName = currentUser?.split(' ')[0] || '';

        return {
            key: item.key,
            link: item.link || `http://jira.lge.com/issue/browse/${item.key}`,
            createdDate: item.createdDate || item.fields?.created || '',
            currentUser,
            flow,
            currentHoldingMs,
            currentHolding,
            totalHolding: `${formatDuration(totalHoldingTime)} (${firstName} ${assignmentCount} times)`,
            assignmentCount
        };
    });
}

function buildEmailHtml(longHoldIssues: ProcessedIssue[], multiAssignIssues: ProcessedIssue[]): string {
    const tableStyle = `style="border-collapse: collapse; width: 100%; font-family: Arial, sans-serif; font-size: 13px;"`;
    const thStyle = `style="border: 1px solid #ddd; padding: 8px; background-color: #4472C4; color: white; text-align: left;"`;
    const tdStyle = `style="border: 1px solid #ddd; padding: 8px;"`;
    const redTd = `style="border: 1px solid #ddd; padding: 8px; color: red; font-weight: bold;"`;

    let html = `
    <div style="font-family: Arial, sans-serif; padding: 20px;">
        <h2 style="color: #333;">Bugs Tracking - Daily Alert</h2>
        <p>Hello Team,</p>
        <p>Please find below the issues that need attention:</p>
    `;

    if (longHoldIssues.length > 0) {
        html += `
        <h3 style="color: #c0392b;">Members Holding Issues More Than 4 Days</h3>
        <table ${tableStyle}>
            <thead>
                <tr>
                    <th ${thStyle}>Key</th>
                    <th ${thStyle}>Created</th>
                    <th ${thStyle}>Current Assignee</th>
                    <th ${thStyle}>Flow</th>
                    <th ${thStyle}>Current Holding</th>
                    <th ${thStyle}>Total Holding</th>
                </tr>
            </thead>
            <tbody>
        `;

        for (const issue of longHoldIssues) {
            html += `
                <tr>
                    <td ${tdStyle}><a href="${issue.link}">${issue.key}</a></td>
                    <td ${tdStyle}>${new Date(issue.createdDate).toLocaleDateString()}</td>
                    <td ${tdStyle}>${issue.currentUser}</td>
                    <td ${tdStyle} style="border: 1px solid #ddd; padding: 8px; max-width: 400px; word-wrap: break-word;">${issue.flow}</td>
                    <td ${redTd}>${issue.currentHolding}</td>
                    <td ${tdStyle}>${issue.totalHolding}</td>
                </tr>
            `;
        }

        html += `</tbody></table>`;
    }

    if (multiAssignIssues.length > 0) {
        html += `
        <br/>
        <h3 style="color: #e67e22;">Issues Assigned to Same Member More Than Once</h3>
        <table ${tableStyle}>
            <thead>
                <tr>
                    <th ${thStyle}>Key</th>
                    <th ${thStyle}>Created</th>
                    <th ${thStyle}>Current Assignee</th>
                    <th ${thStyle}>Flow</th>
                    <th ${thStyle}>Current Holding</th>
                    <th ${thStyle}>Total Holding</th>
                </tr>
            </thead>
            <tbody>
        `;

        for (const issue of multiAssignIssues) {
            html += `
                <tr>
                    <td ${tdStyle}><a href="${issue.link}">${issue.key}</a></td>
                    <td ${tdStyle}>${new Date(issue.createdDate).toLocaleDateString()}</td>
                    <td ${tdStyle}>${issue.currentUser}</td>
                    <td ${tdStyle} style="border: 1px solid #ddd; padding: 8px; max-width: 400px; word-wrap: break-word;">${issue.flow}</td>
                    <td ${redTd}>${issue.currentHolding}</td>
                    <td ${tdStyle}>${issue.totalHolding}</td>
                </tr>
            `;
        }

        html += `</tbody></table>`;
    }

    if (longHoldIssues.length === 0 && multiAssignIssues.length === 0) {
        html += `<p style="color: green;">No issues found matching the alert criteria today.</p>`;
    }

    html += `
        <br/>
        <p style="color: #666; font-size: 12px;">
            This is an automated email from Sprint Analytics.
            Generated at ${new Date().toLocaleString()}.
        </p>
    </div>
    `;

    return html;
}

async function fetchActiveIssues(): Promise<any[]> {
    const db = getMongoDb();

    const cronConfigs = await db.collection('cronConfig')
        .find({ enabled: { $ne: false } })
        .toArray();

    if (!cronConfigs || cronConfigs.length === 0) {
        console.warn('[EMAIL] No cron configurations found for token');
        return [];
    }

    const token = cronConfigs[0].token;

    // Look up teamId from sprintBoards collection
    const team = await db.collection('sprintBoards')
        .findOne({ teamName: /smart media connectivity/i });

    const teamId = team?.boardId || cronConfigs[0].teamId || 40046;
    console.log(`[EMAIL] Using teamId: ${teamId}`);

    const issueStatuses = ['Open', 'In Progress', 'Reopened', 'In Review'];

    // Fetch issues per member to avoid empty DB member lookup
    const promises = members.map(member =>
        jiraService.getIssuesByFilters(token, teamId, issueStatuses, member)
            .then(res => res.issues || [])
            .catch(err => {
                console.warn(`[EMAIL] Failed to fetch issues for ${member}:`, err.message);
                return [];
            })
    );

    const results = await Promise.all(promises);
    return results.flat();
}

function createTransporter() {
    return nodemailer.createTransport({
        host: 'lgekrhqmh01.lge.com',
        port: 25,
        secure: false,
        tls: { rejectUnauthorized: false },
    });
}

async function saveDailySnapshot(
    longHoldIssues: ProcessedIssue[],
    multiAssignIssues: ProcessedIssue[]
) {
    try {
        const db = getMongoDb();
        const dateKey = new Date().toISOString().slice(0, 10); // "2026-05-27"

        await db.collection('dailyBugReports').updateOne(
            { date: dateKey },
            {
                $set: {
                    date: dateKey,
                    generatedAt: new Date(),
                    longHoldIssues,
                    multiAssignIssues,
                    totalIssues: longHoldIssues.length + multiAssignIssues.length,
                    emailSent: true,
                }
            },
            { upsert: true }
        );

        // Keep only last 15 days — delete anything older
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 15);
        const cutoffKey = cutoff.toISOString().slice(0, 10);
        const deleted = await db.collection('dailyBugReports').deleteMany({ date: { $lt: cutoffKey } });
        if (deleted.deletedCount > 0) {
            console.log(`[EMAIL] Pruned ${deleted.deletedCount} daily report(s) older than 15 days`);
        }

        console.log(`[EMAIL] Daily snapshot saved for ${dateKey}`);
    } catch (err) {
        console.error('[EMAIL] Failed to save daily snapshot:', err);
    }
}

export async function runEmailNotification() {
    console.log(`[EMAIL] Starting daily email notification check at ${new Date().toISOString()}`);

    try {
        const issues = await fetchActiveIssues();

        if (!issues || issues.length === 0) {
            console.log('[EMAIL] No active issues found, skipping email');
            return;
        }

        const processed = processIssues(issues);

        const longHoldIssues = processed
            .filter(i => i.currentHoldingMs > FOUR_DAYS_MS)
            .sort((a, b) => b.currentHoldingMs - a.currentHoldingMs);

        const multiAssignIssues = processed
            .filter(i => i.assignmentCount > 1)
            .sort((a, b) => b.assignmentCount - a.assignmentCount);

        if (longHoldIssues.length === 0 && multiAssignIssues.length === 0) {
            console.log('[EMAIL] No issues matching alert criteria, skipping email');
            return;
        }

        console.log(`[EMAIL] Found ${longHoldIssues.length} issues held > 4 days, ${multiAssignIssues.length} issues with repeat assignments`);

        const html = buildEmailHtml(longHoldIssues, multiAssignIssues);

        await createTransporter().sendMail({
            from: config.email.from,
            to: config.email.managerEmail,
            cc: ['preetham.s@lge.com', 'sumanth.hg@lge.com', 'anish.td@lge.com', 'athulya.p@lge.com' ],
            subject: `[Bugs Alert] ${longHoldIssues.length} issues held >4 days | ${multiAssignIssues.length} repeat assignments - ${new Date().toLocaleDateString()}`,
            html,
        });

        console.log(`[EMAIL] Notification email sent to ${config.email.managerEmail}`);

        // Save snapshot after successful send
        await saveDailySnapshot(longHoldIssues, multiAssignIssues);

    } catch (error) {
        console.error('[EMAIL] Failed to send notification email:', error);
    }
}

export async function previewEmailHtml(): Promise<string> {
    const issues = await fetchActiveIssues();
    const processed = processIssues(issues);

    const longHoldIssues = processed
        .filter(i => i.currentHoldingMs > FOUR_DAYS_MS)
        .sort((a, b) => b.currentHoldingMs - a.currentHoldingMs);

    const multiAssignIssues = processed
        .filter(i => i.assignmentCount > 1)
        .sort((a, b) => b.assignmentCount - a.assignmentCount);

    return buildEmailHtml(longHoldIssues, multiAssignIssues);
}

export async function buildOverallReportHtml(): Promise<string> {
    const db = getMongoDb();

    const reports = await db.collection('dailyBugReports')
        .find({})
        .sort({ date: -1 })
        .limit(15)
        .toArray();

    if (!reports || reports.length === 0) {
        return `<div style="font-family:Arial,sans-serif;padding:20px;">
            <h2>Overall Bug Report (Last 15 Days)</h2>
            <p style="color:gray;">No daily reports stored yet. Reports are saved each morning when the cron runs.</p>
        </div>`;
    }

    // Deduplicate: for each issue key keep the latest snapshot
    const latestLongHold = new Map<string, ProcessedIssue>();
    const latestMultiAssign = new Map<string, ProcessedIssue>();
    // Track how many days each issue appeared
    const longHoldDays = new Map<string, string[]>();
    const multiAssignDays = new Map<string, string[]>();

    for (const report of [...reports].reverse()) { // oldest first so latest wins
        for (const issue of (report.longHoldIssues || [])) {
            latestLongHold.set(issue.key, issue);
            longHoldDays.set(issue.key, [...(longHoldDays.get(issue.key) || []), report.date]);
        }
        for (const issue of (report.multiAssignIssues || [])) {
            latestMultiAssign.set(issue.key, issue);
            multiAssignDays.set(issue.key, [...(multiAssignDays.get(issue.key) || []), report.date]);
        }
    }

    const longHoldIssues = [...latestLongHold.values()]
        .sort((a, b) => b.currentHoldingMs - a.currentHoldingMs);
    const multiAssignIssues = [...latestMultiAssign.values()]
        .sort((a, b) => b.assignmentCount - a.assignmentCount);

    const tableStyle = `style="border-collapse:collapse;width:100%;font-family:Arial,sans-serif;font-size:13px;"`;
    const thStyle = `style="border:1px solid #ddd;padding:8px;background-color:#4472C4;color:white;text-align:left;"`;
    const tdStyle = `style="border:1px solid #ddd;padding:8px;"`;
    const redTd = `style="border:1px solid #ddd;padding:8px;color:red;font-weight:bold;"`;

    const dateRange = `${reports[reports.length - 1].date} → ${reports[0].date}`;

    let html = `
    <div style="font-family:Arial,sans-serif;padding:20px;">
        <h2 style="color:#333;">Overall Bug Report</h2>
        <p style="color:#555;">Period: <b>${dateRange}</b> (${reports.length} daily reports)</p>
        <p>Hello Team,</p>
        <p>Below is the aggregated bug tracking report across the last ${reports.length} days:</p>
    `;

    if (longHoldIssues.length > 0) {
        html += `
        <h3 style="color:#c0392b;">Issues Held More Than 4 Days (${longHoldIssues.length})</h3>
        <table ${tableStyle}>
            <thead><tr>
                <th ${thStyle}>Key</th>
                <th ${thStyle}>Current Assignee</th>
                <th ${thStyle}>Flow</th>
                <th ${thStyle}>Current Holding</th>
                <th ${thStyle}>Total Holding</th>
                <th ${thStyle}>Days Flagged</th>
            </tr></thead>
            <tbody>`;
        for (const issue of longHoldIssues) {
            const days = (longHoldDays.get(issue.key) || []).length;
            html += `<tr>
                <td ${tdStyle}><a href="${issue.link}">${issue.key}</a></td>
                <td ${tdStyle}>${issue.currentUser}</td>
                <td ${tdStyle} style="border:1px solid #ddd;padding:8px;max-width:400px;word-wrap:break-word;">${issue.flow}</td>
                <td ${redTd}>${issue.currentHolding}</td>
                <td ${tdStyle}>${issue.totalHolding}</td>
                <td ${tdStyle}>${days} day(s)</td>
            </tr>`;
        }
        html += `</tbody></table>`;
    }

    if (multiAssignIssues.length > 0) {
        html += `
        <br/>
        <h3 style="color:#e67e22;">Issues Assigned to Same Member More Than Once (${multiAssignIssues.length})</h3>
        <table ${tableStyle}>
            <thead><tr>
                <th ${thStyle}>Key</th>
                <th ${thStyle}>Current Assignee</th>
                <th ${thStyle}>Flow</th>
                <th ${thStyle}>Current Holding</th>
                <th ${thStyle}>Total Holding</th>
                <th ${thStyle}>Days Flagged</th>
            </tr></thead>
            <tbody>`;
        for (const issue of multiAssignIssues) {
            const days = (multiAssignDays.get(issue.key) || []).length;
            html += `<tr>
                <td ${tdStyle}><a href="${issue.link}">${issue.key}</a></td>
                <td ${tdStyle}>${issue.currentUser}</td>
                <td ${tdStyle} style="border:1px solid #ddd;padding:8px;max-width:400px;word-wrap:break-word;">${issue.flow}</td>
                <td ${redTd}>${issue.currentHolding}</td>
                <td ${tdStyle}>${issue.totalHolding}</td>
                <td ${tdStyle}>${days} day(s)</td>
            </tr>`;
        }
        html += `</tbody></table>`;
    }

    if (longHoldIssues.length === 0 && multiAssignIssues.length === 0) {
        html += `<p style="color:green;">No flagged issues found in the stored reports.</p>`;
    }

    html += `
        <br/>
        <p style="color:#666;font-size:12px;">
            Overall report generated at ${new Date().toLocaleString()}.
            Data sourced from ${reports.length} daily morning snapshots.
        </p>
    </div>`;

    return html;
}

export async function sendOverallReport() {
    const html = await buildOverallReportHtml();

    await createTransporter().sendMail({
        from: config.email.from,
        to: config.email.managerEmail,
        cc: ['preetham.s@lge.com', 'sumanth.hg@lge.com', 'anish.td@lge.com', 'athulya.p@lge.com' ],
        subject: `[Overall Bug Report] Last 15 Days - ${new Date().toLocaleDateString()}`,
        html,
    });

    console.log(`[EMAIL] Overall report sent to ${config.email.managerEmail}`);
}

export const emailNotificationService = {
    runEmailNotification,
    previewEmailHtml,
    buildOverallReportHtml,
    sendOverallReport,
};
