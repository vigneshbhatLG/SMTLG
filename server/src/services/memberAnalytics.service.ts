import { getMongoDb } from '../utils/mongo';
import { isLead } from '../constants/leads';
import { classifyReopenImpact } from '../constants/reopen';

const OUTCOME_COLLECTION = 'issueOutcomes';
const ALERT_LOG_COLLECTION = 'teamsAlertLog';
const SNAPSHOT_COLLECTION = 'dailyIssueSnapshots';

/**
 * Fix rate is measured over a trailing window rather than year-to-date. A member's
 * pace changes; a YTD rate applied to today's backlog produces absurd projections
 * (a 1-day median with 9 open issues came out as "267 days to clear").
 */
const THROUGHPUT_WINDOW_DAYS = 60;

function percentile(sorted: number[], p: number): number | null {
    if (!sorted.length) return null;
    const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
    return sorted[idx];
}

function diffDaysBetween(later: string, earlier: string): number {
    const a = Date.parse(`${later}T00:00:00Z`);
    const b = Date.parse(`${earlier}T00:00:00Z`);
    if (Number.isNaN(a) || Number.isNaN(b)) return 0;
    return Math.floor((a - b) / 86400000);
}

function daysAgo(n: number): string {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
}

export interface MemberStats {
    name: string;
    teamId: number | null;
    // Historical outcomes
    fixed: number;
    /** Fixes sourced from Jira, where full history is available. */
    jiraFixed: number;
    /** Fixes imported from ALM CSV exports — counts and cycle time only. */
    almFixed: number;
    notABug: number;
    resolvedOutsideTeam: number;
    reopenedAfterFix: number;
    /** Issues this member ever held, whoever finally closed them. */
    held: number;
    /** Issues this member handed on to someone else. */
    transferredOut: number;
    // Jira only: calendar days from taking the issue to resolving it
    medianFixDays: number | null;
    p90FixDays: number | null;
    avgFixDays: number | null;
    // Both sources: created → resolved. ALM exports carry no assignment history,
    // so this is the only basis on which the two can be compared.
    medianCycleDays: number | null;
    p90CycleDays: number | null;
    // Current load
    openNow: number;
    stalledNow: number;
    oldestOpenDays: number | null;
    dueDateChangesOnOpen: number;
    // Forecast
    fixesInWindow: number;
    fixesPerWeek: number | null;
    estDaysToClear: number | null;
    confidence: 'low' | 'medium' | 'high';
}

/**
 * Aggregate the issue outcome ledger into per-member speed, outcome mix and a
 * backlog-clearing forecast.
 */
export async function getMemberStats(): Promise<{ members: MemberStats[]; generatedAt: string; windowDays: number }> {
    const db = getMongoDb();

    const memberDocs = await db.collection('members')
        .find({}, { projection: { name: 1, teamId: 1 } })
        .toArray();
    const teamOf = new Map<string, number | null>(
        memberDocs.map((d: any) => [d.name, d.teamId != null ? Number(d.teamId) : null])
    );

    const outcomes = await db.collection(OUTCOME_COLLECTION).find({}).toArray();
    const windowStart = daysAgo(THROUGHPUT_WINDOW_DAYS);

    const acc = new Map<string, {
        fixTimes: number[];
        cycleTimes: number[];
        jiraFixed: number; almFixed: number;
        fixed: number; notABug: number; resolvedOutsideTeam: number;
        reopenedAfterFix: number; held: number; transferredOut: number;
        openNow: number; stalledNow: number; oldestOpenDays: number;
        dueDateChangesOnOpen: number; fixesInWindow: number;
    }>();

    const bucketFor = (name: string) => {
        let b = acc.get(name);
        if (!b) {
            b = {
                fixTimes: [], cycleTimes: [], jiraFixed: 0, almFixed: 0,
                fixed: 0, notABug: 0, resolvedOutsideTeam: 0,
                reopenedAfterFix: 0, held: 0, transferredOut: 0,
                openNow: 0, stalledNow: 0, oldestOpenDays: 0,
                dueDateChangesOnOpen: 0, fixesInWindow: 0,
            };
            acc.set(name, b);
        }
        return b;
    };

    for (const o of outcomes as any[]) {
        // Resolution outcomes credited to whoever resolved it
        if (o.resolvedBy && teamOf.has(o.resolvedBy)) {
            const b = bucketFor(o.resolvedBy);
            if (o.outcome === 'fixed') {
                b.fixed++;
                if (o.source === 'alm') b.almFixed++; else b.jiraFixed++;
                if (typeof o.ownerCycleTimeDays === 'number') b.fixTimes.push(o.ownerCycleTimeDays);
                if (typeof o.createdToResolvedDays === 'number') b.cycleTimes.push(o.createdToResolvedDays);
                if (o.resolvedAt && o.resolvedAt >= windowStart) b.fixesInWindow++;
                if (o.reopenCount > 0) b.reopenedAfterFix++;
            } else if (o.outcome === 'notABug') {
                b.notABug++;
            } else if (o.outcome === 'resolvedOutsideTeam') {
                b.resolvedOutsideTeam++;
            }
        }

        // Current load sits with whoever holds it now
        if (o.isOpen && o.currentAssignee && teamOf.has(o.currentAssignee)) {
            const b = bucketFor(o.currentAssignee);
            b.openNow++;
            if (typeof o.ageDays === 'number') {
                if (o.ageDays >= 7) b.stalledNow++;
                if (o.ageDays > b.oldestOpenDays) b.oldestOpenDays = o.ageDays;
            }
            if (o.dueDateChangeCount > 1) b.dueDateChangesOnOpen++;
        }

        // Everyone who touched the issue, whoever finally closed it
        for (const holder of (o.holders || [])) {
            if (teamOf.has(holder)) bucketFor(holder).held++;
        }
        for (const handler of (o.transferredOutBy || [])) {
            if (teamOf.has(handler)) bucketFor(handler).transferredOut++;
        }
    }

    const members: MemberStats[] = [];
    for (const [name, teamId] of teamOf.entries()) {
        const b = acc.get(name);
        if (!b) {
            members.push({
                name, teamId,
                fixed: 0, jiraFixed: 0, almFixed: 0, notABug: 0, resolvedOutsideTeam: 0,
                reopenedAfterFix: 0, held: 0, transferredOut: 0,
                medianFixDays: null, p90FixDays: null, avgFixDays: null,
                medianCycleDays: null, p90CycleDays: null,
                openNow: 0, stalledNow: 0, oldestOpenDays: null, dueDateChangesOnOpen: 0,
                fixesInWindow: 0, fixesPerWeek: null, estDaysToClear: null, confidence: 'low',
            });
            continue;
        }

        const sorted = [...b.fixTimes].sort((x, y) => x - y);
        const cycles = [...b.cycleTimes].sort((x, y) => x - y);
        const fixesPerWeek = b.fixesInWindow > 0
            ? Number((b.fixesInWindow / (THROUGHPUT_WINDOW_DAYS / 7)).toFixed(2))
            : null;

        members.push({
            name,
            teamId,
            fixed: b.fixed,
            jiraFixed: b.jiraFixed,
            almFixed: b.almFixed,
            notABug: b.notABug,
            resolvedOutsideTeam: b.resolvedOutsideTeam,
            reopenedAfterFix: b.reopenedAfterFix,
            held: b.held,
            transferredOut: b.transferredOut,
            medianFixDays: percentile(sorted, 0.5),
            p90FixDays: percentile(sorted, 0.9),
            avgFixDays: sorted.length ? Math.round(sorted.reduce((t, x) => t + x, 0) / sorted.length) : null,
            medianCycleDays: percentile(cycles, 0.5),
            p90CycleDays: percentile(cycles, 0.9),
            openNow: b.openNow,
            stalledNow: b.stalledNow,
            oldestOpenDays: b.openNow ? b.oldestOpenDays : null,
            dueDateChangesOnOpen: b.dueDateChangesOnOpen,
            fixesInWindow: b.fixesInWindow,
            fixesPerWeek,
            // Only a forecast when there is a recent pace to extrapolate from
            estDaysToClear: fixesPerWeek && b.openNow
                ? Math.round((b.openNow / fixesPerWeek) * 7)
                : null,
            // Sample sizes here are small; say so rather than implying precision
            confidence: b.fixed >= 20 ? 'high' : b.fixed >= 8 ? 'medium' : 'low',
        });
    }

    members.sort((a, b) => b.fixed - a.fixed || a.name.localeCompare(b.name));

    return {
        members,
        generatedAt: new Date().toISOString(),
        windowDays: THROUGHPUT_WINDOW_DAYS,
    };
}

/**
 * Compact per-issue resolution times, for the project × sprint MTTR table.
 *
 * `days` is the engineer's own hold time — from the issue landing with them to it
 * being resolved — which is what "time required to resolve" means here, rather than
 * the time it sat in the backlog beforehand.
 *
 * ALM rows are excluded: their CSV exports carry no assignment history, so an
 * engineer hold time cannot be derived, and their projects have no snapshot rows
 * to fill the rest of the table.
 */
export async function getMttrSamples(): Promise<{ project: string; resolvedAt: string; days: number }[]> {
    const db = getMongoDb();
    const rows = await db.collection(OUTCOME_COLLECTION)
        .find(
            { source: { $ne: 'alm' }, resolvedAt: { $ne: null }, outcome: { $in: ['fixed', 'notABug'] } },
            { projection: { project: 1, resolvedAt: 1, ownerCycleTimeDays: 1, teamCycleTimeDays: 1 } }
        )
        .toArray();

    const samples: { project: string; resolvedAt: string; days: number }[] = [];
    for (const r of rows as any[]) {
        const days = r.ownerCycleTimeDays ?? r.teamCycleTimeDays;
        if (typeof days !== 'number' || !r.resolvedAt || !r.project) continue;
        samples.push({ project: r.project, resolvedAt: r.resolvedAt, days });
    }
    return samples;
}

/**
 * Dated reopen events with the status each issue came back from — the input to the
 * sprint review's reopen analysis. Jira only; ALM exports have no status history.
 */
export async function getReopenEvents(): Promise<{ key: string; project: string; date: string; fromStatus: string; assignee: string }[]> {
    const db = getMongoDb();
    const rows = await db.collection(OUTCOME_COLLECTION)
        .find(
            { source: { $ne: 'alm' }, reopenCount: { $gt: 0 } },
            { projection: { key: 1, project: 1, reopenDetails: 1 } }
        )
        .toArray();

    const events: { key: string; project: string; date: string; fromStatus: string; assignee: string }[] = [];
    for (const r of rows as any[]) {
        for (const d of (r.reopenDetails || [])) {
            if (!d?.date) continue;
            events.push({
                key: r.key,
                project: r.project,
                date: d.date,
                fromStatus: d.fromStatus || 'Unknown',
                assignee: d.assignee || '',
            });
        }
    }
    return events;
}

export interface ReopenIssueDetail {
    key: string;
    assignee: string;
    /** Calendar days the engineer held the issue. Null when it was never resolved. */
    daysWorked: number | null;
    reopenedOn: string;
    fromResolution: string;
    /** 1 for the first reopen of this issue, 2 for the second, and so on. */
    reopenNumber: number;
    link: string;
    /** Whose fix bounced back, and how long they had worked it. */
    patchOwner: string;
    patchOwnerDays: number | null;
    patchOwnerIsMember: boolean;
    /** Who resolved it after the reopen — blank while it is still open. */
    fixOwner: string;
    fixOwnerDays: number | null;
    /** True when the same person fixed it again after their own fix bounced. */
    sameOwner: boolean;
}

export interface SprintWindow {
    id: string | number;
    shortName: string;
    start: string;
    end: string;
}

/**
 * Exact per-sprint issue accounting, split by cohort so the numbers reconcile:
 *
 *   Carried In + New Logged + Reopened  =  Resolved(old) + Resolved(new)
 *                                          + CarryFwd(old) + CarryFwd(new)
 *
 * Every issue is classified by *state at the sprint boundaries* rather than by
 * counting resolution events, because an issue resolved and reopened inside the same
 * sprint is still open at the end of it — counting events would report it as both
 * resolved and carried forward.
 *
 * "Reopened" is a third intake, not a subset of the other two: an issue closed before
 * the sprint and reopened during it was neither open at the start nor newly logged.
 * Without that cohort each sprint appears to start with more than the previous one
 * handed over, and the table stops being continuous.
 */
export async function getSprintCohorts(sprints: SprintWindow[]) {
    const db = getMongoDb();
    const rows = await db.collection(OUTCOME_COLLECTION)
        .find(
            { source: { $ne: 'alm' } },
            {
                projection: {
                    key: 1, created: 1, firstAssignedDate: 1, resolvedDates: 1, resolutionEvents: 1,
                    reopenDetails: 1, ownerCycleTimeDays: 1, teamCycleTimeDays: 1,
                    createdToResolvedDays: 1,
                }
            }
        )
        .toArray();

    const issues = (rows as any[])
        .filter(r => r.firstAssignedDate)
        .map(r => ({
            key: r.key as string,
            created: (r.created || r.firstAssignedDate) as string,
            firstAssigned: r.firstAssignedDate as string,
            resolves: [...(r.resolvedDates || [])].sort(),
            resolutionEvents: [...(r.resolutionEvents || [])]
                .filter((e: any) => e?.date)
                .sort((a: any, b: any) => String(a.date).localeCompare(String(b.date))),
            reopens: (r.reopenDetails || []).map((d: any) => d.date).filter(Boolean).sort(),
            // Chronological, so the index tells us whether a reopen is a repeat
            reopenDetails: [...(r.reopenDetails || [])]
                .filter((d: any) => d?.date)
                .sort((a: any, b: any) => String(a.date).localeCompare(String(b.date))),
            mttr: typeof r.ownerCycleTimeDays === 'number' ? r.ownerCycleTimeDays
                : typeof r.teamCycleTimeDays === 'number' ? r.teamCycleTimeDays : null,
            createdToResolved: typeof r.createdToResolvedDays === 'number' ? r.createdToResolvedDays : null,
        }));

    /** Was the issue in a resolved state at the end of `date`? */
    const isResolvedOn = (issue: typeof issues[number], date: string): boolean => {
        const resolved = issue.resolves.filter((d: string) => d <= date).length;
        const reopened = issue.reopens.filter((d: string) => d <= date).length;
        return resolved > reopened;
    };

    const previousDay = (date: string) => {
        const d = new Date(`${date}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() - 1);
        return d.toISOString().slice(0, 10);
    };

    return sprints.map(sp => {
        const dayBefore = previousDay(sp.start);
        let carriedIn = 0, newLogged = 0, reopenedIn = 0;
        let resolvedOld = 0, resolvedNew = 0;
        let carryFwdOld = 0, carryFwdNew = 0;
        const mttrValues: number[] = [];
        let reopenEvents = 0;
        let reopenAfterFix = 0, reopenOther = 0, reopenUnknown = 0, reopenRepeat = 0;
        const reopenByResolution = new Map<string, number>();
        const repeatIssues: string[] = [];

        // Drill-down lists behind each clickable count
        const detail: Record<string, ReopenIssueDetail[]> = {
            all: [], afterCodeFix: [], otherReason: [], repeat: [], outTeam: [],
        };

        for (const issue of issues) {
            const reopenedDuring = issue.reopens.some((d: string) => d >= sp.start && d <= sp.end);

            issue.reopenDetails.forEach((event: any, index: number) => {
                if (event.date < sp.start || event.date > sp.end) return;
                reopenEvents++;

                const entry: ReopenIssueDetail = {
                    key: issue.key,
                    assignee: event.assigneeName || event.assignee || 'Unassigned',
                    // Calendar days the engineer held the issue before resolving it;
                    // for one still open, how long they have had it so far.
                    daysWorked: issue.mttr,
                    reopenedOn: event.date,
                    fromResolution: event.fromResolution || 'Unrecorded',
                    reopenNumber: index + 1,
                    link: `http://jira.lge.com/issue/browse/${issue.key}`,
                    patchOwner: event.patchOwnerName || event.patchOwner || '—',
                    patchOwnerDays: event.patchOwnerDays ?? null,
                    patchOwnerIsMember: !!event.patchOwnerIsMember,
                    fixOwner: event.fixOwnerName || event.fixOwner || '',
                    fixOwnerDays: event.fixOwnerDays ?? null,
                    sameOwner: !!event.patchOwner && event.patchOwner === event.fixOwner,
                };
                detail.all.push(entry);

                // After Fix, Other and Outside are mutually exclusive and add up to the
                // total, so they can be read side by side without double counting.
                const impact = classifyReopenImpact(entry.fromResolution);
                if (impact === 'afterFix') {
                    if (entry.patchOwnerIsMember) {
                        reopenAfterFix++;
                        detail.afterCodeFix.push(entry);
                    } else {
                        detail.outTeam.push(entry);
                    }
                } else if (impact === 'other') {
                    reopenOther++;
                    detail.otherReason.push(entry);
                } else {
                    reopenUnknown++;
                }

                // Second and later reopens of the same issue — it keeps coming back
                if (index > 0) {
                    reopenRepeat++;
                    detail.repeat.push(entry);
                    if (!repeatIssues.includes(issue.key)) repeatIssues.push(issue.key);
                }

                reopenByResolution.set(
                    entry.fromResolution,
                    (reopenByResolution.get(entry.fromResolution) || 0) + 1
                );
            });
            // Mean time to resolve, measured from when the issue was raised to when it
            // was resolved — the conventional MTTR, and the basis Jira's own reports use.
            //
            // One sample per issue per sprint, taken from the last resolution inside the
            // window, so the sample count matches the Resolved column beside it. An issue
            // fixed, reopened and fixed again within a single sprint still ends that
            // sprint as one resolved issue. A re-fix in a *later* sprint is timed
            // independently there, rather than reporting the first fix's duration.
            let lastInSprint: string | null = null;
            for (const ev of issue.resolutionEvents) {
                if (ev.date < sp.start || ev.date > sp.end) continue;
                if (!lastInSprint || ev.date > lastInSprint) lastInSprint = ev.date;
            }
            if (lastInSprint) {
                const days = issue.created
                    ? Math.max(diffDaysBetween(lastInSprint, issue.created), 0)
                    : issue.createdToResolved;
                if (days != null) mttrValues.push(days);
            }

            if (issue.firstAssigned > sp.end) continue;

            const closedAtEnd = isResolvedOn(issue, sp.end);

            if (issue.firstAssigned >= sp.start) {
                // Landed on the team during this sprint
                newLogged++;
                if (closedAtEnd) resolvedNew++; else carryFwdNew++;
            } else if (!isResolvedOn(issue, dayBefore)) {
                // Was already open when the sprint began
                carriedIn++;
                if (closedAtEnd) resolvedOld++; else carryFwdOld++;
            } else if (reopenedDuring) {
                // Was closed at the start, came back during the sprint
                reopenedIn++;
                if (closedAtEnd) resolvedOld++; else carryFwdOld++;
            }
        }

        return {
            id: sp.id,
            sprint: sp.shortName,
            start: sp.start,
            end: sp.end,
            carriedIn,
            newLogged,
            reopenedIn,
            totalIn: carriedIn + newLogged + reopenedIn,
            resolvedOld,
            resolvedNew,
            resolvedTotal: resolvedOld + resolvedNew,
            carryFwdOld,
            carryFwdNew,
            carryFwdTotal: carryFwdOld + carryFwdNew,
            reopened: reopenEvents,
            /** Closed on the code and came back, on a fix of ours. */
            reopenAfterFix,
            /** Closed on a triage judgement — Not a Bug, Duplicate, Defer, Withdraw. */
            reopenOther,
            /** After Fix reopens where the fix came from another team. */
            reopenOutside: detail.outTeam.length,
            reopenUnknown,
            /** Reopen events that were not the issue's first — it bounced back again. */
            reopenRepeat,
            repeatIssueCount: repeatIssues.length,
            /** Counts by the resolution each issue was reopened from, largest first. */
            reopenByResolution: [...reopenByResolution.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([resolution, count]) => ({ resolution, count })),
            /** Issue-level lists behind each count, for the drill-down dialog. */
            reopenDetail: detail,
            teamMttr: mttrValues.length
                ? Number((mttrValues.reduce((t, v) => t + v, 0) / mttrValues.length).toFixed(1))
                : null,
            mttrSample: mttrValues.length,
        };
    });
}

export interface SprintMemberLoad {
    name: string;
    teamId: number | null;
    /** Flow during the sprint */
    assigned: number;
    resolved: number;
    reopened: number;
    /** State on the sprint's last day */
    openAtEnd: number;
    stalledAtEnd: number;
    /** Mean assigned → resolved time of what they closed in this sprint */
    avgMttr: number | null;
    /** Work taken on plus work still held — what "loaded more" means here. */
    loadScore: number;
    loadShare: number;
    /** Fixes of theirs that came back during this sprint. */
    reopensCaused: number;
    /** Of those, ones where the issue had already bounced before. */
    repeatReopensCaused: number;
    /** reopensCaused as a share of what they resolved — their rework rate. */
    reworkRate: number | null;
}

/**
 * Per-member workload for a single sprint: what each engineer took on, closed, and
 * was still holding when it ended.
 *
 * Flow numbers are summed from the daily snapshots; the open/stalled figures come
 * from the sprint's last snapshot rather than being summed, because they describe a
 * state rather than events.
 */
export async function getSprintMemberLoad(start: string, end: string): Promise<{
    members: SprintMemberLoad[];
    totals: { assigned: number; resolved: number; reopened: number; openAtEnd: number };
    /** Same four categories the dashboard and sprint table use — see constants/reopen.ts */
    reopens: {
        total: number;
        /** Our code patch, or a Cannot Reproduce call, that did not hold. */
        afterFix: number;
        /** Not a Bug, Duplicate, Won't Fix, Deferred, Withdrawn — a triage problem. */
        other: number;
        /** Another team's patch that later landed with us. */
        outside: number;
        unknown: number;
        /** Came back a 2nd time or more; cuts across the three categories above. */
        repeat: number;
        /** afterFix as a share of what the team resolved this sprint. */
        reworkRate: number | null;
        worstIssues: { key: string; times: number; owner: string }[];
    };
}> {
    const db = getMongoDb();

    const memberDocs = await db.collection('members')
        .find({}, { projection: { name: 1, teamId: 1 } })
        .toArray();
    const teamOf = new Map<string, number | null>(
        memberDocs.map((d: any) => [d.name, d.teamId != null ? Number(d.teamId) : null])
    );

    const snapshots = await db.collection(SNAPSHOT_COLLECTION)
        .find({ date: { $gte: start, $lte: end } })
        .sort({ date: 1 })
        .toArray();

    const acc = new Map<string, SprintMemberLoad>();
    const bucketFor = (name: string): SprintMemberLoad => {
        let b = acc.get(name);
        if (!b) {
            b = {
                name, teamId: teamOf.get(name) ?? null,
                assigned: 0, resolved: 0, reopened: 0,
                openAtEnd: 0, stalledAtEnd: 0,
                avgMttr: null, loadScore: 0, loadShare: 0,
                reopensCaused: 0, repeatReopensCaused: 0, reworkRate: null,
            };
            acc.set(name, b);
        }
        return b;
    };

    for (const snap of snapshots as any[]) {
        for (const [name, bucket] of Object.entries<any>(snap.byMember || {})) {
            const b = bucketFor(name);
            b.assigned += bucket.assigned || 0;
            b.resolved += bucket.resolved || 0;
            b.reopened += bucket.reopened || 0;
        }
    }

    // Stock is a state, so it comes from the final day only
    const lastSnapshot: any = snapshots[snapshots.length - 1];
    for (const [name, bucket] of Object.entries<any>(lastSnapshot?.byMember || {})) {
        const b = bucketFor(name);
        b.openAtEnd = bucket.unresolved || 0;
        b.stalledAtEnd = bucket.stalled || 0;
    }

    const resolvedInSprint = await db.collection(OUTCOME_COLLECTION)
        .find(
            { source: { $ne: 'alm' }, resolvedAt: { $gte: start, $lte: end } },
            { projection: { resolvedBy: 1, ownerCycleTimeDays: 1, teamCycleTimeDays: 1 } }
        )
        .toArray();

    const times = new Map<string, number[]>();
    for (const o of resolvedInSprint as any[]) {
        if (!o.resolvedBy || !teamOf.has(o.resolvedBy)) continue;
        const days = o.ownerCycleTimeDays ?? o.teamCycleTimeDays;
        if (typeof days !== 'number') continue;
        if (!times.has(o.resolvedBy)) times.set(o.resolvedBy, []);
        times.get(o.resolvedBy)!.push(days);
    }
    for (const [name, values] of times) {
        bucketFor(name).avgMttr = Number((values.reduce((t, v) => t + v, 0) / values.length).toFixed(1));
    }

    // Leads are dropped: every issue lands on them first before being handed on, so
    // including them shows a routing queue as if it were engineering workload.
    // Reopens that happened during the sprint, attributed to whoever's fix bounced
    const reopenDocs = await db.collection(OUTCOME_COLLECTION)
        .find({ source: { $ne: 'alm' }, reopenCount: { $gt: 0 } }, { projection: { key: 1, reopenDetails: 1 } })
        .toArray();

    const reopens = {
        total: 0, afterFix: 0, other: 0, outside: 0,
        unknown: 0, repeat: 0,
        reworkRate: null as number | null,
        worstIssues: [] as { key: string; times: number; owner: string }[],
    };
    const repeatByIssue = new Map<string, { times: number; owner: string }>();

    for (const doc of reopenDocs as any[]) {
        (doc.reopenDetails || []).forEach((event: any, index: number) => {
            if (!event?.date || event.date < start || event.date > end) return;
            reopens.total++;
            const isRepeat = index > 0;
            if (isRepeat) reopens.repeat++;

            const impact = classifyReopenImpact(event.fromResolution);
            if (impact === 'afterFix') {
                if (event.patchOwnerIsMember) {
                    reopens.afterFix++;
                    // Credit the bounce to the engineer whose fix came back
                    const owner = event.patchOwner && teamOf.has(event.patchOwner) ? event.patchOwner : null;
                    if (owner) {
                        const b = bucketFor(owner);
                        b.reopensCaused++;
                        if (isRepeat) b.repeatReopensCaused++;
                    }
                } else {
                    reopens.outside++;
                }
            } else if (impact === 'other') reopens.other++;
            else reopens.unknown++;

            if (impact === 'afterFix' && event.patchOwnerIsMember) {
                const prev = repeatByIssue.get(doc.key);
                repeatByIssue.set(doc.key, {
                    times: (prev?.times || 0) + 1,
                    owner: event.patchOwnerName || event.patchOwner || prev?.owner || '—',
                });
            }
        });
    }

    reopens.worstIssues = [...repeatByIssue.entries()]
        .map(([key, v]) => ({ key, times: v.times, owner: v.owner }))
        .filter(i => i.times > 1)
        .sort((a, b) => b.times - a.times)
        .slice(0, 8);

    const members = [...acc.values()]
        .filter(m => !isLead(m.name))
        .filter(m => m.assigned || m.resolved || m.openAtEnd || m.reopensCaused);
    for (const m of members) m.loadScore = m.assigned + m.openAtEnd;
    const totalLoad = members.reduce((t, m) => t + m.loadScore, 0);
    for (const m of members) {
        m.loadShare = totalLoad > 0 ? Number(((m.loadScore / totalLoad) * 100).toFixed(1)) : 0;
    }
    members.sort((a, b) => b.loadScore - a.loadScore || a.name.localeCompare(b.name));

    const totals = {
        assigned: members.reduce((t, m) => t + m.assigned, 0),
        resolved: members.reduce((t, m) => t + m.resolved, 0),
        reopened: members.reduce((t, m) => t + m.reopened, 0),
        openAtEnd: members.reduce((t, m) => t + m.openAtEnd, 0),
    };

    for (const m of members) {
        m.reworkRate = m.resolved > 0
            ? Number(((m.reopensCaused / m.resolved) * 100).toFixed(1))
            : null;
    }
    reopens.reworkRate = totals.resolved > 0
        ? Number(((reopens.afterFix / totals.resolved) * 100).toFixed(1))
        : null;

    return { members, totals, reopens };
}

/** Raw outcome records for one member, for the drill-down list. */
export async function getMemberIssues(name: string): Promise<any[]> {
    const db = getMongoDb();
    return db.collection(OUTCOME_COLLECTION)
        .find({ $or: [{ resolvedBy: name }, { currentAssignee: name }] })
        .sort({ resolvedAt: -1, firstAssignedDate: -1 })
        .limit(500)
        .toArray();
}

export interface TeamsAlertLogEntry {
    type: 'dueToday' | 'reopened' | 'dueDateChange' | 'parked';
    date: string;
    sentAt: Date;
    totalCount: number;
    memberCount: number;
    byMember: Record<string, number>;
    issueKeys: string[];
}

/**
 * Record what each Teams alert actually contained. History before today can be
 * reconstructed from Jira changelogs, but what was *sent* cannot — so it is logged
 * from now on.
 */
export async function logTeamsAlert(entry: Omit<TeamsAlertLogEntry, 'sentAt'>): Promise<void> {
    try {
        const db = getMongoDb();
        await db.collection(ALERT_LOG_COLLECTION).replaceOne(
            { type: entry.type, date: entry.date },
            { ...entry, sentAt: new Date() },
            { upsert: true }
        );
        console.log(`[TEAMS] Logged ${entry.type} alert for ${entry.date}: ${entry.totalCount} issue(s)`);
    } catch (e: any) {
        // Never let logging break an alert that was already delivered
        console.error('[TEAMS] Failed to log alert:', e.message || e);
    }
}

export async function getTeamsAlertLog(from?: string, to?: string): Promise<any[]> {
    const db = getMongoDb();
    const query: any = {};
    if (from || to) {
        query.date = {};
        if (from) query.date.$gte = from;
        if (to) query.date.$lte = to;
    }
    return db.collection(ALERT_LOG_COLLECTION).find(query).sort({ date: 1 }).toArray();
}
