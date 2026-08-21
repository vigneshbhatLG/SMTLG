import React, { useState, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { setKPIData, setSelectedYear, loadKPIsFromStorage } from '../store/slice/kpiSlice';
import TeamManagement from '../components/TeamManagement';
import KPIAnalytics from '../components/KPIAnalytics';
import EvaluationReview from '../components/EvaluationReview';
import './css/KPIPage.css';

const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'];
const STORAGE_KEY = 'kpi_tracker_data';

function QuarterCard({ quarter, year, data, onUpdate }) {
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState(data || {
    promise: '',
    effort: 0,
    achieved: 0,
    comments: '',
    improvement: ''
  });

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSave = () => {
    onUpdate(quarter, formData);
    setIsEditing(false);
  };

  const progressPercent = formData.effort > 0 
    ? Math.round((formData.achieved / formData.effort) * 100) 
    : 0;

  return (
    <div className="kpi-card">
      <div className="kpi-card-header">
        <h3>{quarter}</h3>
        <button 
          className="edit-btn"
          onClick={() => setIsEditing(!isEditing)}
        >
          {isEditing ? 'Cancel' : 'Edit'}
        </button>
      </div>

      {!isEditing ? (
        <div className="kpi-card-view">
          <div className="kpi-field">
            <strong>Promise:</strong> {formData.promise || 'N/A'}
          </div>
          <div className="kpi-field">
            <strong>Effort (hours):</strong> {formData.effort}
          </div>
          <div className="kpi-field">
            <strong>Achieved (hours):</strong> {formData.achieved}
          </div>
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${progressPercent}%` }}>
              {progressPercent}%
            </div>
          </div>
          <div className="kpi-field">
            <strong>Comments:</strong> {formData.comments || 'N/A'}
          </div>
          <div className="kpi-field">
            <strong>Need Improvement:</strong> {formData.improvement || 'N/A'}
          </div>
        </div>
      ) : (
        <div className="kpi-card-edit">
          <div className="form-group">
            <label>Promise</label>
            <textarea
              value={formData.promise}
              onChange={(e) => handleChange('promise', e.target.value)}
              placeholder="What is the promise for this quarter?"
            />
          </div>

          <div className="form-group">
            <label>Effort (hours)</label>
            <input
              type="number"
              value={formData.effort}
              onChange={(e) => handleChange('effort', Number(e.target.value))}
              placeholder="Estimated effort in hours"
            />
          </div>

          <div className="form-group">
            <label>Achieved (hours)</label>
            <input
              type="number"
              value={formData.achieved}
              onChange={(e) => handleChange('achieved', Number(e.target.value))}
              placeholder="Hours actually achieved"
            />
          </div>

          <div className="form-group">
            <label>Comments</label>
            <textarea
              value={formData.comments}
              onChange={(e) => handleChange('comments', e.target.value)}
              placeholder="Add any comments about this quarter"
            />
          </div>

          <div className="form-group">
            <label>Need Improvement</label>
            <textarea
              value={formData.improvement}
              onChange={(e) => handleChange('improvement', e.target.value)}
              placeholder="What areas need improvement?"
            />
          </div>

          <button className="save-btn" onClick={handleSave}>
            Save Changes
          </button>
        </div>
      )}
    </div>
  );
}

export default function KPIPage() {
  const dispatch = useDispatch();
  const selectedYear = useSelector(state => state.kpi.selectedYear);
  const kpis = useSelector(state => state.kpi.organizationKpis);
  const [activeTab, setActiveTab] = useState('organization');
  
  const currentYearKPIs = kpis[selectedYear] || {};

  useEffect(() => {
    // Load from localStorage on mount
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        dispatch(loadKPIsFromStorage(parsed));
      }
    } catch (e) {
      console.error('Failed to load from localStorage:', e);
    }
  }, [dispatch]);

  const handleUpdateKPI = (quarter, data) => {
    dispatch(setKPIData({ year: selectedYear, quarter, data }));
    
    // Save to localStorage
    try {
      const allData = {
        kpis: {
          ...kpis,
          [selectedYear]: {
            ...currentYearKPIs,
            [quarter]: data
          }
        }
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(allData));
    } catch (e) {
      console.error('Failed to save to localStorage:', e);
    }
  };

  return (
    <div className="kpi-page">
      <div className="kpi-container">
        <div className="kpi-header">
          <h1>KPI Dashboard & Performance Management</h1>
          <div className="year-selector">
            <label htmlFor="year">Select Year:</label>
            <input
              id="year"
              type="number"
              value={selectedYear}
              onChange={(e) => dispatch(setSelectedYear(Number(e.target.value)))}
              min="2020"
              max="2030"
            />
          </div>
        </div>

        {/* Development banner */}
        <div className="kpi-dev-banner">
          🚧 KPI Dashboard is still under development. Some features may be missing or incomplete.
        </div>

        {/* Tab Navigation */}
        <div className="kpi-tabs">
          <button 
            className={`tab-btn ${activeTab === 'organization' ? 'active' : ''}`}
            onClick={() => setActiveTab('organization')}
          >
            📊 Organization KPIs
          </button>
          <button 
            className={`tab-btn ${activeTab === 'analytics' ? 'active' : ''}`}
            onClick={() => setActiveTab('analytics')}
          >
            📈 Performance Analytics
          </button>
          <button 
            className={`tab-btn ${activeTab === 'evaluation' ? 'active' : ''}`}
            onClick={() => setActiveTab('evaluation')}
          >
            ✅ Quarterly Reviews
          </button>
          <button 
            className={`tab-btn ${activeTab === 'team' ? 'active' : ''}`}
            onClick={() => setActiveTab('team')}
          >
            👥 Team Management
          </button>
        </div>

        {/* Tab Content */}
        <div className="tab-content">
          {activeTab === 'organization' && (
            <div>
              <div className="kpi-grid">
                {QUARTERS.map(quarter => (
                  <QuarterCard
                    key={quarter}
                    quarter={quarter}
                    year={selectedYear}
                    data={currentYearKPIs[quarter]}
                    onUpdate={handleUpdateKPI}
                  />
                ))}
              </div>
            </div>
          )}

          {activeTab === 'analytics' && (
            <KPIAnalytics />
          )}

          {activeTab === 'evaluation' && (
            <EvaluationReview />
          )}

          {activeTab === 'team' && (
            <TeamManagement />
          )}
        </div>
      </div>
    </div>
  );
}
