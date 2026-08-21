import React, { useState, useEffect } from 'react';
import { useDispatch } from 'react-redux';
import AIAnalysisModal from './AIAnalysisModal';
import { analyzeIssue } from '../store/slice/aiAnalysisSlice';
import './css/ItemSections.css';

const ItemSections = ({ hierarchicalItems, issueTypes, expandedSections, setExpandedSections, ISSUE_TYPE_CONFIG, workItems, aiAnalysisData, aiAnalysisLoading, issueAnalysisLoading }) => {
    const dispatch = useDispatch();
    const [modalOpen, setModalOpen] = useState(false);
    const [selectedAIData, setSelectedAIData] = useState(null);
    const [analyzingTicketId, setAnalyzingTicketId] = useState(null);
    console.log('AI Analysis Data:', aiAnalysisData);

    // Clear analyzing ticket ID when analysis completes
    useEffect(() => {
        if (!issueAnalysisLoading && analyzingTicketId) {
            setAnalyzingTicketId(null);
        }
    }, [issueAnalysisLoading, analyzingTicketId]);

    // Create a map of analysis results by ticketId for quick lookup
    const analysisMap = {};
    if (aiAnalysisData && aiAnalysisData.length > 0) {
        aiAnalysisData.forEach(item => {
            if (item.ticketId && item.analysisResult) {
                analysisMap[item.ticketId] = item.analysisResult;
            }
        });
    }

    // Helper function to get analysis from either analysisMap or issueItemSlice
    const getAnalysis = (item) => {
        // First check analysisMap (from aiAnalysisData)
        if (analysisMap[item.key]) {
            return analysisMap[item.key];
        }
        // Then check if issue has analysisCompleted and analysisResult from issueItemSlice
        if (item.analysisCompleted && item.analysisResult) {
            return item.analysisResult;
        }
        return null;
    };

    const handleShowMore = item => {
        const analysis = getAnalysis(item);
        if (analysis) {
            setSelectedAIData(analysis);
            setModalOpen(true);
        }
    };

    const handleAnalyzeIssue = async (item) => {
        setAnalyzingTicketId(item.key);
        dispatch(analyzeIssue(item.key));
    };

    return (
        <>
            <AIAnalysisModal isOpen={modalOpen} onClose={() => setModalOpen(false)} data={selectedAIData} />
            {Object.entries(hierarchicalItems).map(([type, items]) => {
                if (items.length === 0 || !issueTypes.includes(type)) {
                    return null;
                }

                const config = ISSUE_TYPE_CONFIG[type];

                const isExpanded = expandedSections[type] || false;

                return (
                    <div key={type} className="item-section">
                        <div
                            className={`section-header ${isExpanded ? "expanded" : "collapsed"}`}
                            style={{ borderLeftColor: config.color }}
                            onClick={() => setExpandedSections((prev) => ({ ...prev, [type]: !prev[type] }))}
                        >
                            <div className="section-header-content">
                                <span className={`section-toggle ${isExpanded ? "expanded" : "collapsed"}`}>{isExpanded ? "▼" : "▶"}</span>
                                <h2 className="dropdown-title">
                                    {config.label} ({items.length})
                                </h2>
                            </div>
                        </div>

                        {isExpanded && (
                            <div className="items-table-container">
                                <table className="items-table">
                                    <thead>
                                        <tr>
                                            <th>Key</th>
                                            <th>Summary</th>
                                            <th>Assignee</th>
                                            <th>Created Date</th>
                                            <th>Due Date</th>
                                            <th>Status</th>
                                            <th>Analysis Category</th>
                                            <th>AI Analysis</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {items.map((item) => (
                                            <tr key={item.key} className="item-row">
                                                <td className="item-key-cell">
                                                    <a href={item.link} target="_blank" rel="noopener noreferrer" className="item-key">
                                                        {item.key}
                                                    </a>
                                                </td>
                                                <td className="item-summary-cell">{item.summary}</td>
                                                <td className="item-assignee-cell">{item.assignee || "Unassigned"}</td>
                                                <td className="item-date-cell">
                                                    {item.createdDate ? new Date(item.createdDate).toLocaleDateString() : "-"}
                                                </td>
                                                <td className="item-date-cell">
                                                    {item.dueDate ? new Date(item.dueDate).toLocaleDateString() : "-"}
                                                </td>
                                                <td className="item-status-cell">
                                                    <span
                                                        className="status-badge"
                                                        style={{
                                                            backgroundColor: `${config.color}20`,
                                                            color: config.color,
                                                        }}
                                                    >
                                                        {item.status}
                                                    </span>
                                                </td>
                                                <td className="item-analysis-category-cell">
                                                    {getAnalysis(item) ? (
                                                        <span className="category-badge">
                                                            {getAnalysis(item).predicted_category}
                                                        </span>
                                                    ) : (
                                                        <span className="category-pending">-</span>
                                                    )}
                                                </td>
                                                <td className="item-ai-analysis-cell">
                                                    {getAnalysis(item) ? (
                                                        <button 
                                                            className="ai-analysis-btn show-more-btn"
                                                            onClick={() => handleShowMore(item)}
                                                            disabled={aiAnalysisLoading || issueAnalysisLoading}
                                                        >
                                                            Show More
                                                        </button>
                                                    ) : (
                                                        <button 
                                                            className="ai-analysis-btn pending-btn"
                                                            onClick={() => handleAnalyzeIssue(item)}
                                                            disabled={aiAnalysisLoading || issueAnalysisLoading}
                                                        >
                                                            {analyzingTicketId === item.key ? (
                                                                <span className="loader"></span>
                                                            ) : (
                                                                'AI Analysis'
                                                            )}
                                                        </button>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                );
            })}

            {workItems.length === 0 && (
                <div className="no-items">
                    <p>No work items found</p>
                </div>
            )}
        </>
    );
};

export default ItemSections;