import React, { useState } from 'react';

export default function StalledIssuesTable({ data }) {
    const [expanded, setExpanded] = useState(null);

    if (!data.length) return <div className="health-empty">No stalled issues found</div>;

    return (
        <div className="health-table-wrap">
            <table className="health-table">
                <thead>
                    <tr>
                        <th>Project</th>
                        <th style={{ textAlign: 'right' }}>Stalled Count</th>
                        <th></th>
                    </tr>
                </thead>
                <tbody>
                    {data.map((row) => (
                        <React.Fragment key={row.project}>
                            <tr
                                className="health-table-row health-table-row--clickable"
                                onClick={() => setExpanded(expanded === row.project ? null : row.project)}
                            >
                                <td><strong>{row.project}</strong></td>
                                <td style={{ textAlign: 'right' }}>
                                    <span className="health-badge health-badge--red">{row.count}</span>
                                </td>
                                <td style={{ textAlign: 'right', color: '#6b7280', fontSize: 12 }}>
                                    {expanded === row.project ? '▲' : '▼'}
                                </td>
                            </tr>
                            {expanded === row.project && row.issues.map((issue) => (
                                <tr key={issue.key} className="health-table-row health-table-row--sub">
                                    <td colSpan={3}>
                                        <a
                                            href={`http://jira.lge.com/issue/browse/${issue.key}`}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="health-link"
                                        >
                                            {issue.key}
                                        </a>
                                        <span className="health-muted"> · {issue.assignee} · {issue.daysStalled}d stalled</span>
                                    </td>
                                </tr>
                            ))}
                        </React.Fragment>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
