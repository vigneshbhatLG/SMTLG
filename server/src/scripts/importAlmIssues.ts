/**
 * Import closed ALM issues from CSV exports into the `issueOutcomes` ledger.
 *
 *   npx ts-node src/scripts/importAlmIssues.ts --dry     # report only, no writes
 *   npx ts-node src/scripts/importAlmIssues.ts           # write
 *
 * ALM issues cannot be reached through the Jira API, so they are exported by hand.
 * The exports only carry assignee, id, title, created and a resolved/fixed date —
 * no status history — so every row lands as a closed "fixed" record and contributes
 * only to fix counts and created→resolved time. They never affect open workload,
 * stalled detection, reopen counts or the backlog forecast.
 *
 * Drop the CSVs in server/data (gitignored) and run. Re-running is idempotent:
 * records are upserted on the issue id.
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { connectToMongo, closeMongo, getMongoDb } from '../utils/mongo';
import { parseCsvRecords } from '../utils/csv';
import { LEAD_ASSIGNEES } from '../constants/leads';
import { resolveAlias } from '../constants/memberAliases';

const DATA_DIR = path.resolve(__dirname, '../../data');
const OUTCOME_COLLECTION = 'issueOutcomes';

/** Leads are attached for oversight rather than doing the fix — shared with the report. */
const EXCLUDED_ASSIGNEES = LEAD_ASSIGNEES;

/** First non-empty column wins — the exports disagree on which one is populated. */
const RESOLVED_COLUMNS = ['Fixed Date', 'Resolved Date', 'Fixed Dt', 'Fixed Dated', 'Resolved Date (2)'];
const CREATED_COLUMNS = ['Created'];
const ID_COLUMNS = ['ID'];
const TITLE_COLUMNS = ['Title'];
const ASSIGNEE_COLUMNS = ['Assignee(s)'];

function firstValue(rec: Record<string, string>, columns: string[]): string {
    for (const c of columns) {
        const v = rec[c];
        if (v && v.trim()) return v.trim();
    }
    return '';
}

/** "2026-01-27 11:17" → "2026-01-27" */
function toDay(raw: string): string | null {
    const m = raw.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (!m) return null;
    const [, y, mo, d] = m;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

function diffDays(later: string, earlier: string): number {
    const a = Date.parse(`${later}T00:00:00Z`);
    const b = Date.parse(`${earlier}T00:00:00Z`);
    if (Number.isNaN(a) || Number.isNaN(b)) return 0;
    return Math.floor((a - b) / 86400000);
}

/**
 * Assignees look like "Satish Singh satish.singh, Preetham S preetham.s".
 * The username is the trailing dotted token of each comma-separated segment.
 */
function extractUsernames(raw: string): string[] {
    const out: string[] = [];
    for (const segment of raw.split(',')) {
        const tokens = segment.trim().split(/\s+/).filter(Boolean);
        for (let i = tokens.length - 1; i >= 0; i--) {
            const t = tokens[i].toLowerCase();
            // Retired usernames resolve to the member's current account
            if (/^[a-z][a-z0-9_-]*\.[a-z0-9._-]+$/.test(t)) { out.push(resolveAlias(t)); break; }
        }
    }
    return [...new Set(out)];
}

(async () => {
    const dryRun = process.argv.includes('--dry');

    if (!fs.existsSync(DATA_DIR)) {
        console.error(`No data directory at ${DATA_DIR} — put the CSV exports there.`);
        process.exit(1);
    }
    const files = fs.readdirSync(DATA_DIR).filter(f => f.toLowerCase().endsWith('.csv'));
    if (!files.length) {
        console.error(`No CSV files in ${DATA_DIR}`);
        process.exit(1);
    }

    await connectToMongo(process.env.MONGO_URI);
    const db = getMongoDb();
    const memberDocs = await db.collection('members').find({}, { projection: { name: 1, teamId: 1 } }).toArray();
    const teamOf = new Map<string, number | null>(
        memberDocs.map((d: any) => [d.name, d.teamId != null ? Number(d.teamId) : null])
    );

    const records: any[] = [];
    const unknownAssignees = new Map<string, number>();
    let skippedNoDate = 0;
    let skippedNoAssignee = 0;
    let multiAssignee = 0;

    for (const file of files) {
        const rows = parseCsvRecords(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'));
        let imported = 0;

        for (const rec of rows) {
            const id = firstValue(rec, ID_COLUMNS);
            if (!id) continue;

            const resolvedAt = toDay(firstValue(rec, RESOLVED_COLUMNS));
            if (!resolvedAt) { skippedNoDate++; continue; }

            const created = toDay(firstValue(rec, CREATED_COLUMNS)) || resolvedAt;

            const all = extractUsernames(firstValue(rec, ASSIGNEE_COLUMNS));
            const candidates = all.filter(u => !EXCLUDED_ASSIGNEES.has(u));

            // Anyone left who isn't a known member is reported, never silently dropped
            const known = candidates.filter(u => teamOf.has(u));
            for (const u of candidates) {
                if (!teamOf.has(u)) unknownAssignees.set(u, (unknownAssignees.get(u) || 0) + 1);
            }
            if (!known.length) { skippedNoAssignee++; continue; }
            if (known.length > 1) multiAssignee++;

            // Credit the first remaining member; the rest are recorded as holders so
            // the issue is still counted once, not once per person.
            const resolvedBy = known[0];

            records.push({
                key: id,
                source: 'alm',
                project: (rec['Project name'] || file.replace(/\.csv$/i, '')).slice(0, 120),
                projectName: rec['Project name'] || file.replace(/\.csv$/i, ''),
                title: firstValue(rec, TITLE_COLUMNS).slice(0, 300),
                created,
                firstAssignedDate: created,
                firstAssignee: resolvedBy,
                resolvedAt,
                resolvedBy,
                resolvedByTeamId: teamOf.get(resolvedBy) ?? null,
                // ALM exports carry no assignment history, so only created→resolved
                // is knowable. The Jira-only assigned→resolved metrics stay null.
                teamCycleTimeDays: null,
                ownerCycleTimeDays: null,
                createdToResolvedDays: Math.max(diffDays(resolvedAt, created), 0),
                ageDays: null,
                outcome: 'fixed',
                resolution: rec['Defect Resolution'] || '',
                holders: known,
                transferredOutBy: [],
                currentAssignee: resolvedBy,
                currentAssigneeTeamId: teamOf.get(resolvedBy) ?? null,
                currentStatus: rec['Status'] || 'Closed',
                statusCategory: 'resolved',
                isOpen: false,
                reopenCount: 0,
                dueDateChangeCount: 0,
                transferCount: 0,
                sourceFile: file,
                updatedAt: new Date(),
            });
            imported++;
        }
        console.log(`  ${file}: ${rows.length} rows → ${imported} importable`);
    }

    console.log(`\nimportable records : ${records.length}`);
    console.log(`skipped (no date)  : ${skippedNoDate}`);
    console.log(`skipped (no member): ${skippedNoAssignee}`);
    console.log(`rows with >1 member: ${multiAssignee} (credited to the first, all listed in holders)`);

    if (unknownAssignees.size) {
        console.log(`\nUnrecognised assignees — NOT imported, add to the members collection if they belong:`);
        [...unknownAssignees.entries()].sort((a, b) => b[1] - a[1])
            .forEach(([u, n]) => console.log(`  ${String(n).padStart(4)}  ${u}`));
    }

    const perMember = new Map<string, number>();
    for (const r of records) perMember.set(r.resolvedBy, (perMember.get(r.resolvedBy) || 0) + 1);
    console.log(`\nALM fixes per member (${perMember.size} members):`);
    [...perMember.entries()].sort((a, b) => b[1] - a[1])
        .forEach(([m, n]) => console.log(`  ${String(n).padStart(4)}  ${m}`));

    if (dryRun) {
        console.log('\n--dry: nothing written.');
    } else if (records.length) {
        await db.collection(OUTCOME_COLLECTION).bulkWrite(
            records.map(r => ({ replaceOne: { filter: { key: r.key }, replacement: r, upsert: true } })),
            { ordered: false }
        );
        console.log(`\nWrote ${records.length} ALM records to ${OUTCOME_COLLECTION}.`);

        // Every CSV in the folder is read on each run, so this import is the complete
        // ALM picture. Rows that stop being importable — an assignee reclassified as a
        // lead, a row removed from the export — must not linger as stale credit.
        const importedKeys = new Set(records.map(r => r.key));
        const existing = await db.collection(OUTCOME_COLLECTION)
            .find({ source: 'alm' }, { projection: { key: 1 } })
            .toArray();
        const orphaned = existing
            .map((d: any) => d.key)
            .filter((key: string) => !importedKeys.has(key));

        if (orphaned.length) {
            const { deletedCount } = await db.collection(OUTCOME_COLLECTION)
                .deleteMany({ source: 'alm', key: { $in: orphaned } });
            console.log(`Removed ${deletedCount} ALM record(s) that are no longer importable.`);
        }
    }

    await closeMongo();
})().catch(async (e) => {
    console.error('Import failed:', e.message);
    await closeMongo().catch(() => undefined);
    process.exit(1);
});
