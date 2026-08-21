import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { getAuthHeaders } from '../../utils/api';

export const fetchAssigneeIssues = createAsyncThunk(
  'issue/fetchAssigneeIssues',
  async ({ sprintId, assignee }, { rejectWithValue }) => {
    try {
      const headers = getAuthHeaders();
      const url = `/api/sprints/${encodeURIComponent(sprintId)}/assignees/${encodeURIComponent(assignee)}/issues`;
      const res = await fetch(url, { headers });
      const data = await res.json();
      if (!res.ok) return rejectWithValue(data.error || 'Failed to load issues');
      return data; // { jql, total, issues }
    } catch (err) {
      return rejectWithValue(err.message || 'Network error');
    }
  }
);

const issueSlice = createSlice({
  name: 'issue',
  initialState: {
    issues: [],
    total: 0,
    jql: '',
    status: 'idle',
    error: null
  },
  reducers: {
    clearIssues(state) {
      state.issues = [];
      state.total = 0;
      state.jql = '';
      state.status = 'idle';
      state.error = null;
    }
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchAssigneeIssues.pending, (state) => {
        state.status = 'loading';
        state.error = null;
      })
      .addCase(fetchAssigneeIssues.fulfilled, (state, action) => {
        state.status = 'succeeded';
        state.issues = action.payload.issues || [];
        state.total = action.payload.total || 0;
        state.jql = action.payload.jql || '';
      })
      .addCase(fetchAssigneeIssues.rejected, (state, action) => {
        state.status = 'failed';
        state.error = action.payload || 'Failed to fetch issues';
      });
  }
});

export const { clearIssues } = issueSlice.actions;
export default issueSlice.reducer;
