import React, { useEffect, useState, useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { fetchHealthSnapshots, fetchOpenIssues, triggerBackfill, resetBackfill, deleteSnapshots } from '../store/slice/healthSlice';
import { loadSavedAnalysis } from '../store/slice/aiAnalysisSlice';
import IssueFlowChart from '../components/IssueFlowChart.jsx';
import ProjectIssueChart from '../components/ProjectIssueChart.jsx';
// Hidden for now — re-enable together with their cards below
// import MembersConsole from '../components/MembersConsole.jsx';
// import ProjectSprintTable from '../components/ProjectSprintTable.jsx';
import SprintReviewMetrics from '../components/SprintReviewMetrics.jsx';
import TeamComparisonChart from '../components/TeamComparisonChart.jsx';
import OpenIssuesTable from '../components/OpenIssuesTable.jsx';
import './css/healthDashboard.css';

const TEAM_NAMES = {
    0: 'Smart Media & Connectivity',
    1: 'Home Experience & Input Apps',
    2: 'Multiscreen & CH Apps',
    3: 'Core System Apps',
};

const today = new Date().toISOString().slice(0, 10);
const currentYear = new Date().getFullYear();
const janFirst = `${currentYear}-01-01`;

// Members Console is a preview — everyone else sees "coming soon".
// const MEMBERS_CONSOLE_PREVIEW_USERS = ['preetham.s'];

const sprintNumber = (s) => Number((String(s?.name || '').match(/SP\s*(\d+)/i) || [])[1] || 0);

// "2026_IR3SP15(7/7-7/20)" → "Sprint 15"
const sprintShortName = (s) => {
    const match = String(s?.name || '').match(/SP(\d+)/i) || String(s?.name || '').match(/Sprint\s*(\d+)/i);
    return match ? `Sprint ${Number(match[1])}` : String(s?.name || '').split('(')[0].trim();
};

// Sprints are ordered by start date. Names like "2026_IR3SP01(1/5-1/16)" carry the
// sprint number, which is used as the fallback ordering when a start date is missing.
const sprintSortKey = (s) => {
    const raw = s?.startDate || s?.endDate || s?.completeDate;
    const t = raw ? new Date(raw).getTime() : NaN;
    if (!Number.isNaN(t)) return t;
    return Date.UTC(currentYear, 0, 1) + Math.max(sprintNumber(s) - 1, 0) * 14 * 86400000;
};

const sprintYear = (s) => {
    const raw = s?.startDate || s?.endDate || s?.completeDate;
    if (raw) {
        const y = new Date(raw).getFullYear();
        if (!Number.isNaN(y)) return y;
    }
    const m = String(s?.name || '').match(/(20\d{2})/);
    return m ? Number(m[1]) : null;
};

export default function HealthDashboard() {
    const dispatch = useDispatch();
    const snapshots = useSelector((s) => s.health.snapshots);
    const snapshotsStatus = useSelector((s) => s.health.snapshotsStatus);
    const openIssues = useSelector((s) => s.health.openIssues);
    const openIssuesStatus = useSelector((s) => s.health.openIssuesStatus);
    const backfillStatus = useSelector((s) => s.health.backfillStatus);
    const backfillResult = useSelector((s) => s.health.backfillResult);

    const sprints = useSelector((s) => s.sprint.items);
    // Gate for the hidden Members Console — restore with its card below
    // const currentUser = useSelector((s) => s.auth.user);
    // const canSeeMembersConsole = useMemo(() => {
    //     const name = String(currentUser?.name || '').toLowerCase();
    //     return MEMBERS_CONSOLE_PREVIEW_USERS.includes(name);
    // }, [currentUser]);
    const [period, setPeriod] = useState('day');
    const [selectedSprintId, setSelectedSprintId] = useState(null);
    const [activeTeam, setActiveTeam] = useState('all');

    const [showAllSprints, setShowAllSprints] = useState(false);

    // This year's sprints (closed + active), oldest first so "All Sprints" starts at Sprint 01.
    // Falls back to every sprint if none carry a parseable year.
    const allSprints = useMemo(() => {
        const usable = sprints.filter(s => s.state === 'closed' || s.state === 'active');
        const thisYear = usable.filter(s => sprintYear(s) === currentYear);
        return (thisYear.length ? thisYear : usable).sort((a, b) => sprintSortKey(a) - sprintSortKey(b));
    }, [sprints]);

    // Show the 5 most recent, or the whole year, based on toggle
    const visibleSprints = useMemo(() => {
        return showAllSprints ? allSprints : allSprints.slice(-5);
    }, [allSprints, showAllSprints]);

    // Sprint mode opens on the all-sprints overview; picking a sprint drills into it
    const handlePeriodChange = (p) => {
        setPeriod(p);
        if (p === 'sprint') setSelectedSprintId(null);
    };

    // Sprint date ranges for the overview chart — only sprints that have both ends
    const sprintRanges = useMemo(() => allSprints
        .map(s => ({
            id: s.id,
            shortName: sprintShortName(s),
            start: s.startDate?.slice(0, 10),
            end: (s.endDate || s.completeDate)?.slice(0, 10),
        }))
        .filter(s => s.start && s.end),
        [allSprints]
    );

    const selectedSprint = useMemo(() =>
        allSprints.find(s => String(s.id) === selectedSprintId) || null,
        [allSprints, selectedSprintId]
    );
    const [openIssuesExpanded, setOpenIssuesExpanded] = useState(false);
    const [openIssuesCollapsing, setOpenIssuesCollapsing] = useState(false);

    const handleToggleExpand = () => {
        if (openIssuesExpanded) {
            // play collapse animation then actually collapse
            setOpenIssuesCollapsing(true);
            setTimeout(() => {
                setOpenIssuesExpanded(false);
                setOpenIssuesCollapsing(false);
            }, 300);
        } else {
            setOpenIssuesExpanded(true);
        }
    };

    useEffect(() => {
        if (snapshotsStatus === 'idle') {
            dispatch(fetchHealthSnapshots({ from: janFirst, to: today }));
        }
        if (openIssuesStatus === 'idle') {
            dispatch(fetchOpenIssues());
        }
    }, [dispatch, snapshotsStatus, openIssuesStatus]);

    // Once open issues load, fetch their saved analysis results from MongoDB
    useEffect(() => {
        if (openIssues.length > 0) {
            const keys = openIssues.map(i => i.key);
            dispatch(loadSavedAnalysis(keys));
        }
    }, [openIssues, dispatch]);

    // When in sprint mode with a selected sprint, compute stats only for that sprint's date range
    const activeSnapshots = useMemo(() => {
        if (period === 'sprint' && selectedSprint) {
            const start = selectedSprint.startDate?.slice(0, 10);
            const end = (selectedSprint.endDate || selectedSprint.completeDate)?.slice(0, 10);
            if (start && end) return snapshots.filter(s => s.date >= start && s.date <= end);
        }
        return snapshots;
    }, [snapshots, period, selectedSprint]);

    // Flow metrics (assigned/resolved/reopened) sum over the range; stock metrics
    // (stalled, open, in progress) describe a point in time, so they come from the
    // most recent snapshot in the range rather than being summed across days.
    const stats = useMemo(() => {
        const empty = {
            total: 0, stalled: 0, reopened: 0, resolved: 0, open: 0, inProgress: 0, unresolved: 0,
            reopenAfterFix: 0, reopenOutside: 0, reopenOther: 0, reopenRepeat: 0,
        };
        if (!activeSnapshots.length) return empty;

        const flows = activeSnapshots.reduce((acc, s) => {
            const teams = Object.values(s.byTeam || {});
            return {
                total: acc.total + (s.assignedCount ?? s.totalCount ?? 0),
                reopened: acc.reopened + (s.reopenedCount ?? teams.reduce((t, v) => t + (v.reopened || 0), 0)),
                resolved: acc.resolved + (s.resolvedCount ?? teams.reduce((t, v) => t + (v.resolved || 0), 0)),
                // Reopens by category — After Fix, Other and Outside are exclusive
                reopenAfterFix: acc.reopenAfterFix + (s.reopenAfterFixCount || 0),
                reopenOutside: acc.reopenOutside + (s.reopenOutsideCount || 0),
                reopenOther: acc.reopenOther + (s.reopenOtherCount || 0),
                reopenRepeat: acc.reopenRepeat + (s.reopenRepeatCount || 0),
            };
        }, {
            total: 0, reopened: 0, resolved: 0,
            reopenAfterFix: 0, reopenOutside: 0, reopenOther: 0, reopenRepeat: 0,
        });

        const latest = activeSnapshots[activeSnapshots.length - 1] || {};
        return {
            ...flows,
            stalled: latest.stalledCount || 0,
            open: latest.openCount || 0,
            inProgress: latest.inProgressCount || 0,
            unresolved: latest.unresolvedCount || 0,
        };
    }, [activeSnapshots]);

    const isLoading = snapshotsStatus === 'loading';
    const inSprint = period === 'sprint' && !!selectedSprint;

    /** A category's share of all reopens in the selected period. */
    const shareOfReopens = (value) =>
        stats.reopened > 0 ? `${Math.round((value / stats.reopened) * 100)}% of reopens` : '—';

    // Snapshots written before per-day status tracking have no stock fields, so the
    // Open / In Progress lines would silently read zero. Say so instead.
    const needsRebuild = useMemo(() =>
        snapshots.length > 0 && !snapshots.some(s => s.openCount !== undefined),
        [snapshots]
    );

    return (
        <div className="health-dashboard">
            {/* Header */}
            <div className="health-header">
                <h2 className="health-title">Team Health Dashboard</h2>
                <div className="health-header-actions">
                    <button
                        className="health-btn health-btn--secondary"
                        onClick={() => dispatch(fetchHealthSnapshots({ from: janFirst, to: today }))}
                        disabled={isLoading}
                    >
                        Refresh
                    </button>
                    <button
                        className="health-btn health-btn--secondary"
                        onClick={() => {
                            if (window.confirm('Delete all existing snapshots and re-fetch from Jan 1? This may take a few minutes.')) {
                                dispatch(deleteSnapshots()).then(() => dispatch(triggerBackfill()));
                            }
                        }}
                        disabled={backfillStatus === 'loading'}
                    >
                        {backfillStatus === 'loading' ? 'Fetching data…' : 'Reload Historical Data'}
                    </button>
                </div>
            </div>

            {needsRebuild && !isLoading && backfillStatus !== 'loading' && (
                <div className="health-alert health-alert--error">
                    Stored snapshots predate per-day status tracking, so Open / In&nbsp;Progress / Stalled read zero.
                    Click <strong>Reload Historical Data</strong> to rebuild them from Jira.
                </div>
            )}

            {backfillResult && (
                <div className={`health-alert ${backfillResult.error ? 'health-alert--error' : 'health-alert--success'}`}>
                    {backfillResult.error
                        ? `Backfill failed: ${backfillResult.error}`
                        : `Backfill complete — ${backfillResult.processed} issues, ${backfillResult.snapshots} snapshots stored`
                    }
                    <button className="health-alert-close" onClick={() => dispatch(resetBackfill())}>×</button>
                </div>
            )}

            {/* Top layouts — hidden when open issues expanded */}
            {!openIssuesExpanded && (
                <>
                    {/* Context label when sprint is selected */}
                    {period === 'sprint' && (
                        <div className="health-sprint-context">
                            <span className="health-sprint-context-label">
                                📅 {selectedSprint ? selectedSprint.name : `All ${currentYear} sprints`}
                            </span>
                            <span className="health-muted" style={{ fontSize: 12 }}>
                                {selectedSprint
                                    ? `${selectedSprint.startDate?.slice(0, 10)} → ${(selectedSprint.endDate || selectedSprint.completeDate)?.slice(0, 10)}`
                                    : `${sprintRanges.length} sprints · ${sprintRanges[0]?.start ?? ''} → today`}
                            </span>
                        </div>
                    )}

                    <div className="health-stats-row">
                        {[
                            { label: inSprint ? 'Assigned in Sprint' : 'Assigned (YTD)', value: stats.total, color: 'blue' },
                            { label: 'Stalled (>7 days, now)', value: stats.stalled, color: 'red' },
                            // The four reopen cards are mutually exclusive and add up to
                            // Total Reopened, so they can be read together without
                            // double counting.
                            {
                                label: 'Reopened — Total',
                                value: stats.reopened,
                                color: 'orange',
                                hint: 'all causes',
                            },
                            // Each category also shows its share of all reopens, so the
                            // three can be weighed against each other at a glance.
                            {
                                label: 'Reopened — After Fix',
                                value: stats.reopenAfterFix,
                                color: 'orange',
                                hint: `${shareOfReopens(stats.reopenAfterFix)} · our code patch, or a Cannot Reproduce call`,
                            },
                            {
                                label: 'Reopened — Other',
                                value: stats.reopenOther,
                                color: 'purple',
                                hint: `${shareOfReopens(stats.reopenOther)} · Not a Bug / Duplicate / Defer / Withdraw`,
                            },
                            {
                                label: 'Reopened — Outside',
                                value: stats.reopenOutside,
                                color: 'purple',
                                hint: `${shareOfReopens(stats.reopenOutside)} · another team's patch, later assigned to us`,
                            },
                            { label: inSprint ? 'Resolved in Sprint' : 'Resolved (YTD)', value: stats.resolved, color: 'green' },
                            // Snapshot-derived so this agrees with the charts below;
                            // the Open Issues table is live.
                            { label: 'Open Now', value: stats.unresolved, color: 'purple' },
                        ].map(({ label, value, color, hint }) => (
                            <div key={label} className={`health-stat-card health-stat-card--${color}`}>
                                <div className="health-stat-value">{isLoading ? '—' : value.toLocaleString()}</div>
                                <div className="health-stat-label">{label}</div>
                                {hint && <div className="health-stat-hint">{hint}</div>}
                            </div>
                        ))}
                    </div>

                    <div className="health-card">
                        <div className="health-card-header">
                            <h3 className="health-card-title">Sprint Review Metrics</h3>
                            <span className="health-card-subtitle">(all projects, {currentYear})</span>
                        </div>
                        {isLoading
                            ? <div className="health-loading">Loading…</div>
                            : <SprintReviewMetrics sprints={sprintRanges} />
                        }
                    </div>

                    <div className="health-card">
                        <div className="health-card-header">
                            <h3 className="health-card-title">Issue Flow</h3>
                            <div className="health-period-toggle">
                                {['day', 'week', 'month', 'sprint'].map(p => (
                                    <button
                                        key={p}
                                        className={`health-toggle-btn ${period === p ? 'active' : ''}`}
                                        onClick={() => handlePeriodChange(p)}
                                    >
                                        {p.charAt(0).toUpperCase() + p.slice(1)}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Sprint selector — side by side buttons in sprint mode */}
                        {period === 'sprint' && (
                            <div className="health-sprint-selector-row">
                                {visibleSprints.length === 0 ? (
                                    <span className="health-muted">No sprints available</span>
                                ) : (<>
                                    <button
                                        className={`health-sprint-btn ${selectedSprintId === null ? 'active' : ''}`}
                                        onClick={() => setSelectedSprintId(null)}
                                        title={`Every ${currentYear} sprint side by side`}
                                    >
                                        All Sprints
                                    </button>
                                    {visibleSprints.map(s => (
                                        <button
                                            key={s.id}
                                            className={`health-sprint-btn ${selectedSprintId === String(s.id) ? 'active' : ''}`}
                                            onClick={() => setSelectedSprintId(String(s.id))}
                                            title={`${s.name} · ${s.startDate?.slice(0, 10)} → ${(s.endDate || s.completeDate)?.slice(0, 10)}`}
                                        >
                                            {sprintShortName(s)}
                                        </button>
                                    ))}
                                    {allSprints.length > 5 && (
                                        <button
                                            className={`health-sprint-btn health-sprint-btn--toggle ${showAllSprints ? 'active' : ''}`}
                                            onClick={() => setShowAllSprints(!showAllSprints)}
                                            title={showAllSprints ? 'List only the 5 most recent sprints' : `List all ${allSprints.length} sprints of ${currentYear}`}
                                        >
                                            {showAllSprints ? 'Show Top 5' : 'Show All'}
                                        </button>
                                    )}
                                </>)}
                            </div>
                        )}

                        {isLoading
                            ? <div className="health-loading">Loading chart data…</div>
                            : <IssueFlowChart snapshots={snapshots} period={period} selectedSprint={selectedSprint} sprints={sprintRanges} />
                        }
                    </div>

                    <div className="health-two-col">
                        <div className="health-card">
                            <div className="health-card-header">
                                <h3 className="health-card-title">Issues by Project</h3>
                                <span className="health-card-subtitle">(Jan 1 – today)</span>
                            </div>
                            {isLoading
                                ? <div className="health-loading">Loading…</div>
                                : <ProjectIssueChart snapshots={snapshots} />
                            }
                        </div>

                        <div className="health-card">
                            <div className="health-card-header">
                                <h3 className="health-card-title">Team Comparison</h3>
                                <div className="health-period-toggle">
                                    <button
                                        className={`health-toggle-btn ${activeTeam === 'all' ? 'active' : ''}`}
                                        onClick={() => setActiveTeam('all')}
                                    >All</button>
                                    {[0, 1, 2, 3].map(id => (
                                        <button
                                            key={id}
                                            className={`health-toggle-btn ${activeTeam === String(id) ? 'active' : ''}`}
                                            onClick={() => setActiveTeam(String(id))}
                                            title={TEAM_NAMES[id]}
                                        >
                                            T{id + 1}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            {isLoading
                                ? <div className="health-loading">Loading…</div>
                                : <TeamComparisonChart
                                    snapshots={activeSnapshots}
                                    activeTeam={activeTeam}
                                    // The all-sprints overview spans the year — daily bars
                                    // would be unreadable there.
                                    period={period === 'sprint' && !selectedSprint ? 'week' : period}
                                />
                            }
                        </div>
                    </div>
                    {/* Project Sprint Summary — hidden for now
                    <div className="health-card">
                        <div className="health-card-header">
                            <h3 className="health-card-title">Project Sprint Summary</h3>
                            <span className="health-card-subtitle">(per sprint, {currentYear})</span>
                        </div>
                        {isLoading
                            ? <div className="health-loading">Loading…</div>
                            : <ProjectSprintTable snapshots={snapshots} sprints={sprintRanges} />
                        }
                    </div>
                    */}

                    {/* Members Console — hidden for now
                    <div className="health-card">
                        <div className="health-card-header">
                            <h3 className="health-card-title">Members Console</h3>
                            <span className="health-card-subtitle">
                                {canSeeMembersConsole ? '(preview · Jan 1 – today)' : '(coming soon)'}
                            </span>
                        </div>
                        {!canSeeMembersConsole ? (
                            <div className="health-empty">
                                Members Console is coming soon — per-member fix speed, workload and
                                backlog forecast.
                            </div>
                        ) : isLoading ? (
                            <div className="health-loading">Loading…</div>
                        ) : (
                            <MembersConsole snapshots={snapshots} teamUnresolved={stats.unresolved} />
                        )}
                    </div>
                    */}
                </>
            )}

            {/* Open Issues — always visible, expands to full screen */}
            <div className={`health-card ${openIssuesExpanded ? 'health-card--fullscreen' : ''} ${openIssuesCollapsing ? 'health-card--collapsing' : ''}`}>
                <div className="health-card-header">
                    <h3 className="health-card-title">Open Issues</h3>
                    <button
                        className="health-btn health-btn--secondary"
                        onClick={() => dispatch(fetchOpenIssues())}
                        disabled={openIssuesStatus === 'loading'}
                    >
                        {openIssuesStatus === 'loading' ? 'Loading…' : 'Refresh'}
                    </button>
                </div>
                <OpenIssuesTable
                    issues={openIssues}
                    loading={openIssuesStatus === 'loading'}
                    expanded={openIssuesExpanded}
                    onToggleExpand={handleToggleExpand}
                />
            </div>
        </div>
    );
}
