import React, { useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { fetchSprintCohorts } from '../store/slice/healthSlice';
import SprintAnalysisReport from './SprintAnalysisReport.jsx';

/** A count that opens the issue list behind it. Renders plain text when zero. */
function CountButton({ value, onClick, title, tone }) {
    if (!value) return <span className="health-muted">0</span>;
    return (
        <button
            type="button"
            className={`health-count-btn ${tone ? `health-count-btn--${tone}` : ''}`}
            onClick={onClick}
            title={title}
        >
            {value}
        </button>
    );
}

function ReopenDetailDialog({ open, onClose, title, issues }) {
    if (!open) return null;
    return (
        <div className="health-dialog-overlay" onClick={onClose} role="presentation">
            <div
                className="health-dialog health-dialog--wide"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-label={title}
            >
                <div className="health-dialog-header">
                    <h4 className="health-dialog-title">{title}</h4>
                    <button className="health-dialog-close" onClick={onClose} aria-label="Close">×</button>
                </div>
                <div className="health-dialog-body">
                    {!issues.length ? (
                        <div className="health-empty">No issues</div>
                    ) : (
                        <table className="health-table health-table--grouped">
                            <thead>
                                <tr>
                                    <th rowSpan={2}>Issue</th>
                                    <th colSpan={2} className="health-group health-group--reopen">Patch Owner (fix bounced)</th>
                                    <th colSpan={2} className="health-group health-group--out">Final Fix Owner</th>
                                    <th rowSpan={2}>Reopened On</th>
                                    <th rowSpan={2}>From</th>
                                </tr>
                                <tr>
                                    <th>Member</th>
                                    <th style={{ textAlign: 'right' }}>Days</th>
                                    <th>Member</th>
                                    <th style={{ textAlign: 'right' }}>Days</th>
                                </tr>
                            </thead>
                            <tbody>
                                {issues.map((it, i) => (
                                    <tr key={`${it.key}-${it.reopenedOn}-${i}`} className="health-table-row">
                                        <td>
                                            <a
                                                href={it.link}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="health-link"
                                            >
                                                {it.key}
                                            </a>
                                            {it.reopenNumber > 1 && (
                                                <span className="health-badge health-badge--orange" style={{ marginLeft: 6 }}>
                                                    #{it.reopenNumber}
                                                </span>
                                            )}
                                        </td>
                                        <td title={it.patchOwnerIsMember ? 'Our team' : 'Outside the team'}>
                                            {it.patchOwner}
                                            {!it.patchOwnerIsMember && (
                                                <span className="health-badge health-badge--blue" style={{ marginLeft: 6 }}>ext</span>
                                            )}
                                        </td>
                                        <td style={{ textAlign: 'right' }}>
                                            {it.patchOwnerDays != null ? `${it.patchOwnerDays}d` : '—'}
                                        </td>
                                        <td>
                                            {it.fixOwner
                                                ? <>{it.fixOwner}{it.sameOwner && <span className="health-muted"> (same)</span>}</>
                                                : <span className="health-muted">still open</span>}
                                        </td>
                                        <td style={{ textAlign: 'right' }}>
                                            {it.fixOwnerDays != null ? `${it.fixOwnerDays}d` : '—'}
                                        </td>
                                        <td>{it.reopenedOn}</td>
                                        <td className="health-muted" style={{ fontSize: 12 }}>{it.fromResolution}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
                <div className="health-dialog-footer health-muted">
                    {issues.length} reopen event(s) · <strong>Patch Owner</strong> delivered the fix
                    that came back; <strong>Final Fix Owner</strong> resolved it afterwards — often a
                    different engineer. Days are how long each of them held the issue before
                    resolving it. “ext” marks someone outside the team.
                </div>
            </div>
        </div>
    );
}

export default function SprintReviewMetrics({ sprints }) {
    const dispatch = useDispatch();
    const cohorts = useSelector((s) => s.health.sprintCohorts);
    const cohortsStatus = useSelector((s) => s.health.sprintCohortsStatus);
    const [dialog, setDialog] = useState(null);
    const [reportSprint, setReportSprint] = useState(null);

    const openDialog = (row, bucket, label) => setDialog({
        title: `${row.sprint} · ${label}`,
        issues: row.reopenDetail?.[bucket] || [],
    });

    const sprintKey = useMemo(
        () => sprints.map(s => `${s.id}:${s.start}:${s.end}`).join('|'),
        [sprints]
    );

    useEffect(() => {
        if (sprints.length) dispatch(fetchSprintCohorts(sprints));
        // sprintKey keeps this to one call per distinct sprint set
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dispatch, sprintKey]);

    const rows = useMemo(() => cohorts.map((r) => ({
        ...r,
        // Full resolution breakdown, shown on hover over the "Other" cell
        breakdown: (r.reopenByResolution || [])
            .map(({ resolution, count }) => `${resolution} ×${count}`)
            .join('\n') || 'no reopens',
    })), [cohorts]);

    // Newest sprint first — the current one is what gets looked at most. Kept separate
    // from `rows` so anything computed across sprints still sees them chronologically.
    const displayRows = useMemo(() => [...rows].reverse(), [rows]);

    // Sprints whose intake ran well above the year's norm
    const outliers = useMemo(() => {
        const counts = rows.map(r => r.newLogged).filter(n => n > 0);
        if (counts.length < 3) return new Set();
        const mean = counts.reduce((t, n) => t + n, 0) / counts.length;
        const sd = Math.sqrt(counts.reduce((t, n) => t + (n - mean) ** 2, 0) / counts.length);
        return new Set(rows.filter(r => sd > 0 && r.newLogged > mean + sd).map(r => r.id));
    }, [rows]);

    if (cohortsStatus === 'loading') return <div className="health-loading">Loading…</div>;
    if (!rows.length) return <div className="health-empty">No sprint data available</div>;

    return (
        <>
            <div className="health-table-wrap health-table-wrap--full">
                <table className="health-table health-table--grouped">
                    <thead>
                        <tr>
                            <th rowSpan={2}>Sprint</th>
                            <th rowSpan={2} style={{ textAlign: 'right' }} className="health-group-start">Open at Start</th>
                            <th rowSpan={2} style={{ textAlign: 'right' }}>New Issues</th>
                            <th rowSpan={2} style={{ textAlign: 'right' }}>Resolved Issues</th>
                            <th rowSpan={2} style={{ textAlign: 'right' }}>Open at End</th>
                            <th rowSpan={2} style={{ textAlign: 'right' }}>Avg MTTR (Days)</th>
                            <th colSpan={5} className="health-group health-group--reopen">Reopen Analysis</th>
                            <th rowSpan={2} style={{ textAlign: 'center' }} className="health-group-start">Report</th>
                        </tr>
                        <tr>
                            <th style={{ textAlign: 'right' }} className="health-group-start" title="Reopened because of our code patch, or a Cannot Reproduce call that did not hold">After Fix</th>
                            <th style={{ textAlign: 'right' }} title="Not a Bug / Duplicate / Deferred / Withdrawn — a triage problem, not a code problem">Other</th>
                            <th style={{ textAlign: 'right' }} title="Reopened due to another team's patch, later assigned to the system apps team">Outside</th>
                            <th style={{ textAlign: 'right' }} title="Every reopen event in this sprint, across all categories">Total</th>
                            <th style={{ textAlign: 'right' }} title="Came back a 2nd time or more — the fix missed the root cause. Cuts across the three categories, so it is shown after the total.">Repeat</th>
                        </tr>
                    </thead>
                    <tbody>
                        {displayRows.map(r => (
                            <tr key={r.id} className="health-table-row">
                                <td>
                                    <strong>{r.sprint}</strong>
                                    {outliers.has(r.id) && (
                                        <span className="health-badge health-badge--red" style={{ marginLeft: 6 }}>surge</span>
                                    )}
                                </td>
                                <td style={{ textAlign: 'right' }} className="health-group-start">{r.carriedIn}</td>
                                <td
                                    style={{ textAlign: 'right' }}
                                    title={`${r.reopenedIn} reopened issue(s) also came back this sprint`}
                                >
                                    {r.newLogged}
                                </td>
                                <td
                                    style={{ textAlign: 'right' }}
                                    title={`${r.resolvedOld} carried over · ${r.resolvedNew} logged this sprint`}
                                >
                                    {r.resolvedTotal}
                                </td>
                                <td
                                    style={{ textAlign: 'right' }}
                                    title={`${r.carryFwdOld} old · ${r.carryFwdNew} new`}
                                >
                                    {r.carryFwdTotal}
                                </td>
                                <td
                                    style={{ textAlign: 'right' }}
                                    title={r.mttrSample ? `${r.mttrSample} resolution(s)` : 'no issues resolved'}
                                >
                                    {r.teamMttr != null ? r.teamMttr.toFixed(2) : '—'}
                                </td>
                                <td style={{ textAlign: 'right' }} className="health-group-start">
                                    <CountButton
                                        value={r.reopenAfterFix}
                                        onClick={() => openDialog(r, 'afterCodeFix', 'Reopened after code fix')}
                                        title="Show issues"
                                    />
                                </td>
                                <td style={{ textAlign: 'right' }} title={r.breakdown}>
                                    <CountButton
                                        value={r.reopenOther}
                                        onClick={() => openDialog(r, 'otherReason', 'Reopened — triage problem')}
                                        title="Show issues"
                                    />
                                </td>
                                <td style={{ textAlign: 'right' }}>
                                    <CountButton
                                        value={r.reopenOutside}
                                        onClick={() => openDialog(r, 'outTeam', "Reopened — another team's patch")}
                                        title="Show issues"
                                    />
                                </td>
                                <td style={{ textAlign: 'right' }}>
                                    <CountButton
                                        value={r.reopened}
                                        onClick={() => openDialog(r, 'all', 'All reopens')}
                                        title="Show every reopen in this sprint"
                                        tone="warn"
                                    />
                                </td>
                                <td style={{ textAlign: 'right' }}>
                                    <CountButton
                                        value={r.reopenRepeat}
                                        onClick={() => openDialog(r, 'repeat', 'Reopened a 2nd time or more')}
                                        title={r.repeatIssueCount ? `${r.repeatIssueCount} issue(s) came back more than once` : 'Show issues'}
                                        tone="warn"
                                    />
                                </td>
                                <td style={{ textAlign: 'center' }} className="health-group-start">
                                    <button
                                        type="button"
                                        className="health-btn health-btn--secondary health-btn--sm"
                                        onClick={() => setReportSprint(r)}
                                        title={`Workload analysis for ${r.sprint}`}
                                    >
                                        Analyse
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <div className="health-muted" style={{ fontSize: 11, marginTop: 8 }}>
                <strong>Open at Start</strong> is what the previous sprint handed over, and equals its
                Open at End. <strong>New Issues</strong> counts issues first assigned to the team during
                the sprint; hover any figure for its old/new split.
                <strong> Avg MTTR</strong> is the mean time the resolving engineer held each issue
                (taken over → resolved, calendar days), across the resolutions that happened in that
                sprint. Only issues that reached a member in the <code>members</code> collection are
                counted — see the note on scope if these differ from a Jira report.
                <br />
                <strong>Reopen Analysis</strong> is read from the resolution each issue was reopened
                from — a structured field, not comment text.
                <em> After Fix</em> — reopened because of our code patch, or a Cannot Reproduce call
                that did not hold.
                <em> Other</em> — Not a Bug, Duplicate, Deferred, Withdrawn: a triage problem rather
                than a code problem; hover for the full breakdown.
                <em> Repeat</em> — came back a 2nd time or more, so the fix missed the root cause.
                <em> Outside</em> — reopened due to another team's patch that later landed with us.
                After Fix, Other and Outside are mutually exclusive and add up to Total; Repeat cuts
                across all three.
                <br />
                Team MTTR is the mean assigned → resolved time of issues resolved in the sprint;
                hover for the sample size. “Surge” marks intake more than one standard deviation
                above the year's mean. Click any reopen count to list the issues behind it.
            </div>

            <ReopenDetailDialog
                open={!!dialog}
                onClose={() => setDialog(null)}
                title={dialog?.title || ''}
                issues={dialog?.issues || []}
            />

            <SprintAnalysisReport
                open={!!reportSprint}
                onClose={() => setReportSprint(null)}
                sprint={reportSprint}
            />
        </>
    );
}
