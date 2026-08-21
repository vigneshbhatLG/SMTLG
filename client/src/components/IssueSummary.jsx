import React from 'react';

function fmtHours(secs) {
  if (secs == null) return '—';
  const h = secs / 3600;
  // format up to 2 decimals, strip trailing zeros
  const s = h.toFixed(2).replace(/\.00$|(?<=\.[0-9])0+$/,'');
  return `${s}h`;
}

function IssueSummary({ issue = {} }) {
  if (!issue) return null;

  // planned story points (try a few common fields)
  const plannedSp = issue.storyPoints ?? issue.sp ?? (issue.fields && (issue.fields.storyPoints || issue.fields.customfield_10016 || issue.fields.customfield_10002)) ?? null;

  // planned estimate in seconds (many mappers use timeoriginalestimate)
  const plannedSecs = issue.timeoriginalestimate ?? issue.originalEstimateSeconds ?? (issue.fields && (issue.fields.timeoriginalestimate || issue.fields.timetracking?.originalEstimateSeconds)) ?? null;

  // Jira may provide remaining estimate or timeestimate
  const remainingSecsFromIssue = issue.timeRemainingEstimate;

  // logged seconds from worklogs (sum)
  const loggedSecs = issue.timeSpent;

  // remaining secs: prefer issue remaining if present, else planned - logged
  const remainingSecs = remainingSecsFromIssue != null ? remainingSecsFromIssue : (plannedSecs != null ? Math.max(0, plannedSecs - loggedSecs) : null);
  
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', border: '1px solid #f0f0f0', padding: 12, borderRadius: 6, marginBottom: 12, background: '#fff' }}>
      <div style={{ minWidth: 120 }}>
        <div style={{ fontSize: 12, color: '#666' }}>Planned SP</div>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{plannedSp ?? '—'}</div>
      </div>

      <div style={{ minWidth: 120 }}>
        <div style={{ fontSize: 12, color: '#666' }}>Planned Time</div>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{fmtHours(plannedSecs)}</div>
      </div>

      <div style={{ minWidth: 120 }}>
        <div style={{ fontSize: 12, color: '#666' }}>Logged Time</div>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{fmtHours(loggedSecs)}</div>
      </div>

      <div style={{ minWidth: 120 }}>
        <div style={{ fontSize: 12, color: '#666' }}>Remaining</div>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{fmtHours(remainingSecs)}</div>
      </div>
    </div>
  );
}

export default IssueSummary;
