/**
 * Print the per-member analytics the Members Console renders.
 *
 *   npx ts-node src/scripts/checkMemberStats.ts
 */
import 'dotenv/config';
import { connectToMongo, closeMongo } from '../utils/mongo';
import { getMemberStats } from '../services/memberAnalytics.service';

(async () => {
    await connectToMongo(process.env.MONGO_URI);
    const r = await getMemberStats();
    const active = r.members.filter(m => m.fixed > 0 || m.openNow > 0);

    console.log(`members: ${r.members.length} | with activity: ${active.length} | window: ${r.windowDays}d`);
    console.log(
        '\n' + 'name'.padEnd(22) + 'fixed'.padStart(6) + 'med'.padStart(5) + 'p90'.padStart(5) +
        'open'.padStart(6) + 'stall'.padStart(6) + '/wk'.padStart(6) + 'clear'.padStart(7) + 'conf'.padStart(8)
    );
    for (const m of active.slice(0, 15)) {
        console.log(
            m.name.padEnd(22) +
            String(m.fixed).padStart(6) +
            String(m.medianFixDays ?? '-').padStart(5) +
            String(m.p90FixDays ?? '-').padStart(5) +
            String(m.openNow).padStart(6) +
            String(m.stalledNow).padStart(6) +
            String(m.fixesPerWeek ?? '-').padStart(6) +
            String(m.estDaysToClear ?? '-').padStart(7) +
            String(m.confidence).padStart(8)
        );
    }
    await closeMongo();
})().catch(async (e) => {
    console.error('Failed:', e.message);
    await closeMongo().catch(() => undefined);
    process.exit(1);
});
