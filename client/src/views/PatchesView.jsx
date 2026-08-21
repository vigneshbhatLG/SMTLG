import React, { useMemo, useState, useEffect } from "react";
import { useSelector, useDispatch } from "react-redux";
import { fetchTeamPatchCounts, setPatchDateFilters } from "../store/slice/worklogSlice";
import './css/PatchesView.css';

const PatchesView = ({ patchCountsByMember = {} }) => {
	const dispatch = useDispatch();
	const teams = useSelector((state) => state.auth.teams);
	const selectedTeamId = useSelector((state) => state.auth.selectedTeamId);
	const user = useSelector((state) => state.auth.user);
	const teamPatchData = useSelector((state) => state.worklog.teamPatchData);

	// Calculate default dates (last month)
	const getDefaultDates = () => {
		const today = new Date();
		const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, today.getDate());
		return {
			toDate: today.toISOString().split('T')[0],
			fromDate: lastMonth.toISOString().split('T')[0]
		};
	};

	// Initialize dates with lazy initialization to avoid cascading renders
	const [fromDate, setFromDate] = useState(() => teamPatchData.fromDate || getDefaultDates().fromDate);
	const [toDate, setToDate] = useState(() => teamPatchData.toDate || getDefaultDates().toDate);
	const [selectedApplication, setSelectedApplication] = useState('');

	// Initialize Redux with default dates on first mount if needed
	useEffect(() => {
		if (!teamPatchData.fromDate || !teamPatchData.toDate) {
			const defaults = getDefaultDates();
			dispatch(setPatchDateFilters({
				fromDate: defaults.fromDate,
				toDate: defaults.toDate
			}));
		}
	}, []);



	// Handle date changes and save to Redux
	const handleFromDateChange = (e) => {
		const newDate = e.target.value;
		setFromDate(newDate);
		dispatch(setPatchDateFilters({ fromDate: newDate, toDate }));
	};

	const handleToDateChange = (e) => {
		const newDate = e.target.value;
		setToDate(newDate);
		dispatch(setPatchDateFilters({ fromDate, toDate: newDate }));
	};

	// Fetch patch counts based on selected dates and team
	useEffect(() => {
		if (selectedTeamId == null || !fromDate || !toDate) {
			return;
		}

		dispatch(fetchTeamPatchCounts({
			teamId: selectedTeamId,
			fromDate,
			toDate,
			projectPrefix: selectedApplication || undefined
		}));
	}, [selectedTeamId, fromDate, toDate, selectedApplication, dispatch]);

	// Derive members from patch counts and sort by count
	const membersWithPatches = useMemo(() => {
		return Object.entries(teamPatchData.counts)
			.map(([name, patchCount]) => ({
				name,
				patchCount
			}))
			.sort((a, b) => b.patchCount - a.patchCount);
	}, [teamPatchData.counts]);

	// Check if Gerrit is logged in
	if (!user?.gerritConnected) {
		return (
			<div className="patches-view">
				<div className="patches-filters">
					<div className="filter-group">
						<label htmlFor="from-date">From Date:</label>
						<input
							id="from-date"
							type="date"
							value={fromDate}
							onChange={handleFromDateChange}
							className="date-input"
						/>
					</div>
					<div className="filter-group">
						<label htmlFor="to-date">To Date:</label>
						<input
							id="to-date"
							type="date"
							value={toDate}
							onChange={handleToDateChange}
							className="date-input"
						/>
					</div>
				</div>
				<div className="empty-state">
					<p>🔒 Please login to Gerrit to view patch data. Use the header button to sign in.</p>
				</div>
			</div>
		);
	}

	if (!membersWithPatches || membersWithPatches.length === 0) {
		return (
			<div className="patches-view">
				<div className="patches-filters">
					<div className="filter-group">
						<label htmlFor="from-date">From Date:</label>
						<input
							id="from-date"
							type="date"
							value={fromDate}
							onChange={handleFromDateChange}
							className="date-input"
						/>
					</div>
					<div className="filter-group">
						<label htmlFor="to-date">To Date:</label>
						<input
							id="to-date"
							type="date"
							value={toDate}
							onChange={handleToDateChange}
							className="date-input"
						/>
					</div>
					{teamPatchData.applications && teamPatchData.applications.length > 0 && (
						<div className="filter-group">
							<label htmlFor="application-filter">Application:</label>
							<select
								id="application-filter"
								value={selectedApplication}
								onChange={(e) => setSelectedApplication(e.target.value)}
								className="filter-select"
							>
								<option value="">All Applications</option>
								{teamPatchData.applications.map((app, idx) => (
									<option key={idx} value={app}>
										{app}
									</option>
								))}
							</select>
						</div>
					)}
				</div>
				<div className="empty-state">
					<p>No Member patch data available. Select a date range to load data.</p>
				</div>
			</div>
		);
	}

	const needsDateFilter = !fromDate || !toDate;

	return (
		<div className="patches-view">
			<div className="patches-filters">
				<div className="filter-group">
					<label htmlFor="from-date">From Date:</label>
					<input
						id="from-date"
						type="date"
						value={fromDate}
						onChange={handleFromDateChange}
						className="date-input"
					/>
				</div>
				<div className="filter-group">
					<label htmlFor="to-date">To Date:</label>
					<input
						id="to-date"
						type="date"
						value={toDate}
						onChange={handleToDateChange}
						className="date-input"
					/>
				</div>
				{teamPatchData.applications && teamPatchData.applications.length > 0 && (
					<div className="filter-group">
						<label htmlFor="application-filter">Application:</label>
						<select
							id="application-filter"
							value={selectedApplication}
							onChange={(e) => setSelectedApplication(e.target.value)}
							className="filter-select"
						>
							<option value="">All Applications</option>
							{teamPatchData.applications.map((app, idx) => (
								<option key={idx} value={app}>
									{app}
								</option>
							))}
						</select>
					</div>
				)}
			</div>
			{teamPatchData.status === 'loading' && <div className="loading-state">Loading patch data...</div>}
			{teamPatchData.status !== 'loading' && (!fromDate || !toDate) && (
				<div className="empty-state">
					<p>Select both from and to dates to view patch counts</p>
				</div>
			)}
			{teamPatchData.status !== 'loading' && fromDate && toDate && (
				<div className="patches-container">
					<table className="patches-table">
						<thead>
							<tr>
								<th>Member Name</th>
								<th>Patches Count</th>
							</tr>
						</thead>
						<tbody>
							{membersWithPatches.map((member, idx) => (
								<tr key={idx} className={member.patchCount === 0 ? 'zero-patches' : ''}>
									<td className="member-name">
										{member.name}
										{user?.name === member.name && <span className="badge-you">(You)</span>}
									</td>
									<td className="patch-count">
										<span className={`patch-badge ${member.patchCount > 0 ? 'active' : 'inactive'}`}>
											{member.patchCount || 0}
										</span>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</div>
	);
};

export default PatchesView;
