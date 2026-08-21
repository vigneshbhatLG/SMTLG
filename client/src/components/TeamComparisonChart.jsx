import React, { useMemo } from 'react';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend } from 'chart.js';
import { Bar } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

const TEAM_NAMES = {
    0: 'SMC',
    1: 'HEI',
    2: 'MCH',
    3: 'CSA',
};

// Spelled out in the tooltip, where there is room for it
const TEAM_FULL_NAMES = {
    0: 'Smart Media & Connectivity',
    1: 'Home Experience & Input Apps',
    2: 'Multiscreen & CH Apps',
    3: 'Core System Apps',
};

const TEAM_COLORS = {
    0: { created: '#6366f1', reopened: '#f97316', resolved: '#22c55e' },
    1: { created: '#8b5cf6', reopened: '#fb923c', resolved: '#4ade80' },
    2: { created: '#3b82f6', reopened: '#f59e0b', resolved: '#34d399' },
    3: { created: '#06b6d4', reopened: '#ef4444', resolved: '#a3e635' },
};

export default function TeamComparisonChart({ snapshots, activeTeam, period }) {
    const chartData = useMemo(() => {
        if (!snapshots.length) return null;

        // Aggregate by period
        const periodMap = new Map();
        for (const s of snapshots) {
            let key = s.date;
            if (period === 'week') {
                const d = new Date(s.date);
                const sow = new Date(d);
                sow.setDate(d.getDate() - d.getDay());
                key = sow.toISOString().slice(0, 10);
            } else if (period === 'month') {
                key = s.date.slice(0, 7);
            }

            if (!periodMap.has(key)) periodMap.set(key, { 0: { c: 0, r: 0, res: 0 }, 1: { c: 0, r: 0, res: 0 }, 2: { c: 0, r: 0, res: 0 }, 3: { c: 0, r: 0, res: 0 } });
            const entry = periodMap.get(key);
            for (const [tid, tdata] of Object.entries(s.byTeam || {})) {
                const id = Number(tid);
                if (entry[id] !== undefined) {
                    entry[id].c += (tdata.assigned ?? tdata.created) || 0;
                    entry[id].r += tdata.reopened || 0;
                    entry[id].res += tdata.resolved || 0;
                }
            }
        }

        const entries = [...periodMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
        const labels = entries.map(([k]) => {
            if (period === 'month') {
                const [y, m] = k.split('-');
                return new Date(y, m - 1).toLocaleString('default', { month: 'short', year: '2-digit' });
            }
            if (period === 'week') return `W/o ${k.slice(5)}`;
            return k.slice(5);
        });

        const teamIds = activeTeam === 'all' ? [0, 1, 2, 3] : [Number(activeTeam)];
        const datasets = [];

        for (const id of teamIds) {
            const name = TEAM_NAMES[id];
            const colors = TEAM_COLORS[id];
            // teamName/metric are read back by the tooltip callbacks so a hovered bar
            // can name itself without re-parsing the dataset label.
            const meta = { teamName: TEAM_FULL_NAMES[id] || name, teamShort: name, stack: `t${id}` };
            datasets.push(
                { ...meta, label: `${name} Assigned`, metric: 'Assigned', data: entries.map(([, v]) => v[id].c), backgroundColor: colors.created },
                { ...meta, label: `${name} Reopened`, metric: 'Reopened', data: entries.map(([, v]) => v[id].r), backgroundColor: colors.reopened },
                { ...meta, label: `${name} Resolved`, metric: 'Resolved', data: entries.map(([, v]) => v[id].res), backgroundColor: colors.resolved },
            );
        }

        return { labels, datasets };
    }, [snapshots, activeTeam, period]);

    if (!chartData) return <div className="health-empty">No data available</div>;

    return (
        <div className="health-chart-wrap">
            <Bar
                data={chartData}
                options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    // Only the hovered bar — 'index' would dump all 12 team/metric series
                    // into one tooltip.
                    interaction: { mode: 'nearest', intersect: true },
                    plugins: {
                        legend: { position: 'top', labels: { boxWidth: 10, font: { size: 10 } } },
                        tooltip: {
                            displayColors: false,
                            padding: 10,
                            titleFont: { size: 12 },
                            bodyFont: { size: 12 },
                            callbacks: {
                                title: (items) => items[0]?.dataset?.teamName || '',
                                beforeBody: (items) => `Period: ${items[0]?.label ?? ''}`,
                                // One bar is hovered, but all three of that team's metrics
                                // are listed — they share the team's stack id.
                                label: (item) => {
                                    const { stack } = item.dataset;
                                    const i = item.dataIndex;
                                    return item.chart.data.datasets
                                        .filter(ds => ds.stack === stack)
                                        .map(ds => `${ds.teamShort} ${ds.metric}: ${ds.data[i] ?? 0}`);
                                },
                            },
                        },
                    },
                    scales: {
                        x: { ticks: { maxTicksLimit: 20, font: { size: 10 } }, grid: { display: false } },
                        y: { beginAtZero: true, ticks: { font: { size: 10 } } }
                    }
                }}
            />
        </div>
    );
}
