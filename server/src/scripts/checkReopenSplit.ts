/**
 * Confirm the reopen splits reconcile: the table's Our Team + Outside must equal
 * After Fix, and the dashboard cards must sum to Total Reopened.
 *
 *   npx ts-node src/scripts/checkReopenSplit.ts
 */
import 'dotenv/config';
import { connectToMongo, closeMongo, getMongoDb } from '../utils/mongo';
import { getSprintCohorts } from '../services/memberAnalytics.service';

(async () => {
    await connectToMongo(process.env.MONGO_URI);

    const rows: any[] = await getSprintCohorts([
        { id: 15, shortName: 'S15', start: '2026-07-20', end: '2026-08-03' },
    ]);
    const r = rows[0];
    const sprintSum = r.reopenAfterFix + r.reopenOther + r.reopenOutside;
    console.log('Sprint 15 table:');
    console.log(`  After Fix ${r.reopenAfterFix} + Other ${r.reopenOther} + Outside ${r.reopenOutside} = ${sprintSum}`);
    console.log(`  Total ${r.reopened}  -> ${sprintSum === r.reopened ? 'OK' : `gap ${r.reopened - sprintSum} unclassified`}`);
    console.log(`  Repeat ${r.reopenRepeat} (cuts across the three above)`);

    const snaps = await getMongoDb().collection('dailyIssueSnapshots').find({}).toArray();
    const t = snaps.reduce((a: any, s: any) => ({
        total: a.total + (s.reopenedCount || 0),
        af: a.af + (s.reopenAfterFixCount || 0),
        oth: a.oth + (s.reopenOtherCount || 0),
        out: a.out + (s.reopenOutsideCount || 0),
    }), { total: 0, af: 0, oth: 0, out: 0 });

    const ytd = t.af + t.oth + t.out;
    console.log('\nYTD dashboard cards:');
    console.log(`  After Fix ${t.af} + Other ${t.oth} + Outside ${t.out} = ${ytd}`);
    console.log(`  Total Reopened ${t.total}  -> ${ytd === t.total ? 'OK' : 'MISMATCH'}`);

    await closeMongo();
})().catch(async (e) => {
    console.error('Failed:', e.message);
    await closeMongo().catch(() => undefined);
    process.exit(1);
});
