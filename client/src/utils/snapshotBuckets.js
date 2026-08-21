/**
 * Shared period-bucketing helpers for the health snapshot charts.
 *
 * Snapshots carry two kinds of number and they aggregate differently:
 *  - flow  (assigned / resolved / reopened) counts events that happened on that date → summed
 *  - stock (open / inProgress / reopened / stalled) is the status issues were actually
 *    in at the end of that date → never summed, always the last day of the bucket
 */

export function bucketKey(date, grouping) {
    if (grouping === 'month') return date.slice(0, 7);
    if (grouping === 'week') {
        const d = new Date(`${date}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() - d.getUTCDay());
        return d.toISOString().slice(0, 10);
    }
    return date;
}

export function formatLabel(key, grouping) {
    if (grouping === 'month') {
        const [y, m] = key.split('-');
        return new Date(y, m - 1).toLocaleString('default', { month: 'short', year: '2-digit' });
    }
    if (grouping === 'week') return `W/o ${key.slice(5)}`;
    return key.slice(5); // MM-DD
}

/** All dates between start and end inclusive, as YYYY-MM-DD. */
export function dateRange(start, end) {
    const dates = [];
    const cur = new Date(`${start}T00:00:00Z`);
    const last = new Date(`${end}T00:00:00Z`);
    while (cur <= last) {
        dates.push(cur.toISOString().slice(0, 10));
        cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return dates;
}

const ZERO_STOCK = { open: 0, inProgress: 0, reopenedOpen: 0, resolvedTotal: 0, unresolved: 0, stalled: 0 };

/**
 * Collapse dated rows into period buckets: flows summed, stocks taken from the
 * bucket's last day. Rows must carry `date`, the flow fields, and the stock fields.
 */
export function toBuckets(rows, grouping) {
    const map = new Map();
    for (const r of rows) {
        const key = bucketKey(r.date, grouping);
        const b = map.get(key) || { key, assigned: 0, resolved: 0, reopened: 0, lastDate: null, stock: ZERO_STOCK };
        b.assigned += r.assigned;
        b.resolved += r.resolved;
        b.reopened += r.reopened;
        if (!b.lastDate || r.date >= b.lastDate) {
            b.lastDate = r.date;
            b.stock = r;
        }
        map.set(key, b);
    }
    return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export { ZERO_STOCK };
