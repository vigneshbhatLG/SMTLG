import { getMongoDb } from '../utils/mongo';
import { jiraService } from './jira.service';
import { resolveAlias } from '../constants/memberAliases';
import { classifyReopenImpact, CODE_FIX_RESOLUTION } from '../constants/reopen';

const TEAM_NAMES: Record<number, string> = {
    0: 'Smart Media and Connectivity',
    1: 'Home Experience and Input Apps',
    2: 'Multiscreen and CH Apps',
    3: 'Core System Apps',
};

// Used for total issue count, open issues table, daily snapshot
const BASE_JQL = `assignee in membersOf("LGSI MS System App Solution(11018653)_grp") AND project not in ("[통합] webOS Testcase","TVQEWEBTCT", "webOS TV Platform", LGSIBDSQE, "Porsche J1PA (PFIFF)", REAVN, "webOS Test Case", "HKMC K3 ICCU", "LUPA Platform", "제어 SW 개발 프로젝트 관리", "Telematics NAD SW Tracker", "TestPresso WorkItems", LATS_HVAC, "[LM CSMS/SE팀] 규격/SE", "LMSW TC Management", "TV Release Process", "TV Project Manage", "ID LGSI Project Managerment", "[webOS] SRS", "[webOS26] SRS", "Smart Commercial WBS", "Deferred issue Manage", "[webOS TV] 개발 프로세스", "HE 정적분석 이슈", "25년도 방송인증", "[webOS] TV App Framework", "Product Requirement", "[WebOS TV][Japan Lab]", "[webOS TV] Localization", "HMC VFAS CCU", "형상관리 자동화 시스템 개발", "제어 SW 개발 프로젝트 관리", "AUDI_C-SPORT FID/CID", "AUDI C-SPORT FID/CID_CE", "SW 개발담당", "제어 SW 개발 프로젝트 관리", "webOS API Test", "LUPA Platform", "[webOS Appliance RP 1.0] SRS", "[webOS24] SRS", "webOS for TV", "ID Field Claim", "webOS for Mobile", "[ID ED] ID SW개발실", PremiumCP, "LUPA Platform") AND type = Bug`;

const SNAPSHOT_COLLECTION = 'dailyIssueSnapshots';

// First day we track. Matches the createdDate floor used in fetchAllIssues.
const RANGE_START = '2026-01-01';

// An unresolved issue with no changelog activity for this many days counts as stalled.
const STALLED_THRESHOLD_DAYS = 7;

// Cap the stalled issue list stored per snapshot so documents stay small.
const MAX_STALLED_STORED = 300;

// How many trailing days the daily cron recomputes. Rebuilding a window (instead of
// only "yesterday") self-heals snapshots when Jira changelogs arrive late.
const DAILY_REBUILD_DAYS = 10;

type StatusCategory = 'open' | 'inProgress' | 'reopened' | 'resolved';

async function getToken(): Promise<string> {
    const db = getMongoDb();
    const configs = await db.collection('cronConfig').find({ enabled: { $ne: false } }).toArray();
    if (!configs || configs.length === 0) throw new Error('[HEALTH] No cron config found for token');
    return configs[0].token;
}

async function getMemberTeamMap(): Promise<Map<string, number>> {
    const db = getMongoDb();
    const docs = await db.collection('members').find({}, { projection: { name: 1, teamId: 1 } }).toArray();
    const map = new Map<string, number>();
    for (const doc of docs) {
        if (!doc.name) continue;
        // A member without a team is still a member: their issues must be tracked and
        // attributed to them. -1 simply falls out of the per-team buckets, which are
        // keyed 0-3 and guarded. Requiring a teamId here silently dropped every issue
        // belonging to anyone whose team had not been filled in.
        map.set(doc.name, doc.teamId != null ? Number(doc.teamId) : -1);
    }
    return map;
}

function toDay(iso?: string | null): string | null {
    return iso ? iso.slice(0, 10) : null;
}

function todayStr(): string {
    return new Date().toISOString().slice(0, 10);
}

function diffDays(later: string, earlier: string): number {
    const a = Date.parse(`${later}T00:00:00Z`);
    const b = Date.parse(`${earlier}T00:00:00Z`);
    if (Number.isNaN(a) || Number.isNaN(b)) return 0;
    return Math.floor((a - b) / 86400000);
}

function dateRange(from: string, to: string): string[] {
    const dates: string[] = [];
    const cur = new Date(`${from}T00:00:00Z`);
    const last = new Date(`${to}T00:00:00Z`);
    while (cur <= last) {
        dates.push(cur.toISOString().slice(0, 10));
        cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return dates;
}

/**
 * Map a raw Jira status name onto one of the four categories the dashboard charts.
 * Every status an issue can hold lands in exactly one bucket, so the per-day
 * category counts always add up to the number of issues the team is holding.
 */
function classifyStatus(raw?: string | null): StatusCategory {
    const s = (raw || '').trim().toLowerCase();
    if (!s) return 'open';
    // Jira spells this status "Fixready" — matching on "fix ready" silently misses it,
    // so compare against a space-stripped form too.
    const compact = s.replace(/\s+/g, '');
    if (
        s === 'resolved' || s === 'closed' || s === 'done' ||
        s.includes('resolv') || s.includes('clos') || s.includes('release') || s.includes('verif')
    ) return 'resolved';
    if (s.includes('reopen')) return 'reopened';
    if (
        s.includes('progress') || compact.includes('fixready') ||
        s.includes('review') || s.includes('implement')
    ) return 'inProgress';
    return 'open';
}

interface StatusChange {
    date: string;
    status: string;
}

interface IssueTimeline {
    key: string;
    project: string;
    projectName: string;
    assignee: string;
    teamId: number;
    assignedDate: string;
    /** Chronological status history, seeded with the status the issue was created in. */
    statusChanges: StatusChange[];
    /** Who held the issue over time, seeded with the assignee it was created with. */
    assigneeChanges: AssigneeChange[];
    /** Every changelog date, ascending — drives the stalled calculation. */
    activityDates: string[];
    /** Transitions *into* a resolved-like status, credited to whoever held it then. */
    resolvedEvents: TimelineEvent[];
    /** Transitions *into* a reopened status, credited to whoever held it then. */
    reopenedEvents: TimelineEvent[];
    // --- fields used by the member outcome ledger ---
    createdDate: string;
    /** The member the issue was first handed to — owner of the `assigned` flow. */
    firstAssignee: string;
    /** Every member who ever held the issue. */
    holders: string[];
    /** Members who handed the issue on to someone else. */
    transferredOutBy: string[];
    currentAssignee: string;
    currentStatus: string;
    resolution: string;
    dueDateChangeCount: number;
    transferCount: number;
}

interface AssigneeChange {
    date: string;
    assignee: string;
}

interface TimelineEvent {
    date: string;
    assignee: string;
    /** Status the issue moved *from*. */
    fromStatus?: string;
    /**
     * Human-readable assignee. Users outside the team never appear as a current
     * assignee, so their key cannot be mapped to a username — but the changelog
     * carries their display name, which is what a reader actually wants to see.
     */
    assigneeName?: string;
    /**
     * Days this assignee had held the issue when the event happened. On a resolution
     * event that is how long they worked it before delivering the fix.
     */
    daysHeld?: number;
    /** On a reopen: who delivered the fix that came back, and whether they are ours. */
    patchOwner?: string;
    patchOwnerIsMember?: boolean;
    /**
     * Resolution the issue held when it was reopened. Jira clears the resolution in
     * the same changelog entry as the reopen, so this comes from that item's
     * `fromString` — reading the field afterwards only ever yields a blank.
     * "Fixed"/"Done" means a real fix bounced back; anything else means the issue
     * was reopened after being rejected, deferred or withdrawn.
     */
    fromResolution?: string;
}

/**
 * Changelog assignee items carry the Jira *user key* (`JIRAUSER119229`), while the
 * members collection and `fields.assignee` use the *username* (`prajwal.r`). Without
 * this translation every changelog assignee lookup silently misses, and issues get
 * credited to nobody.
 *
 * Built from `fields.assignee` (which carries both), with a per-user API lookup for
 * any member who never appears as a current assignee.
 */
async function buildUserKeyMap(issues: any[], memberNames: string[], token: string): Promise<Map<string, string>> {
    const map = new Map<string, string>();

    // Usernames resolve to themselves — some accounts use the username as their key
    for (const name of memberNames) map.set(name, name);

    for (const issue of issues) {
        const assignee = issue.fields?.assignee;
        if (assignee?.key && assignee?.name) map.set(assignee.key, assignee.name);
    }

    const resolvedMembers = new Set<string>();
    for (const [key, name] of map) {
        if (key !== name) resolvedMembers.add(name);
    }

    const missing = memberNames.filter(n => !resolvedMembers.has(n));
    for (const name of missing) {
        try {
            const user = await (jiraService as any).callJira(
                `/rest/api/2/user?username=${encodeURIComponent(name)}`,
                token
            );
            if (user?.key) map.set(user.key, user.name || name);
        } catch {
            // A member who no longer resolves in Jira just stays unmapped
        }
    }

    console.log(`[HEALTH] User key map: ${map.size} entries (${missing.length} looked up via API)`);
    return map;
}

// Get the date when an issue was first assigned to one of our members (from changelog)
function getFirstAssignedDate(
    issue: any,
    memberSet: Set<string>,
    sortedHistories: any[],
    resolveUser: (raw: string) => string,
): string | null {
    for (const history of sortedHistories) {
        for (const item of (history.items || [])) {
            if (item.field === 'assignee' && memberSet.has(resolveUser(item.to || ''))) {
                return toDay(history.created);
            }
        }
    }
    // fallback: if issue was created with one of our members as assignee
    const assignee = resolveUser(issue.fields?.assignee?.name || '');
    if (memberSet.has(assignee)) {
        return toDay(issue.fields?.created);
    }
    return null;
}

/**
 * Flatten one Jira issue into a day-by-day replayable timeline. This is what makes
 * every metric land on the date it actually happened rather than on the date the
 * issue was first assigned.
 */
function buildTimeline(
    issue: any,
    memberTeamMap: Map<string, number>,
    memberSet: Set<string>,
    userKeyMap: Map<string, string>,
): IssueTimeline | null {
    // Key → username, then retired username → current one. Both are needed: the
    // changelog stores user keys, and members who were renamed still appear under
    // their old username in older entries.
    const resolveUser = (raw: string) => resolveAlias(userKeyMap.get(raw) || raw);

    const histories = [...(issue.changelog?.histories || [])].sort((a: any, b: any) =>
        new Date(a.created).getTime() - new Date(b.created).getTime()
    );

    const assignedDate = getFirstAssignedDate(issue, memberSet, histories, resolveUser);
    if (!assignedDate) return null;

    // The status the issue started in: the "from" side of its first status change.
    // With no status changes at all, it is still in its original status today.
    let initialStatus: string = issue.fields?.status?.name || 'Open';
    for (const h of histories) {
        const statusItem = (h.items || []).find((i: any) => i.field === 'status');
        if (statusItem) {
            initialStatus = statusItem.fromString || statusItem.from || initialStatus;
            break;
        }
    }

    // Likewise, the assignee it started with is the "from" side of the first reassignment
    let initialAssignee: string = resolveUser(issue.fields?.assignee?.name || '');
    for (const h of histories) {
        const assigneeItem = (h.items || []).find((i: any) => i.field === 'assignee');
        if (assigneeItem) {
            initialAssignee = resolveUser(assigneeItem.from || '');
            break;
        }
    }

    const createdDate = toDay(issue.fields?.created) || assignedDate;
    const statusChanges: StatusChange[] = [{ date: createdDate, status: initialStatus }];
    const assigneeChanges: AssigneeChange[] = [{ date: createdDate, assignee: initialAssignee }];
    const activityDates: string[] = [];

    // Replay status and assignee together so each status event knows who held the issue.
    const resolvedEvents: TimelineEvent[] = [];
    const reopenedEvents: TimelineEvent[] = [];
    let heldBy = initialAssignee;
    let heldByDisplay = issue.fields?.assignee?.displayName || initialAssignee;
    // When the current holder took the issue — the clock for their own work time
    let heldSince = createdDate;
    let currentCategory = classifyStatus(initialStatus);
    let dueDateChangeCount = 0;
    let transferCount = 0;
    let firstAssignee = memberSet.has(initialAssignee) ? initialAssignee : '';

    // Every member who ever held the issue, and every member who handed it on —
    // a transfer is work touched even when someone else closed it.
    const holders = new Set<string>();
    const transferredOutBy = new Set<string>();
    if (memberSet.has(initialAssignee)) holders.add(initialAssignee);

    let lastResolution = '';

    for (const h of histories) {
        const day = toDay(h.created);
        if (!day) continue;
        activityDates.push(day);

        // The reopen and the resolution-clear land in the same entry, so the
        // resolution has to be read before the entry's items are applied.
        const items = h.items || [];
        const resolutionItem = items.find((i: any) => i.field === 'resolution');
        const resolutionBefore = resolutionItem?.fromString || lastResolution;

        for (const item of items) {
            if (item.field === 'resolution') {
                lastResolution = item.toString || '';
            }
            if (item.field === 'assignee') {
                const previous = heldBy;
                heldBy = resolveUser(item.to || '');
                heldByDisplay = item.toString || heldBy;
                heldSince = day;
                assigneeChanges.push({ date: day, assignee: heldBy });
                transferCount++;
                if (previous && previous !== heldBy && memberSet.has(previous)) {
                    transferredOutBy.add(previous);
                }
                if (memberSet.has(heldBy)) holders.add(heldBy);
                if (!firstAssignee && memberSet.has(heldBy)) firstAssignee = heldBy;
            } else if (item.field === 'duedate') {
                dueDateChangeCount++;
            } else if (item.field === 'status') {
                const status = item.toString || item.to || '';
                const fromStatus = item.fromString || item.from || '';
                statusChanges.push({ date: day, status });
                // Only count a transition when the *category* changes, so
                // Resolved → Closed is one resolution, not two.
                const next = classifyStatus(status);
                if (next !== currentCategory) {
                    if (next === 'resolved') {
                        resolvedEvents.push({
                            date: day,
                            assignee: heldBy,
                            assigneeName: heldByDisplay || heldBy,
                            daysHeld: Math.max(diffDays(day, heldSince), 0),
                        });
                    }
                    if (next === 'reopened') {
                        // Whoever resolved it last is the one whose fix came back
                        const priorFix = resolvedEvents[resolvedEvents.length - 1];
                        reopenedEvents.push({
                            date: day,
                            assignee: heldBy,
                            assigneeName: heldByDisplay || heldBy,
                            fromStatus,
                            fromResolution: resolutionBefore || '',
                            patchOwner: priorFix?.assignee || heldBy,
                            patchOwnerIsMember: memberSet.has(priorFix?.assignee || heldBy),
                        });
                    }
                    currentCategory = next;
                }
            }
        }
    }

    const assignee = resolveUser(issue.fields?.assignee?.name || '');

    return {
        key: issue.key,
        project: issue.fields?.project?.key || 'UNKNOWN',
        projectName: issue.fields?.project?.name || issue.fields?.project?.key || 'Unknown',
        assignee,
        teamId: memberTeamMap.get(assignee) ?? -1,
        assignedDate,
        statusChanges,
        assigneeChanges,
        activityDates,
        resolvedEvents,
        reopenedEvents,
        createdDate,
        firstAssignee,
        holders: [...holders],
        transferredOutBy: [...transferredOutBy],
        currentAssignee: assignee,
        currentStatus: issue.fields?.status?.name || '',
        resolution: issue.fields?.resolution?.name || '',
        dueDateChangeCount,
        transferCount,
    };
}

interface TeamBucket {
    name: string;
    // Flow — events that happened on this date
    assigned: number;
    created: number; // legacy alias of `assigned`, kept so older clients keep rendering
    resolved: number;
    reopened: number;
    // Stock — state at end of this date
    open: number;
    inProgress: number;
    reopenedOpen: number;
    resolvedTotal: number;
    stalled: number;
}

interface ProjectBucket {
    key: string;
    name: string;
    // Flow — events that happened on this date
    assigned: number;
    resolved: number;
    reopened: number;
    // Stock — state at end of this date
    open: number;
    inProgress: number;
    reopenedOpen: number;
    resolvedTotal: number;
    unresolved: number;
    stalled: number;
}

interface MemberBucket {
    name: string;
    teamId: number;
    // Flow — events on this date
    assigned: number;
    resolved: number;
    reopened: number;
    // Stock — what they were holding at end of this date
    open: number;
    inProgress: number;
    reopenedOpen: number;
    unresolved: number;
    stalled: number;
}

interface StalledEntry {
    key: string;
    project: string;
    assignee: string;
    teamId: number;
    daysStalled: number;
    status: string;
}

interface DayAccumulator {
    date: string;
    assignedCount: number;
    resolvedCount: number;
    reopenedCount: number;
    /** Reopens by category — see constants/reopen.ts. After Fix is split by whether
     *  the fix that came back was ours or another team's. */
    reopenAfterFix: number;
    reopenOutside: number;
    reopenOther: number;
    reopenRepeat: number;
    open: number;
    inProgress: number;
    reopenedOpen: number;
    resolvedTotal: number;
    stalled: number;
    byProject: Record<string, ProjectBucket>;
    byTeam: Record<number, TeamBucket>;
    byMember: Record<string, MemberBucket>;
    stalledIssues: StalledEntry[];
}

function memberBucket(day: DayAccumulator, name: string, memberTeamMap: Map<string, number>): MemberBucket | null {
    if (!name || !memberTeamMap.has(name)) return null;
    let bucket = day.byMember[name];
    if (!bucket) {
        bucket = {
            name,
            teamId: memberTeamMap.get(name) ?? -1,
            assigned: 0, resolved: 0, reopened: 0,
            open: 0, inProgress: 0, reopenedOpen: 0, unresolved: 0, stalled: 0,
        };
        day.byMember[name] = bucket;
    }
    return bucket;
}

function emptyProjectBucket(key: string, name: string): ProjectBucket {
    return {
        key, name,
        assigned: 0, resolved: 0, reopened: 0,
        open: 0, inProgress: 0, reopenedOpen: 0, resolvedTotal: 0, unresolved: 0, stalled: 0,
    };
}

function projectBucket(day: DayAccumulator, t: IssueTimeline): ProjectBucket {
    let bucket = day.byProject[t.project];
    if (!bucket) {
        bucket = emptyProjectBucket(t.project, t.projectName);
        day.byProject[t.project] = bucket;
    }
    return bucket;
}

function emptyTeamBucket(teamId: number): TeamBucket {
    return {
        name: TEAM_NAMES[teamId] || `Team ${teamId}`,
        assigned: 0, created: 0, resolved: 0, reopened: 0,
        open: 0, inProgress: 0, reopenedOpen: 0, resolvedTotal: 0, stalled: 0,
    };
}

function emptyDay(date: string): DayAccumulator {
    const byTeam: Record<number, TeamBucket> = {};
    for (const teamId of [0, 1, 2, 3]) byTeam[teamId] = emptyTeamBucket(teamId);
    return {
        date,
        assignedCount: 0, resolvedCount: 0, reopenedCount: 0,
        reopenAfterFix: 0, reopenOutside: 0, reopenOther: 0, reopenRepeat: 0,
        open: 0, inProgress: 0, reopenedOpen: 0, resolvedTotal: 0, stalled: 0,
        byProject: {}, byTeam, byMember: {}, stalledIssues: [],
    };
}

/**
 * Replay every issue timeline across every requested date.
 *
 * Each date gets two kinds of number:
 *  - flow   (assigned / resolved / reopened) — counted on the date the event happened
 *  - stock  (open / inProgress / reopenedOpen / resolvedTotal / stalled) — the status
 *           each tracked issue was actually in at the end of that day
 *
 * Days are computed independently of one another, so a partial window (the daily cron)
 * produces exactly the same numbers as a full backfill.
 */
function buildSnapshots(dates: string[], timelines: IssueTimeline[], memberTeamMap: Map<string, number>) {
    const days = new Map<string, DayAccumulator>();
    for (const date of dates) days.set(date, emptyDay(date));

    const bumpFlow = (
        date: string,
        t: IssueTimeline,
        field: 'assignedCount' | 'resolvedCount' | 'reopenedCount',
        creditTo: string,
    ) => {
        const day = days.get(date);
        if (!day) return;
        day[field]++;

        const project = projectBucket(day, t);
        const team = day.byTeam[t.teamId];
        const member = memberBucket(day, creditTo, memberTeamMap);

        if (field === 'assignedCount') {
            project.assigned++;
            if (team) { team.assigned++; team.created++; }
            if (member) member.assigned++;
        } else if (field === 'resolvedCount') {
            project.resolved++;
            if (team) team.resolved++;
            if (member) member.resolved++;
        } else {
            project.reopened++;
            if (team) team.reopened++;
            if (member) member.reopened++;
        }
    };

    for (const t of timelines) {
        // Flow events — recorded on their own dates, whether or not they fall in the
        // window, and credited to whoever held the issue at that moment.
        bumpFlow(t.assignedDate, t, 'assignedCount', t.firstAssignee);
        for (const e of t.resolvedEvents) bumpFlow(e.date, t, 'resolvedCount', e.assignee);
        t.reopenedEvents.forEach((e, index) => {
            bumpFlow(e.date, t, 'reopenedCount', e.assignee);
            const day = days.get(e.date);
            if (!day) return;

            // After Fix means the issue was closed on the code and came back; when that
            // fix came from another team it is reported as Outside instead.
            const impact = classifyReopenImpact(e.fromResolution);
            if (impact === 'afterFix') {
                if (e.patchOwnerIsMember) day.reopenAfterFix++;
                else day.reopenOutside++;
            } else if (impact === 'other') {
                day.reopenOther++;
            }

            // Second and later time the same issue came back, whatever the category
            if (index > 0) day.reopenRepeat++;
        });

        // Stock — walk the dates the issue was actually held by the team
        let i = 0;
        while (i < dates.length && dates[i] < t.assignedDate) i++;
        if (i >= dates.length) continue;

        let sc = 0;
        let ac = 0;
        let act = 0;
        let lastActivity = t.assignedDate;

        for (; i < dates.length; i++) {
            const date = dates[i];
            const day = days.get(date)!;

            while (sc + 1 < t.statusChanges.length && t.statusChanges[sc + 1].date <= date) sc++;
            while (ac + 1 < t.assigneeChanges.length && t.assigneeChanges[ac + 1].date <= date) ac++;
            while (act < t.activityDates.length && t.activityDates[act] <= date) {
                lastActivity = t.activityDates[act];
                act++;
            }

            const statusName = t.statusChanges[sc].status;
            const category = classifyStatus(statusName);
            const team = day.byTeam[t.teamId];
            const project = projectBucket(day, t);
            // Held by whoever the issue was actually assigned to on this date
            const heldBy = t.assigneeChanges[ac].assignee;
            const member = memberBucket(day, heldBy, memberTeamMap);

            if (category === 'resolved') {
                day.resolvedTotal++;
                project.resolvedTotal++;
                if (team) team.resolvedTotal++;
                continue;
            }

            project.unresolved++;
            if (member) member.unresolved++;

            if (category === 'inProgress') {
                day.inProgress++;
                project.inProgress++;
                if (team) team.inProgress++;
                if (member) member.inProgress++;
            } else if (category === 'reopened') {
                day.reopenedOpen++;
                project.reopenedOpen++;
                if (team) team.reopenedOpen++;
                if (member) member.reopenedOpen++;
            } else {
                day.open++;
                project.open++;
                if (team) team.open++;
                if (member) member.open++;
            }

            const idleDays = diffDays(date, lastActivity);
            if (idleDays >= STALLED_THRESHOLD_DAYS) {
                day.stalled++;
                project.stalled++;
                if (team) team.stalled++;
                if (member) member.stalled++;
                day.stalledIssues.push({
                    key: t.key,
                    project: t.project,
                    assignee: heldBy || t.assignee,
                    teamId: t.teamId,
                    daysStalled: idleDays,
                    status: statusName,
                });
            }
        }
    }

    const now = new Date();
    return dates.map(date => {
        const day = days.get(date)!;
        const stalledIssues = day.stalledIssues
            .sort((a, b) => b.daysStalled - a.daysStalled)
            .slice(0, MAX_STALLED_STORED);
        const unresolvedCount = day.open + day.inProgress + day.reopenedOpen;

        return {
            date,
            // Flow
            assignedCount: day.assignedCount,
            resolvedCount: day.resolvedCount,
            reopenedCount: day.reopenedCount,
            reopenAfterFixCount: day.reopenAfterFix,
            reopenOutsideCount: day.reopenOutside,
            reopenOtherCount: day.reopenOther,
            reopenRepeatCount: day.reopenRepeat,
            // Stock (end of day)
            openCount: day.open,
            inProgressCount: day.inProgress,
            reopenedOpenCount: day.reopenedOpen,
            resolvedTotalCount: day.resolvedTotal,
            unresolvedCount,
            stalledCount: day.stalled,
            trackedCount: unresolvedCount + day.resolvedTotal,
            // Legacy field name — still the daily assigned flow
            totalCount: day.assignedCount,
            byProject: day.byProject,
            byTeam: day.byTeam,
            byMember: day.byMember,
            stalledIssues,
            stalledTruncated: day.stalledIssues.length > MAX_STALLED_STORED,
            createdAt: now,
        };
    });
}

const OUTCOME_COLLECTION = 'issueOutcomes';

/** Resolutions that mean "no code was written" rather than "fixed". */
const NON_FIX_RESOLUTION = /not a bug|cannot reproduce|duplicate|won'?t fix|invalid|rejected|as designed/i;

export type IssueOutcome = 'fixed' | 'notABug' | 'open' | 'resolvedOutsideTeam';

export type ReopenCategory = 'afterCodeFix' | 'otherReason' | 'unknown';

/**
 * Why an issue came back, judged by the resolution it was reopened from.
 *
 *  - "Fixed" / "Done"  → a delivered fix that did not hold  → afterCodeFix
 *  - "Not a Bug", "Won't Fix", "Withdrawn", "Deferred", …    → otherReason
 *  - nothing recorded                                        → unknown
 *
 * This is read from the changelog rather than from comment text: the resolution is
 * a structured field every reopen clears, whereas comments are free-form and mix
 * English and Korean.
 */
function classifyReopen(fromResolution?: string): ReopenCategory {
    const r = (fromResolution || '').trim();
    if (!r) return 'unknown';
    return CODE_FIX_RESOLUTION.test(r) ? 'afterCodeFix' : 'otherReason';
}

/**
 * One record per issue describing how it ended up — the base for member fix-speed,
 * outcome mix and throughput. Credit goes to the assignee **at the moment of
 * resolution**, not the first assignee: issues change hands often, and crediting the
 * first holder marks most of them as merely "transferred".
 */
function buildIssueOutcomes(timelines: IssueTimeline[], memberTeamMap: Map<string, number>) {
    const now = new Date();

    return timelines.map(t => {
        const firstResolved = t.resolvedEvents[0] || null;
        const resolvedBy = firstResolved?.assignee || '';
        const isMemberResolver = !!resolvedBy && memberTeamMap.has(resolvedBy);
        const nonFix = NON_FIX_RESOLUTION.test(t.resolution);
        const stillOpen = classifyStatus(t.currentStatus) !== 'resolved';

        let outcome: IssueOutcome;
        if (stillOpen) outcome = 'open';
        else if (nonFix) outcome = 'notABug';
        else if (isMemberResolver) outcome = 'fixed';
        else outcome = 'resolvedOutsideTeam';

        // When the resolver took the issue over — the basis for their own hold time
        let ownedSince = t.assignedDate;
        if (firstResolved) {
            for (const change of t.assigneeChanges) {
                if (change.date > firstResolved.date) break;
                if (change.assignee === resolvedBy) ownedSince = change.date;
            }
        }

        return {
            key: t.key,
            source: 'jira' as const,
            project: t.project,
            projectName: t.projectName,
            created: t.createdDate,
            firstAssignedDate: t.assignedDate,
            firstAssignee: t.firstAssignee,
            resolvedAt: firstResolved?.date || null,
            resolvedBy,
            resolvedByTeamId: memberTeamMap.get(resolvedBy) ?? null,
            // Calendar days — there is no worklog time on these bugs, so effort
            // cannot be separated from waiting.
            teamCycleTimeDays: firstResolved ? Math.max(diffDays(firstResolved.date, t.assignedDate), 0) : null,
            ownerCycleTimeDays: firstResolved ? Math.max(diffDays(firstResolved.date, ownedSince), 0) : null,
            // Created → resolved. The only fix-time basis ALM exports can supply, so
            // this is the metric that may be compared across the two sources.
            createdToResolvedDays: firstResolved ? Math.max(diffDays(firstResolved.date, t.createdDate), 0) : null,
            ageDays: stillOpen ? Math.max(diffDays(todayStr(), t.assignedDate), 0) : null,
            outcome,
            resolution: t.resolution,
            holders: t.holders,
            transferredOutBy: t.transferredOutBy,
            currentAssignee: t.currentAssignee,
            currentAssigneeTeamId: memberTeamMap.get(t.currentAssignee) ?? null,
            currentStatus: t.currentStatus,
            statusCategory: classifyStatus(t.currentStatus),
            isOpen: stillOpen,
            // Every resolution, not just the first — with the reopen dates below these
            // let the issue's open/closed state be replayed for any date.
            resolvedDates: t.resolvedEvents.map(e => e.date),
            // Each resolution with the time its own owner spent — a sprint's MTTR must
            // use the resolution that fell in that sprint, not the issue's first one.
            resolutionEvents: t.resolvedEvents.map(e => ({
                date: e.date,
                daysHeld: e.daysHeld ?? null,
                assignee: e.assignee || '',
            })),
            reopenCount: t.reopenedEvents.length,
            // Dated reopen events with the status they came back from, so a sprint
            // can be asked what its reopens were caused by.
            // A reopen has two people attached: whoever delivered the fix that bounced,
            // and whoever eventually made it stick. They are often not the same person,
            // so both are recorded with the time each of them spent on it.
            reopenDetails: t.reopenedEvents.map(e => {
                const patchFix = [...t.resolvedEvents].reverse().find(r => r.date <= e.date);
                const finalFix = t.resolvedEvents.find(r => r.date > e.date);
                const patchOwner = patchFix?.assignee || e.assignee || '';
                return {
                    date: e.date,
                    fromStatus: e.fromStatus || 'Unknown',
                    fromResolution: e.fromResolution || '',
                    category: classifyReopen(e.fromResolution),
                    assignee: e.assignee || '',
                    assigneeName: e.assigneeName || e.assignee || '',
                    // Whose fix came back
                    patchOwner,
                    patchOwnerName: patchFix?.assigneeName || patchOwner,
                    patchOwnerDays: patchFix?.daysHeld ?? null,
                    patchOwnerIsMember: !!patchOwner && memberTeamMap.has(patchOwner),
                    // Who resolved it after this reopen — absent if still unresolved
                    fixOwner: finalFix?.assignee || '',
                    fixOwnerName: finalFix?.assigneeName || finalFix?.assignee || '',
                    fixOwnerDays: finalFix?.daysHeld ?? null,
                    fixOwnerIsMember: !!finalFix?.assignee && memberTeamMap.has(finalFix.assignee),
                };
            }),
            dueDateChangeCount: t.dueDateChangeCount,
            transferCount: t.transferCount,
            updatedAt: now,
        };
    });
}

/**
 * Drop ledger records for issues the team no longer holds.
 *
 * An issue can leave our population by being reassigned outside the group, changing
 * type, or moving project — the Jira fetch simply stops returning it, leaving a stale
 * record behind that still counts toward someone's open workload.
 *
 * Only *unresolved* records are removed. A fix a member actually made is history and
 * must survive the issue being handed on afterwards — deleting those would silently
 * erase their credit. ALM records never appear in the Jira fetch, so they are exempt.
 *
 * Nothing is lost permanently: if the issue comes back to a team member it matches
 * BASE_JQL again and the next run re-creates the record.
 */
async function pruneStaleOutcomes(currentKeys: Set<string>): Promise<number> {
    const db = getMongoDb();
    const candidates = await db.collection(OUTCOME_COLLECTION)
        .find({ source: { $ne: 'alm' }, isOpen: true }, { projection: { key: 1 } })
        .toArray();

    const staleKeys = candidates
        .map((d: any) => d.key)
        .filter((key: string) => !currentKeys.has(key));

    if (!staleKeys.length) return 0;

    const result = await db.collection(OUTCOME_COLLECTION).deleteMany({ key: { $in: staleKeys } });
    console.log(`[HEALTH] Pruned ${result.deletedCount} stale open record(s) no longer held by the team`);
    return result.deletedCount;
}

async function storeIssueOutcomes(outcomes: ReturnType<typeof buildIssueOutcomes>): Promise<void> {
    if (!outcomes.length) return;
    const db = getMongoDb();
    await db.collection(OUTCOME_COLLECTION).bulkWrite(
        outcomes.map(o => ({
            replaceOne: { filter: { key: o.key }, replacement: o, upsert: true }
        })),
        { ordered: false }
    );
    console.log(`[HEALTH] Stored ${outcomes.length} issue outcome records`);
}

async function fetchAllIssues(token: string): Promise<any[]> {
    const fields = ['assignee', 'status', 'resolution', 'created', 'project', 'issuetype', 'summary', 'duedate', 'priority'];
    const jql = `${BASE_JQL} AND createdDate >= "${RANGE_START.replace(/-/g, '/')}" ORDER BY key ASC`;

    const allIssues: any[] = [];
    let startAt = 0;
    const maxResults = 100;

    while (true) {
        // A full crawl is ~20 pages; Jira occasionally returns a truncated body
        // ("Unexpected end of JSON input"). Retrying the page is far cheaper than
        // losing the whole run.
        const result = await fetchSearchPage(token, jql, fields, startAt, maxResults);

        allIssues.push(...(result.issues || []));
        console.log(`[HEALTH] Fetched ${allIssues.length}/${result.total} issues`);
        if (allIssues.length >= result.total) break;
        startAt += maxResults;
    }

    return allIssues;
}

const PAGE_RETRIES = 3;

async function fetchSearchPage(
    token: string,
    jql: string,
    fields: string[],
    startAt: number,
    maxResults: number,
): Promise<any> {
    let lastError: any;
    for (let attempt = 1; attempt <= PAGE_RETRIES; attempt++) {
        try {
            return await (jiraService as any).callJira('/rest/api/2/search', token, {
                method: 'POST',
                body: JSON.stringify({ jql, fields, startAt, maxResults, expand: ['changelog'] })
            });
        } catch (e: any) {
            lastError = e;
            console.warn(`[HEALTH] Page at startAt=${startAt} failed (attempt ${attempt}/${PAGE_RETRIES}): ${e.message}`);
            if (attempt < PAGE_RETRIES) {
                await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
            }
        }
    }
    throw lastError;
}

/**
 * Recompute and store snapshots for [writeFrom, today]. Stocks depend on the whole
 * issue population, so the Jira fetch is always full — only the write window narrows.
 */
async function rebuildSnapshots(writeFrom: string): Promise<{ processed: number; snapshots: number }> {
    const token = await getToken();
    const memberTeamMap = await getMemberTeamMap();
    const memberSet = new Set(memberTeamMap.keys());

    const allIssues = await fetchAllIssues(token);
    console.log(`[HEALTH] Total issues fetched: ${allIssues.length}`);

    // Must come before timeline building — changelog assignees are user keys
    const userKeyMap = await buildUserKeyMap(allIssues, [...memberSet], token);

    const timelines: IssueTimeline[] = [];
    for (const issue of allIssues) {
        const timeline = buildTimeline(issue, memberTeamMap, memberSet, userKeyMap);
        if (timeline) timelines.push(timeline);
    }
    console.log(`[HEALTH] Timelines built for ${timelines.length} team-assigned issues`);

    const dates = dateRange(writeFrom, todayStr());
    const snapshots = buildSnapshots(dates, timelines, memberTeamMap);

    const db = getMongoDb();
    if (snapshots.length) {
        await db.collection(SNAPSHOT_COLLECTION).bulkWrite(
            snapshots.map(s => ({
                replaceOne: { filter: { date: s.date }, replacement: s, upsert: true }
            })),
            { ordered: false }
        );
    }

    // Per-issue outcome ledger — the analytical base for the Members Console
    const outcomes = buildIssueOutcomes(timelines, memberTeamMap);
    await storeIssueOutcomes(outcomes);
    await pruneStaleOutcomes(new Set(outcomes.map(o => o.key)));

    console.log(`[HEALTH] Stored ${snapshots.length} snapshots (${writeFrom} → ${todayStr()})`);
    return { processed: allIssues.length, snapshots: snapshots.length };
}

export async function runBackfill(): Promise<{ processed: number; snapshots: number }> {
    console.log(`[HEALTH] Starting backfill from ${RANGE_START} to today`);
    return rebuildSnapshots(RANGE_START);
}

export async function runDailySnapshot(): Promise<void> {
    const from = new Date();
    from.setDate(from.getDate() - (DAILY_REBUILD_DAYS - 1));
    const writeFrom = from.toISOString().slice(0, 10);
    console.log(`[HEALTH] Running daily snapshot rebuild for ${writeFrom} → today`);
    await rebuildSnapshots(writeFrom < RANGE_START ? RANGE_START : writeFrom);
}

export async function getSnapshots(from: string, to: string) {
    const db = getMongoDb();
    return db.collection(SNAPSHOT_COLLECTION)
        .find({ date: { $gte: from, $lte: to } })
        .sort({ date: 1 })
        .toArray();
}

export async function getOpenIssues(): Promise<any[]> {
    const token = await getToken();
    const fields = ['assignee', 'status', 'summary', 'project', 'issuetype', 'duedate', 'created'];
    // "Fixready" is the real status name — "Fix Ready" matches nothing and silently
    // drops ~27 issues. The createdDate floor keeps this list on the same population
    // as the snapshots, so the Open Now card and the charts agree.
    const jql = `${BASE_JQL} AND status in ("Open", "In Progress", "Fixready", "Reopened") `
        + `AND createdDate >= "${RANGE_START.replace(/-/g, '/')}" ORDER BY created ASC`;

    const allIssues: any[] = [];
    let startAt = 0;
    const maxResults = 100;

    while (true) {
        const result = await (jiraService as any).callJira('/rest/api/2/search', token, {
            method: 'POST',
            body: JSON.stringify({ jql, fields, startAt, maxResults, expand: ['changelog'] })
        });
        allIssues.push(...(result.issues || []));
        if (allIssues.length >= result.total) break;
        startAt += maxResults;
    }

    const db = getMongoDb();
    const memberDocs = await db.collection('members').find({}, { projection: { name: 1, teamId: 1 } }).toArray();
    const memberTeamMap = new Map(memberDocs.map((d: any) => [d.name, Number(d.teamId)]));
    const memberSet = new Set(memberTeamMap.keys());
    const today = new Date();

    // Same user-key translation the snapshot builder needs
    const userKeyMap = await buildUserKeyMap(allIssues, [...memberSet] as string[], token);
    const resolveUser = (raw: string) => resolveAlias(userKeyMap.get(raw) || raw);

    return allIssues.map((issue: any) => {
        const histories = issue.changelog?.histories || [];
        const assigneeName = resolveUser(issue.fields?.assignee?.name || '');

        const sortedHistories = [...histories].sort((a: any, b: any) =>
            new Date(a.created).getTime() - new Date(b.created).getTime()
        );

        // Days since issue was first assigned to a team member
        const firstAssignedDate = getFirstAssignedDate(issue, memberSet, sortedHistories, resolveUser);
        const daysAssigned = firstAssignedDate
            ? Math.floor((today.getTime() - new Date(firstAssignedDate).getTime()) / (1000 * 3600 * 24))
            : null;

        // Count how many times status changed to Reopened
        const reopenCount = histories.reduce((count: number, h: any) =>
            count + ((h.items || []).filter((item: any) =>
                item.field === 'status' &&
                item.toString?.toLowerCase().includes('reopen')
            ).length), 0);

        // Count how many times issue was reassigned to a team member
        const reassignCount = histories.reduce((count: number, h: any) =>
            count + ((h.items || []).filter((item: any) =>
                item.field === 'assignee' && memberSet.has(resolveUser(item.to || ''))
            ).length), 0);

        const teamId = memberTeamMap.get(assigneeName) ?? null;

        return {
            key: issue.key,
            assignee: issue.fields?.assignee?.displayName || assigneeName || 'Unassigned',
            assigneeName,
            status: issue.fields?.status?.name || '',
            project: issue.fields?.project?.key || '',
            duedate: issue.fields?.duedate || '',
            created: issue.fields?.created || '',
            teamId,
            teamName: teamId !== null ? (TEAM_NAMES[teamId] || '') : '',
            daysAssigned,
            reopenCount,
            reassignCount,
            link: `http://jira.lge.com/issue/browse/${issue.key}`,
        };
    }).sort((a: any, b: any) => {
        // Sort by team first, then by daysAssigned desc
        if (a.teamId !== b.teamId) return (a.teamId ?? 99) - (b.teamId ?? 99);
        return (b.daysAssigned ?? 0) - (a.daysAssigned ?? 0);
    });
}

export async function deleteAllSnapshots(): Promise<number> {
    const db = getMongoDb();
    const result = await db.collection(SNAPSHOT_COLLECTION).deleteMany({});
    console.log(`[HEALTH] Deleted ${result.deletedCount} snapshots`);
    return result.deletedCount;
}
