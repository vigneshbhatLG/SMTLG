import React, { useState, useEffect, useMemo } from "react";
import { useDispatch, useSelector } from "react-redux";
import { fetchIssueItems, setFilters, setRefresh } from "../store/slice/issueItemSlice";
import { fetchAIAnalysis } from "../store/slice/aiAnalysisSlice";
import ItemSections from '../components/ItemSections';
import BugsTable from '../components/BugsTable';
import "./css/WorkItemsView.css";

const ISSUE_TYPE_CONFIG = {
    initiative: { label: "Initiatives", color: "#2563eb", jiraType: "Initiative" },
    epic: { label: "Epics", color: "#7c3aed", jiraType: "Epic" },
    stories: { label: "Stories", color: "#0891b2", jiraType: "Story" },
    bug: { label: "Bugs", color: "#dc2626", jiraType: "Bug" },
};

// Common Jira statuses
const JIRA_STATUSES = [
    { value: "Active", label: "Active" },
    { value: "Done", label: "Done" },
];

// Reverse mapping from Jira type to frontend key
const JIRA_TYPE_TO_KEY = Object.entries(ISSUE_TYPE_CONFIG).reduce((acc, [key, config]) => {
    acc[config.jiraType] = key;
    return acc;
}, {});

function IssueItemPage({ issueTypes = ["bug"] }) {
    const dispatch = useDispatch();
    const user = useSelector((state) => state.auth.user);
    const selectedTeamId = useSelector((state) => state.auth.selectedTeamId);
    console.log('Selected Team ID in IssueItemPage:', selectedTeamId);
    const teamId = selectedTeamId
    const workItems = useSelector((state) => state.issueItems.items);
    const bugCountByUser = useSelector((state) => state.issueItems.bugCountByUser);
    const status = useSelector((state) => state.issueItems.status);
    const error = useSelector((state) => state.issueItems.error);
    const refresh = useSelector((state) => state.issueItems.refresh);
    const aiAnalysisLoading = useSelector((state) => state.aiAnalysis.loading);
    const issueAnalysisLoading = useSelector((state) => state.aiAnalysis.issueAnalysisLoading);
    const aiAnalysisData = useSelector((state) => state.aiAnalysis.analysisData);

    const [selectedAssignee, setSelectedAssignee] = useState(""); // Empty string means all assignees
    const [selectedStatuses, setSelectedStatuses] = useState(["Active"]); // Default to Active status
    const [expandedSections, setExpandedSections] = useState({}); // Track expanded sections, default closed
	const [expandedBugsListSections, setExpandedBugsListSections] = useState({}); // Track expanded sections, default closed
    // Fetch work items when filters change
    useEffect(() => {
        if (teamId == null) return;

        const assignee = selectedAssignee || undefined;

        if (refresh) {
            dispatch(
                fetchIssueItems({
                    teamId,
                    issueStatuses: selectedStatuses.length > 0 ? selectedStatuses : undefined,
                    assignee,
                }),
            );
        }

        dispatch(
            setFilters({
                teamId,
                issueStatuses: selectedStatuses,
                selectedAssignee,
                assignee,
            }),
        );
    }, [dispatch, teamId, selectedAssignee, selectedStatuses, user, refresh]);

    const refreshData = () => {
        dispatch(setRefresh());
    };

    const handleAIAnalysis = () => {
        dispatch(fetchAIAnalysis());
    };

    // Group and sort work items hierarchically
    const hierarchicalItems = useMemo(() => {
        const grouped = {
            initiative: [],
            epic: [],
            stories: [],
            bug: [],
        };

        workItems.forEach((item) => {
            const jiraType = item.type; // Changed from item.issueType to item.type
            const frontendKey = JIRA_TYPE_TO_KEY[jiraType] || "bug";
            if (grouped[frontendKey]) {
                grouped[frontendKey].push(item);
            }
        });

        return grouped;
    }, [workItems]);

    return (
        <div className="work-item-page">
            {/* Filters Section */}
            <div className="work-item-filters">
                {/* Assignee filter */}
                <div className="filter-group">
                    <label className="filter-label">Assignee:</label>
                    <select className="assignee-select" value={selectedAssignee} onChange={(e) => setSelectedAssignee(e.target.value)}>
                        <option value="">All Assignees</option>
                        {user && <option value={user.name}>My Work Items ({user.name})</option>}
                    </select>

                </div>

                {/* Status filter */}
                <div className="filter-group">
                    <label className="filter-label">Status:</label>
                    <div className="status-checkboxes">
                        {JIRA_STATUSES.map((status) => (
                            <label key={status.value} className="checkbox-label">
                                <input
                                    type="checkbox"
                                    checked={selectedStatuses.includes(status.value)}
                                    onChange={(e) => {
                                        if (e.target.checked) {
                                            setSelectedStatuses([...selectedStatuses, status.value]);
                                        } else {
                                            setSelectedStatuses(selectedStatuses.filter((s) => s !== status.value));
                                        }
                                    }}
                                />
                                <span className="checkbox-text">{status.label}</span>
                            </label>
                        ))}
                    </div>
                </div>
                <button className="refresh-button" onClick={refreshData} disabled={status === "loading"}>Refresh</button>

                {/* AI Analysis Button with Loader */}
                <button 
                    className="ai-analysis-button" 
                    onClick={handleAIAnalysis} 
                    disabled={aiAnalysisLoading || workItems.length === 0}
                >
                    {aiAnalysisLoading ? (
                        <>
                            <div className="ai-button-spinner"></div>
                            <span>Analyzing...</span>
                        </>
                    ) : (
                        <span>AI Analysis</span>
                    )}
                </button>
            </div>

            {/* Loading and Error States */}
            {status === "loading" && (
                <div className="loading-spinner">
                    <div className="spinner"></div>
                    <p>Loading issue items...</p>
                </div>
            )}

            {status === "failed" && error && (
                <div className="error-message">
                    <p>Error: {error}</p>
                </div>
            )}

            {/* Work Items Content */}
            {status === "succeeded" && (
                <div className="work-items-container">
                    {/* Bug Count Statistics - only show for bug issue types */}
                    <div className="bug-statistics-section">
                        <div className="bug-stats-table-container">
                            <table className="bug-stats-table">
                                <thead>
                                    <tr>
                                        {Object.entries(bugCountByUser)
                                            .sort(([, a], [, b]) => b - a) // Sort by count descending
                                            .map(([user]) => (
                                                <th key={user} className="bug-stat-header">
                                                    {user}
                                                </th>
                                            ))}
                                        <th className="bug-stat-header bug-stat-total-header">Total</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr>
                                        {Object.entries(bugCountByUser)
                                            .sort(([, a], [, b]) => b - a) // Sort by count descending
                                            .map(([user, count]) => (
                                                <td key={user} className="bug-stat-count">
                                                    {count}
                                                </td>
                                            ))}
                                        <td className="bug-stat-count bug-stat-total">
                                            {Object.values(bugCountByUser).reduce((sum, count) => sum + count, 0)}
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <ItemSections
                        hierarchicalItems={hierarchicalItems}
                        issueTypes={issueTypes}
                        expandedSections={expandedSections}
                        setExpandedSections={setExpandedSections}
                        ISSUE_TYPE_CONFIG={ISSUE_TYPE_CONFIG}
                        workItems={workItems}
                        aiAnalysisData={aiAnalysisData}
                        aiAnalysisLoading={aiAnalysisLoading}
                        issueAnalysisLoading={issueAnalysisLoading}
                    />

					<BugsTable
                        hierarchicalItems={hierarchicalItems}
                        issueTypes={issueTypes}
                        expandedBugsListSections={expandedBugsListSections}
                        setExpandedBugsListSections={setExpandedBugsListSections}
                        ISSUE_TYPE_CONFIG={ISSUE_TYPE_CONFIG}
                    />
                </div>
            )}
        </div>
    );
}

export default IssueItemPage;
