import React, { useMemo, useState } from 'react';
import { Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import './css/SprintVisualization.css';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend
);

// Utility function to convert hours to days (8 hours = 1 day)
const hoursToDays = (hours) => {
  if (!hours || hours === 0) return 0;
  return parseFloat((hours / 8).toFixed(2));
};

// Utility to convert hours to story points (4 hours = 1 SP)
const hoursToSP = (hours) => {
  if (!hours || hours === 0) return 0;
  return parseFloat((hours / 4).toFixed(2));
};

// Utility function to format days for display
const formatDays = (hours) => {
  if (!hours || hours === 0) return '0 days';
  const days = hoursToDays(hours);
  return `${days} ${days === 1 ? 'day' : 'days'}`;
};

export default function SprintVisualization({ data }) {
  const [unitMode, setUnitMode] = useState('sp');
  // Aggregate data for charts
  const chartData = useMemo(() => {
    if (!data || data.length === 0) {
      return null;
    }

    // detect whether incoming data is in story points or hours
    const sampleLabelObj = data.find(d => d.development || d.issue || d.training || d.operation || d.plannedLeave || d.unplannedLeave);
    const labelSample = sampleLabelObj ? (sampleLabelObj.development || sampleLabelObj.issue || sampleLabelObj.training || sampleLabelObj.operation || sampleLabelObj.plannedLeave || sampleLabelObj.unplannedLeave) : null;
    const sourceIsStoryPoints = labelSample && (labelSample.totalOriginalEstimateStoryPoints !== undefined || labelSample.totalTimeSpentStoryPoints !== undefined);

    // convert from source unit (hours or SP) to the requested display unit (unitMode)
    const convertValue = (val) => {
      if (!val && val !== 0) return 0;

      if (sourceIsStoryPoints) {
        // val is in SP
        if (unitMode === 'sp') return val;
        if (unitMode === 'hours') return val * 4; // 1 SP = 4 hours
        if (unitMode === 'days') return (val * 4) / 8; // SP -> hours -> days
      } else {
        // val is in hours
        if (unitMode === 'hours') return val;
        if (unitMode === 'days') return hoursToDays(val);
        if (unitMode === 'sp') return hoursToSP(val);
      }

      return val;
    };

    const unitLabel = unitMode === 'hours' ? 'Hours' : unitMode === 'days' ? 'Days' : 'SP';
    const unitShort = unitMode === 'hours' ? 'h' : unitMode === 'days' ? 'd' : 'SP';
    const unitDisplayName = unitMode === 'hours' ? 'hours' : unitMode === 'days' ? 'days' : 'SP';

    const memberLabels = data.map(d => d.member || 'Unknown');
    const plannedHours = data.map(d => convertValue(d.planned || 0));
    const loggedHours = data.map(d => convertValue(d.logged || 0));
    const storyPoints = data.map(d => d.storypoints || 0);

    // Calculate team totals
    const totalPlannedDays = plannedHours.reduce((a, b) => a + (b || 0), 0);
    const totalLoggedDays = loggedHours.reduce((a, b) => a + (b || 0), 0);
    const totalStoryPoints = storyPoints.reduce((a, b) => a + (b || 0), 0);
    const efficiency = totalPlannedDays > 0
      ? parseFloat(((totalLoggedDays / totalPlannedDays) * 100).toFixed(1))
      : 0;

    // Per-member diffs (logged - planned) in current unit mode
    const diffs = plannedHours.map((p, i) => {
      const l = loggedHours[i] || 0;
      return parseFloat((l - (p || 0)).toFixed(2));
    });

    // Overworked members: positive diffs
    const overworkedMembers = memberLabels
      .map((m, i) => ({ member: m, diff: diffs[i] || 0 }))
      .filter(x => x.diff > 0);

    const totalOverworked = overworkedMembers.reduce((s, m) => s + m.diff, 0);

    // Colors for logged bars: red when logged > planned, green otherwise
    const loggedColors = loggedHours.map((l, i) => {
      const p = plannedHours[i] || 0;
      return (l > p) ? 'rgba(255, 99, 132, 0.9)' : 'rgba(75, 192, 75, 0.8)';
    });

    // Create per-label data (like the table columns)
    const labelCharts = {};
    const labelMap = {
      'development': 'Development',
      'issue': 'Issue',
      'training': 'Training',
      'operation': 'Operation',
      'plannedLeave': 'Planned Leave',
      'unplannedLeave': 'Unplanned Leave'
    };

    // Build per-label charts for all known labels (show all categories)
    Object.keys(labelMap).forEach(key => {
      const labelName = labelMap[key] || key;
      const estimatedData = [];
      const loggedData = [];

      data.forEach(member => {
        const labelObj = member[key] || {};
        // prefer story point fields when available, otherwise hours fields
        const estimatedRaw = (labelObj.totalOriginalEstimateStoryPoints !== undefined) ? labelObj.totalOriginalEstimateStoryPoints : (labelObj.totalOriginalEstimateHours !== undefined ? labelObj.totalOriginalEstimateHours : 0);
        const loggedRaw = (labelObj.totalTimeSpentStoryPoints !== undefined) ? labelObj.totalTimeSpentStoryPoints : (labelObj.totalTimeSpentHours !== undefined ? labelObj.totalTimeSpentHours : 0);

        estimatedData.push(convertValue(estimatedRaw));
        loggedData.push(convertValue(loggedRaw));
      });

      labelCharts[labelName] = {
        estimated: estimatedData,
        logged: loggedData
      };
    });

    return {
      memberLabels,
      plannedHours,
      loggedHours,
      storyPoints,
      labelCharts,
      diffs,
      overworkedMembers,
      totalOverworked,
      loggedColors,
      // Team aggregates
      totalPlannedDays,
      totalLoggedDays,
      totalStoryPoints,
      efficiency,
      unitLabel,
      unitShort,
      unitDisplayName,
      convertValue
    };
  }, [data, unitMode]);

  if (!chartData) {
    return <div className="chart-placeholder">No data available for visualization</div>;
  }

  // expose friendly unit display name for the JSX below
  const unitDisplayName = chartData.unitDisplayName;

  // Expanded-per-category logic removed — render all category charts expanded by default

  const effortVsLoggedConfig = {
    labels: chartData.memberLabels,
    datasets: (() => {
      // split logged into within-plan and overwork
      const loggedWithin = chartData.loggedHours.map((l, i) => {
        const p = chartData.plannedHours[i] || 0;
        return Math.min(l || 0, p || 0);
      });
      const overwork = chartData.loggedHours.map((l, i) => {
        const p = chartData.plannedHours[i] || 0;
        return Math.max(0, (l || 0) - (p || 0));
      });

      return [
        {
          type: 'bar',
          label: `Within Plan ${chartData.unitLabel}`,
          data: loggedWithin,
          backgroundColor: 'rgba(75, 192, 75, 0.85)',
          borderColor: 'rgba(75, 192, 75, 1)',
          borderWidth: 0,
          borderRadius: 4,
          stack: 'stack1',
        },
        {
          type: 'bar',
          label: `Overwork ${chartData.unitLabel}`,
          data: overwork,
          backgroundColor: 'rgba(255, 99, 132, 0.95)',
          borderColor: 'rgba(255, 99, 132, 1)',
          borderWidth: 0,
          borderRadius: 4,
          stack: 'stack1',
        },
        {
          type: 'line',
          label: `Planned ${chartData.unitLabel}`,
          data: chartData.plannedHours,
          borderColor: 'rgba(54, 162, 235, 1)',
          borderWidth: 2,
          pointRadius: 3,
          tension: 0.2,
          order: 2,
        }
      ];
    })()
  };

  // storyPointsConfig removed: we keep a single Team Capacity vs Effort chart


  const chartOptions = {
    responsive: true,
    maintainAspectRatio: true,
    plugins: {
      legend: {
        position: 'top',
        labels: {
          font: { size: 13, weight: 'bold' },
          padding: 15,
          usePointStyle: true,
        }
      },
      title: {
        display: false,
      }
    },
    scales: {
      y: {
        beginAtZero: true,
        ticks: {
          font: { size: 12 },
          color: '#666'
        },
        grid: {
          color: 'rgba(0, 0, 0, 0.05)',
        }
      },
      x: {
        ticks: {
          font: { size: 12 },
          color: '#666'
        },
        grid: {
          display: false,
        }
      }
    }
  };

  const pieChartOptions = {
    responsive: true,
    maintainAspectRatio: true,
    plugins: {
      legend: {
        position: 'right',
        labels: {
          font: { size: 12, weight: '500' },
          padding: 15,
          usePointStyle: true,
        }
      }
    }
  };

  return (
    <div className="sprint-visualization">
      {/* Team-Wide Analytics Section */}
      <div className="team-analytics">
        <div className="analytics-header">
          <h2 className='teamheader'>📊 Team Performance Dashboard</h2>
          <div className="unit-toggle" role="group" aria-label="Unit display">
            <div className="unit-selectWrap">
              <select
                id="unit-select"
                className="unit-select"
                value={unitMode} onChange={(e) => setUnitMode(e.target.value)}
                title="Select unit display"
                aria-label="Select unit display"
              >
                <option value="sp">⭐ SP (default)</option>
                <option value="hours">⏱️ Hours</option>
                <option value="days">📅 Days</option>
              </select>

              {/* decorative arrow (no logic impact) */}
              <span className="unit-selectArrow" aria-hidden="true">▾</span>
            </div>
          </div>

          {/* unit selector moved to top-right (.unit-control-top) */}
        </div>
        <div className="analytics-grid">
          <div className="analytics-card primary">
            <div className="card-icon">👥</div>
            <h4>Active Members</h4>
            <div className="analytics-value">{chartData.memberLabels.length}</div>
            <p className="analytics-label">team contributors</p>
          </div>


          <div className="analytics-card">
            <div className="card-icon">✅</div>
            <h4>Effort Logged</h4>
            <div className="analytics-value">
              {chartData.totalLoggedDays !== undefined ? (unitMode === 'hours' ? chartData.totalLoggedDays.toFixed(0) : chartData.totalLoggedDays.toFixed(1)) : '0'}
            </div>
            <p className="analytics-label">{chartData.unitDisplayName} logged</p>
          </div>

          <div className="analytics-card">
            <div className="card-icon">📊</div>
            <h4>Story Points</h4>
            <div className="analytics-value">{chartData.totalStoryPoints}</div>
            <p className="analytics-label">completed</p>
          </div>

          <div className={`analytics-card efficiency-card ${chartData.efficiency >= 80 ? 'high' : chartData.efficiency >= 60 ? 'medium' : 'low'}`}>
            <div className="card-icon">⚡</div>
            <h4>Team Efficiency</h4>
            <div className="analytics-value">{chartData.efficiency}%</div>
            <p className="analytics-label">
              {chartData.efficiency >= 80 ? '🚀 Excellent' : chartData.efficiency >= 60 ? '📈 Good' : '⚠️ Needs Attention'}
            </p>
          </div>

          <div className="analytics-card overwork-card">
            <div className="card-icon">🔥</div>
            <h4>Overworked</h4>
            <div className="analytics-value" style={{ color: chartData.overworkedMembers.length ? '#ef4444' : '#10b981' }}>
              {chartData.overworkedMembers.length} / {chartData.memberLabels.length}
            </div>
            <p className="analytics-label">members overworked • total {chartData.totalOverworked.toFixed(1)} {chartData.unitShort}</p>
            {chartData.overworkedMembers.length > 0 && (
              <div className="overwork-list">
                {chartData.overworkedMembers.slice(0, 4).map(m => (
                  <div key={m.member} className="overwork-item">{m.member}: <strong style={{ color: '#ef4444' }}>{m.diff}{chartData.unitShort}</strong></div>
                ))}
                {chartData.overworkedMembers.length > 4 && <div className="overwork-more">and {chartData.overworkedMembers.length - 4} more...</div>}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main Charts Section */}
      <div className="charts-section">
        <h3 className="section-title">📈 Sprint Metrics</h3>
        <div className="charts-container">
          {/* Effort vs Logged Chart */}
          <div className="chart-card">
            <div className="chart-header">
              <h4>Team Capacity vs Effort</h4>
              <span className="chart-badge">Overall</span>
            </div>
            <p className="chart-description">Planned vs actual {unitDisplayName} logged by each team member{unitMode === 'days' ? ' (8 hours = 1 day)' : unitMode === 'sp' ? ' (4 hours = 1 SP)' : ''}</p>
            <div className="chart-wrapper">
              <Bar
                data={effortVsLoggedConfig}
                options={{
                  ...chartOptions,
                  plugins: {
                    ...chartOptions.plugins,
                    title: { ...chartOptions.plugins.title, text: '' }
                  }
                }}
              />
            </div>
          </div>

          {/* Story Points chart removed — single main chart now visualizes capacity vs effort */}
        </div>
      </div>

      {/* Per-Category Section */}
      {(() => {
        const labelNames = Object.keys(chartData.labelCharts || {});
        if (labelNames.length === 0) {
          return (
            <div className="category-section">
              <h3 className="section-title">🏷️ Category Breakdown</h3>
              <p className="section-subtitle">No category data available for this sprint.</p>
            </div>
          );
        }

        // when few categories selected, render charts inline
        if (labelNames.length <= 3) {
          return (
            <div className="category-section">
              <h3 className="section-title">🏷️ Category Breakdown</h3>
              <p className="section-subtitle">Detailed view of {unitDisplayName} per category</p>
              <div className="charts-container">
                {labelNames.map((labelName, index) => {
                  const labelData = chartData.labelCharts[labelName];
                  const categoryColors = [
                    { bg: 'rgba(100, 150, 200, 0.8)', border: 'rgba(100, 150, 200, 1)' },
                    { bg: 'rgba(150, 100, 200, 0.8)', border: 'rgba(150, 100, 200, 1)' },
                    { bg: 'rgba(100, 200, 150, 0.8)', border: 'rgba(100, 200, 150, 1)' },
                    { bg: 'rgba(200, 150, 100, 0.8)', border: 'rgba(200, 150, 100, 1)' },
                    { bg: 'rgba(200, 100, 150, 0.8)', border: 'rgba(200, 100, 150, 1)' },
                    { bg: 'rgba(150, 200, 100, 0.8)', border: 'rgba(150, 200, 100, 1)' },
                  ];
                  const colors = categoryColors[index % categoryColors.length];



                  const labelConfig = (() => {
                    // split per-member logged into within-estimate and overwork
                    const loggedWithin = labelData.logged.map((l, i) => {
                      const est = labelData.estimated[i] || 0;
                      return Math.min(l || 0, est || 0);
                    });
                    const overwork = labelData.logged.map((l, i) => {
                      const est = labelData.estimated[i] || 0;
                      return Math.max(0, (l || 0) - (est || 0));
                    });

                    return {
                      labels: chartData.memberLabels,
                      datasets: [
                        {
                          type: 'bar',
                          label: `Within Est. ${chartData.unitLabel}`,
                          data: loggedWithin,
                          backgroundColor: 'rgba(75, 192, 75, 0.85)',
                          borderColor: 'rgba(75, 192, 75, 1)',
                          borderWidth: 0,
                          borderRadius: 4,
                          stack: 'stack1',
                        },
                        {
                          type: 'bar',
                          label: `Overwork ${chartData.unitLabel}`,
                          data: overwork,
                          backgroundColor: 'rgba(255, 99, 132, 0.95)',
                          borderColor: 'rgba(255, 99, 132, 1)',
                          borderWidth: 0,
                          borderRadius: 4,
                          stack: 'stack1',
                        },
                        {
                          type: 'line',
                          label: `Estimated ${chartData.unitLabel}`,
                          data: labelData.estimated,
                          borderColor: colors.border,
                          borderWidth: 2,
                          pointRadius: 2,
                          tension: 0.2,
                          order: 2,
                        }
                      ]
                    };
                  })();

                  const sumEstimated = labelData.estimated.reduce((a, b) => a + (b || 0), 0);
                  const sumLogged = labelData.logged.reduce((a, b) => a + (b || 0), 0);
                  const total = sumEstimated + sumLogged;

                  return (
                    <div key={labelName} className="chart-card category-card">
                      <div className="chart-header">
                        <h4>{labelName}</h4>
                        <span className="chart-badge category">{labelName}</span>
                      </div>
                      <p className="chart-description">Estimated vs logged {unitDisplayName} for {labelName.toLowerCase()}</p>
                      <div className="chart-wrapper">
                        {total === 0 ? (
                          <div className="chart-placeholder">No data for this category — try selecting different labels or check worklog entries.</div>
                        ) : (
                          <Bar
                            data={labelConfig}
                            options={{
                              ...chartOptions,
                              plugins: {
                                ...chartOptions.plugins,
                                title: { ...chartOptions.plugins.title, text: '' }
                              }
                            }}
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        }

        // many categories selected: show compact summary cards with 'View' to expand
        return (
          <div className="category-section">
            <h3 className="section-title">🏷️ Category Breakdown</h3>
            <p className="section-subtitle">Detailed view of {unitDisplayName} per category</p>
            <div className="charts-container">
              {labelNames.map((labelName, index) => {
                const labelData = chartData.labelCharts[labelName];
                const categoryColors = [
                  { bg: 'rgba(100, 150, 200, 0.8)', border: 'rgba(100, 150, 200, 1)' },
                  { bg: 'rgba(150, 100, 200, 0.8)', border: 'rgba(150, 100, 200, 1)' },
                  { bg: 'rgba(100, 200, 150, 0.8)', border: 'rgba(100, 200, 150, 1)' },
                ];
                const colors = categoryColors[index % categoryColors.length];

                // build full label chart (expanded by default)
                const loggedWithin = labelData.logged.map((l, i) => {
                  const est = labelData.estimated[i] || 0;
                  return Math.min(l || 0, est || 0);
                });
                const overwork = labelData.logged.map((l, i) => {
                  const est = labelData.estimated[i] || 0;
                  return Math.max(0, (l || 0) - (est || 0));
                });
                const cfg = {
                  labels: chartData.memberLabels,
                  datasets: [
                    { type: 'bar', label: `Within Est. ${chartData.unitLabel}`, data: loggedWithin, backgroundColor: 'rgba(75, 192, 75, 0.85)', borderRadius: 4, stack: 'stack1' },
                    { type: 'bar', label: `Overwork ${chartData.unitLabel}`, data: overwork, backgroundColor: 'rgba(255, 99, 132, 0.95)', borderRadius: 4, stack: 'stack1' },
                    { type: 'line', label: `Estimated ${chartData.unitLabel}`, data: labelData.estimated, borderColor: colors.border, borderWidth: 2, pointRadius: 2 }
                  ]
                };

                const sumEstimated = labelData.estimated.reduce((a, b) => a + (b || 0), 0);
                const sumLogged = labelData.logged.reduce((a, b) => a + (b || 0), 0);

                return (
                  <div key={labelName} className="chart-card category-card full-width">
                    <div className="chart-header">
                      <h4>{labelName}</h4>
                      <span className="chart-badge category">{labelName}</span>
                    </div>
                    <p className="chart-description">Estimated vs logged {unitDisplayName} for {labelName.toLowerCase()}</p>
                    <div className="chart-wrapper">
                      {sumEstimated + sumLogged === 0 ? (
                        <div className="chart-placeholder">No data for this category — try selecting different labels or check worklog entries.</div>
                      ) : (
                        <Bar data={cfg} options={chartOptions} />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
