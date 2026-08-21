import React, { useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
    Chart as ChartJS,
    CategoryScale, LinearScale, LineElement,
    PointElement, Title, Tooltip, Legend, Filler
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import { fetchMemberStats } from '../store/slice/healthSlice';
import { formatLabel, toBuckets } from '../utils/snapshotBuckets';

ChartJS.register(CategoryScale, LinearScale, LineElement, PointElement, Title, Tooltip, Legend, Filler);

const EMPTY_ROW = {
    assigned: 0, resolved: 0, reopened: 0,
    open: 0, inProgress: 0, reopenedOpen: 0, unresolved: 0, stalled: 0,
};

const ALL = '__all__';

function sumMembers(byMember) {
    const total = { ...EMPTY_ROW };
    for (const bucket of Object.values(byMember || {})) {
        if (!bucket || typeof bucket !== 'object') continue;
        for (const field of Object.keys(EMPTY_ROW)) total[field] += bucket[field] || 0;
    }
    return total;
}

function StatTile({ label, value, hint }) {
    return (
        <div className="health-member-stat">
            <div className="health-member-stat-value">{value ?? '—'}</div>
            <div className="health-member-stat-label">{label}</div>
            {hint && <div className="health-member-stat-hint">{hint}</div>}
        </div>
    );
}

export default function MembersConsole({ snapshots, teamUnresolved }) {
    const dispatch = useDispatch();
    const memberStats = useSelector((s) => s.health.memberStats);
    const memberStatsStatus = useSelector((s) => s.health.memberStatsStatus);
    const memberStatsMeta = useSelector((s) => s.health.memberStatsMeta);

    const [member, setMember] = useState(ALL);
    const [grouping, setGrouping] = useState('week');

    useEffect(() => {
        if (memberStatsStatus === 'idle') dispatch(fetchMemberStats());
    }, [dispatch, memberStatsStatus]);

    // Members that actually appear in the snapshot history
    const memberOptions = useMemo(() => {
        const seen = new Map();
        for (const s of snapshots) {
            for (const [name, bucket] of Object.entries(s.byMember || {})) {
                if (!bucket || typeof bucket !== 'object') continue;
                const prev = seen.get(name) || 0;
                seen.set(name, Math.max(prev, bucket.unresolved || 0));
            }
        }
        return [...seen.entries()]
            .map(([name, peak]) => ({ name, peak }))
            .sort((a, b) => b.peak - a.peak || a.name.localeCompare(b.name));
    }, [snapshots]);

    const selectedStats = useMemo(() => {
        if (member === ALL) return null;
        return memberStats.find(m => m.name === member) || null;
    }, [memberStats, member]);

    const chartData = useMemo(() => {
        if (!snapshots.length) return null;

        const rows = [...snapshots]
            .sort((a, b) => a.date.localeCompare(b.date))
            .map(s => {
                const source = member === ALL
                    ? sumMembers(s.byMember)
                    : (s.byMember?.[member] || EMPTY_ROW);
                return { date: s.date, ...EMPTY_ROW, ...source };
            });

        const buckets = toBuckets(rows, grouping);
        if (!buckets.length) return null;

        const pointRadius = grouping === 'day' ? 2 : 4;

        return {
            labels: buckets.map(b => formatLabel(b.key, grouping)),
            datasets: [
                {
                    label: 'Open',
                    data: buckets.map(b => b.stock.open),
                    borderColor: '#6366f1',
                    backgroundColor: 'rgba(99,102,241,0.10)',
                    fill: true, tension: 0.3, pointRadius,
                },
                {
                    label: 'In Progress',
                    data: buckets.map(b => b.stock.inProgress),
                    borderColor: '#0ea5e9',
                    backgroundColor: 'transparent',
                    fill: false, tension: 0.3, pointRadius,
                },
                {
                    label: 'Stalled (>7d idle)',
                    data: buckets.map(b => b.stock.stalled),
                    borderColor: '#ef4444',
                    backgroundColor: 'transparent',
                    fill: false, tension: 0.3, borderDash: [4, 4], pointRadius,
                },
                {
                    label: 'Resolved (in period)',
                    data: buckets.map(b => b.resolved),
                    borderColor: '#22c55e',
                    backgroundColor: 'transparent',
                    fill: false, tension: 0.3, pointRadius,
                },
                {
                    label: 'Assigned (in period)',
                    data: buckets.map(b => b.assigned),
                    borderColor: '#8b5cf6',
                    backgroundColor: 'transparent',
                    fill: false, tension: 0.3, borderDash: [2, 3], pointRadius,
                },
                {
                    label: 'Reopened (in period)',
                    data: buckets.map(b => b.reopened),
                    borderColor: '#f97316',
                    backgroundColor: 'transparent',
                    fill: false, tension: 0.3, pointRadius,
                },
            ],
        };
    }, [snapshots, member, grouping]);

    const options = {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
            legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 } } },
            tooltip: { callbacks: { title: (items) => items[0].label } },
        },
        scales: {
            x: { ticks: { maxTicksLimit: 20, font: { size: 10 } }, grid: { display: false } },
            y: { beginAtZero: true, ticks: { font: { size: 10 } } },
        },
    };

    const totals = useMemo(() => memberStats.reduce((acc, m) => ({
        fixed: acc.fixed + m.fixed,
        openNow: acc.openNow + m.openNow,
        stalledNow: acc.stalledNow + m.stalledNow,
        transferredOut: acc.transferredOut + (m.transferredOut || 0),
        almFixed: acc.almFixed + (m.almFixed || 0),
        jiraFixed: acc.jiraFixed + (m.jiraFixed || 0),
    }), { fixed: 0, openNow: 0, stalledNow: 0, transferredOut: 0, almFixed: 0, jiraFixed: 0 }), [memberStats]);

    return (
        <>
            <div className="health-project-controls">
                <select
                    className="health-select"
                    value={member}
                    onChange={(e) => setMember(e.target.value)}
                    aria-label="Filter by member"
                >
                    <option value={ALL}>All Members ({memberOptions.length})</option>
                    {memberOptions.map(m => (
                        <option key={m.name} value={m.name}>{m.name}</option>
                    ))}
                </select>
                <div className="health-period-toggle">
                    {['day', 'week', 'month'].map(g => (
                        <button
                            key={g}
                            className={`health-toggle-btn ${grouping === g ? 'active' : ''}`}
                            onClick={() => setGrouping(g)}
                        >
                            {g.charAt(0).toUpperCase() + g.slice(1)}
                        </button>
                    ))}
                </div>
            </div>

            <div className="health-member-stats">
                {member === ALL ? (
                    <>
                        <StatTile
                            label="Fixed (YTD)"
                            value={totals.fixed}
                            hint={totals.almFixed ? `${totals.jiraFixed} Jira · ${totals.almFixed} ALM` : 'Jira only'}
                        />
                        <StatTile
                            label="Open Now"
                            value={totals.openNow}
                            // The gap is issues currently held by someone outside the
                            // members collection — they cannot be attributed to anyone.
                            hint={teamUnresolved != null && teamUnresolved !== totals.openNow
                                ? `of ${teamUnresolved} team-wide`
                                : null}
                        />
                        <StatTile label="Stalled >7d" value={totals.stalledNow} />
                        <StatTile label="Transferred Out" value={totals.transferredOut} />
                        <StatTile label="Members Tracked" value={memberOptions.length} />
                    </>
                ) : selectedStats ? (
                    <>
                        <StatTile
                            label="Fixed (YTD)"
                            value={selectedStats.fixed}
                            hint={selectedStats.almFixed
                                ? `${selectedStats.jiraFixed} Jira · ${selectedStats.almFixed} ALM`
                                : 'Jira only'}
                        />
                        <StatTile
                            label="Median Fix Time"
                            value={selectedStats.medianFixDays != null ? `${selectedStats.medianFixDays}d` : '—'}
                            hint={selectedStats.p90FixDays != null ? `p90 ${selectedStats.p90FixDays}d · Jira` : 'Jira only'}
                        />
                        <StatTile
                            label="Median Cycle Time"
                            value={selectedStats.medianCycleDays != null ? `${selectedStats.medianCycleDays}d` : '—'}
                            hint="created → resolved · Jira + ALM"
                        />
                        <StatTile label="Open Now" value={selectedStats.openNow} hint={`${selectedStats.stalledNow} stalled`} />
                        <StatTile
                            label="Est. Days to Clear"
                            value={selectedStats.estDaysToClear != null ? `${selectedStats.estDaysToClear}d` : '—'}
                            hint={selectedStats.fixesPerWeek != null ? `${selectedStats.fixesPerWeek}/wk` : 'no recent fixes'}
                        />
                        <StatTile
                            label="Not a Bug / CNR"
                            value={selectedStats.notABug}
                            hint={`${selectedStats.reopenedAfterFix} reopened after fix`}
                        />
                        <StatTile
                            label="Transferred Out"
                            value={selectedStats.transferredOut}
                            hint={`of ${selectedStats.held} ever held`}
                        />
                        <StatTile label="Confidence" value={selectedStats.confidence} hint={`${memberStatsMeta?.windowDays ?? 60}d window`} />
                    </>
                ) : (
                    <div className="health-muted" style={{ fontSize: 12 }}>No stats recorded for this member yet.</div>
                )}
            </div>

            {chartData
                ? <div className="health-chart-wrap"><Line data={chartData} options={options} /></div>
                : <div className="health-empty">No member data available — run “Reload Historical Data”</div>
            }

            <div className="health-muted" style={{ fontSize: 11, marginTop: 8 }}>
                Fix time is calendar days from taking the issue to resolving it — bugs carry no
                worklog time, so waiting cannot be separated from effort. Forecast uses the last
                {' '}{memberStatsMeta?.windowDays ?? 60} days of fixes. ALM issues are imported from
                CSV exports and contribute fix counts and cycle time only — the chart, open workload,
                stalled counts and the forecast are Jira-only.
            </div>
        </>
    );
}
