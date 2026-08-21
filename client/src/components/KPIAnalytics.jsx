import React, { useMemo } from 'react';
import { useSelector } from 'react-redux';
import './css/KPIAnalytics.css';

const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'];

export default function KPIAnalytics() {
  const selectedYear = useSelector(state => state.kpi.selectedYear);
  const organizationKpis = useSelector(state => state.kpi.organizationKpis);
  const teamMemberKpis = useSelector(state => state.kpi.teamMemberKpis);
  const teamMembers = useSelector(state => state.kpi.teamMembers);

  const yearKpis = organizationKpis[selectedYear] || {};

  const analytics = useMemo(() => {
    // Organization metrics
    const orgMetrics = {};
    Object.keys(yearKpis).forEach(quarter => {
      const kpi = yearKpis[quarter];
      const achievementRate = kpi.effort > 0 ? (kpi.achieved / kpi.effort) * 100 : 0;
      orgMetrics[quarter] = {
        effort: kpi.effort || 0,
        achieved: kpi.achieved || 0,
        achievementRate: Math.round(achievementRate),
        promise: kpi.promise || ''
      };
    });

    // Team member metrics
    const memberMetrics = {};
    teamMembers.forEach(member => {
      const memberKpis = teamMemberKpis[member.id]?.[selectedYear] || {};
      let totalEffort = 0;
      let totalAchieved = 0;
      let quarterCount = 0;

      Object.keys(memberKpis).forEach(quarter => {
        const kpi = memberKpis[quarter];
        totalEffort += kpi.effort || 0;
        totalAchieved += kpi.achieved || 0;
        quarterCount++;
      });

      memberMetrics[member.id] = {
        name: member.name,
        totalEffort,
        totalAchieved,
        achievementRate: totalEffort > 0 ? Math.round((totalAchieved / totalEffort) * 100) : 0,
        quartersCovered: quarterCount
      };
    });

    // Overall statistics
    const allEffort = Object.values(orgMetrics).reduce((sum, m) => sum + m.effort, 0);
    const allAchieved = Object.values(orgMetrics).reduce((sum, m) => sum + m.achieved, 0);
    const overallRate = allEffort > 0 ? Math.round((allAchieved / allEffort) * 100) : 0;

    return {
      orgMetrics,
      memberMetrics,
      overallRate,
      totalQuarters: Object.keys(orgMetrics).length
    };
  }, [yearKpis, teamMembers, teamMemberKpis, selectedYear]);

  const topPerformers = useMemo(() => {
    return Object.entries(analytics.memberMetrics)
      .sort((a, b) => b[1].achievementRate - a[1].achievementRate)
      .slice(0, 3);
  }, [analytics.memberMetrics]);

  return (
    <div className="kpi-analytics">
      <h3>Performance Analytics — {selectedYear}</h3>

      {/* Overall metrics */}
      <div className="analytics-grid">
        <div className="metric-card overall">
          <h4>Overall Achievement Rate</h4>
          <div className="metric-value">{analytics.overallRate}%</div>
          <p className="metric-detail">
            {analytics.allAchieved || 0} / {analytics.allEffort || 0} hours
          </p>
        </div>

        <div className="metric-card">
          <h4>Total Quarters Tracked</h4>
          <div className="metric-value">{analytics.totalQuarters}</div>
        </div>

        <div className="metric-card">
          <h4>Team Members</h4>
          <div className="metric-value">{Object.keys(analytics.memberMetrics).length}</div>
        </div>
      </div>

      {/* Quarterly breakdown */}
      <div className="quarterly-breakdown">
        <h4>Quarterly Performance Breakdown</h4>
        <div className="quarter-cards">
          {QUARTERS.map(quarter => {
            const metric = analytics.orgMetrics[quarter];
            if (!metric) return null;
            return (
              <div key={quarter} className="quarter-card">
                <h5>{quarter}</h5>
                <div className="metric-row">
                  <span>Achievement Rate:</span>
                  <strong>{metric.achievementRate}%</strong>
                </div>
                <div className="progress-bar-small">
                  <div className="progress-fill-small" style={{ width: `${metric.achievementRate}%` }}></div>
                </div>
                <div className="metric-row">
                  <span>Effort/Achieved:</span>
                  <span>{metric.achieved} / {metric.effort}h</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Top performers */}
      {topPerformers.length > 0 && (
        <div className="top-performers">
          <h4>🏆 Top Performers</h4>
          <div className="performers-list">
            {topPerformers.map(([id, member], idx) => (
              <div key={id} className="performer-item">
                <div className="rank-badge">#{idx + 1}</div>
                <div className="performer-info">
                  <strong>{member.name}</strong>
                  <p>{member.achievementRate}% achievement rate</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Detailed member metrics */}
      {Object.keys(analytics.memberMetrics).length > 0 && (
        <div className="member-metrics">
          <h4>Team Member Performance</h4>
          <div className="metrics-table">
            <div className="table-header">
              <div>Member</div>
              <div>Total Effort</div>
              <div>Total Achieved</div>
              <div>Rate</div>
            </div>
            {Object.entries(analytics.memberMetrics).map(([id, member]) => (
              <div key={id} className="table-row">
                <div>{member.name}</div>
                <div>{member.totalEffort}h</div>
                <div>{member.totalAchieved}h</div>
                <div>
                  <div className="rate-badge" style={{
                    backgroundColor: member.achievementRate >= 80 ? '#28a745' : 
                                     member.achievementRate >= 60 ? '#ffc107' : '#dc3545'
                  }}>
                    {member.achievementRate}%
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
