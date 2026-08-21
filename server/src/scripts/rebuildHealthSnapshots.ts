/**
 * Rebuild every daily issue snapshot from Jan 1 to today.
 *
 * Equivalent to the dashboard's "Reload Historical Data" button / POST /api/health/backfill,
 * but runnable without the API server so snapshots can be regenerated after a service change.
 *
 *   npx ts-node src/scripts/rebuildHealthSnapshots.ts
 */
import 'dotenv/config';
import { connectToMongo, closeMongo } from '../utils/mongo';
import { runBackfill } from '../services/healthSnapshot.service';

(async () => {
    await connectToMongo(process.env.MONGO_URI);
    const result = await runBackfill();
    console.log(`[HEALTH] Done — ${result.processed} issues processed, ${result.snapshots} snapshots written`);
    await closeMongo();
})().catch(async (e) => {
    console.error('[HEALTH] Rebuild failed:', e.message);
    await closeMongo().catch(() => undefined);
    process.exit(1);
});
