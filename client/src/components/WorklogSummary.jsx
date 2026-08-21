import React from 'react';

function fmtHours(secs) {
  if (secs == null || secs === 0) return '0h';
  const h = secs / 3600;
  // format up to 2 decimals, strip trailing zeros
  const s = h.toFixed(2).replace(/\.00$|(?<=\.[0-9])0+$/,'');
  return `${s}h`;
}

function WorklogSummary({ issues = [] }) {
  // Calculate totals across all issues
  let totalSp = 0;
  let totalPlannedSecs = 0;
  let totalLoggedSecs = 0;

  issues.forEach((issue) => {
    // planned story points
    const plannedSp = issue.storyPoints ?? issue.sp ?? (issue.fields && (issue.fields.storyPoints || issue.fields.customfield_10016 || issue.fields.customfield_10002)) ?? 0;
    totalSp += plannedSp || 0;

    // planned estimate in seconds
    const plannedSecs = issue.timeoriginalestimate ?? issue.originalEstimateSeconds ?? (issue.fields && (issue.fields.timeoriginalestimate || issue.fields.timetracking?.originalEstimateSeconds)) ?? 0;
    totalPlannedSecs += plannedSecs || 0;

    // logged seconds from worklogs (sum)
    const loggedSecs = issue.timeSpent ?? 0;
    totalLoggedSecs += loggedSecs || 0;
  });

  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', border: '1px solid #e0e0e0', padding: 12, borderRadius: 6, marginBottom: 16, background: '#f9f9f9' }}>
      <div style={{ minWidth: 120 }}>
        <div style={{ fontSize: 12, color: '#666' }}>Total Planned SP</div>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{totalSp}</div>
      </div>

      <div style={{ minWidth: 140 }}>
        <div style={{ fontSize: 12, color: '#666' }}>Total Planned Hours</div>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{fmtHours(totalPlannedSecs)}</div>
      </div>

      <div style={{ minWidth: 140 }}>
        <div style={{ fontSize: 12, color: '#666' }}>Total Logged Hours</div>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{fmtHours(totalLoggedSecs)}</div>
      </div>
    </div>
  );
}

export default WorklogSummary;
