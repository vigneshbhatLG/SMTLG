import React, { useMemo } from 'react';
import {
    Chart as ChartJS,
    CategoryScale, LinearScale, BarController, BarElement, LineController, LineElement,
    PointElement, Title, Tooltip, Legend, Filler
} from 'chart.js';
import { Chart } from 'react-chartjs-2';
import { formatLabel, dateRange, toBuckets, ZERO_STOCK } from '../utils/snapshotBuckets';

ChartJS.register(
    CategoryScale, LinearScale, BarController, BarElement, LineController, LineElement,
    PointElement, Title, Tooltip, Legend, Filler
);

function normalize(s) {
    const teams = Object.values(s.byTeam || {});
    const sumTeams = (field) => teams.reduce((t, v) => t + (v[field] || 0), 0);
    const open = s.openCount || 0;
    const inProgress = s.inProgressCount || 0;
    const reopenedOpen = s.reopenedOpenCount || 0;

    return {
        date: s.date,
        // flow
        assigned: s.assignedCount ?? s.totalCount ?? 0,
        resolved: s.resolvedCount ?? sumTeams('resolved'),
        reopened: s.reopenedCount ?? sumTeams('reopened'),
        // stock
        open,
        inProgress,
        reopenedOpen,
        resolvedTotal: s.resolvedTotalCount || 0,
        unresolved: s.unresolvedCount ?? (open + inProgress + reopenedOpen),
        stalled: s.stalledCount || 0,
        // snapshots written before status tracking have no stock fields
        hasStock: s.openCount !== undefined,
    };
}

export default function IssueFlowChart({ snapshots, period, selectedSprint, sprints = [] }) {
    const result = useMemo(() => {
        if (!snapshots.length) return null;

        const rows = snapshots.map(normalize).sort((a, b) => a.date.localeCompare(b.date));

        // Sprint mode with nothing selected: one column per sprint, Sprint 1 → latest
        if (period === 'sprint' && !selectedSprint) {
            if (!sprints.length) return null;

            const byDate = new Map(rows.map(r => [r.date, r]));
            const points = sprints.map(sp => {
                let assigned = 0;
                let resolved = 0;
                let reopened = 0;
                let endStock = ZERO_STOCK;
                for (const date of dateRange(sp.start, sp.end)) {
                    const r = byDate.get(date);
                    if (!r) continue;
                    assigned += r.assigned;
                    resolved += r.resolved;
                    reopened += r.reopened;
                    endStock = r; // last day of the sprint that has a snapshot
                }
                return { label: sp.shortName, assigned, resolved, reopened, endStock };
            });

            return {
                type: 'bar',
                data: {
                    labels: points.map(p => p.label),
                    datasets: [
                        {
                            type: 'bar',
                            label: 'Assigned',
                            data: points.map(p => p.assigned),
                            backgroundColor: '#8b5cf6',
                        },
                        {
                            type: 'bar',
                            label: 'Resolved',
                            data: points.map(p => p.resolved),
                            backgroundColor: '#22c55e',
                        },
                        {
                            type: 'bar',
                            label: 'Reopened',
                            data: points.map(p => p.reopened),
                            backgroundColor: '#f97316',
                        },
                        {
                            type: 'line',
                            label: 'Open / In Progress at sprint end',
                            data: points.map(p => p.endStock.unresolved),
                            borderColor: '#6366f1',
                            backgroundColor: 'transparent',
                            borderWidth: 2,
                            tension: 0.3,
                            pointRadius: 3,
                        },
                    ],
                },
            };
        }

        if (period === 'sprint') {
            const startDate = selectedSprint.startDate?.slice(0, 10);
            const endDate = (selectedSprint.endDate || selectedSprint.completeDate)?.slice(0, 10);
            if (!startDate || !endDate) return null;

            const byDate = new Map(rows.map(r => [r.date, r]));
            // Stock is continuous, so a missing day carries the previous day's state forward
            // rather than dropping the line to zero.
            const days = [];
            let carried = [...rows].reverse().find(r => r.date < startDate) || ZERO_STOCK;
            for (const date of dateRange(startDate, endDate)) {
                const r = byDate.get(date);
                if (r) {
                    carried = r;
                    days.push({ ...r, date });
                } else {
                    days.push({
                        date,
                        assigned: 0, resolved: 0, reopened: 0,
                        open: carried.open, inProgress: carried.inProgress,
                        reopenedOpen: carried.reopenedOpen, resolvedTotal: carried.resolvedTotal,
                        unresolved: carried.unresolved, stalled: carried.stalled,
                    });
                }
            }

            const labels = days.map(d => d.date.slice(5));

            let cumAssigned = 0;
            const assignedLine = days.map(d => (cumAssigned += d.assigned));

            let cumResolved = 0;
            const resolvedLine = days.map(d => (cumResolved += d.resolved));

            // Real remaining work — the issues actually sitting in a non-resolved status
            const remainingLine = days.map(d => d.unresolved);

            const startScope = remainingLine[0] || 0;
            const idealLine = days.map((_, i) =>
                Math.round(startScope - (startScope / (days.length - 1 || 1)) * i)
            );

            return {
                type: 'line',
                data: {
                labels,
                datasets: [
                    {
                        label: 'Ideal Burndown',
                        data: idealLine,
                        borderColor: '#94a3b8',
                        backgroundColor: 'transparent',
                        borderDash: [6, 4],
                        borderWidth: 2,
                        pointRadius: 0,
                        tension: 0,
                    },
                    {
                        label: 'Open / In Progress (remaining)',
                        data: remainingLine,
                        borderColor: '#6366f1',
                        backgroundColor: 'rgba(99,102,241,0.10)',
                        fill: true,
                        borderWidth: 2.5,
                        tension: 0.3,
                        pointRadius: 3,
                    },
                    {
                        label: 'Resolved (cumulative)',
                        data: resolvedLine,
                        borderColor: '#22c55e',
                        backgroundColor: 'transparent',
                        borderWidth: 2,
                        tension: 0.3,
                        pointRadius: 3,
                    },
                    {
                        label: 'Newly Assigned (cumulative)',
                        data: assignedLine,
                        borderColor: '#8b5cf6',
                        backgroundColor: 'transparent',
                        borderWidth: 2,
                        tension: 0.3,
                        pointRadius: 3,
                    },
                ],
                },
            };
        }

        const buckets = toBuckets(rows, period);
        if (!buckets.length) return null;

        const labels = buckets.map(b => formatLabel(b.key, period));
        const pointRadius = period === 'day' ? 2 : 4;

        return {
            type: 'line',
            data: {
            labels,
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
                    backgroundColor: 'rgba(14,165,233,0.10)',
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
            },
        };
    }, [snapshots, period, selectedSprint, sprints]);

    if (!result) {
        return <div className="health-empty">No data available — check snapshot data</div>;
    }

    const isSprintOverview = period === 'sprint' && !selectedSprint;

    const commonOptions = {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
            legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 } } },
            tooltip: { callbacks: { title: (items) => items[0].label } }
        },
        scales: {
            x: {
                ticks: { maxTicksLimit: period === 'sprint' ? 30 : 20, font: { size: 10 } },
                grid: { display: false },
                ...(isSprintOverview ? { stacked: false } : {}),
            },
            y: { beginAtZero: true, ticks: { font: { size: 10 } } }
        }
    };

    return (
        <div className="health-chart-wrap">
            <Chart type={result.type} data={result.data} options={commonOptions} />
        </div>
    );
}
