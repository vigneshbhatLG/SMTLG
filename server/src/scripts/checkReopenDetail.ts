/**
 * Print the drill-down list behind each reopen count for one sprint.
 *
 *   npx ts-node src/scripts/checkReopenDetail.ts
 */
import 'dotenv/config';
import { connectToMongo, closeMongo } from '../utils/mongo';
import { getSprintCohorts } from '../services/memberAnalytics.service';

(async () => {
    await connectToMongo(process.env.MONGO_URI);
    const rows = await getSprintCohorts([
        { id: 9, shortName: 'Sprint 9', start: '2026-04-27', end: '2026-05-10' },
    ]);
    const r = rows[0] as any;

    console.log(
        `counts -> afterFix ${r.reopenAfterFix} | other ${r.reopenOther} | ` +
        `defer ${r.reopenAfterDefer} | withdraw ${r.reopenAfterWithdraw} | repeat ${r.reopenRepeat}`
    );
    console.log(
        'detail sizes ->',
        Object.entries(r.reopenDetail).map(([k, v]: any) => `${k}=${v.length}`).join(', ')
    );

    console.log(`team split -> ownTeam ${r.reopenOwnTeam} | outTeam ${r.reopenOutTeam}`);

    for (const bucket of ['afterCodeFix', 'ownTeam', 'outTeam']) {
        console.log(`\n--- ${bucket} ---`);
        console.log(
            '  ' + 'issue'.padEnd(18) + 'patch owner'.padEnd(28) + 'days'.padStart(5) +
            '   ' + 'final fix owner'.padEnd(28) + 'days'.padStart(5) + '  same?'
        );
        for (const d of r.reopenDetail[bucket].slice(0, 6)) {
            console.log(
                `  ${d.key.padEnd(18)}${String(d.patchOwner).slice(0, 27).padEnd(28)}` +
                `${String(d.patchOwnerDays ?? '-').padStart(4)}d   ` +
                `${String(d.fixOwner || '(still open)').slice(0, 27).padEnd(28)}` +
                `${String(d.fixOwnerDays ?? '-').padStart(4)}d  ${d.sameOwner ? 'same' : 'DIFFERENT'}`
            );
        }
    }

    await closeMongo();
})().catch(async (e) => {
    console.error('Failed:', e.message);
    await closeMongo().catch(() => undefined);
    process.exit(1);
});
