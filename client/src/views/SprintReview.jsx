import React, { useEffect } from 'react';
import './css/SprintReview.css';
import { useSelector, useDispatch } from 'react-redux';
import { fetchResolvedIssues, fetchIssueTransfers } from '../store/slice/sprintReviewSlice';

export default function SprintReview() {
  const dispatch = useDispatch();
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const { 
    memberMetrics, 
    status, 
    error,
    issueTransfers,
    transfersStatus,
    transfersError
  } = useSelector(state => state.sprintReview);
  const { worklogs } = useSelector(state => state.worklog);
  const selectedSprintId = useSelector(state => state.sprint.selectedSprintId);
  const sprints = useSelector(state => state.sprint.items);
  const selectedTeamId = useSelector(state => state.auth.selectedTeamId);
  const selectedSprint = sprints.find(s => String(s.id) === String(selectedSprintId));

  // Create a map of member name to issue SP
  const memberIssueSPMap = React.useMemo(() => {
    const map = {};
    console.log('Calculating member issue SP map from worklogs:', worklogs);
    if (worklogs && Array.isArray(worklogs)) {
      worklogs.forEach(wl => {
        const fullAssigneeKey = wl.assigneeName;
        // Extract the last word (email/username part) from assigneeKey
        const memberName = fullAssigneeKey ? fullAssigneeKey.split(' ').pop() : fullAssigneeKey;
        console.log(`Processing worklog for assignee: ${fullAssigneeKey}, extracted member name: ${memberName}`);
        const issueSP = wl.labelBreakdown?.issue?.totalTimeSpentStoryPoints || 0;
        map[memberName] = issueSP;
      });
    }
    return map;
  }, [worklogs]);

  const handleRefresh = async () => {
    if (!selectedSprint || isRefreshing) return;

    setIsRefreshing(true);

    const formatDate = (d) => {
      if (!d) return null;
      return new Date(d).toISOString().split('T')[0];
    };

    try {
      await Promise.all([
        dispatch(fetchResolvedIssues({
          startDate: formatDate(selectedSprint.startDate),
          endDate: formatDate(selectedSprint.endDate),
          teamId: selectedTeamId,
          hardReload: true,
        })),
        dispatch(fetchIssueTransfers({
          startDate: formatDate(selectedSprint.startDate),
          endDate: formatDate(selectedSprint.endDate),
          teamId: selectedTeamId,
          hardReload: true,
        }))
      ]);
    } finally {
      setIsRefreshing(false);
    }
  };


  useEffect(() => {
    console.log('Status: ', status);
    if (!selectedSprint || status === 'loading') return;

    const formatDate = (d) => {
      if (!d) return null;
      return new Date(d).toISOString().split('T')[0];
    };

    dispatch(fetchResolvedIssues({
      startDate: formatDate(selectedSprint.startDate),
      endDate: formatDate(selectedSprint.endDate),
      teamId: selectedTeamId,
    }));
  }, [selectedSprint, selectedTeamId]);

  useEffect(() => {
    console.log('transfersStatus: ', transfersStatus);
    if (!selectedSprint || transfersStatus === 'loading') return;

    const formatDate = (d) => {
      if (!d) return null;
      return new Date(d).toISOString().split('T')[0];
    };

    dispatch(fetchIssueTransfers({
      startDate: formatDate(selectedSprint.startDate),
      endDate: formatDate(selectedSprint.endDate),
      teamId: selectedTeamId,
    }));
  }, [selectedSprint, selectedTeamId]);

  return (
    <div className="sprint-review">
      {console.log('Member Metrics: ',memberMetrics)}
      <div className="review-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Sprint Review - Member Issue Counts</h2>
        <button 
          onClick={handleRefresh} 
          disabled={isRefreshing || !selectedSprint}
          style={{
            padding: '10px 20px',
            backgroundColor: isRefreshing ? '#cbd5e1' : '#0ea5e9',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            cursor: isRefreshing ? 'not-allowed' : 'pointer',
            fontSize: '14px',
            fontWeight: '600',
            transition: 'all 0.3s ease',
            boxShadow: isRefreshing ? 'none' : '0 2px 8px rgba(14, 165, 233, 0.2)',
            whiteSpace: 'nowrap'
          }}
          onMouseEnter={(e) => !isRefreshing && (e.target.style.backgroundColor = '#0284c7', e.target.style.boxShadow = '0 4px 12px rgba(14, 165, 233, 0.4)')}
          onMouseLeave={(e) => !isRefreshing && (e.target.style.backgroundColor = '#0ea5e9', e.target.style.boxShadow = '0 2px 8px rgba(14, 165, 233, 0.2)')}
        >
          {isRefreshing ? 'Refreshing...' : 'Refresh Data'}
        </button>
      </div>

      {status === 'loading' && (
        <div className="loading-state">
          <div className="loading-spinner"></div>
          <span>Loading resolved issues...</span>
        </div>
      )}
      {status === 'failed' && <div className="error-state">Error: {error}</div>}

      {status === 'succeeded' && (
        <section className="people-metrics">
          <div className="table-wrap">
            <table className="metrics-table">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Number of Issues</th>
                  <th>MTTR (days)</th>
                </tr>
              </thead>
              <tbody>
                {memberMetrics.length > 0 ? (
                  <>
                    {memberMetrics.map(row => (
                      <tr key={row.name}>
                        <td>{row.name}</td>
                        <td>{row.issuesCount}</td>
                        <td>{row.averageMttr.toFixed(2)}</td>
                      </tr>
                    ))}
                    <tr className="total-row">
                      <td><strong>Total</strong></td>
                      <td><strong>{memberMetrics.reduce((sum, r) => sum + r.issuesCount, 0)}</strong></td>
                      <td><strong>{(memberMetrics.reduce((sum, r) => sum + r.averageMttr, 0) / memberMetrics.filter(r => r.averageMttr > 0).length || 0).toFixed(2)}</strong></td>
                    </tr>
                  </>
                ) : (
                  <tr>
                    <td colSpan="3" style={{ textAlign: 'center', padding: '24px', color: '#94a3b8' }}>No data available</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Issue Transfers Table */}
      <section className="issue-transfers">
        <div className="review-header">
          <h2>Issue Transfers & Resolution Summary</h2>
        </div>

        {transfersStatus === 'loading' && (
          <div className="loading-state">
            <div className="loading-spinner"></div>
            <span>Loading issue transfers...</span>
          </div>
        )}
        {transfersStatus === 'failed' && <div className="error-state">Error: {transfersError}</div>}

        {transfersStatus === 'succeeded' && (
          <div className="table-wrap">
            <table className="metrics-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Total Logged SP for Issues</th>
                  <th>No of Fixed Issues</th>
                  <th>No of Transferred Issues</th>
                </tr>
              </thead>
              <tbody>
                {issueTransfers.length > 0 ? (
                  <>
                    {issueTransfers.map(row => (
                      <tr key={row.name}>
                        <td>{row.name}</td>
                        <td>{(memberIssueSPMap[row.name] || 0).toFixed(2)}</td>
                        <td>{row.issuesCount.fixed}</td>
                        <td>{row.issuesCount.transferred}</td>
                      </tr>
                    ))}
                    <tr className="total-row">
                      <td><strong>Total</strong></td>
                      <td><strong>{issueTransfers.reduce((sum, r) => sum + (memberIssueSPMap[r.name] || 0), 0).toFixed(2)}</strong></td>
                      <td><strong>{issueTransfers.reduce((sum, r) => sum + r.issuesCount.fixed, 0)}</strong></td>
                      <td><strong>{issueTransfers.reduce((sum, r) => sum + r.issuesCount.transferred, 0)}</strong></td>
                    </tr>
                  </>
                ) : (
                  <tr>
                    <td colSpan="4" style={{ textAlign: 'center', padding: '24px', color: '#94a3b8' }}>No data available</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div> 
  );
}
