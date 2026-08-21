import React, { useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { fetchMttrSamples } from '../store/slice/healthSlice';
import { buildProjectOptions, isRichBucket, ALL_PROJECTS } from '../utils/projects';

const EMPTY = { assigned: 0, resolved: 0, unresolved: 0 };

/** Totals across every project on a single date — stocks may be summed across
 *  projects because they are disjoint sets of issues on the same day. */
function sumProjects(byProject) {
    const total = { ...EMPTY };
    for (const bucket of Object.values(byProject || {})) {
        if (!isRichBucket(bucket)) continue;
        total.assigned += bucket.assigned || 0;
        total.resolved += bucket.resolved || 0;
        total.unresolved += bucket.unresolved || 0;
    }
    return total;
}

function bucketFor(snapshot, project) {
    if (project === ALL_PROJECTS) return sumProjects(snapshot.byProject);
    const b = snapshot.byProject?.[project];
    return isRichBucket(b) ? { assigned: b.assigned || 0, resolved: b.resolved || 0, unresolved: b.unresolved || 0 } : EMPTY;
}

export default function ProjectSprintTable({ snapshots, sprints }) {
    const dispatch = useDispatch();
    const mttrSamples = useSelector((s) => s.health.mttrSamples);
    const mttrStatus = useSelector((s) => s.health.mttrStatus);

    const [project, setProject] = useState(ALL_PROJECTS);

    useEffect(() => {
        if (mttrStatus === 'idle') dispatch(fetchMttrSamples());
    }, [dispatch, mttrStatus]);

    const projectOptions = useMemo(() => buildProjectOptions(snapshots), [snapshots]);

    const rows = useMemo(() => {
        if (!snapshots.length || !sprints.length) return [];

        const byDate = new Map(
            [...snapshots].sort((a, b) => a.date.localeCompare(b.date)).map(s => [s.date, s])
        );
        const dates = [...byDate.keys()].sort();

        const samples = project === ALL_PROJECTS
            ? mttrSamples
            : mttrSamples.filter(s => s.project === project);

        /** Stock carried at the end of the last snapshot on or before `date`. */
        const stockAsOf = (date) => {
            let candidate = null;
            for (const d of dates) {
                if (d > date) break;
                candidate = d;
            }
            return candidate ? bucketFor(byDate.get(candidate), project).unresolved : 0;
        };

        return sprints.map(sp => {
            let newIssues = 0;
            let resolved = 0;
            for (const [date, snap] of byDate) {
                if (date < sp.start || date > sp.end) continue;
                const b = bucketFor(snap, project);
                newIssues += b.assigned;
                resolved += b.resolved;
            }

            // "Open at start" is the state carried in, i.e. the end of the day before
            const dayBefore = new Date(`${sp.start}T00:00:00Z`);
            dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
            const openAtStart = stockAsOf(dayBefore.toISOString().slice(0, 10));
            const openAtEnd = stockAsOf(sp.end);

            const inSprint = samples.filter(s => s.resolvedAt >= sp.start && s.resolvedAt <= sp.end);
            const avgMttr = inSprint.length
                ? Number((inSprint.reduce((t, s) => t + s.days, 0) / inSprint.length).toFixed(1))
                : null;

            return {
                id: sp.id,
                sprint: sp.shortName,
                openAtStart,
                newIssues,
                resolved,
                openAtEnd,
                avgMttr,
                mttrSample: inSprint.length,
            };
        });
    }, [snapshots, sprints, project, mttrSamples]);

    const totals = useMemo(() => rows.reduce((acc, r) => ({
        newIssues: acc.newIssues + r.newIssues,
        resolved: acc.resolved + r.resolved,
    }), { newIssues: 0, resolved: 0 }), [rows]);

    return (
        <>
            <div className="health-project-controls">
                <select
                    className="health-select"
                    value={project}
                    onChange={(e) => setProject(e.target.value)}
                    aria-label="Filter by project"
                >
                    <option value={ALL_PROJECTS}>All Projects ({projectOptions.length})</option>
                    {projectOptions.map(p => (
                        <option key={p.key} value={p.key}>{p.name} ({p.key})</option>
                    ))}
                </select>
            </div>

            {!rows.length ? (
                <div className="health-empty">No sprint data available</div>
            ) : (
                <div className="health-table-wrap">
                    <table className="health-table">
                        <thead>
                            <tr>
                                <th>Sprint</th>
                                <th style={{ textAlign: 'right' }}>Open at Start</th>
                                <th style={{ textAlign: 'right' }}>New Issues</th>
                                <th style={{ textAlign: 'right' }}>Resolved Issues</th>
                                <th style={{ textAlign: 'right' }}>Open at End</th>
                                <th style={{ textAlign: 'right' }}>Average MTTR</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map(r => (
                                <tr key={r.id} className="health-table-row">
                                    <td><strong>{r.sprint}</strong></td>
                                    <td style={{ textAlign: 'right' }}>{r.openAtStart}</td>
                                    <td style={{ textAlign: 'right' }}>{r.newIssues}</td>
                                    <td style={{ textAlign: 'right' }}>{r.resolved}</td>
                                    <td style={{ textAlign: 'right' }}>{r.openAtEnd}</td>
                                    <td style={{ textAlign: 'right' }} title={r.mttrSample ? `${r.mttrSample} issue(s)` : 'no issues resolved'}>
                                        {r.avgMttr != null ? `${r.avgMttr}d` : '—'}
                                    </td>
                                </tr>
                            ))}
                            <tr className="health-table-row">
                                <td><strong>Total</strong></td>
                                <td style={{ textAlign: 'right' }} className="health-muted">—</td>
                                <td style={{ textAlign: 'right' }}><strong>{totals.newIssues}</strong></td>
                                <td style={{ textAlign: 'right' }}><strong>{totals.resolved}</strong></td>
                                <td style={{ textAlign: 'right' }} className="health-muted">—</td>
                                <td style={{ textAlign: 'right' }} className="health-muted">—</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            )}

            <div className="health-muted" style={{ fontSize: 11, marginTop: 8 }}>
                MTTR is the mean time an engineer held each issue before resolving it
                (assigned → resolved, calendar days), averaged over the issues resolved in
                that sprint. Open at Start is the state carried in from the previous day.
                Jira issues only — ALM imports have no assignment history.
            </div>
        </>
    );
}
