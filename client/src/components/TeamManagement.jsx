import React, { useState, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  setTeamMembers,
  addTeamMember,
  removeTeamMember
} from '../store/slice/kpiSlice';
import './css/TeamManagement.css';

export default function TeamManagement() {
  const dispatch = useDispatch();
  const teamMembers = useSelector(state => state.kpi.teamMembers);
  const [isAddingMember, setIsAddingMember] = useState(false);
  const [formData, setFormData] = useState({
    id: '',
    name: '',
    email: '',
    role: ''
  });

  useEffect(() => {
    // Load from localStorage
    try {
      const stored = localStorage.getItem('team_members');
      if (stored) {
        dispatch(setTeamMembers(JSON.parse(stored)));
      }
    } catch (e) {
      console.error('Failed to load team members:', e);
    }
  }, [dispatch]);

  const handleAddMember = () => {
    if (formData.name && formData.email) {
      const newMember = {
        id: Date.now().toString(),
        name: formData.name,
        email: formData.email,
        role: formData.role || 'Team Member'
      };
      dispatch(addTeamMember(newMember));
      
      // Save to localStorage
      const updated = [...teamMembers, newMember];
      localStorage.setItem('team_members', JSON.stringify(updated));
      
      setFormData({ id: '', name: '', email: '', role: '' });
      setIsAddingMember(false);
    }
  };

  const handleRemoveMember = (id) => {
    dispatch(removeTeamMember(id));
    const updated = teamMembers.filter(m => m.id !== id);
    localStorage.setItem('team_members', JSON.stringify(updated));
  };

  return (
    <div className="team-management">
      <h3>Team Members</h3>
      
      <button 
        className="add-member-btn"
        onClick={() => setIsAddingMember(!isAddingMember)}
      >
        {isAddingMember ? 'Cancel' : '+ Add Team Member'}
      </button>

      {isAddingMember && (
        <div className="add-member-form">
          <input
            type="text"
            placeholder="Name"
            value={formData.name}
            onChange={(e) => setFormData({...formData, name: e.target.value})}
          />
          <input
            type="email"
            placeholder="Email"
            value={formData.email}
            onChange={(e) => setFormData({...formData, email: e.target.value})}
          />
          <input
            type="text"
            placeholder="Role (e.g., Developer, QA, PM)"
            value={formData.role}
            onChange={(e) => setFormData({...formData, role: e.target.value})}
          />
          <button onClick={handleAddMember}>Add Member</button>
        </div>
      )}

      <div className="members-list">
        {teamMembers.length === 0 ? (
          <p className="no-members">No team members added yet</p>
        ) : (
          teamMembers.map(member => (
            <div key={member.id} className="member-card">
              <div className="member-info">
                <strong>{member.name}</strong>
                <p>{member.email}</p>
                <span className="role-badge">{member.role}</span>
              </div>
              <button 
                className="remove-btn"
                onClick={() => handleRemoveMember(member.id)}
              >
                Remove
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
