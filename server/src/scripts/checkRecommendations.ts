/**
 * Preview the "How To Improve Next Sprint" lines for a sprint.
 *
 *   npx ts-node src/scripts/checkRecommendations.ts [start] [end]
 */
import 'dotenv/config';
import { connectToMongo, closeMongo } from '../utils/mongo';
import { getSprintMemberLoad, getSprintCohorts } from '../services/memberAnalytics.service';

const start = process.argv[2] || '2026-07-20';
const end = process.argv[3] || '2026-08-03';

(async () => {
    await connectToMongo(process.env.MONGO_URI);
    const { members, totals, reopens } = await getSprintMemberLoad(start, end);
    const [sprint] = await getSprintCohorts([{ id: 15, shortName: 'Sprint', start, end }]) as any[];

    const out: string[] = [];
    if (reopens.reworkRate != null && reopens.reworkRate >= 10) {
        out.push(`Rework is high at ${reopens.reworkRate}% — ${reopens.afterFix} of the team's own fixes came back.`);
    }
    if (reopens.repeat > 0) {
        const w = reopens.worstIssues[0];
        out.push(`${reopens.repeat} reopen(s) on issues that had already bounced${w ? `, worst ${w.key} (×${w.times}, ${w.owner})` : ''}.`);
    }
    const net = totals.resolved - totals.assigned;
    if (net < 0) out.push(`Intake outpaced closure by ${Math.abs(net)}; backlog grew to ${sprint.carryFwdTotal}.`);
    const stalled = members.reduce((t, m) => t + m.stalledAtEnd, 0);
    if (stalled > 0) out.push(`${stalled} issue(s) untouched for over 7 days.`);

    const active = members.filter(m => m.loadScore > 0);
    if (active.length >= 4) {
        const top = active[0];
        const med = [...active].sort((a, b) => a.loadScore - b.loadScore)[Math.floor(active.length / 2)];
        if (med.loadScore > 0 && top.loadScore >= med.loadScore * 2.5) {
            out.push(`Load uneven — ${top.name} carried ${top.loadScore} against a median of ${med.loadScore}.`);
        }
    }
    const heavy = members.filter(m => m.resolved >= 5 && (m.reworkRate ?? 0) >= 20);
    if (heavy.length) out.push(`Over 20% rework: ${heavy.map(m => m.name).join(', ')}.`);
    if (!out.length) out.push('No systemic issues stood out this sprint.');

    console.log(`Sprint ${start} → ${end}`);
    console.log(`inputs: rework ${reopens.reworkRate}% | repeat ${reopens.repeat} | net ${net} | stalled ${stalled}\n`);
    out.forEach(l => console.log('  • ' + l));
    await closeMongo();
})().catch(async (e) => {
    console.error('Failed:', e.message);
    await closeMongo().catch(() => undefined);
    process.exit(1);
});
