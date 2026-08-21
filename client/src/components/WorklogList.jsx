import React, { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { fetchWorklogComments } from '../store/slice/worklogSlice';
import WorklogComments from './WorklogComments';
import IssueSummary from './IssueSummary';
import './css/WorklogList.css';

function WorklogList({ issueId, onBack, issueStatus, issue = null }) {
  const dispatch = useDispatch();
  const selectedSprint = useSelector((state) => state.sprint.selectedSprintId);
  const member = useSelector((state) => state.auth.user?.name);
  const commentsByIssue = useSelector((state) => (state.worklog && state.worklog.commentsByIssue) || {});
  const worklogs = commentsByIssue[issueId] || [];
  const sortedWorklogs = [...worklogs].sort((a, b) => new Date(b.datetime) - new Date(a.datetime));

  useEffect(() => {
    if (issueId && selectedSprint && member) {
      dispatch(fetchWorklogComments({ issueId }));
    }
  }, [issueId, selectedSprint, member, dispatch]);

  // replies and posting handled by WorklogComments component

  return (
    <div className="worklog-list-root">
      <div className="worklog-header">
        <h3 className="worklog-h3">Work Logs</h3>
      </div>

      <div className="worklog-body">
        {/* Issue summary shown above worklogs */}
        {issue && <IssueSummary issue={issue} worklogs={sortedWorklogs} />}
        {issueStatus === 'loading' ? (
          <div>Loading worklogs...</div>
        ) : worklogs.length === 0 ? (
          <div className="no-efforts">No efforts logged</div>
        ) : (
          sortedWorklogs.map((wl) => (
            <div key={wl.id} className="worklog-item">
              <div className="worklog-item-header">
                <div className="worklog-time-badge">
                  {wl.time}
                </div>
                <div className="worklog-meta">
                  <div className="worklog-date">
                    <span className="date-icon">📅</span>
                    {wl.datetime ? new Date(wl.datetime).toLocaleDateString() : 'Unknown date'}
                  </div>
                </div>
              </div>
              <div className="worklog-content">
                {wl.comment && (
                  <div className="comment-container">
                    {wl.comment || 'No comment provided'}
                  </div>
                )}
              </div>

              {/* <WorklogComments worklog={wl} issueKey={issueId} /> */}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default WorklogList;
