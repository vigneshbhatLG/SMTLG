/**
 * Print the Sprint Analysis Report data for one sprint.
 *
 *   npx ts-node src/scripts/checkSprintLoad.ts [start] [end]
 */
import 'dotenv/config';
import { connectToMongo, closeMongo } from '../utils/mongo';
import { getSprintMemberLoad } from '../services/memberAnalytics.service';

const start = process.argv[2] || '2026-07-20';
const end = process.argv[3] || '2026-08-02';

(async () => {
    await connectToMongo(process.env.MONGO_URI);
    const { members, totals, reopens } = await getSprintMemberLoad(start, end);

    console.log(`Sprint ${start} → ${end} · ${members.length} members active`);
    console.log(`delivery: assigned ${totals.assigned} | resolved ${totals.resolved} | open at end ${totals.openAtEnd}`);
    console.log(
        `\nreopens: total ${reopens.total}\n` +
        `  after fix (ours)      ${reopens.afterFix}\n` +
        `  other (triage)        ${reopens.other}\n` +
        `  outside (other team)  ${reopens.outside}\n` +
        `  unclassified          ${reopens.unknown}\n` +
        `  repeat                ${reopens.repeat}\n` +
        `  rework rate           ${reopens.reworkRate}%  (${reopens.afterFix} of ${totals.resolved} resolved)`
    );

    console.log('\n' + 'member'.padEnd(24) + 'asgn'.padStart(5) + 'resv'.padStart(5) +
        'open'.padStart(5) + 'mttr'.padStart(6) + 'load'.padStart(6) + 'bounced'.padStart(8) + 'rework'.padStart(8));
    for (const m of members.slice(0, 12)) {
        console.log(
            m.name.padEnd(24) + String(m.assigned).padStart(5) + String(m.resolved).padStart(5) +
            String(m.openAtEnd).padStart(5) + String(m.avgMttr ?? '-').padStart(6) +
            String(m.loadScore).padStart(6) + String(m.reopensCaused).padStart(8) +
            String(m.reworkRate != null ? m.reworkRate + '%' : '-').padStart(8)
        );
    }

    if (reopens.worstIssues.length) {
        console.log('\nissues reopened more than once this sprint:');
        for (const i of reopens.worstIssues) console.log(`  ${i.key.padEnd(18)} ×${i.times}  ${i.owner}`);
    }
    await closeMongo();
})().catch(async (e) => {
    console.error('Failed:', e.message);
    await closeMongo().catch(() => undefined);
    process.exit(1);
});
