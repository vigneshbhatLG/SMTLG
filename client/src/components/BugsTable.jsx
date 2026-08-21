import React, { useState } from "react";
import './css/ItemSections.css';


const BugsTable = ({
	hierarchicalItems,
	issueTypes,
	expandedBugsListSections,
	setExpandedBugsListSections,
	ISSUE_TYPE_CONFIG,
	}) => {

	const [filterUser, setFilterUser] = useState("");
	const [filterLongHold, setFilterLongHold] = useState(false);
	const [overallStatus, setOverallStatus] = useState(null);

	const sendOverallReport = async () => {
		setOverallStatus('sending');
		try {
			const res = await fetch(`/cron/send-overall-report`, { method: 'POST' });
			if (res.ok) {
				// Open the HTML response as a preview in a new tab
				const html = await res.text();
				const blob = new Blob([html], { type: 'text/html' });
				window.open(URL.createObjectURL(blob), '_blank');
				setOverallStatus('success');
			} else {
				setOverallStatus('error');
			}
		} catch {
			setOverallStatus('error');
		} finally {
			setTimeout(() => setOverallStatus(null), 4000);
		}
	};

	// ✅ FORMAT TIME
	const formatDuration = (ms) => {
		const h = Math.floor(ms / 3600000);
		const d = Math.floor(h / 24);
		return d > 0 ? `${d}d ${h % 24}h` : `${h}h`;
	};

	// ✅ PROCESS FUNCTION
	const processItems = (items) => {
		return items
		.map(item => {

			const history = item.assigneeHistory || [];

			// ✅ TIMELINE
			const timeline = history.map((h, i) => {
			const start = new Date(h.date);
			const end = history[i + 1]
				? new Date(history[i + 1].date)
				: new Date();

			return {
				user: h.toString,
				start,
				end,
				duration: end - start
			};
			});

			// ✅ FLOW (JSX - FIXED ✅)
			const flow = timeline
			.map(t => `${t.user} (${formatDuration(t.duration)})`)
			.join(" → ");


			// ✅ CURRENT USER
			const current = timeline[timeline.length - 1];
			const currentUser = current?.user || item.assignee;

			// ✅ CURRENT HOLD
			const currentHoldingMs = current
			? new Date() - current.start
			: 0;

			const currentHolding = formatDuration(currentHoldingMs);

			// ✅ TOTAL HOLD + COUNT
			const userEntries = timeline.filter(t => t.user === currentUser);

			const totalHoldingTime = userEntries.reduce(
			(sum, t) => sum + t.duration, 0
			);

			const assignmentCount = userEntries.length;

			return {
			...item,
			flow,
			currentUser,
			currentHolding,
			currentHoldingMs,
			totalHolding: `${formatDuration(totalHoldingTime)} (${currentUser?.split(' ')[0]} ${assignmentCount} times)`
			};
		})
		.filter(item =>
			(!filterUser || item.currentUser.toLowerCase().includes(filterUser.toLowerCase())) &&
			(!filterLongHold || item.currentHoldingMs > 48 * 3600000)
		)
		.sort((a, b) => b.currentHoldingMs - a.currentHoldingMs);
	};

	// ✅ CSV EXPORT
	const exportToCSV = (data) => {
		const header = "Key,CurrentUser,CurrentHolding,TotalHolding\n";

		const rows = data.map(i =>
		`${i.key},${i.currentUser},${i.currentHolding},"${i.totalHolding}"`
		).join("\n");

		const blob = new Blob([header + rows], { type: "text/csv" });
		const url = URL.createObjectURL(blob);

		const a = document.createElement("a");
		a.href = url;
		a.download = "issue-report.csv";
		a.click();
	};

	return (
		<>
		{/* ✅ FILTERS */}
		<div style={{ marginBottom: 10 }}>
			<input
			placeholder="Filter by user"
			value={filterUser}
			onChange={(e) => setFilterUser(e.target.value)}
			/>

			<label style={{ marginLeft: 10 }}>
			<input
				type="checkbox"
				checked={filterLongHold}
				onChange={() => setFilterLongHold(!filterLongHold)}
			/>
			{' '}Holding &gt; 48h
			</label>
		</div>

		{Object.entries(hierarchicalItems).map(([type, items]) => {
			if (!items.length || !issueTypes.includes(type)) return null;

			const config = ISSUE_TYPE_CONFIG[type];
			const isExpanded = expandedBugsListSections[type] || false;

			const processedItems = processItems(items);

			return (
			<div key={type} className="item-section">

				{/* ✅ HEADER */}
				<div
				className="section-header"
				style={{ borderLeftColor: config.color }}
				onClick={() =>
					setExpandedBugsListSections(prev => ({
					...prev,
					[type]: !prev[type],
					}))
				}
				>
				<span>{isExpanded ? "▼" : "▶"}</span>
				<b>{'Issue Assignee Tracker'} ({items.length})</b>
				</div>

				{/* ✅ TABLE */}
				{isExpanded && (
				<div>

					<button onClick={() => exportToCSV(processedItems)}>
					Export CSV
					</button>

					<button
					onClick={sendOverallReport}
					disabled={overallStatus === 'sending'}
					style={{ marginLeft: 8 }}
					>
					{overallStatus === 'sending' ? 'Generating...' : 'Overall Report (15 Days)'}
					</button>
					{overallStatus === 'success' && <span style={{ marginLeft: 8, color: 'green' }}>Report sent & opened!</span>}
					{overallStatus === 'error' && <span style={{ marginLeft: 8, color: 'red' }}>Failed to generate.</span>}

					<table className="items-table">
					<thead>
						<tr>
						<th>Key</th>
						<th>Created</th>
						<th>Current</th>
						<th>Flow</th>
						<th>Current Holding</th>
						<th>Total Holding</th>
						</tr>
					</thead>

					<tbody>
						{processedItems.map(item => (
						<tr key={item.key}>
							<td>
							<a href={item.link} target="_blank" rel="noopener noreferrer">
								{item.key}
							</a>
							</td>

							<td>
							{new Date(item.createdDate).toLocaleDateString()}
							</td>

							<td>{item.currentUser}</td>

							{/* ✅ FIXED FLOW USAGE */}
							<td style={{ maxWidth: 400 }}>
							{item.flow}
							</td>

							<td style={{
							color: item.currentHoldingMs > 48 * 3600000 ? "red" : "green"
							}}>
							{item.currentHolding}
							</td>

							<td>{item.totalHolding}</td>
						</tr>
						))}
					</tbody>
					</table>

				</div>
				)}
			</div>
			);
		})}
		</>
	);
};

export default BugsTable;