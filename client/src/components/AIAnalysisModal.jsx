import React from 'react';
import './css/ItemSections.css';

const AIAnalysisModal = ({ isOpen, onClose, data }) => {
    if (!isOpen) return null;

    const confidence = Number(data.confidence_score || 0);
    let progressColor = '#28a745';
    if (confidence < 60) {
        progressColor = '#dc3545';
    } else if (confidence < 80) {
        progressColor = '#ffc107';
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>AI Analysis</h2>
                    <button className="modal-close-btn" onClick={onClose}>×</button>
                </div>
                <div className="modal-body">
                    <div className="analysis-section">
                        <div className="analysis-field">
                            <label>Issue ID:</label>
                            <p>{data['Issue ID']}</p>
                        </div>
                        <div className="analysis-field">
                            <label>Predicted Issue ID:</label>
                            <p>{data.predicted_issue_id}</p>
                        </div>
                        <div className="analysis-field">
                            <label>Predicted Category:</label>
                            <p>{data.predicted_category}</p>
                        </div>
                        <div className="analysis-field">
                            <label>Likely Cause:</label>
                            <p>{data.likely_cause}</p>
                        </div>
                        {/* <div className="analysis-field">
                            <label>Suggested Fix:</label>
                            <p className="multiline-text">{data.suggested_fix}</p>
                        </div> */}
                        <div className="analysis-field">
                            <label>Suggested Fix:</label>
                            <p className="multiline-text">{data.recommended_fix}</p>
                        </div>
                        <div className="analysis-field">
                            <label>AI Explanation:</label>
                            <p className="multiline-text">{data.explanation}</p>
                        </div>
                        <div className="analysis-field">
                            <label>Confidence Score:</label>
                            <div className="progress-container">
                                <div className="progress-bar">
                                    <div 
                                        className="progress-fill" 
                                        style={{ width: `${confidence}%`, backgroundColor: progressColor }}
                                    ></div>
                                </div>
                                <span className="progress-value">{confidence.toFixed(2)}%</span>
                            </div>
                        </div>
                    </div>

                    <div className="similar-issues-section">
                        <h3>Similar Issues</h3>
                        <div className="similar-issues-list">
                            {data.similar_issues && data.similar_issues.map((issue, index) => (
                                <div key={index} className="similar-issue-item">
                                    <div className="issue-id">{issue.issue_id}</div>
                                    <div className="issue-cause">{issue.likely_cause}</div>
                                    <div className="issue-distance">Distance: {(issue.match_percentage).toFixed(2)}%</div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AIAnalysisModal;
