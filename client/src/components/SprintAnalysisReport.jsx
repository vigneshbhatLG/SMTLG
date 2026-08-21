import React, { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { fetchSprintMemberLoad } from '../store/slice/healthSlice';

function Tile({ label, value, hint, tone }) {
    return (
        <div className={`health-member-stat ${tone ? `health-member-stat--${tone}` : ''}`}>
            <div className="health-member-stat-value">{value}</div>
            <div className="health-member-stat-label">{label}</div>
            {hint && <div className="health-member-stat-hint">{hint}</div>}
        </div>
    );
}

/** Horizontal share bar used for both load and rework columns. */
function Bar({ value, max, title, tone }) {
    if (!value) return <span className="health-muted">—</span>;
    return (
        <div className="health-loadbar" title={title}>
            <div
                className={`health-loadbar-fill ${tone ? `health-loadbar-fill--${tone}` : ''}`}
                style={{ width: `${Math.round((value / (max || 1)) * 100)}%` }}
            />
            <span className="health-loadbar-label">{value}</span>
        </div>
    );
}

/**
 * Concrete things to change next sprint, derived from this sprint's own numbers
 * rather than offered as generic advice. Only rules that actually fire are shown,
 * so a clean sprint says so instead of padding the report.
 */
function buildRecommendations({ sprint, totals, reopens, members }) {
    const out = [];

    // These describe what the changelog actually records: the issue was resolved as
    // Fixed and later reopened. Whether a code patch was involved, and whether the same
    // change failed twice, is not in this data — the wording must not imply otherwise.
    if (reopens.reworkRate != null && reopens.reworkRate >= 10) {
        out.push(
            `Rework is high at ${reopens.reworkRate}% — ${reopens.afterFix} issue(s) the team ` +
            `resolved as Fixed were reopened. Worth reviewing these in code review to see whether ` +
            `the reported scenario was actually covered.`
        );
    }

    if (reopens.repeat > 0) {
        const worst = reopens.worstIssues[0];
        out.push(
            `${reopens.repeat} reopen(s) were on issues that had already been resolved and reopened ` +
            `before${worst ? `, most often ${worst.key} (×${worst.times}, last resolved by ${worst.owner})` : ''}. ` +
            `Being marked Fixed more than once suggests the underlying cause was not found — ` +
            `these are the ones to take through code review together.`
        );
    }

    const netFlow = totals.resolved - totals.assigned;
    if (netFlow < 0) {
        out.push(
            `Intake outpaced closure by ${Math.abs(netFlow)} issues, so the backlog grew to ` +
            `${sprint.carryFwdTotal}. Next sprint needs either more capacity or tighter intake.`
        );
    }

    const stalled = members.reduce((t, m) => t + m.stalledAtEnd, 0);
    if (stalled > 0) {
        out.push(
            `${stalled} issue(s) ended the sprint untouched for over 7 days. ` +
            `Pick these up first rather than starting new work.`
        );
    }

    // Load concentrated on a few people while others were light
    const active = members.filter(m => m.loadScore > 0);
    if (active.length >= 4) {
        const top = active[0];
        const median = [...active].sort((a, b) => a.loadScore - b.loadScore)[Math.floor(active.length / 2)];
        if (median.loadScore > 0 && top.loadScore >= median.loadScore * 2.5) {
            out.push(
                `Load was uneven — ${top.name} carried ${top.loadScore} against a team median of ` +
                `${median.loadScore}. Spread assignment more evenly at planning.`
            );
        }
    }

    const heavyRework = members.filter(m => m.resolved >= 5 && (m.reworkRate ?? 0) >= 20);
    if (heavyRework.length) {
        out.push(
            `Over 20% of what ${heavyRework.map(m => m.name).join(', ')} resolved was reopened. ` +
            `Put their fixes through a second reviewer next sprint, and use the reopened ones as ` +
            `examples in the team's next code review discussion.`
        );
    }

    if (!out.length) {
        out.push('No systemic issues stood out this sprint — backlog held, rework low, nothing left stalled.');
    }
    return out;
}

/**
 * Sprint Analysis Report — how much the team carried, and how much of what they
 * delivered came back.
 *
 * Reopens use the same four categories as the dashboard and the sprint table:
 * After Fix (ours), Other (triage), Outside (another team's patch), and Repeat, which
 * cuts across the other three. Only After Fix feeds the rework rate — a triage call or
 * someone else's patch is not this team's fix quality.
 */
export default function SprintAnalysisReport({ open, onClose, sprint }) {
    const dispatch = useDispatch();
    const sprintLoad = useSelector((s) => s.health.sprintLoad);
    const status = useSelector((s) => s.health.sprintLoadStatus);
    const error = useSelector((s) => s.health.sprintLoadError);

    useEffect(() => {
        if (open && sprint) {
            dispatch(fetchSprintMemberLoad({ id: sprint.id, start: sprint.start, end: sprint.end }));
        }
    }, [dispatch, open, sprint]);

    if (!open || !sprint) return null;

    const ready = status === 'succeeded' && sprintLoad?.id === sprint.id;
    const members = ready ? sprintLoad.members : [];
    const totals = ready ? sprintLoad.totals : null;
    const reopens = ready ? sprintLoad.reopens : null;

    const maxLoad = Math.max(1, ...members.map(m => m.loadScore));
    const maxRework = Math.max(1, ...members.map(m => m.reopensCaused));

    const busiest = [...members].sort((a, b) => b.loadScore - a.loadScore)[0];
    const mostRework = [...members]
        .filter(m => m.reopensCaused > 0)
        .sort((a, b) => b.reopensCaused - a.reopensCaused)[0];

    const netFlow = totals ? totals.resolved - totals.assigned : 0;

    return (
        <div className="health-dialog-overlay" onClick={onClose} role="presentation">
            <div
                className="health-dialog health-dialog--wide"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-label={`Sprint analysis report for ${sprint.sprint}`}
            >
                <div className="health-dialog-header">
                    <h4 className="health-dialog-title">
                        Sprint Analysis Report — {sprint.sprint}
                        <span className="health-muted" style={{ fontWeight: 400, marginLeft: 8, fontSize: 12 }}>
                            {sprint.start} → {sprint.end}
                        </span>
                    </h4>
                    <button className="health-dialog-close" onClick={onClose} aria-label="Close">×</button>
                </div>

                <div className="health-dialog-body">
                    {status === 'loading' && <div className="health-loading">Loading…</div>}
                    {status === 'failed' && <div className="health-empty">Failed to load: {error}</div>}

                    {ready && (
                        <>
                            <h5 className="health-report-heading">Delivery</h5>
                            <div className="health-member-stats">
                                <Tile
                                    label="Came Into Sprint"
                                    value={sprint.totalIn}
                                    hint={`${sprint.carriedIn} carried · ${sprint.newLogged} new · ${sprint.reopenedIn} reopened`}
                                />
                                <Tile
                                    label="Resolved"
                                    value={sprint.resolvedTotal}
                                    hint={`${sprint.resolvedOld} old · ${sprint.resolvedNew} new`}
                                />
                                <Tile
                                    label="Carried Forward"
                                    value={sprint.carryFwdTotal}
                                    hint={`${sprint.carryFwdOld} old · ${sprint.carryFwdNew} new`}
                                />
                                <Tile
                                    label="Backlog Movement"
                                    value={netFlow === 0 ? '0' : `${netFlow > 0 ? '−' : '+'}${Math.abs(netFlow)}`}
                                    hint={netFlow > 0 ? 'closed more than arrived' : netFlow < 0 ? 'arrived more than closed' : 'level'}
                                    tone={netFlow < 0 ? 'bad' : netFlow > 0 ? 'good' : null}
                                />
                                <Tile
                                    label="Avg MTTR"
                                    value={sprint.teamMttr != null ? `${sprint.teamMttr.toFixed(1)}d` : '—'}
                                    hint={`${sprint.mttrSample} resolution(s)`}
                                />
                            </div>

                            <h5 className="health-report-heading">Reopen Effect</h5>
                            <div className="health-member-stats">
                                <Tile label="Total Reopened" value={reopens.total} hint="all causes" />
                                <Tile
                                    label="After Fix"
                                    value={reopens.afterFix}
                                    hint="our code patch or Cannot Reproduce — actionable"
                                    tone={reopens.afterFix ? 'bad' : null}
                                />
                                <Tile
                                    label="Other"
                                    value={reopens.other}
                                    hint="Not a Bug / Duplicate / Defer / Withdraw — triage"
                                />
                                <Tile
                                    label="Outside"
                                    value={reopens.outside}
                                    hint="another team's patch, later assigned to us"
                                />
                                <Tile
                                    label="Repeat"
                                    value={reopens.repeat}
                                    hint="came back a 2nd time or more"
                                    tone={reopens.repeat ? 'bad' : null}
                                />
                                <Tile
                                    label="Rework Rate"
                                    value={reopens.reworkRate != null ? `${reopens.reworkRate}%` : '—'}
                                    hint={`${reopens.afterFix} of ${totals.resolved} resolved`}
                                    tone={reopens.reworkRate > 15 ? 'bad' : null}
                                />
                            </div>

                            <div className="health-report-callout">
                                {busiest && (
                                    <div>
                                        <strong>{busiest.name}</strong> handled the most work:
                                        {' '}<strong>{busiest.assigned} new issue(s) assigned</strong> during the sprint
                                        {' '}and <strong>{busiest.openAtEnd} still open</strong> at the end
                                        {' '}— {busiest.loadScore} issues in total, {busiest.loadShare}% of the team's load.
                                        {' '}Closed {busiest.resolved}
                                        {busiest.avgMttr != null ? `, averaging ${busiest.avgMttr} days each` : ''}.
                                    </div>
                                )}
                                {mostRework ? (
                                    <div style={{ marginTop: 6 }}>
                                        <strong>{mostRework.name}</strong> had the most fixes reopened:
                                        {' '}<strong>{mostRework.reopensCaused} of {mostRework.resolved}</strong> they resolved
                                        {mostRework.reworkRate != null ? ` (${mostRework.reworkRate}%)` : ''}
                                        {mostRework.repeatReopensCaused > 0
                                            ? `, ${mostRework.repeatReopensCaused} on issue(s) that had been reopened before`
                                            : ''}
                                        {' '}— worth walking through these in code review.
                                    </div>
                                ) : (
                                    <div style={{ marginTop: 6 }}>
                                        Nothing the team resolved was reopened this sprint.
                                    </div>
                                )}
                                {(reopens.other > 0 || reopens.outside > 0) && (
                                    <div style={{ marginTop: 6 }} className="health-muted">
                                        {reopens.other} reopen(s) were triage calls (Not a Bug, Duplicate, Defer,
                                        Withdraw) and {reopens.outside} came from another team's patch — both are
                                        excluded from the rework rate.
                                    </div>
                                )}
                            </div>

                            <h5 className="health-report-heading">How To Improve Next Sprint</h5>
                            <ul className="health-report-actions">
                                {buildRecommendations({ sprint, totals, reopens, members }).map((line, i) => (
                                    <li key={i}>{line}</li>
                                ))}
                            </ul>

                            <h5 className="health-report-heading">Per Member</h5>
                            <table className="health-table">
                                <thead>
                                    <tr>
                                        <th>Member</th>
                                        <th style={{ textAlign: 'right' }}>Assigned</th>
                                        <th style={{ textAlign: 'right' }}>Resolved</th>
                                        <th style={{ textAlign: 'right' }}>Open at End</th>
                                        <th style={{ textAlign: 'right' }}>Stalled</th>
                                        <th style={{ textAlign: 'right' }}>Avg MTTR</th>
                                        <th style={{ minWidth: 110 }}>Load</th>
                                        <th style={{ minWidth: 110 }} title="Issues they resolved that were later reopened — candidates for code review follow-up">
                                            Fixes Reopened
                                        </th>
                                        <th style={{ textAlign: 'right' }}>Rework</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {members.map((m) => (
                                        <tr key={m.name} className="health-table-row">
                                            <td><strong>{m.name}</strong></td>
                                            <td style={{ textAlign: 'right' }}>{m.assigned}</td>
                                            <td style={{ textAlign: 'right' }}>{m.resolved}</td>
                                            <td style={{ textAlign: 'right' }}>{m.openAtEnd}</td>
                                            <td style={{ textAlign: 'right' }} className={m.stalledAtEnd ? 'health-delta-up' : ''}>
                                                {m.stalledAtEnd}
                                            </td>
                                            <td style={{ textAlign: 'right' }}>{m.avgMttr != null ? `${m.avgMttr}d` : '—'}</td>
                                            <td>
                                                <Bar
                                                    value={m.loadScore}
                                                    max={maxLoad}
                                                    title={`${m.loadScore} = ${m.assigned} assigned + ${m.openAtEnd} open · ${m.loadShare}% of team`}
                                                />
                                            </td>
                                            <td>
                                                <Bar
                                                    value={m.reopensCaused}
                                                    max={maxRework}
                                                    tone="bad"
                                                    title={m.repeatReopensCaused
                                                        ? `${m.repeatReopensCaused} on issue(s) reopened more than once — review these together`
                                                        : 'issues they resolved that were later reopened'}
                                                />
                                            </td>
                                            <td style={{ textAlign: 'right' }} className={m.reworkRate > 15 ? 'health-delta-up' : ''}>
                                                {m.reworkRate != null ? `${m.reworkRate}%` : '—'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>

                            {reopens.worstIssues.length > 0 && (
                                <>
                                    <h5 className="health-report-heading">
                                        Reopened More Than Once — Review Together
                                    </h5>
                                    <table className="health-table">
                                        <thead>
                                            <tr>
                                                <th>Issue</th>
                                                <th style={{ textAlign: 'right' }}>Times Reopened This Sprint</th>
                                                <th>Last Resolved By</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {reopens.worstIssues.map((i) => (
                                                <tr key={i.key} className="health-table-row">
                                                    <td>
                                                        <a
                                                            href={`http://jira.lge.com/issue/browse/${i.key}`}
                                                            target="_blank"
                                                            rel="noreferrer"
                                                            className="health-link"
                                                        >
                                                            {i.key}
                                                        </a>
                                                    </td>
                                                    <td style={{ textAlign: 'right' }} className="health-delta-up">{i.times}</td>
                                                    <td>{i.owner}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </>
                            )}
                        </>
                    )}
                </div>

                <div className="health-dialog-footer health-muted">
                    <strong>Load</strong> = issues assigned during the sprint plus issues still open at
                    the end. <strong>Fixes Reopened</strong> counts After Fix reopens where that member
                    delivered the fix; <strong>Rework</strong> is that as a share of what they resolved.
                    This is read from the Jira changelog only — it shows that a fix did not hold, not
                    what the change contained, so treat these as candidates to look at in code review
                    rather than as proof of a review failure. <strong>Other</strong> (triage calls) and
                    <strong> Outside</strong> (another team's patch) are reported but excluded from the
                    rework figures. Leads are excluded throughout, since every issue is routed through
                    them first.
                </div>
            </div>
        </div>
    );
}
