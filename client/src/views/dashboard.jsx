import React, { useEffect, useMemo, useState, useCallback, lazy, Suspense } from "react";
import { Routes, Route, useNavigate } from 'react-router-dom';
import {
	useReactTable,
	getCoreRowModel,
	createColumnHelper
} from "@tanstack/react-table";

// Redux
import { useDispatch, useSelector } from "react-redux";
import { fetchSprintWorklogs } from "../store/slice/worklogSlice";
import { setGerritConnected } from "../store/slice/authSlice";

// Child components
import dashboardColumns from "../utils/columns";
import Table from "../components/table";
import SprintVisualization from "../components/SprintVisualization";
import LabelColumnSelector from "../components/LabelColumnSelector.jsx";
import GerritLoginModal from "../components/GerritLoginModal.jsx";

// Lazy load views
const WorklogPage = lazy(() => import('./WorklogPage'));
const WorkItemsView = lazy(() => import('./WorkItemsView'));
const IssueItemsView = lazy(() => import('./IssueItemsView'));
const PatchesView = lazy(() => import('./PatchesView'));
const TVPMsView = lazy(() => import('./TVPMsView'));
const SprintReviewView = lazy(() => import('./SprintReview'));
const SprintPlanningView = lazy(() => import('./SprintPlanningView'));
const HealthDashboard = lazy(() => import('./HealthDashboard'));

// Styling
import './css/dashboard.css';

const Dashboard = () => {

	const dispatch = useDispatch();
	const navigate = useNavigate();

	const sprints = useSelector((state) => state.sprint.items);
	const selectedSprint = useSelector((state) => state.sprint.selectedSprintId);
	const sprintStatus = useSelector((state) => state.sprint.status);
	const worklogStatus = useSelector((state) => state.worklog.status);
	const worklogs = useSelector((state) => state.worklog.worklogs);
	const lastUpdated = useSelector((state) => state.worklog.updated);
	const worklogPatchCountsByMember = useSelector((state) => state.worklog.patchCountsByMember);
	const user = useSelector((state) => state.auth.user);
	const selectedTeamId = useSelector((state) => state.auth.selectedTeamId);
	const isGerritConnected = !!user?.gerritConnected;

	const [data, setData] = useState([]);
	const [showGerritModal, setShowGerritModal] = useState(false);
	const [patchCountsByMember, setPatchCountsByMember] = useState({});
	const patchCountsLoading = !!(isGerritConnected && worklogStatus === 'loading');

	const selectedSprintObj = useMemo(() => {
		if (!selectedSprint) return null;
		return sprints.find((s) => String(s.id) === String(selectedSprint)) || null;
	}, [sprints, selectedSprint]);

	const formatGerritDate = useCallback((dateStr) => {
		if (!dateStr) return null;
		const d = new Date(dateStr);
		if (Number.isNaN(d.getTime())) return null;
		return d.toISOString().slice(0, 10); // YYYY-MM-DD
	}, []);

	const parseSprintNameDateRange = useCallback((sprintName, startDateStr) => {
		if (!sprintName || typeof sprintName !== 'string') return { from: null, to: null };

		let baseYear = null;
		if (startDateStr) {
			const d = new Date(startDateStr);
			if (!Number.isNaN(d.getTime())) baseYear = d.getFullYear();
		}
		if (!baseYear) {
			const mYear = sprintName.match(/^(\d{4})/);
			if (mYear) baseYear = Number(mYear[1]);
		}
		if (!baseYear) return { from: null, to: null };

		const mParen = sprintName.match(/\(([^)]+)\)/);
		if (!mParen) return { from: null, to: null };

		const inside = mParen[1];
		const parts = inside.split('-').map((p) => p.trim());
		if (parts.length !== 2) return { from: null, to: null };

		function parseMonthDay(str) {
			const m = str.match(/^(\d{1,2})\/(\d{1,2})$/);
			if (!m) return null;
			const month = Number(m[1]);
			const day = Number(m[2]);
			if (!Number.isFinite(month) || !Number.isFinite(day)) return null;
			if (month < 1 || month > 12) return null;
			if (day < 1 || day > 31) return null;
			return { month, day };
		}

		const startMD = parseMonthDay(parts[0]);
		const endMD = parseMonthDay(parts[1]);
		if (!startMD || !endMD) return { from: null, to: null };

		const fromYear = baseYear;
		let toYear = baseYear;
		if (
			endMD.month < startMD.month ||
			(endMD.month === startMD.month && endMD.day < startMD.day)
		) {
			toYear = baseYear + 1;
		}

		const pad2 = (n) => String(n).padStart(2, '0');
		const from = `${fromYear}-${pad2(startMD.month)}-${pad2(startMD.day)}`;
		const to = `${toYear}-${pad2(endMD.month)}-${pad2(endMD.day)}`;
		return { from, to };
	}, []);

	useEffect(() => {

		if (!selectedSprint) return;
		// Wait until sprints are loaded and we can compute dates; prevents an extra fetch on Jira login.
		if (!selectedSprintObj) return;
		const parsed = selectedSprintObj ? parseSprintNameDateRange(selectedSprintObj.name, selectedSprintObj.startDate) : { from: null, to: null };
		const gerritFromDate = selectedSprintObj ? (formatGerritDate(selectedSprintObj.startDate) || parsed.from) : undefined;
		const gerritToDate = selectedSprintObj ? (formatGerritDate(selectedSprintObj.endDate || selectedSprintObj.completeDate) || parsed.to) : undefined;
		dispatch(fetchSprintWorklogs({ sprintId: selectedSprint, gerritFromDate, gerritToDate, teamId: selectedTeamId }));
		// Also re-run when Gerrit connects/disconnects so patch counts are refreshed from the same endpoint.
	}, [selectedSprint, selectedSprintObj, isGerritConnected, dispatch, formatGerritDate, parseSprintNameDateRange, selectedTeamId]);

	useEffect(() => {
		setPatchCountsByMember(worklogPatchCountsByMember || {});
	}, [worklogPatchCountsByMember]);

	useEffect(() => {
		const getMemberIdFromMember = (memberText) => {
			if (!memberText || typeof memberText !== 'string') return null;
			const parts = memberText.trim().split(/\s+/).filter(Boolean);
			return parts.length ? String(parts[parts.length - 1]).replace(/[;,]+$/g, '') : null;
		};

		const defaultLabelStat = {
			totalOriginalEstimateStoryPoints: 0,
			totalTimeSpentStoryPoints: 0
		};

		if (worklogs && worklogs.length > 0) {
			setData(
				worklogs.map(wl => ({
					member: wl.assigneeName,
					memberKey: getMemberIdFromMember(wl.assigneeName) || wl.assigneeKey,
					storypoints: wl.totalStoryPoints,     
					planned: wl.totalStoryPoints,
					logged: wl.totalTimeSpentStoryPoints,
					diff: wl.totalTimeSpentStoryPoints - wl.totalStoryPoints,
					patches: null,
					development: wl.labelBreakdown?.development || defaultLabelStat,
					issue: wl.labelBreakdown?.issue || defaultLabelStat,
					training: wl.labelBreakdown?.training || defaultLabelStat,
					operation: wl.labelBreakdown?.operation || defaultLabelStat,
					plannedLeave: wl.labelBreakdown?.planned_leave || defaultLabelStat,
					unplannedLeave: wl.labelBreakdown?.unplanned_leave || defaultLabelStat
				}))
			);
		}
	}, [worklogs]);


	const [selectedLabels, setSelectedLabels] = useState({
		development: false,
		issue: false,
		training: false,
		operation: false,
		plannedLeave: false,
		unplannedLeave: false
	});

	const openMemberView = useCallback((memberName) => {
		// Navigate to worklog page instead of showing inline
		navigate(`/dashboard/worklog/${encodeURIComponent(memberName)}`);
	}, [navigate]);

	const columnHelper = createColumnHelper();

	const columns = useMemo(
		() => dashboardColumns(columnHelper, openMemberView, selectedLabels, patchCountsByMember, patchCountsLoading),
		[columnHelper, openMemberView, selectedLabels, patchCountsByMember, patchCountsLoading]
	);

	// Sync patch counts into rows so table has stable values after refresh
	useEffect(() => {
		setData((prev) => {
			if (!prev || prev.length === 0) return prev;
			return prev.map((row) => {
				const key = row?.memberKey || row?.member;
				const val = key && typeof patchCountsByMember[key] === 'number' ? patchCountsByMember[key] : null;
				if (row.patches === val) return row;
				return { ...row, patches: val };
			});
		});
	}, [patchCountsByMember]);

	const table = useReactTable({
		data,
		columns,
		getCoreRowModel: getCoreRowModel()
	});

	const isLoading = sprintStatus === 'loading';

	// Table View Component
	const TableView = () => (
		<>
			<div className="dashboard-updated-row">
				<div className="last-updated">
					Last updated: {lastUpdated ? new Date(lastUpdated).toLocaleString() : '—'}
				</div>
				<button
					className="refresh-button"
					aria-label="Refresh worklogs"
					onClick={() => {
						if (!selectedSprint) return;
						const parsed = selectedSprintObj ? parseSprintNameDateRange(selectedSprintObj.name, selectedSprintObj.startDate) : { from: null, to: null };
						const gerritFromDate = selectedSprintObj ? (formatGerritDate(selectedSprintObj.startDate) || parsed.from) : undefined;
						const gerritToDate = selectedSprintObj ? (formatGerritDate(selectedSprintObj.endDate || selectedSprintObj.completeDate) || parsed.to) : undefined;
						dispatch(fetchSprintWorklogs({ sprintId: selectedSprint, gerritFromDate, gerritToDate, teamId: selectedTeamId, hardLoad: true }));
					}}
					disabled={worklogStatus === 'loading'}
				>
					Refresh
				</button>
			</div>
			{(worklogStatus === 'loading' || patchCountsLoading) && (
				<div className="spinner-overlay-worklogs" role="status" aria-live="polite">
					<div className="spinner" aria-hidden="true"></div>
					<div className="spinner-text">Loading worklogs...</div>
				</div>
			)}
			<div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
				<LabelColumnSelector selectedLabels={selectedLabels} setSelectedLabels={setSelectedLabels} />
			</div>
			<Table table={table} highlightMembers={[user?.name, user?.memberKey]} />
		</>
	);

	// Visual View Component
	const VisualView = () => (
		<>
			{(worklogStatus === 'loading' || patchCountsLoading) ? (
				<div className="spinner-overlay" role="status" aria-live="polite">
					<div className="spinner" aria-hidden="true"></div>
					<div className="spinner-text">Loading worklogs...</div>
				</div>
			) : (
				<SprintVisualization data={data} />
			)}
		</>
	);

	// WorkItem View Component
	const WorkItemView = () => <WorkItemsView />;

	// IssueItem View Component (shows only bugs)
	const IssueItemView = () => <IssueItemsView />;

	// Sprint Review View Component
	const SprintReviewComponent = () => <SprintReviewView />;

	// Patches View Component
	const PatchesViewComponent = () => <PatchesView patchCountsByMember={patchCountsByMember} />;

	// TVPMs View Component
	const TVPMsViewComponent = () => <TVPMsView />;

	// Sprint Planning View Component
	const SprintPlanningComponent = () => <SprintPlanningView />;

	// Health Dashboard Component
	const HealthDashboardComponent = () => <HealthDashboard />;

	return (
		<div className="dashboard">
			{/* Title - header is provided by App layout (AppLayout) */}

			{isLoading && (
				<div className="spinner-overlay-sprints" role="status" aria-live="polite">
					<div className="spinner" aria-hidden="true"></div>
					<div className="spinner-text">Loading sprints...</div>
				</div>
			)}

			<GerritLoginModal visible={showGerritModal} onClose={() => setShowGerritModal(false)} onSuccess={() => dispatch(setGerritConnected(true))} />

			{sprintStatus === 'succeeded' && (
				<Suspense fallback={<div>Loading...</div>}>
					<Routes>
						<Route path="/" element={<HealthDashboardComponent />} />
						<Route path="/health" element={<HealthDashboardComponent />} />
						<Route path="/table" element={<TableView />} />
						<Route path="/visual" element={<VisualView />} />
						<Route path="/workItem" element={<WorkItemView />} />
						<Route path="/issueItem" element={<IssueItemView />} />
						<Route path="/sprintReview" element={<SprintReviewComponent />} />
						<Route path="/patches" element={<PatchesViewComponent />} />
						<Route path="/tvpms" element={<TVPMsViewComponent />} />
						<Route path="/sprintPlanning" element={<SprintPlanningComponent />} />
						<Route path="/worklog/:member" element={<WorklogPage />} />
					</Routes>
				</Suspense>
			)}
		</div>
	);
};

export default Dashboard;
