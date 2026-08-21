/**
 * Compare our per-sprint numbers against an externally supplied table, to find
 * where and why they differ.
 *
 *   npx ts-node src/scripts/compareSprintTable.ts
 */
import 'dotenv/config';
import { connectToMongo, closeMongo } from '../utils/mongo';
import { getSprintCohorts, SprintWindow } from '../services/memberAnalytics.service';

/** Real Jira sprint windows. Jira's endDate overlaps the next sprint's startDate. */
const JIRA_SPRINTS = [
    { name: 'IR1SP01', start: '2026-01-05', end: '2026-01-19' },
    { name: 'IR1SP02', start: '2026-01-19', end: '2026-02-02' },
    { name: 'IR1SP03', start: '2026-02-02', end: '2026-02-16' },
    { name: 'IR1SP04', start: '2026-02-16', end: '2026-03-02' },
    { name: 'IR1SP05', start: '2026-03-02', end: '2026-03-16' },
    { name: 'IR2SP06', start: '2026-03-16', end: '2026-03-30' },
    { name: 'IR2SP07', start: '2026-03-30', end: '2026-04-13' },
    { name: 'IR2SP08', start: '2026-04-13', end: '2026-04-27' },
    { name: 'IR2SP09', start: '2026-04-27', end: '2026-05-11' },
    { name: 'IR2SP10', start: '2026-05-11', end: '2026-05-25' },
    { name: 'IR3SP11', start: '2026-05-25', end: '2026-06-08' },
    { name: 'IR3SP12', start: '2026-06-08', end: '2026-06-21' },
    { name: 'IR3SP13', start: '2026-06-22', end: '2026-07-06' },
    { name: 'IR3SP14', start: '2026-07-06', end: '2026-07-20' },
    { name: 'IR3SP15', start: '2026-07-20', end: '2026-08-03' },
];

/** The table to reconcile against: start, new, resolved, end, MTTR. */
const REFERENCE: Record<string, [number, number, number, number, number]> = {
    IR1SP01: [3, 107, 16, 94, 4.18],
    IR1SP02: [94, 103, 85, 112, 9.12],
    IR1SP03: [111, 97, 97, 111, 13.81],
    IR1SP04: [111, 82, 72, 121, 16.73],
    IR1SP05: [121, 92, 94, 119, 19.63],
    IR2SP06: [118, 152, 128, 142, 13.16],
    IR2SP07: [141, 173, 155, 159, 12.70],
    IR2SP08: [167, 264, 223, 208, 10.18],
    IR2SP09: [208, 121, 171, 158, 14.20],
    IR2SP10: [159, 135, 150, 144, 14.06],
    IR3SP11: [144, 86, 104, 126, 18.02],
    IR3SP12: [126, 123, 102, 147, 23.08],
    IR3SP13: [148, 220, 207, 161, 11.48],
    IR3SP14: [161, 244, 219, 186, 12.90],
    IR3SP15: [186, 106, 109, 183, 11.91],
};

/** End the sprint the day before the next one starts, removing the overlap. */
function nonOverlapping(): SprintWindow[] {
    return JIRA_SPRINTS.map((s, i) => {
        let end = s.end;
        const next = JIRA_SPRINTS[i + 1];
        if (next) {
            const d = new Date(`${next.start}T00:00:00Z`);
            d.setUTCDate(d.getUTCDate() - 1);
            end = d.toISOString().slice(0, 10);
        }
        return { id: s.name, shortName: s.name, start: s.start, end };
    });
}

function asIs(): SprintWindow[] {
    return JIRA_SPRINTS.map(s => ({ id: s.name, shortName: s.name, start: s.start, end: s.end }));
}

async function report(label: string, windows: SprintWindow[]) {
    const rows = await getSprintCohorts(windows);
    console.log(`\n═══ ${label} ═══`);
    console.log(
        'sprint'.padEnd(9) +
        'start(ours/ref)'.padStart(17) + 'new(ours/ref)'.padStart(16) +
        'resolved(ours/ref)'.padStart(20) + 'end(ours/ref)'.padStart(16) + 'mttr(ours/ref)'.padStart(17)
    );
    const totals = { new: [0, 0], resolved: [0, 0] };
    for (const r of rows as any[]) {
        const ref = REFERENCE[r.sprint];
        if (!ref) continue;
        totals.new[0] += r.newLogged; totals.new[1] += ref[1];
        totals.resolved[0] += r.resolvedTotal; totals.resolved[1] += ref[2];
        const f = (ours: number | null, theirs: number) =>
            `${ours ?? '-'}/${theirs}`.padStart(16);
        console.log(
            r.sprint.padEnd(9) +
            f(r.carriedIn, ref[0]) + ' ' + f(r.newLogged, ref[1]) + ' ' +
            f(r.resolvedTotal, ref[2]) + ' ' + f(r.carryFwdTotal, ref[3]) + ' ' +
            f(r.teamMttr, ref[4])
        );
    }
    console.log(
        'TOTAL'.padEnd(9) + ' '.repeat(17) +
        `${totals.new[0]}/${totals.new[1]}`.padStart(16) + ' ' +
        `${totals.resolved[0]}/${totals.resolved[1]}`.padStart(16)
    );
}

(async () => {
    await connectToMongo(process.env.MONGO_URI);
    await report('Jira dates as-is (sprints overlap by 1 day)', asIs());
    await report('Non-overlapping (end = day before next start)', nonOverlapping());
    await closeMongo();
})().catch(async (e) => {
    console.error('Failed:', e.message);
    await closeMongo().catch(() => undefined);
    process.exit(1);
});
