import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  // Organization-wide KPIs
  organizationKpis: {}, // { [year]: { [quarter]: { promise, effort, achieved, comments, improvement } } }
  
  // Team member individual KPIs
  teamMemberKpis: {}, // { [memberId]: { [year]: { [quarter]: { promise, effort, achieved, comments, improvement } } } }
  
  // Evaluation assessments
  evaluations: {}, // { [year]: { [quarter]: { overallAssessment, recommendations, strengths, weaknesses } } }
  
  // Team members list
  teamMembers: [], // [{ id, name, email, role }]
  
  selectedYear: new Date().getFullYear(),
  selectedQuarter: null,
  selectedMemberId: null
};

const kpiSlice = createSlice({
  name: 'kpi',
  initialState,
  reducers: {
    // Organization KPI actions
    setKPIData(state, action) {
      const { year, quarter, data } = action.payload;
      if (!state.organizationKpis[year]) {
        state.organizationKpis[year] = {};
      }
      state.organizationKpis[year][quarter] = data;
    },
    
    // Team member KPI actions
    setTeamMemberKPI(state, action) {
      const { memberId, year, quarter, data } = action.payload;
      if (!state.teamMemberKpis[memberId]) {
        state.teamMemberKpis[memberId] = {};
      }
      if (!state.teamMemberKpis[memberId][year]) {
        state.teamMemberKpis[memberId][year] = {};
      }
      state.teamMemberKpis[memberId][year][quarter] = data;
    },
    
    // Evaluation actions
    setEvaluation(state, action) {
      const { year, quarter, data } = action.payload;
      if (!state.evaluations[year]) {
        state.evaluations[year] = {};
      }
      state.evaluations[year][quarter] = data;
    },
    
    // Team member management
    addTeamMember(state, action) {
      state.teamMembers.push(action.payload);
    },
    removeTeamMember(state, action) {
      state.teamMembers = state.teamMembers.filter(m => m.id !== action.payload);
    },
    setTeamMembers(state, action) {
      state.teamMembers = action.payload;
    },
    
    // UI state
    setSelectedYear(state, action) {
      state.selectedYear = action.payload;
    },
    setSelectedQuarter(state, action) {
      state.selectedQuarter = action.payload;
    },
    setSelectedMemberId(state, action) {
      state.selectedMemberId = action.payload;
    },
    
    // Load from storage
    loadKPIsFromStorage(state, action) {
      state.organizationKpis = action.payload.organizationKpis || {};
      state.teamMemberKpis = action.payload.teamMemberKpis || {};
      state.evaluations = action.payload.evaluations || {};
      state.teamMembers = action.payload.teamMembers || [];
    }
  }
});

export const {
  setKPIData,
  setTeamMemberKPI,
  setEvaluation,
  addTeamMember,
  removeTeamMember,
  setTeamMembers,
  setSelectedYear,
  setSelectedQuarter,
  setSelectedMemberId,
  loadKPIsFromStorage
} = kpiSlice.actions;
export default kpiSlice.reducer;
