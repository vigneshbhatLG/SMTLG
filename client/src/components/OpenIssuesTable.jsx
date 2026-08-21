import React, { useState, useMemo } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { analyzeIssue, fetchAIAnalysis } from '../store/slice/aiAnalysisSlice';
import AIAnalysisModal from './AIAnalysisModal.jsx';

const STATUS_COLORS = {
    'Open': '#ef4444',
    'In Progress': '#f97316',
    'Fixready': '#22c55e',
    'Reopened': '#8b5cf6',
};

// Jira spells it "Fixready"; compare space-insensitively so either form matches.
const statusKey = (s) => String(s || '').toLowerCase().replace(/\s+/g, '');

const TEAM_ORDER = [0, 1, 2, 3];
const TEAM_NAMES = {
    0: 'Smart Media & Connectivity',
    1: 'Home Experience & Input Apps',
    2: 'Multiscreen & CH Apps',
    3: 'Core System Apps',
};

function SortIcon({ k, sortKey, sortDir }) {
    return sortKey === k ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ' ↕';
}

function ConfidenceBadge({ score }) {
    const n = Number(score || 0);
    const color = n >= 80 ? '#15803d' : n >= 60 ? '#92400e' : '#991b1b';
    const bg = n >= 80 ? '#dcfce7' : n >= 60 ? '#fef3c7' : '#fee2e2';
    return (
        <span style={{ background: bg, color, fontSize: 11, padding: '1px 6px', borderRadius: 999, fontWeight: 600, marginLeft: 4 }}>
            {n.toFixed(0)}%
        </span>
    );
}

export default function OpenIssuesTable({ issues, loading, expanded, onToggleExpand }) {
    const dispatch = useDispatch();
    const aiAnalysisData = useSelector((s) => s.aiAnalysis.analysisData);
    const aiAnalysisLoading = useSelector((s) => s.aiAnalysis.loading);
    const issueAnalysisLoading = useSelector((s) => s.aiAnalysis.issueAnalysisLoading);
    const streamDone = useSelector((s) => s.aiAnalysis.streamDone);
    const streamTotal = useSelector((s) => s.aiAnalysis.streamTotal);

    const [search, setSearch] = useState('');
    const [sortKey, setSortKey] = useState('daysAssigned');
    const [sortDir, setSortDir] = useState('desc');
    const [page, setPage] = useState(1);
    const [modalData, setModalData] = useState(null);
    // 'all' | 'Open' | 'In Progress' | 'Fix Ready' | 'Reopened' | 'stalled'
    const [statusFilter, setStatusFilter] = useState('all');
    const PAGE_SIZE = 100;

    const analysisMap = useMemo(() => {
        const map = {};
        for (const item of (aiAnalysisData || [])) {
            if (item.ticketId) map[item.ticketId] = item.analysisResult;
        }
        return map;
    }, [aiAnalysisData]);

    const todayStr = new Date().toISOString().slice(0, 10);

    const filtered = useMemo(() => {
        let list = issues;
        // Status / stalled filter
        if (statusFilter === 'stalled') {
            list = list.filter(i => (i.daysAssigned ?? 0) > 7);
        } else if (statusFilter !== 'all') {
            list = list.filter(i => statusKey(i.status) === statusKey(statusFilter));
        }
        // Search
        const q = search.toLowerCase();
        if (q) {
            list = list.filter(i =>
                i.key.toLowerCase().includes(q) ||
                i.assignee.toLowerCase().includes(q) ||
                i.project.toLowerCase().includes(q)
            );
        }
        return list;
    }, [issues, search, statusFilter]);

    const sorted = useMemo(() => {
        return [...filtered].sort((a, b) => {
            const ta = a.teamId ?? 99;
            const tb = b.teamId ?? 99;
            if (ta !== tb) return ta - tb;
            let av = a[sortKey] ?? 0;
            let bv = b[sortKey] ?? 0;
            if (typeof av === 'string') av = av.toLowerCase();
            if (typeof bv === 'string') bv = bv.toLowerCase();
            if (av < bv) return sortDir === 'asc' ? -1 : 1;
            if (av > bv) return sortDir === 'asc' ? 1 : -1;
            return 0;
        });
    }, [filtered, sortKey, sortDir]);

    const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
    const paged = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

    function handleSort(key) {
        if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        else { setSortKey(key); setSortDir(['daysAssigned', 'reopenCount', 'reassignCount'].includes(key) ? 'desc' : 'asc'); }
        setPage(1);
    }

    const teamGroups = {};
    for (const issue of paged) {
        const key = issue.teamId ?? 'unknown';
        if (!teamGroups[key]) teamGroups[key] = [];
        teamGroups[key].push(issue);
    }

    // Filter tab counts
    const counts = useMemo(() => {
        const c = { all: issues.length, stalled: 0, Open: 0, 'In Progress': 0, Fixready: 0, Reopened: 0 };
        const byKey = new Map(Object.keys(c).map(k => [statusKey(k), k]));
        for (const i of issues) {
            if ((i.daysAssigned ?? 0) > 7) c.stalled++;
            const bucket = byKey.get(statusKey(i.status));
            if (bucket && bucket !== 'all') c[bucket]++;
        }
        return c;
    }, [issues]);

    const renderRow = (issue) => {
        const analysis = analysisMap[issue.key];
        return (
            <tr key={issue.key} className="health-table-row">
                <td><a href={issue.link} target="_blank" rel="noreferrer" className="health-link">{issue.key}</a></td>
                <td>{issue.assignee}</td>
                <td><span className="health-status-badge" style={{ background: STATUS_COLORS[issue.status] || '#6b7280' }}>{issue.status}</span></td>
                <td style={{ color: issue.duedate && issue.duedate < todayStr ? '#ef4444' : 'inherit' }}>{issue.duedate || '—'}</td>
                <td>{issue.project}</td>
                <td>
                    <span style={{ color: issue.daysAssigned > 7 ? '#ef4444' : issue.daysAssigned > 3 ? '#f97316' : 'inherit', fontWeight: issue.daysAssigned > 7 ? 600 : 400 }}>
                        {issue.daysAssigned != null ? `${issue.daysAssigned}d` : '—'}
                    </span>
                </td>
                <td>{issue.reopenCount > 0 ? <span className="health-badge health-badge--orange">{issue.reopenCount}x</span> : <span className="health-muted">0</span>}</td>
                <td>{issue.reassignCount > 1 ? <span className="health-badge health-badge--purple">{issue.reassignCount}x</span> : <span className="health-muted">{issue.reassignCount}</span>}</td>
                <td>
                    {analysis?.predicted_category ? (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                            <span className="health-badge health-badge--blue">{analysis.predicted_category}</span>
                            <ConfidenceBadge score={analysis.confidence_score} />
                        </span>
                    ) : <span className="health-muted">—</span>}
                </td>
                <td>
                    {analysis
                        ? <button className="health-ai-btn health-ai-btn--done" onClick={() => setModalData(analysis)}>Show More</button>
                        : <button className="health-ai-btn" disabled={issueAnalysisLoading} onClick={() => dispatch(analyzeIssue(issue.key))}>
                            {issueAnalysisLoading ? '…' : 'Analyze'}
                          </button>
                    }
                </td>
            </tr>
        );
    };

    return (
        <div className={`open-issues-wrap ${expanded ? 'open-issues-wrap--expanded' : ''}`}>
            {/* Divider with expand toggle */}
            <div className="open-issues-divider">
                <div className="open-issues-divider-line" />
                <button className="open-issues-expand-btn" onClick={onToggleExpand}>
                    {expanded ? '↓ Collapse' : '↑ Expand'}
                </button>
                <div className="open-issues-divider-line" />
            </div>

            {/* Toolbar */}
            <div className="health-table-toolbar">
                <input
                    className="health-search"
                    placeholder="Search key, assignee, project…"
                    value={search}
                    onChange={e => { setSearch(e.target.value); setPage(1); }}
                />
                {/* Status / stalled filters */}
                <div className="health-period-toggle">
                    {[
                        { key: 'all', label: `All (${counts.all})` },
                        { key: 'Open', label: `Open (${counts.Open})` },
                        { key: 'In Progress', label: `In Progress (${counts['In Progress']})` },
                        { key: 'Fixready', label: `Fix Ready (${counts.Fixready})` },
                        { key: 'Reopened', label: `Reopened (${counts.Reopened})` },
                        { key: 'stalled', label: `>7 Days (${counts.stalled})` },
                    ].map(f => (
                        <button
                            key={f.key}
                            className={`health-toggle-btn ${statusFilter === f.key ? 'active' : ''}`}
                            onClick={() => { setStatusFilter(f.key); setPage(1); }}
                        >
                            {f.label}
                        </button>
                    ))}
                </div>
                {/* AI Analysis All button with progress */}
                <button
                    className="health-ai-btn health-ai-btn--all"
                    disabled={aiAnalysisLoading || !issues.length}
                    onClick={() => dispatch(fetchAIAnalysis(issues.map(i => i.key)))}
                >
                    {aiAnalysisLoading ? (
                        <>
                            <span className="health-ai-spinner" />
                            {streamTotal > 0 ? `${streamDone}/${streamTotal} Analyzing…` : 'Starting…'}
                        </>
                    ) : 'AI Analysis All'}
                </button>
                {aiAnalysisLoading && streamTotal > 0 && (
                    <div className="health-ai-progress">
                        <div
                            className="health-ai-progress-bar"
                            style={{ width: `${Math.round((streamDone / streamTotal) * 100)}%` }}
                        />
                        <span className="health-ai-progress-text">
                            {streamDone} done · {streamTotal - streamDone} pending
                        </span>
                    </div>
                )}
                <span className="health-muted">{sorted.length} issues</span>
            </div>

            {loading ? (
                <div className="health-loading">Loading open issues…</div>
            ) : !issues.length ? (
                <div className="health-empty">No open issues found</div>
            ) : (
                <>
                    <div className="health-table-wrap">
                        <table className="health-table health-table--open">
                            <thead>
                                <tr>
                                    <th onClick={() => handleSort('key')} className="health-th-sort">Key<SortIcon k="key" sortKey={sortKey} sortDir={sortDir} /></th>
                                    <th onClick={() => handleSort('assignee')} className="health-th-sort">Assignee<SortIcon k="assignee" sortKey={sortKey} sortDir={sortDir} /></th>
                                    <th onClick={() => handleSort('status')} className="health-th-sort">Status<SortIcon k="status" sortKey={sortKey} sortDir={sortDir} /></th>
                                    <th onClick={() => handleSort('duedate')} className="health-th-sort">Due Date<SortIcon k="duedate" sortKey={sortKey} sortDir={sortDir} /></th>
                                    <th onClick={() => handleSort('project')} className="health-th-sort">Project<SortIcon k="project" sortKey={sortKey} sortDir={sortDir} /></th>
                                    <th onClick={() => handleSort('daysAssigned')} className="health-th-sort">Days Assigned<SortIcon k="daysAssigned" sortKey={sortKey} sortDir={sortDir} /></th>
                                    <th onClick={() => handleSort('reopenCount')} className="health-th-sort">Reopened<SortIcon k="reopenCount" sortKey={sortKey} sortDir={sortDir} /></th>
                                    <th onClick={() => handleSort('reassignCount')} className="health-th-sort">Reassigned<SortIcon k="reassignCount" sortKey={sortKey} sortDir={sortDir} /></th>
                                    <th>Issue Category</th>
                                    <th>AI Analysis</th>
                                </tr>
                            </thead>
                            <tbody>
                                {TEAM_ORDER.filter(tid => teamGroups[tid]?.length > 0).map(tid => (
                                    <React.Fragment key={tid}>
                                        <tr className="health-team-header-row">
                                            <td colSpan={10}>
                                                <span className="health-team-header">{TEAM_NAMES[tid]} — {teamGroups[tid].length} issue(s)</span>
                                            </td>
                                        </tr>
                                        {teamGroups[tid].map(issue => renderRow(issue))}
                                    </React.Fragment>
                                ))}
                                {teamGroups['unknown']?.length > 0 && (
                                    <React.Fragment>
                                        <tr className="health-team-header-row">
                                            <td colSpan={10}>
                                                <span className="health-team-header">Unassigned Team — {teamGroups['unknown'].length} issue(s)</span>
                                            </td>
                                        </tr>
                                        {teamGroups['unknown'].map(issue => renderRow(issue))}
                                    </React.Fragment>
                                )}
                            </tbody>
                        </table>
                    </div>
                    {totalPages > 1 && (
                        <div className="health-pagination">
                            <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="health-btn health-btn--secondary">Prev</button>
                            <span className="health-muted">Page {page} of {totalPages} ({sorted.length} total)</span>
                            <button disabled={page === totalPages} onClick={() => setPage(p => p + 1)} className="health-btn health-btn--secondary">Next</button>
                        </div>
                    )}
                </>
            )}
            <AIAnalysisModal isOpen={!!modalData} onClose={() => setModalData(null)} data={modalData || {}} />
        </div>
    );
}
