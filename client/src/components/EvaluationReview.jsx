import React, { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { setEvaluation } from '../store/slice/kpiSlice';
import './css/EvaluationReview.css';

const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'];

export default function EvaluationReview() {
  const dispatch = useDispatch();
  const selectedYear = useSelector(state => state.kpi.selectedYear);
  const evaluations = useSelector(state => state.kpi.evaluations);
  const [selectedQuarter, setSelectedQuarter] = useState('Q1');
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState(
    evaluations[selectedYear]?.[selectedQuarter] || {
      overallAssessment: '',
      strengths: '',
      weaknesses: '',
      recommendations: '',
      nextQuarterGoals: '',
      rating: 'Needs Improvement'
    }
  );

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSave = () => {
    dispatch(setEvaluation({
      year: selectedYear,
      quarter: selectedQuarter,
      data: formData
    }));

    // Save to localStorage
    try {
      const stored = localStorage.getItem('kpi_evaluations');
      const all = stored ? JSON.parse(stored) : {};
      if (!all[selectedYear]) all[selectedYear] = {};
      all[selectedYear][selectedQuarter] = formData;
      localStorage.setItem('kpi_evaluations', JSON.stringify(all));
    } catch (e) {
      console.error('Failed to save evaluation:', e);
    }

    setIsEditing(false);
  };

  const handleQuarterChange = (quarter) => {
    setSelectedQuarter(quarter);
    setFormData(
      evaluations[selectedYear]?.[quarter] || {
        overallAssessment: '',
        strengths: '',
        weaknesses: '',
        recommendations: '',
        nextQuarterGoals: '',
        rating: 'Needs Improvement'
      }
    );
    setIsEditing(false);
  };

  const ratingColors = {
    'Excellent': '#28a745',
    'Good': '#17a2b8',
    'Satisfactory': '#ffc107',
    'Needs Improvement': '#dc3545'
  };

  return (
    <div className="evaluation-review">
      <h3>Quarterly Evaluation & Review — {selectedYear}</h3>

      {/* Quarter tabs */}
      <div className="quarter-tabs">
        {QUARTERS.map(quarter => (
          <button
            key={quarter}
            className={`quarter-tab ${selectedQuarter === quarter ? 'active' : ''}`}
            onClick={() => handleQuarterChange(quarter)}
          >
            {quarter}
          </button>
        ))}
      </div>

      {!isEditing ? (
        <div className="evaluation-view">
          <div className="evaluation-header">
            <h4>{selectedQuarter} {selectedYear} Evaluation</h4>
            <button className="edit-btn" onClick={() => setIsEditing(true)}>
              Edit Evaluation
            </button>
          </div>

          <div className="evaluation-rating">
            <label>Overall Rating:</label>
            <span 
              className="rating-badge"
              style={{ backgroundColor: ratingColors[formData.rating] }}
            >
              {formData.rating}
            </span>
          </div>

          <div className="evaluation-section">
            <h5>Overall Assessment</h5>
            <p>{formData.overallAssessment || 'No assessment yet'}</p>
          </div>

          <div className="evaluation-row">
            <div className="evaluation-column">
              <h5>✅ Strengths</h5>
              <p>{formData.strengths || 'Not specified'}</p>
            </div>
            <div className="evaluation-column">
              <h5>⚠️ Weaknesses</h5>
              <p>{formData.weaknesses || 'Not specified'}</p>
            </div>
          </div>

          <div className="evaluation-section">
            <h5>💡 Recommendations</h5>
            <p>{formData.recommendations || 'No recommendations'}</p>
          </div>

          <div className="evaluation-section">
            <h5>🎯 Next Quarter Goals</h5>
            <p>{formData.nextQuarterGoals || 'Goals not set'}</p>
          </div>
        </div>
      ) : (
        <div className="evaluation-edit">
          <div className="evaluation-header">
            <h4>Edit {selectedQuarter} {selectedYear} Evaluation</h4>
            <button className="cancel-btn" onClick={() => setIsEditing(false)}>
              Cancel
            </button>
          </div>

          <div className="form-group-eval">
            <label>Overall Rating</label>
            <select
              value={formData.rating}
              onChange={(e) => handleChange('rating', e.target.value)}
            >
              <option>Excellent</option>
              <option>Good</option>
              <option>Satisfactory</option>
              <option>Needs Improvement</option>
            </select>
          </div>

          <div className="form-group-eval">
            <label>Overall Assessment</label>
            <textarea
              value={formData.overallAssessment}
              onChange={(e) => handleChange('overallAssessment', e.target.value)}
              placeholder="Provide an overall assessment of the quarter's performance"
              rows="4"
            />
          </div>

          <div className="form-row-eval">
            <div className="form-group-eval">
              <label>Strengths</label>
              <textarea
                value={formData.strengths}
                onChange={(e) => handleChange('strengths', e.target.value)}
                placeholder="What went well this quarter?"
                rows="3"
              />
            </div>
            <div className="form-group-eval">
              <label>Weaknesses</label>
              <textarea
                value={formData.weaknesses}
                onChange={(e) => handleChange('weaknesses', e.target.value)}
                placeholder="What areas need improvement?"
                rows="3"
              />
            </div>
          </div>

          <div className="form-group-eval">
            <label>Recommendations</label>
            <textarea
              value={formData.recommendations}
              onChange={(e) => handleChange('recommendations', e.target.value)}
              placeholder="What recommendations do you have?"
              rows="4"
            />
          </div>

          <div className="form-group-eval">
            <label>Next Quarter Goals</label>
            <textarea
              value={formData.nextQuarterGoals}
              onChange={(e) => handleChange('nextQuarterGoals', e.target.value)}
              placeholder="Set goals for the next quarter"
              rows="4"
            />
          </div>

          <button className="save-btn" onClick={handleSave}>
            Save Evaluation
          </button>
        </div>
      )}
    </div>
  );
}
