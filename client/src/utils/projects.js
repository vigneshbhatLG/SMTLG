/**
 * Project dropdown ordering, shared by the project chart and the sprint table.
 *
 * Keyed by Jira project key — keys are stable, display names vary in spacing and
 * locale. Any project found in the snapshots that isn't listed here still appears,
 * after these, ranked by volume.
 */
export const PRIORITY_PROJECTS = [
    ['QETEST', 'QE TEST'],
    ['QEVENTTF', 'Q EVENT 24(webOS24)'],
    ['QEVENTTG', 'Q EVENT 25'],
    ['QEVENTTH', 'Q EVENT 26'],
    ['DITTEST', 'DIT TEST 현황'],
    ['QEVENTSIT', 'SIT Issue Management'],
    ['RITTEST', 'RIT TEST현황'],
    ['TVCSISSUE', 'TV CS Issue 관리'],
    ['TVHWQ', 'TV HW TEST 20'],
    ['WEBOSMXPR', 'webOS LGE Corporate Event'],
    ['ITQEVENTA', 'IT Q EVENT 26'],
    ['QEVENTTWTT', 'Q EVENT 23 (webOS23)'],
    ['INQAISSUE', 'LGEIN QA Issue Management Project'],
    ['QEVENTTWT', 'Q Event 22'],
];

const PRIORITY_RANK = new Map(PRIORITY_PROJECTS.map(([key], i) => [key, i]));
const PRIORITY_NAME = new Map(PRIORITY_PROJECTS);

export const ALL_PROJECTS = 'all';

/** Snapshots written before per-project status tracking stored a bare count. */
export const isRichBucket = (v) => v && typeof v === 'object';

export function rankOf(option) {
    const rank = PRIORITY_RANK.get(option.key);
    return rank !== undefined ? rank : PRIORITY_PROJECTS.length;
}

/** Every project present across the snapshots, configured ones first then by volume. */
export function buildProjectOptions(snapshots) {
    const seen = new Map();
    for (const s of snapshots) {
        for (const [key, bucket] of Object.entries(s.byProject || {})) {
            if (!isRichBucket(bucket)) continue;
            const prev = seen.get(key);
            const peak = Math.max(prev?.peak || 0, bucket.unresolved || 0);
            seen.set(key, { key, name: bucket.name || PRIORITY_NAME.get(key) || key, peak });
        }
    }
    return [...seen.values()].sort((a, b) => {
        const ra = rankOf(a);
        const rb = rankOf(b);
        if (ra !== rb) return ra - rb;
        if (b.peak !== a.peak) return b.peak - a.peak;
        return a.name.localeCompare(b.name);
    });
}
