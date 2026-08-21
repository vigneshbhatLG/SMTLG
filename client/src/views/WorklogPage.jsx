import React, { useState, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useParams, useNavigate } from 'react-router-dom';
import { fetchAssigneeIssues } from '../store/slice/issueSlice';
import { fetchWorklogComments } from '../store/slice/worklogSlice';
import './css/dashboard.css';
import './css/WorklogPage.css';
import WorklogList from '../components/WorklogList';
import WorklogSummary from '../components/WorklogSummary';
import WorklogPostForm from '../components/WorklogPostForm';

function WorklogPage() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const params = useParams();
  const member = decodeURIComponent(params.member || '');
  const selectedSprint = useSelector((state) => state.sprint.selectedSprintId);
  const issues = useSelector((state) => state.issue.issues || []);
  const issueStatus = useSelector((state) => state.issue.status);
  const user = useSelector((state) => state.auth.user);

  // Tickets come from issues returned by server (include labels and status)
  const tickets = issues.map((i) => ({ id: i.key, title: i.summary, labels: i.labels || [], status: i.status || (i.fields && i.fields.status && i.fields.status.name) || 'Unknown', link: i.link }));

  const [selectedTicket, setSelectedTicket] = useState(null);

  // Fetch issues for this member when component mounts or member/sprint changes
  useEffect(() => {
    console.log('Fetching issues for member:', member, 'sprint:', selectedSprint);
    if (!member || !selectedSprint) return;
    dispatch(fetchAssigneeIssues({ sprintId: selectedSprint, assignee: member }));
  }, [member, selectedSprint, dispatch]);
  // Ensure a default selected ticket (useMemo avoids setState in effects)
  const currentTicket = selectedTicket ?? (issues && issues.length > 0 ? issues[0].key : null);
  const activeTicket = selectedTicket ?? currentTicket;

  // Light color map for labels (soft, non-dark colors)
  const labelColorMap = {
    development: { bg: '#e6fbdf', color: '#2f8f3f' }, // soft green
    issue: { bg: '#fff0f0', color: '#d95b5b' },       // soft red
    operation: { bg: '#eaf4ff', color: '#2b7be6' },   // soft blue
    training: { bg: '#f6f0ff', color: '#7b4bff' }     // soft purple
  };

  // Status color map (soft, non-dark colors)
  const statusColorMap = {
    closed: { bg: '#e6fbdf', color: '#2f8f3f' },
    verify: { bg: '#e6fbdf', color: '#2b7be6' },
    analysis: { bg: '#fff4e6', color: '#d97b2b' },
    implementation: { bg: '#fff4e6', color: '#d97b2b' },
    screen: { bg: '#eaf4ff', color: '#555' },
    open: { bg: '#eaf4ff', color: '#555' },
  };

  const selectedIssue = issues.find((it) => it.key === activeTicket) || null;

  function handleTicketClick(id) {
    setSelectedTicket(id);
  }

  // reply & expanded state moved into WorklogList component for clarity

  return (
    <div className="worklog-page">
      <div className="worklog-header-row">
        <h2 className="worklog-member-name">{member}</h2>
        <WorklogSummary issues={issues} />
        <button onClick={() => navigate('/dashboard/table')} className="back-btn">Back</button>
      </div>

      <div className="worklog-content">
        <div className="worklog-sidebar">
          <div className="ticket-list">
            {issueStatus === 'loading' ? (
              <div className="loading">Loading issues...</div>
            ) : tickets.map((t) => (
              <button
                key={t.id}
                onClick={() => handleTicketClick(t.id)}
                className={`ticket-btn ${t.id === activeTicket ? 'active' : ''}`}
              >
                {t.labels && t.labels.length > 0 && (() => {
                  const lbl = t.labels[0];
                  const cls = (lbl && labelColorMap[lbl.toLowerCase()]) ? lbl.toLowerCase() : 'default';
                  return (
                    <div className={`label-badge ${cls}`}>
                      {lbl}
                    </div>
                  );
                })()}
                <div className="ticket-id-row">
                  <div>{t.id}</div>
                  {t.status && (() => {
                    const statusText = String(t.status);
                    const key = statusText.toLowerCase().replace(/\s+/g, '');
                    const cls = statusColorMap[key] ? key : '';
                    return (
                      <div className={`status-badge ${cls}`}>
                        {statusText}
                      </div>
                    );
                  })()}
                </div>
                <div className="ticket-title">{t.title}</div>
                {t.link && (
                  <a href={t.link} target="_blank" rel="noopener noreferrer" className="ticket-link-icon" title="Open in Jira">
                    🔗
                  </a>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="worklog-main">
          {member === user?.name && activeTicket && (
            <WorklogPostForm
              issueId={activeTicket}
              issue={selectedIssue}
              onSuccess={() => {
                // Refresh the worklogs after posting
                dispatch(fetchWorklogComments({ issueId: activeTicket, sprintId: selectedSprint, assignee: member }));
                // Optionally refresh issues if needed
              }}
            />
          )}

          <WorklogList key={activeTicket || 'worklogs'} issueId={activeTicket} onBack={() => navigate('/dashboard/table')} issueStatus={issueStatus} issue={selectedIssue} />
        </div>
      </div>
    </div>
  );
}

export default WorklogPage;
