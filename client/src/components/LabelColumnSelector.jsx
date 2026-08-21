import React from 'react';

const LabelColumnSelector = ({ selectedLabels, setSelectedLabels }) => {
  const options = [
    { key: 'development', label: 'Development' },
    { key: 'issue', label: 'Issue' },
    { key: 'training', label: 'Training' },
    { key: 'operation', label: 'Operation' },
    { key: 'plannedLeave', label: 'Planned Leave' },
    { key: 'unplannedLeave', label: 'Unplanned Leave' }
  ];

  return (
    <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginBottom: 12 }}>
      {options.map((opt) => (
        <label key={opt.key} style={{ fontSize: 14 }}>
          <input
            type="checkbox"
            checked={!!selectedLabels?.[opt.key]}
            onChange={() => setSelectedLabels(prev => ({ ...prev, [opt.key]: !prev[opt.key] }))}
          />
          &nbsp;{opt.label}
        </label>
      ))}
    </div>
  );
};

export default LabelColumnSelector;
