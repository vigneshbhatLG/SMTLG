import React, { useMemo, useState, useEffect } from "react";
import { useSelector, useDispatch } from "react-redux";
import { fetchTeamTVPMsCounts, setTVPMsDateFilters } from "../store/slice/worklogSlice";
import './css/TVPMsView.css';

const TVPMsView = () => {
	const dispatch = useDispatch();
	const selectedTeamId = useSelector((state) => state.auth.selectedTeamId);
	const user = useSelector((state) => state.auth.user);
	const teamTVPMsData = useSelector((state) => state.worklog.teamTVPMsData);

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
	const [fromDate, setFromDate] = useState(() => teamTVPMsData.fromDate || getDefaultDates().fromDate);
	const [toDate, setToDate] = useState(() => teamTVPMsData.toDate || getDefaultDates().toDate);

	// Initialize Redux with default dates on first mount if needed
	useEffect(() => {
		if (!teamTVPMsData.fromDate || !teamTVPMsData.toDate) {
			const defaults = getDefaultDates();
			dispatch(setTVPMsDateFilters({
				fromDate: defaults.fromDate,
				toDate: defaults.toDate
			}));
		}
	}, []);



	// Handle date changes and save to Redux
	const handleFromDateChange = (e) => {
		const newDate = e.target.value;
		setFromDate(newDate);
		dispatch(setTVPMsDateFilters({ fromDate: newDate, toDate }));
	};

	const handleToDateChange = (e) => {
		const newDate = e.target.value;
		setToDate(newDate);
		dispatch(setTVPMsDateFilters({ fromDate, toDate: newDate }));
	};

	// Fetch TVPMs counts based on selected dates and team
	useEffect(() => {
		if (selectedTeamId == null || !fromDate || !toDate) {
			return;
		}

		dispatch(fetchTeamTVPMsCounts({
			teamId: selectedTeamId,
			fromDate,
			toDate
		}));
	}, [selectedTeamId, fromDate, toDate, dispatch]);

	// Derive members from TVPMs counts and sort by count
	const membersWithTVPMs = useMemo(() => {
		return Object.entries(teamTVPMsData.counts)
			.map(([name, tvpmCount]) => ({
				name,
				tvpmCount
			}))
			.sort((a, b) => b.tvpmCount - a.tvpmCount);
	}, [teamTVPMsData.counts]);

	return (
		<div className="tvpms-view">
			<div className="tvpms-filters">
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
			{teamTVPMsData.status === 'loading' && <div className="loading-state">Loading TVPM data...</div>}
			{teamTVPMsData.status !== 'loading' && (!membersWithTVPMs || membersWithTVPMs.length === 0) && (
				<div className="empty-state">
					<p>No TVPM data available. Select a date range to load data.</p>
				</div>
			)}
			{teamTVPMsData.status !== 'loading' && membersWithTVPMs && membersWithTVPMs.length > 0 && (
				<div className="tvpms-container">
					<table className="tvpms-table">
						<thead>
							<tr>
								<th>Member Name</th>
								<th>TVPMs Count</th>
							</tr>
						</thead>
						<tbody>
							{membersWithTVPMs.map((member, idx) => (
								<tr key={idx} className={member.tvpmCount === 0 ? 'zero-tvpms' : ''}>
									<td className="member-name">
										{member.name}
										{user?.name === member.name && <span className="badge-you">(You)</span>}
									</td>
									<td className="tvpm-count">
										<span className={`tvpm-badge ${member.tvpmCount > 0 ? 'active' : 'inactive'}`}>
											{member.tvpmCount || 0}
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

export default TVPMsView;
