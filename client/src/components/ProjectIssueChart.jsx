import React, { useMemo, useState } from 'react';
import {
    Chart as ChartJS,
    CategoryScale, LinearScale, LineElement,
    PointElement, Title, Tooltip, Legend, Filler
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import { formatLabel, toBuckets } from '../utils/snapshotBuckets';
import { buildProjectOptions, isRichBucket } from '../utils/projects';

ChartJS.register(CategoryScale, LinearScale, LineElement, PointElement, Title, Tooltip, Legend, Filler);

const EMPTY_ROW = {
    assigned: 0, resolved: 0, reopened: 0,
    open: 0, inProgress: 0, reopenedOpen: 0, resolvedTotal: 0, unresolved: 0, stalled: 0,
};

function sumBuckets(byProject) {
    const total = { ...EMPTY_ROW };
    for (const bucket of Object.values(byProject || {})) {
        if (!isRichBucket(bucket)) continue;
        for (const field of Object.keys(EMPTY_ROW)) total[field] += bucket[field] || 0;
    }
    return total;
}

export default function ProjectIssueChart({ snapshots }) {
    const [projectKey, setProjectKey] = useState('all');
    const [grouping, setGrouping] = useState('week');

    // Every project seen across the range, ranked by the configured list then by volume
    const projectOptions = useMemo(() => buildProjectOptions(snapshots), [snapshots]);

    const chartData = useMemo(() => {
        if (!snapshots.length) return null;

        const rows = [...snapshots]
            .sort((a, b) => a.date.localeCompare(b.date))
            .map(s => {
                const source = projectKey === 'all'
                    ? sumBuckets(s.byProject)
                    : (isRichBucket(s.byProject?.[projectKey]) ? s.byProject[projectKey] : EMPTY_ROW);
                return { date: s.date, ...EMPTY_ROW, ...source };
            });

        const buckets = toBuckets(rows, grouping);
        if (!buckets.length) return null;

        const pointRadius = grouping === 'day' ? 2 : 4;

        return {
            labels: buckets.map(b => formatLabel(b.key, grouping)),
            datasets: [
                {
                    label: 'Open',
                    data: buckets.map(b => b.stock.open),
                    borderColor: '#6366f1',
                    backgroundColor: 'rgba(99,102,241,0.10)',
                    fill: true,
                    tension: 0.3,
                    pointRadius,
                },
                {
                    label: 'In Progress',
                    data: buckets.map(b => b.stock.inProgress),
                    borderColor: '#0ea5e9',
                    backgroundColor: 'transparent',
                    fill: false,
                    tension: 0.3,
                    pointRadius,
                },
                {
                    label: 'Reopened',
                    data: buckets.map(b => b.stock.reopenedOpen),
                    borderColor: '#f97316',
                    backgroundColor: 'transparent',
                    fill: false,
                    tension: 0.3,
                    pointRadius,
                },
                {
                    label: 'Stalled (>7d idle)',
                    data: buckets.map(b => b.stock.stalled),
                    borderColor: '#ef4444',
                    backgroundColor: 'transparent',
                    fill: false,
                    tension: 0.3,
                    borderDash: [4, 4],
                    pointRadius,
                },
                {
                    label: 'Resolved (in period)',
                    data: buckets.map(b => b.resolved),
                    borderColor: '#22c55e',
                    backgroundColor: 'transparent',
                    fill: false,
                    tension: 0.3,
                    pointRadius,
                },
                {
                    label: 'Newly Assigned (in period)',
                    data: buckets.map(b => b.assigned),
                    borderColor: '#8b5cf6',
                    backgroundColor: 'transparent',
                    fill: false,
                    tension: 0.3,
                    borderDash: [2, 3],
                    pointRadius,
                },
            ],
        };
    }, [snapshots, projectKey, grouping]);

    const options = {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
            legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 } } },
            tooltip: { callbacks: { title: (items) => items[0].label } },
        },
        scales: {
            x: { ticks: { maxTicksLimit: 20, font: { size: 10 } }, grid: { display: false } },
            y: { beginAtZero: true, ticks: { font: { size: 10 } } },
        },
    };

    return (
        <>
            <div className="health-project-controls">
                <select
                    className="health-select"
                    value={projectKey}
                    onChange={(e) => setProjectKey(e.target.value)}
                    aria-label="Filter by project"
                >
                    <option value="all">All Projects ({projectOptions.length})</option>
                    {projectOptions.map(p => (
                        <option key={p.key} value={p.key}>{p.name} ({p.key})</option>
                    ))}
                </select>
                <div className="health-period-toggle">
                    {['day', 'week', 'month'].map(g => (
                        <button
                            key={g}
                            className={`health-toggle-btn ${grouping === g ? 'active' : ''}`}
                            onClick={() => setGrouping(g)}
                        >
                            {g.charAt(0).toUpperCase() + g.slice(1)}
                        </button>
                    ))}
                </div>
            </div>

            {chartData
                ? <div className="health-chart-wrap"><Line data={chartData} options={options} /></div>
                : <div className="health-empty">No project data available — run “Reload Historical Data”</div>
            }
        </>
    );
}
