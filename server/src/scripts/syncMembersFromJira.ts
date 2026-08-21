/**
 * Add team members missing from the `members` collection.
 *
 *   npx ts-node src/scripts/syncMembersFromJira.ts --dry   # report only
 *   npx ts-node src/scripts/syncMembersFromJira.ts         # write
 *
 * The group-membership endpoint needs Jira admin rights, so membership is derived
 * from the issues instead: BASE_JQL already filters `assignee in membersOf(group)`,
 * so every assignee on those issues is a group member by definition.
 *
 * Anything the analytics touches keys off this collection — a member missing from it
 * has their issues dropped entirely, which is why our totals ran below Jira's.
 * Rows are added with a null team; team assignment stays a manual decision.
 */
import 'dotenv/config';
import { connectToMongo, closeMongo, getMongoDb } from '../utils/mongo';
import { MEMBER_ALIASES, resolveAlias } from '../constants/memberAliases';

const BASE = 'http://jira.lge.com/issue';
const GROUP_JQL =
    'assignee in membersOf("LGSI MS System App Solution(11018653)_grp") ' +
    'AND type = Bug AND createdDate >= "2026/01/01"';

(async () => {
    const dryRun = process.argv.includes('--dry');
    await connectToMongo(process.env.MONGO_URI);
    const db = getMongoDb();

    const config = await db.collection('cronConfig').findOne({ enabled: { $ne: false } });
    if (!config?.token) throw new Error('No enabled cron config with a token');

    const existing = await db.collection('members').find({}, { projection: { name: 1 } }).toArray();
    const have = new Set(existing.map((m: any) => m.name));

    const headers = {
        Authorization: `Bearer ${config.token}`,
        Cookie: process.env.JIRA_COOKIE || '',
        Accept: 'application/json',
        'Content-Type': 'application/json',
    };

    const seen = new Map<string, { name: string; displayName: string; issues: number }>();
    let startAt = 0;
    while (true) {
        const res = await fetch(`${BASE}/rest/api/2/search`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ jql: GROUP_JQL, fields: ['assignee'], startAt, maxResults: 100 }),
        });
        if (!res.ok) throw new Error(`Jira search failed: ${res.status}`);
        const page: any = await res.json();
        for (const issue of (page.issues || [])) {
            const a = issue.fields?.assignee;
            if (!a?.name) continue;
            const prev = seen.get(a.name);
            seen.set(a.name, {
                name: a.name,
                displayName: a.displayName || a.name,
                issues: (prev?.issues || 0) + 1,
            });
        }
        startAt += 100;
        if (startAt >= page.total) break;
    }

    const all = [...seen.values()].sort((a, b) => b.issues - a.issues);

    // Retired accounts already resolve to a current member — adding them would split
    // one person's history across two rows.
    const aliased = all.filter(u => MEMBER_ALIASES[u.name]);
    const missing = all.filter(u => !MEMBER_ALIASES[u.name] && !have.has(resolveAlias(u.name)));

    console.log(`assignees on 2026 bugs : ${all.length}`);
    console.log(`already in members     : ${all.length - missing.length - aliased.length}`);
    console.log(`resolved via alias     : ${aliased.length} (${aliased.map(a => a.name).join(', ') || 'none'})`);
    console.log(`to add                 : ${missing.length}\n`);

    for (const u of missing) {
        console.log(`  ${String(u.issues).padStart(4)}  ${u.name.padEnd(24)} ${u.displayName}`);
    }

    // Same surname, different account — likely a rename rather than a new person
    const suspects = missing.filter(u => {
        const surname = u.name.split('.').pop();
        return existing.some((m: any) => m.name !== u.name && m.name.split('.').pop() === surname);
    });
    if (suspects.length) {
        console.log('\nPossible renames — check before treating these as new people:');
        for (const u of suspects) {
            const surname = u.name.split('.').pop();
            const matches = existing.filter((m: any) => m.name !== u.name && m.name.split('.').pop() === surname);
            console.log(`  ${u.name}  ~  ${matches.map((m: any) => m.name).join(', ')}`);
        }
        console.log('  If they are the same person, add them to constants/memberAliases.ts instead.');
    }

    if (dryRun) {
        console.log('\n--dry: nothing written.');
    } else if (missing.length) {
        await db.collection('members').insertMany(missing.map(u => ({
            name: u.name,
            displayName: u.displayName,
            role: null,
            teamId: null,
            source: 'jira-assignee-sync',
            addedAt: new Date(),
        })));
        console.log(`\nAdded ${missing.length} member(s). Set teamId on them to include them in team charts.`);
    }

    await closeMongo();
})().catch(async (e) => {
    console.error('Sync failed:', e.message);
    await closeMongo().catch(() => undefined);
    process.exit(1);
});
