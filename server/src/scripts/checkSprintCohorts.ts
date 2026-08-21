/**
 * Print the per-sprint cohort table and check that the columns balance.
 *
 *   npx ts-node src/scripts/checkSprintCohorts.ts
 */
import 'dotenv/config';
import { connectToMongo, closeMongo } from '../utils/mongo';
import { getSprintCohorts, SprintWindow } from '../services/memberAnalytics.service';

/** Stand-in sprint windows — the real ones come from Jira via the client. */
function fortnightlySprints(from: string, count: number): SprintWindow[] {
    const out: SprintWindow[] = [];
    for (let n = 0; n < count; n++) {
        const s = new Date(`${from}T00:00:00Z`);
        s.setUTCDate(s.getUTCDate() + n * 14);
        const e = new Date(s);
        e.setUTCDate(e.getUTCDate() + 13);
        out.push({
            id: n + 1,
            shortName: `Sprint ${n + 1}`,
            start: s.toISOString().slice(0, 10),
            end: e.toISOString().slice(0, 10),
        });
    }
    return out;
}

(async () => {
    await connectToMongo(process.env.MONGO_URI);
    const rows = await getSprintCohorts(fortnightlySprints('2026-01-05', 15));

    console.log(
        'Sprint'.padEnd(10) + 'CarrIn'.padStart(7) + 'New'.padStart(6) + 'ReopIn'.padStart(7) +
        'ResOld'.padStart(8) + 'ResNew'.padStart(8) + 'CfOld'.padStart(7) +
        'CfNew'.padStart(7) + 'CfTot'.padStart(7) + 'MTTR'.padStart(7) +
        'AftFix'.padStart(7) + 'Other'.padStart(6) + 'Repeat'.padStart(7) + 'Outside'.padStart(8) +
        '  balance'
    );

    let allBalanced = true;
    for (const r of rows) {
        const lhs = r.totalIn;
        const rhs = r.resolvedTotal + r.carryFwdTotal;
        const ok = lhs === rhs;
        if (!ok) allBalanced = false;
        console.log(
            r.sprint.padEnd(10) +
            String(r.carriedIn).padStart(7) + String(r.newLogged).padStart(6) + String(r.reopenedIn).padStart(7) +
            String(r.resolvedOld).padStart(8) + String(r.resolvedNew).padStart(8) +
            String(r.carryFwdOld).padStart(7) + String(r.carryFwdNew).padStart(7) +
            String(r.carryFwdTotal).padStart(7) +
            String(r.teamMttr ?? '-').padStart(7) +
            String(r.reopenAfterFix).padStart(7) + String(r.reopenOther).padStart(6) +
            String(r.reopenRepeat).padStart(7) + String(r.reopenOutside).padStart(8) +
            `  ${lhs} = ${rhs} ${ok ? 'OK' : '*** MISMATCH ***'}`
        );
    }

    // Each sprint should start with exactly what the previous one carried forward
    console.log('\nContinuity (carriedIn should equal previous carryFwdTotal):');
    for (let i = 1; i < rows.length; i++) {
        const expected = rows[i - 1].carryFwdTotal;
        const actual = rows[i].carriedIn;
        if (expected !== actual) {
            allBalanced = false;
            console.log(`  ${rows[i].sprint}: carriedIn ${actual} vs previous carryFwd ${expected}  <-- gap ${actual - expected}`);
        }
    }
    console.log(allBalanced ? '  all sprints continuous' : '  (gaps above)');

    await closeMongo();
})().catch(async (e) => {
    console.error('Failed:', e.message);
    await closeMongo().catch(() => undefined);
    process.exit(1);
});
